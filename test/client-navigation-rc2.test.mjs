import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientRc2 } from './helpers/client-rc2.mjs';
const a = 'session-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const b = 'session-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('message cards show the reply above details and retain saved receipts', async t => {
  const h = await clientRc2(t, { ids: [a] });
  const row = h.ctx.slots.entriesOfSlot('tool.call.toolview').find(entry => entry.options.key === 'session_send');
  const reply = '这是文字结果。';
  const receipt = `Receipt: sessionId=${a}, messageId=receipt-a, delivery=queue`;
  const status = '已发送消息';
  const render = (messageStatus, texts) => row.component({ block: {
    kind: 'tool-result', isError: false,
    meta: { sessionId: a, messageId: 'receipt-a', messageStatus },
    content: texts.map(text => ({ type: 'text', text })),
  } }).props.children;
  const currentReceipt = `${receipt}, messageStatus=turnCompleted`;
  const current = render('turnCompleted', [`${status}\n${currentReceipt}`, reply]);
  assert.equal(current.find(child => child?.type === 'strong').props.children, status);
  assert.equal(current.find(child => child?.type === 'div').props.children, reply);
  const [summary, body] = current.find(child => child?.type === 'details').props.children;
  assert.equal(summary.props.children, '消息详情');
  assert.equal(body.props.children, currentReceipt);
  const pending = render('queued', [`已排队\n${receipt}, messageStatus=queued`]);
  assert.equal(pending.find(child => child?.type === 'strong').props.children, '已排队');
  assert.equal(pending.some(child => child?.type === 'div'), false);

  for (const savedStatus of ['对方已处理这条消息', '目标本轮结束（不等于任务成功）']) {
    const children = render('turnCompleted', [`${savedStatus}\n${receipt}\n${reply}`]);
    assert.equal(children.find(child => child?.type === 'strong').props.children, status);
    const [summary, body] = children.find(child => child?.type === 'details').props.children;
    assert.equal(summary.props.children, '消息详情');
    assert.equal(body.props.children, `${receipt}\n${reply}`);
  }
  h.setLanguage('en');
  const english = render('turnCompleted', [`${status}\n${currentReceipt}`, reply]);
  assert.equal(english.find(child => child?.type === 'strong').props.children, 'Message sent');
  const [englishSummary, englishBody] = english.find(child => child?.type === 'details').props.children;
  assert.equal(englishSummary.props.children, 'Message details');
  assert.equal(englishBody.props.children, currentReceipt);
});

test('the communication status card translates durable switch status without changing the raw output', async t => {
  const h = await clientRc2(t, { ids: [a] });
  const row = h.ctx.slots.entriesOfSlot('tool.call.toolview').find(entry => entry.options.key === 'session_communication_status');
  const block = {
    kind: 'tool-result', isError: false,
    meta: { communicationReason: 'target_receive_disabled' },
    content: [{ type: 'text', text: 'Saved tool output' }],
  };
  assert.equal(row.component({ block }).props.children[0].props.children, '目标会话已关闭接收');
  h.setLanguage('en');
  assert.equal(row.component({ block }).props.children[0].props.children, 'Receiving is off for the target session');
  assert.equal(row.component({ block: { ...block, meta: undefined } }).props.children, 'Saved tool output');
});

test('published client bundles own delayed navigation, repeat selection, replacement and unload', async t => {
  const pending = Promise.withResolvers();
  const h = await clientRc2(t, { ids: [a, b], delayed: new Map([[a, pending]]) });
  assert.equal(h.entry(), undefined, 'wait for UIWorkspace service; do not call removed sessions.open');
  const workspace = await h.mountWorkspace();
  assert.ok(h.entry());
  h.click(a);
  const binding = h.ctx.sessions.binding(a);
  assert.equal(binding.session.getSnapshot().openState, 'loading');
  assert.equal(h.ctx.sessions.retainInfo(a).getSnapshot().retainedBy.mainView, 1);
  h.click(a);
  assert.equal(h.ctx.sessions.retainInfo(a).getSnapshot().retainedBy.mainView, 1, 'repeated clicks replace rather than leak a main reference');
  h.click(b);
  await tick();
  assert.equal(h.ctx.sessions.binding(b).session.getSnapshot().openState, 'open');
  assert.equal(h.panel.getSnapshot().selectedPanel, null);
  assert.equal(h.ctx.sessions.retainInfo(a).getSnapshot().referenceCount, 0);
  assert.equal(h.ctx.sessions.retainInfo(b).getSnapshot().retainedBy.mainView, 1);
  pending.resolve(); await tick();
  assert.equal(h.ctx.sessions.retainInfo(a).getSnapshot().referenceCount, 0, 'late history cannot steal selection');
  await h.plugin.dispose();
  assert.equal(h.entry(), undefined);
  assert.equal(h.ctx.sessions.retainInfo(b).getSnapshot().retainedBy.mainView, 1, 'plugin owns no UI reference');
  await workspace.dispose(); await tick();
  assert.equal(h.ctx.sessions.retainInfo(b).getSnapshot().referenceCount, 0);
  assert.deepEqual(h.cancelled, [], 'reading/navigation never cancels an Agent turn');
});

test('two client roots keep independent selections and dispose all streams', async t => {
  const left = await clientRc2(t, { ids: [a, b] });
  const right = await clientRc2(t, { ids: [a, b] });
  await left.mountWorkspace(); await right.mountWorkspace();
  left.click(a); right.click(b); await tick();
  assert.equal(left.ctx.sessions.retainInfo(a).getSnapshot().referenceCount, 1);
  assert.equal(right.ctx.sessions.retainInfo(b).getSnapshot().referenceCount, 1);
  left.click(b); await tick();
  assert.equal(right.ctx.sessions.retainInfo(b).getSnapshot().referenceCount, 1);
  await left.ctx.fiber.dispose(); await right.ctx.fiber.dispose();
  assert.deepEqual([...left.closed].sort(), [...left.opened].sort());
  assert.deepEqual([...right.closed].sort(), [...right.opened].sort());
});

test('failed history remains a failed selected Session, without cancelling work', async t => {
  const h = await clientRc2(t, { ids: [a], rejected: new Set([a]) });
  const workspace = await h.mountWorkspace();
  h.click(a); await tick();
  const snapshot = h.ctx.sessions.binding(a).session.getSnapshot();
  assert.equal(snapshot.openState, 'error');
  assert.equal(snapshot.openError.message, 'Synthetic missing history');
  assert.equal(h.ctx.sessions.retainInfo(a).getSnapshot().retainedBy.mainView, 1);
  await workspace.dispose(); await tick();
  assert.equal(h.entry(), undefined, 'navigation owner unload removes the dependent card');
  assert.equal(h.ctx.sessions.retainInfo(a).getSnapshot().referenceCount, 0);
  assert.deepEqual(h.cancelled, []);
  await h.mountWorkspace();
  assert.ok(h.entry(), 'service reload registers exactly one working card');
});

test('assistant Markdown session links navigate by catalog identity and release their handlers', async t => {
  const document = new EventTarget();
  const h = await clientRc2(t, { ids: [a, b], document });
  const workspace = await h.mountWorkspace();
  h.click(a);

  function activate(href, { assistant = true, type = 'click', ...modifiers } = {}) {
    const row = { matches: () => assistant, closest: () => ({}) };
    const anchor = { getAttribute: () => href, closest: () => row };
    const event = Object.assign(new Event(type, { cancelable: true }), { button: 0, ...modifiers });
    Object.defineProperty(event, 'target', { value: { closest: () => anchor } });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  }

  const prefix = 'https://dsh.invalid/session/';
  const target = prefix + b;
  assert.equal(activate('https://example.com/session/' + b), false);
  assert.equal(activate(target, { assistant: false }), false);
  assert.equal(activate(target, { type: 'auxclick', button: 1 }), true);
  assert.equal(activate(target, { ctrlKey: true }), true);
  assert.equal(activate(prefix + 'missing'), true);
  assert.deepEqual(h.opened, [a]);

  const workspaces = h.ctx.workspaces.list;
  const snapshot = workspaces.getSnapshot();
  workspaces.set({ ...snapshot, archivedSessionIds: [b] });
  assert.equal(activate(target), true);
  assert.deepEqual(h.opened, [a]);

  workspaces.set(snapshot);
  assert.equal(activate(target), true);
  await tick();
  assert.equal(h.ctx.sessions.binding(b).session.getSnapshot().openState, 'open');
  assert.equal(h.ctx.sessions.retainInfo(a).getSnapshot().referenceCount, 0);
  assert.deepEqual(h.opened, [a, b]);
  assert.deepEqual(h.cancelled, []);
  await workspace.dispose();
  assert.equal(activate(target), false, 'unloading navigation removes document listeners');
});
