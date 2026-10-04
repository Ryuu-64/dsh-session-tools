// Official Session/JSONL constructors and ordinary Web UI. No model or fake Chat.
// Reference: deepseek-ai/deepseek-harness@639ed015 apps/web/tests/chat-scroll-fixture.ts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ids = {
  A: 'session-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  B: 'session-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  C: 'session-cccccccc-cccc-cccc-cccc-cccccccccccc',
};
export async function seedHistory(require, home, workspace) {
  const load = name => import(pathToFileURL(require.resolve(name)).href);
  const { Session, SessionId, SESSION_FORMAT_VERSION } = await load('@deepseek-ai/dsh-session');
  const { createUserMessage, createAssistantMessage, createToolResultMessage, ToolCallId } = await load('@deepseek-ai/dsh-llm');
  const { Context } = await load('@deepseek-ai/cordis');
  const { default: Jsonl } = await load('@deepseek-ai/dsh-session-persistence-jsonl');
  fs.mkdirSync(workspace, { recursive: true });
  const ctx = new Context(), result = [];
  try {
    await ctx.plugin(Jsonl, { root: path.join(home, '.dsh/sessions') });
    for (const label of ['A', 'B', 'C']) {
      const id = SessionId(ids[label]), session = Session.create(id);
      for (let turn = 1; turn <= 80; turn++) {
        session.append('turn/start', { turn }); session.append('step/start', { turn, step: 1 });
        const user = session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `RETURN_${label}_USER_${turn}\n\nRepeated paragraph.\n\nRepeated paragraph.` }] }), { surfaceOp: 'append' });
        if (turn === 1) session.append('session/title', { title: `RETURN_${label}`, messageSeqs: [user.seq], source: { kind: 'fallback' } });
        session.append('request/header', { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }, reason: turn === 1 ? 'initial' : 'change' });
        const target = label === 'A' ? 'B' : 'C';
        if ([20, 40, 60, 78].includes(turn) && label !== 'C') {
          const callId = ToolCallId(`return-${label}-${turn}`), args = JSON.stringify({ prompt: 'synthetic', title: `RETURN_${target}` });
          session.append('assistant/message', { turn, step: 1, stream: [], message: createAssistantMessage({ source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, content: [{ type: 'tool-call', id: callId, name: 'session_create', arguments: args }] }), usage: { inputTokens: 1, outputTokens: 1 } }, { surfaceOp: 'append' });
          const call = session.append('tool/call', { turn, step: 1, callId, name: 'session_create', arguments: args });
          session.append('tool/result', { turn, step: 1, meta: { sessionId: ids[target], title: `RETURN_${target}` }, message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: `Created session RETURN_${target}` }] }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] });
        }
        session.append('assistant/message', { turn, step: 1, stream: [], message: createAssistantMessage({ source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, content: [{ type: 'text', text: `RETURN_${label}_ANSWER_${turn}\n\n${'A long synthetic reading paragraph. '.repeat(18)}\n\n${'Repeated answer text. '.repeat(12)}` }] }), usage: { inputTokens: 1, outputTokens: 1 } }, { surfaceOp: 'append' });
        session.append('step/end', { turn, step: 1 }); session.append('turn/end', { turn, reason: { kind: 'completed' } });
      }
      const events = session.snapshotEvents();
      const handle = await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, createdAt: Date.now() - 60000, isSeeded: false, cwd: workspace, delegationDepth: 0 });
      await handle.append(events); await handle.close(); result.push({ id, turns: 80, events: events.length });
    }
  } finally { await ctx.fiber.dispose(); }
  return result;
}

async function openFromSidebar(page, label) {
  const search = page.getByRole('button', { name: 'Search sessions' });
  await search.waitFor({ timeout: 30000 });
  if (await search.getAttribute('aria-expanded') !== 'true') await search.click();
  await page.getByRole('textbox', { name: /^(Search sessions\.\.\.|Search session names)$/ }).fill(`RETURN_${label}_USER_1`);
  const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem');
  await result.first().waitFor({ timeout: 60000 }); await result.first().click();
  await page.locator(`[data-conversation-session="${ids[label]}"]`).waitFor();
  await page.getByText(`RETURN_${label}_USER_80`, { exact: false }).last().waitFor();
}
async function openCard(page, from, to, turn) {
  const scope = page.locator(`[data-conversation-session="${ids[from]}"]`);
  const seat = turn === undefined ? scope : scope.locator(`[data-chat-node-key][data-chat-turn="${turn}"]`);
  const card = seat.getByRole('button', { name: `RETURN_${to}`, exact: true }).last();
  await card.scrollIntoViewIfNeeded();
  await card.focus();
  // The reading position is measured after the browser brought the real card
  // into view, immediately before the trusted keyboard activation.
  const captured = await scope.evaluate(root => {
    window.__readingReturnSourceFlow = root.querySelector('[data-chat-flow]');
    const scroll = root.querySelector('[data-conversation-scroll]'), flow = root.querySelector('[data-chat-flow]');
    const top = scroll.getBoundingClientRect().top + 24;
    const rows = [...flow.querySelectorAll('[data-chat-anchor-key][data-chat-node-key]:not([data-chat-flow-kind="turn-process"])')];
    const row = rows.find(x => !x.closest('[hidden]') && x.getClientRects().length && x.getBoundingClientRect().bottom > top);
    return { key: row?.dataset.chatAnchorKey, top: row?.getBoundingClientRect().top - scroll.getBoundingClientRect().top };
  });
  await page.keyboard.press('Enter');
  await page.locator(`[data-conversation-session="${ids[to]}"]`).waitFor({ timeout: 20000 });
  const back = page.getByRole('button', { name: `返回 RETURN_${from} 的原位置`, exact: true });
  await back.waitFor({ timeout: 20000 });
  return captured;
}
export async function exercise(page, browser, url, output) {
  const result = {};
  await openFromSidebar(page, 'A');
  const capture = await openCard(page, 'A', 'B');
  await page.screenshot({ path: path.join(output, 'target-return-control.png') });
  await page.getByRole('button', { name: '返回 RETURN_A 的原位置', exact: true }).click();
  const a = page.locator(`[data-conversation-session="${ids.A}"]`); await a.waitFor();
  await page.getByRole('button', { name: '返回 RETURN_A 的原位置', exact: true }).waitFor({ state: 'hidden', timeout: 20000 });
  const landing = await a.evaluate((root, key) => {
    const row = [...root.querySelectorAll('[data-chat-anchor-key]')].find(x => x.dataset.chatAnchorKey === key);
    return row ? row.getBoundingClientRect().top - root.querySelector('[data-conversation-scroll]').getBoundingClientRect().top : null;
  }, capture.key);
  assert.ok(landing !== null && Math.abs(landing - capture.top) < 2, `same native row and offset: ${JSON.stringify({ capture, landing })}`);
  result.roundTrip = { captured: capture, landedTop: landing };
  await page.screenshot({ path: path.join(output, 'source-restored.png') });
  await openCard(page, 'A', 'B'); await openCard(page, 'B', 'C');
  assert.equal(await page.getByRole('button', { name: '返回 RETURN_A 的原位置', exact: true }).count(), 0);
  await page.getByRole('button', { name: '返回 RETURN_B 的原位置', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '返回 RETURN_B 的原位置', exact: true }).waitFor({ state: 'hidden', timeout: 20000 });
  result.oneStep = 'passed';
  await openFromSidebar(page, 'A'); await openCard(page, 'A', 'B');
  await openFromSidebar(page, 'C');
  assert.equal(await page.getByRole('button', { name: /返回 RETURN_/ }).count(), 0);
  result.otherNavigationInvalidates = 'passed';
  await openFromSidebar(page, 'A'); await openCard(page, 'A', 'B');
  await page.reload();
  await page.getByRole('button', { name: 'Search sessions' }).waitFor({ timeout: 30000 });
  assert.equal(await page.getByRole('button', { name: /返回 RETURN_/ }).count(), 0);
  result.refreshInvalidates = 'passed';

  // Real host paging, followed by unloading and reloading that source Chat.
  await openFromSidebar(page, 'A');
  const history = page.locator(`[data-conversation-session="${ids.A}"]`);
  let loads = 0;
  while (await history.getByText('RETURN_A_USER_20', { exact: false }).count() === 0) {
    const older = history.getByRole('button', { name: 'Load earlier', exact: true });
    assert.equal(await older.count(), 1, 'host must still offer history before turn 20');
    const before = await history.locator('[data-chat-node-key]').count();
    await older.click(); loads++;
    await page.waitForFunction(({ id, before }) => {
      const root = document.querySelector(`[data-conversation-session="${id}"]`);
      return root && root.querySelectorAll('[data-chat-node-key]').length > before;
    }, { id: ids.A, before }, { timeout: 20000 });
  }
  const olderCapture = await openCard(page, 'A', 'B', 20);
  const olderBack = page.getByRole('button', { name: '返回 RETURN_A 的原位置', exact: true });
  await olderBack.focus(); await page.keyboard.press('Space');
  await olderBack.waitFor({ state: 'hidden', timeout: 20000 });
  const olderLanding = await page.locator(`[data-conversation-session="${ids.A}"]`).evaluate((root, key) => {
    const row = [...root.querySelectorAll('[data-chat-anchor-key]')].find(x => x.dataset.chatAnchorKey === key);
    return { top: row ? row.getBoundingClientRect().top - root.querySelector('[data-conversation-scroll]').getBoundingClientRect().top : null,
      remounted: root.querySelector('[data-chat-flow]') !== window.__readingReturnSourceFlow };
  }, olderCapture.key);
  assert.ok(olderLanding.remounted, 'the real source Chat must have a fresh paging/scroll owner');
  assert.ok(olderLanding.top !== null && Math.abs(olderLanding.top - olderCapture.top) < 2,
    `paged source offset: ${JSON.stringify({ olderCapture, olderLanding })}`);
  result.loadedHistory = { loads, captured: olderCapture, landing: olderLanding, returnKey: 'Space' };
  await page.screenshot({ path: path.join(output, 'source-history-restored.png') });

  // Two actual pages share the same origin/profile, but own separate UI roots.
  await openCard(page, 'A', 'B');
  const other = await page.context().newPage();
  try {
    await other.goto(url, { waitUntil: 'load' });
    await openFromSidebar(other, 'C');
    const otherRoot = other.locator(`[data-conversation-session="${ids.C}"]`);
    await otherRoot.getByText('RETURN_C_USER_78', { exact: false }).scrollIntoViewIfNeeded();
    await other.waitForTimeout(600);
    const otherTop = await otherRoot.locator('[data-conversation-scroll]').evaluate(x => x.scrollTop);
    assert.equal(await other.getByRole('button', { name: /返回 RETURN_/ }).count(), 0);
    await page.getByRole('button', { name: '返回 RETURN_A 的原位置', exact: true }).click();
    await page.getByRole('button', { name: '返回 RETURN_A 的原位置', exact: true }).waitFor({ state: 'hidden', timeout: 20000 });
    assert.equal(await otherRoot.count(), 1);
    assert.equal(await otherRoot.locator('[data-conversation-scroll]').evaluate(x => x.scrollTop), otherTop);
    result.twoWindows = { sharedBrowserContext: true, unaffectedSession: ids.C, unaffectedScrollTop: otherTop };
  } finally { await other.close(); }
  return result;
}
