import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title';
import { receiptHost, user, gate, textChunks } from './helpers/message-receipts-host.mjs';

// Exact shipped dsh-base@0.1.5-rc.2 composition. The real title service,
// provider, Agent, projections, Loader and JSONL store run; only LLM I/O is scripted.
const titleConfig = { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 };
const providerConfig = { targetWords: 5, targetCjkCharacters: 10, maxInputBytes: 4096, maxOutputTokens: 64, timeoutMs: 60000 };
async function registerFirstPrompt(h) {
  await h.loader.create({ name: '@deepseek-ai/dsh-session-title-first-prompt-llm', config: providerConfig });
  await h.loader.await();
}
const titles = session => session.snapshotEvents().filter(e => e.type === 'session/title');
const readReceipt = (h, receipt) => h.ctx.tools.get('session_wait').execute({ sessionId: receipt.sessionId, messageId: receipt.messageId }, {});

const cases = [
  { label: 'omitted title', prompt: 'Review this task', expected: 'Review this task' },
  { label: 'empty title', title: '', prompt: 'Review this task', expected: 'Review this task' },
  { label: 'whitespace title', title: ' \t\n ', prompt: '修复会话标题', expected: '修复会话标题' },
  { label: 'explicit title', title: '  My chosen title  ', prompt: 'Ignore this for naming', expected: 'My chosen title' },
  { label: 'five word limit', prompt: 'one two three four five six seven', expected: 'one two three four five' },
  { label: 'long word byte limit', prompt: 'x'.repeat(100), expected: 'x'.repeat(40) },
  { label: 'Chinese byte limit', prompt: '请帮我检查这个项目的自动命名逻辑是否正常运行', expected: '请帮我检查这个项目的自动命' },
  { label: 'whole Unicode code points', prompt: 'x'.repeat(37) + '😀tail', expected: 'x'.repeat(37) },
  { label: 'prompt control and whitespace normalization', prompt: '\u001b[31m第一行\u001b[0m\n  第二行\t第三行\u202e', expected: '第一行 第二行 第三行' },
  { label: 'explicit title host normalization', title: '\u001b[32mChosen\u001b[0m\n\t title\u202e', prompt: 'Other task', expected: 'Chosen title' },
  { label: 'explicit title uses accepted-title rather than fallback limit', title: 'x'.repeat(100), prompt: 'Other task', expected: 'x'.repeat(80) },
];

for (const { label, expected, ...args } of cases) {
  test(`real creation names once: ${label}`, { timeout: 15000 }, async t => {
    const h = await receiptHost(t, { titleConfig });
    const caller = await h.holdCaller();
    await registerFirstPrompt(h);
    const requestsBefore = h.model.requests.length;
    h.model.text('first task result');
    const created = await h.ctx.tools.get('session_create').execute({ ...args, wait: true, timeoutMs: 1000 }, caller.exec);
    const target = h.ctx.agents.get(created.sessionId);
    assert.equal(created.title, expected);
    assert.equal(h.ctx.sessionTitle.get(target.session).title, expected);
    assert.equal(created.messageStatus, 'turnCompleted');
    assert.equal(created.output, 'first task result');
    assert.equal(h.model.requests.length, requestsBefore + 1, 'only the task uses a model request');
    assert.equal(h.model.requests.some(r => r.purpose === 'session-title'), false);
    assert.equal(target.session.header.parentSession, caller.caller.agent.id);
    const events = target.session.snapshotEvents();
    const title = titles(target.session);
    const message = events.find(e => e.type === 'user/message');
    assert.equal(title.length, 1);
    assert.ok(title[0].seq < message.seq, 'title is committed before the first message is admitted');
    assert.deepEqual(title[0].data, { title: expected, source: { kind: 'user' }, messageSeqs: [] });
    assert.equal(message.data.id, created.messageId);
    assert.deepEqual(message.data.source, { kind: 'plugin', plugin: 'tool-session' });
    assert.equal(message.data.content[0].text, args.prompt.trim(), 'title cleanup must not rewrite the task');
    const create = h.ctx.tools.get('session_create');
    assert.deepEqual(create.output.presentationMeta(args, created), { sessionId: created.sessionId, title: expected });
    assert.match(create.output.render(args, created)[0].text, new RegExp(created.messageId));
    await h.ctx.sessionPersistence.flush();
    const stored = await h.read(created.sessionId);
    assert.equal(foldSessionTitle(stored.events).title, expected);
    assert.deepEqual(stored.events.find(e => e.type === 'user/message').data.source, message.data.source);
  });
}

test('non-waiting creation returns its fixed title while the first turn is still running', { timeout: 15000 }, async t => {
  const h = await receiptHost(t, { titleConfig });
  const caller = await h.holdCaller(); await registerFirstPrompt(h);
  const hold = gate(), started = Promise.withResolvers(); t.after(hold.release);
  h.model.scripts.push(async function* (options) { started.resolve(); await hold.wait(options.signal); yield* textChunks('eventual result'); });
  const created = await h.ctx.tools.get('session_create').execute({ prompt: 'One two three four five six' }, caller.exec);
  await started.promise;
  assert.equal(created.title, 'One two three four five');
  assert.equal(h.ctx.agents.get(created.sessionId).status, 'running');
  assert.ok(['queued', 'delivered'].includes(created.messageStatus));
  assert.equal(created.output, undefined);
  hold.release(); await h.ctx.agents.get(created.sessionId).whenIdle();
  assert.equal((await readReceipt(h, created)).output, 'eventual result');
});

for (const mode of ['first-prompt', 'all-prompts']) {
  test(`real ${mode} provider cannot overwrite pinned titles, including after restart`, { timeout: 15000 }, async t => {
    let h = await receiptHost(t, { titleConfig });
    const caller = await h.holdCaller();
    let allPromptCalls = 0;
    const register = () => mode === 'first-prompt' ? registerFirstPrompt(h) : h.ctx.sessionTitle.register({
      id: 'fixture-all-prompts', automatic: 'all-prompts',
      async generate(request) {
        allPromptCalls++;
        return { title: 'provider probe', messageSeqs: request.messages.map(m => m.seq) };
      },
    });
    await register();
    // Positive control: the real first-prompt provider (or all-prompts contract
    // probe) is live and can generate, so absence of later work is meaningful.
    if (mode === 'first-prompt') h.model.text('provider probe');
    assert.equal((await h.ctx.sessionTitle.refresh(caller.caller.agent.session)).title, 'provider probe');
    const titleRequests = h.model.requests.filter(r => r.purpose === 'session-title').length;
    assert.equal(mode === 'first-prompt' ? titleRequests : allPromptCalls, 1);
    h.model.text('initial answer');
    const created = await h.ctx.tools.get('session_create').execute({ prompt: 'Keep the initial task title', wait: true }, caller.exec);
    const target = h.ctx.agents.get(created.sessionId);
    h.model.text('plugin followup answer');
    await h.ctx.tools.get('session_send').execute({ sessionId: created.sessionId, message: 'Different later plugin task', wait: true }, caller.exec);
    h.model.text('human followup answer'); target.followup(user('Different later human task')); await target.whenIdle();
    assert.equal(h.ctx.sessionTitle.get(target.session).title, created.title);
    assert.equal(titles(target.session).length, 1);
    assert.equal((await readReceipt(h, created)).output, 'initial answer');
    assert.equal(h.model.requests.filter(r => r.purpose === 'session-title').length, titleRequests);
    if (mode === 'all-prompts') assert.equal(allPromptCalls, 1);
    caller.release(); await caller.caller.agent.whenIdle();
    h = await h.restart(); await register();
    assert.equal(foldSessionTitle((await h.read(created.sessionId)).events).title, created.title);
    assert.equal((await readReceipt(h, created)).output, 'initial answer');
    assert.equal(h.ctx.agents.get(created.sessionId), undefined, 'cold receipt/title reads never resume the target');
    const resumed = await h.ctx.agents.resume({ resumeSessionId: created.sessionId, agentOptions: { provider: 'fixture', model: 'scripted' } });
    h.model.text('resumed human answer'); resumed.agent.followup(user('A new topic after restart')); await resumed.agent.whenIdle();
    assert.equal(h.ctx.sessionTitle.get(resumed.agent.session).title, created.title);
    assert.equal(titles(resumed.agent.session).length, 1);
    assert.equal(h.model.requests.some(r => r.purpose === 'session-title'), false);
    if (mode === 'all-prompts') assert.equal(allPromptCalls, 1);
    h.ctx.sessionTitle.rename(resumed.agent.session, 'Manually chosen title');
    h.model.text('after manual rename'); resumed.agent.followup(user('Another topic')); await resumed.agent.whenIdle();
    assert.equal(h.ctx.sessionTitle.get(resumed.agent.session).title, 'Manually chosen title');
    await h.ctx.sessionPersistence.flush();
    assert.equal(foldSessionTitle((await h.read(created.sessionId)).events).title, 'Manually chosen title');
    assert.equal((await readReceipt(h, created)).output, 'initial answer');
  });
}

test('a stricter custom host title cap is still enforced by public rename', { timeout: 15000 }, async t => {
  const h = await receiptHost(t, { titleConfig: { fallbackMaxWords: 5, fallbackMaxBytes: 12, maxTitleBytes: 12 } });
  const caller = await h.holdCaller(); h.model.text('answer');
  const created = await h.ctx.tools.get('session_create').execute({ prompt: 'LongEnoughTaskName', wait: true }, caller.exec);
  assert.equal(created.title, 'LongEnoughTa');
});

for (const title of [undefined, '\u001b[31m\u001b[0m\u202e']) {
  test(`no visible ${title === undefined ? 'fallback' : 'explicit'} title fails before delivery`, { timeout: 15000 }, async t => {
    const h = await receiptHost(t, { titleConfig }); const caller = await h.holdCaller();
    const before = h.model.requests.length;
    const prompt = title === undefined ? '\u001b[31m\u001b[0m\u202e' : 'A visible task';
    await assert.rejects(h.ctx.tools.get('session_create').execute({ prompt, ...(title === undefined ? {} : { title }) }, caller.exec), /visible characters/);
    assert.equal(h.model.requests.length, before);
    await h.ctx.sessionPersistence.flush();
    for (const { header } of await h.ctx.sessionPersistence.list()) {
      if (header.id === caller.caller.agent.id) continue;
      assert.equal(h.ctx.agents.get(header.id), undefined, 'failed creation disposes its handle');
      assert.equal((await h.read(header.id)).events.some(e => e.type === 'user/message'), false);
    }
  });
}
