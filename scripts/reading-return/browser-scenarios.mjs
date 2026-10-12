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
  T: 'session-dddddddd-dddd-dddd-dddd-dddddddddddd',
  H: 'session-eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  G: 'session-ffffffff-ffff-ffff-ffff-ffffffffffff',
  S: 'session-11111111-1111-1111-1111-111111111111',
  D: 'session-22222222-2222-2222-2222-222222222222',
  R: 'session-33333333-3333-3333-3333-333333333333',
  U: 'session-44444444-4444-4444-4444-444444444444',
  V: 'session-55555555-5555-5555-5555-555555555555',
  P: 'session-66666666-6666-6666-6666-666666666666',
  Q: 'session-77777777-7777-7777-7777-777777777777',
};
export async function seedHistory(require, home, workspace) {
  const load = name => import(pathToFileURL(require.resolve(name)).href);
  const { Session, SessionId, SESSION_FORMAT_VERSION } = await load('@deepseek-ai/dsh-session');
  const { createUserMessage, createAssistantMessage, createToolResultMessage, ToolCallId } = await load('@deepseek-ai/dsh-llm');
  const { snapshotSubagentDescriptor } = await load('@deepseek-ai/dsh-subagent');
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
    for (const label of ['T', 'H', 'G', 'S', 'D', 'R', 'U', 'V', 'P', 'Q']) {
      const id = SessionId(ids[label]), session = Session.create(id);
      const child = ['S', 'V'].includes(label);
      for (let turn = 1; turn <= 80; turn++) {
        session.append('turn/start', { turn }); session.append('step/start', { turn, step: 1 });
        if (child && turn === 1) session.append('subagent/descriptor', snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'reading-fixture', label: `RETURN_${label}` }));
        const user = session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `RETURN_${label}_USER_${turn}\n\n${'Synthetic source reading paragraph. '.repeat(12)}` }] }), { surfaceOp: 'append' });
        if (turn === 1) session.append('session/title', { title: `RETURN_${label}`, messageSeqs: [user.seq], source: { kind: 'fallback' } });
        session.append('request/header', { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }, reason: turn === 1 ? 'initial' : 'change' });
        const tail = ['T', 'P'].includes(label) && turn === 80;
        const answer = () => session.append('assistant/message', { turn, step: 1, stream: [], message: createAssistantMessage({ source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, content: [{ type: 'text', text: `RETURN_${label}_ANSWER_${turn}\n\n${'Additional synthetic reading content. '.repeat(tail ? 1 : 30)}` }] }), usage: { inputTokens: 1, outputTokens: 1 } }, { surfaceOp: 'append' });
        if (tail) answer();
        if ([20, 40, 60, 78].includes(turn) || tail) {
          const count = ['G', 'S'].includes(label) && turn === 78 ? 12 : 1;
          for (let index = 0; index < count; index++) {
            const callId = ToolCallId(`extra-${label}-${turn}-${index}`), args = JSON.stringify({ prompt: 'synthetic', title: 'RETURN_B' });
            session.append('assistant/message', { turn, step: 1, stream: [], message: createAssistantMessage({ source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, content: [{ type: 'tool-call', id: callId, name: 'session_create', arguments: args }] }), usage: { inputTokens: 1, outputTokens: 1 } }, { surfaceOp: 'append' });
            const call = session.append('tool/call', { turn, step: 1, callId, name: 'session_create', arguments: args });
            session.append('tool/result', { turn, step: 1, meta: { sessionId: ids.B, title: 'RETURN_B' }, message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: `Created session RETURN_B ${label}_${turn}_${index}` }] }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] });
          }
        }
        if (!tail) answer();
        session.append('step/end', { turn, step: 1 }); session.append('turn/end', { turn, reason: { kind: 'completed' } });
      }
      const events = session.snapshotEvents();
      const handle = await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, createdAt: Date.now() - 60000, isSeeded: false, cwd: workspace, delegationDepth: child ? 1 : 0, ...(child ? { origin: 'subagent', parentSession: ids.G } : {}) });
      await handle.append(events); await handle.close(); result.push({ id, turns: 80, events: events.length });
    }
  } finally { await ctx.fiber.dispose(); }
  return result;
}

async function openFromSidebar(page, label) {
  const search = page.getByRole('button', { name: 'Search sessions' });
  await search.waitFor({ timeout: 30000 });
  if (await search.getAttribute('aria-expanded') !== 'true') await search.click();
  await page.getByRole('textbox', { name: /^(Search sessions\.\.\.|Search session names)$/ }).fill(`RETURN_${label}`);
  // Cold search rows can display Untitled until the Session summary is loaded.
  // Each seed's USER/ANSWER marker identifies only its own content, unlike a
  // tool card mentioning another session's title. Search rows expose no ID.
  const identity = page.getByText(`RETURN_${label}`, { exact: true })
    .or(page.getByText(new RegExp(`\\bRETURN_${label}_(?:USER|ANSWER)_\\d+\\b`)));
  const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
    .filter({ has: identity });
  await result.waitFor({ timeout: 60000 });
  assert.equal(await result.count(), 1, 'search must identify exactly one seeded session');
  await result.click();
  await page.locator(`[data-conversation-session="${ids[label]}"]`).waitFor();
  await page.getByText(`RETURN_${label}_USER_80`, { exact: false }).last().waitFor();
}
async function openCard(page, from, to, turn) {
  const scope = page.locator(`[data-conversation-session="${ids[from]}"]`);
  const seat = turn === undefined ? scope : scope.locator(`[data-chat-node-key][data-chat-turn="${turn}"]`);
  const card = seat.getByRole('button', { name: `RETURN_${to}`, exact: true }).last();
  await card.scrollIntoViewIfNeeded();
  await card.focus();
  // Observe the departure during the actual activation, before the plugin's
  // bubbling click handler captures. Paging can still move between Playwright calls.
  await card.evaluate(button => {
    const root = button.closest('[data-conversation-session]');
    const measure = () => {
      const scroll = root.querySelector('[data-conversation-scroll]'), flow = root.querySelector('[data-chat-flow]');
      const top = scroll.getBoundingClientRect().top + 24;
      const rows = [...flow.querySelectorAll('[data-chat-anchor-key][data-chat-node-key]:not([data-chat-flow-kind="turn-process"])')];
      const row = rows.find(x => !x.closest('[hidden]') && x.getClientRects().length && x.getBoundingClientRect().bottom > top);
      return { key: row?.dataset.chatAnchorKey, top: row?.getBoundingClientRect().top - scroll.getBoundingClientRect().top,
        atTail: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 3,
        sourceSeq: row && window.__readingReturnFixture?.sourceEvent(root.dataset.conversationSession, row.dataset.chatNodeKey) };
    };
    const departure = { preActivation: measure(), activation: null };
    const observe = event => {
      departure.activation = { ...measure(), trusted: event.isTrusted };
      window.__readingReturnSourceFlow = root.querySelector('[data-chat-flow]');
    };
    button.addEventListener('click', observe, { capture: true, once: true });
    window.__readingReturnDeparture = departure;
    window.__readingReturnDepartureCleanup = () => button.removeEventListener('click', observe, true);
  });
  let departure;
  try {
    await page.keyboard.press('Enter');
    departure = await page.evaluate(() => window.__readingReturnDeparture);
  } finally {
    await page.evaluate(() => { window.__readingReturnDepartureCleanup?.(); delete window.__readingReturnDepartureCleanup; delete window.__readingReturnDeparture; });
  }
  assert.equal(departure?.activation?.trusted, true, 'departure is measured at the real trusted card activation');
  const captured = { ...departure.activation, preActivation: departure.preActivation,
    activationChange: { keyChanged: departure.preActivation.key !== departure.activation.key,
      topDelta: departure.activation.top - departure.preActivation.top } };
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

const mainRoot = (page, label) => page.locator(`[data-slot="main"] [data-conversation-content][data-conversation-session="${ids[label]}"]`).first();
const backButton = (page, label) => page.getByRole('button', { name: `返回 RETURN_${label} 的原位置`, exact: true });
async function land(page, label) {
  await backButton(page, label).click();
  await backButton(page, label).waitFor({ state: 'hidden', timeout: 20000 });
  await mainRoot(page, label).waitFor();
}
async function assertAnchor(root, captured, label) {
  const actual = await root.evaluate((element, key) => {
    const row = [...element.querySelectorAll('[data-chat-anchor-key]')].find(node => node.dataset.chatAnchorKey === key);
    const scroll = element.querySelector('[data-conversation-scroll]');
    return row && { key: row.dataset.chatAnchorKey, top: row.getBoundingClientRect().top - scroll.getBoundingClientRect().top,
      following: element.querySelector('[data-chat-following-tail]') !== null };
  }, captured.key);
  assert.ok(actual && actual.key === captured.key && Math.abs(actual.top - captured.top) < 2, `${label}: ${JSON.stringify({ captured, actual })}`);
  assert.equal(actual.following, false, `${label}: returning must preserve reading intent`);
  return actual;
}
async function historyThrough(page, label, turn) {
  const root = mainRoot(page, label); let pages = 0;
  while (await root.getByText(`RETURN_${label}_USER_${turn}`, { exact: false }).count() === 0) {
    assert.ok(pages++ < 8, 'bounded synthetic history must expose the source turn');
    const before = await root.locator('[data-chat-node-key]').count();
    await root.getByRole('button', { name: 'Load earlier', exact: true }).click();
    await page.waitForFunction(({ id, before }) => {
      const root = document.querySelector(`[data-slot="main"] [data-conversation-session="${id}"]`);
      return root?.querySelectorAll('[data-chat-node-key]').length > before;
    }, { id: ids[label], before }, { timeout: 20000 });
  }
  return pages;
}
async function waitAtTail(page, label) {
  await page.waitForFunction(id => {
    const root = document.querySelector(`[data-slot="main"] [data-conversation-session="${id}"]`);
    const scroll = root?.querySelector('[data-conversation-scroll]');
    return scroll && scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 3;
  }, ids[label], { timeout: 20000 });
}
async function references(page, label) {
  return page.evaluate(id => window.__readingReturnFixture.references(id), ids[label]);
}
async function waitNoRestoreReference(page, label) {
  await page.waitForFunction(id => (window.__readingReturnFixture.references(id).controllerOperation ?? 0) === 0,
    ids[label], { timeout: 20000 });
}

// The six explicitly approved acceptance groups use the same real profile and controls.
export async function exerciseRequiredCases(page, url, output, fixture) {
  const results = {};
  const record = (name, value) => { results[name] = value; fs.writeFileSync(path.join(output, 'required-cases.json'), JSON.stringify(results, null, 2)); };
  await page.waitForFunction(() => Boolean(window.__readingReturnFixture), null, { timeout: 30000 });

  // 1. Old-tail and historical reading survive real append and Agent streaming.
  const growth = {};
  for (const label of ['T', 'H']) {
    await openFromSidebar(page, label);
    if (label === 'H') await historyThrough(page, label, 20);
    else await waitAtTail(page, label);
    const draft = `UNSENT_DRAFT_${label}`;
    await page.locator('[data-slot="main"] [data-composer-input]').fill(draft);
    if (label === 'T') await waitAtTail(page, label);
    const capture = await openCard(page, label, 'B', label === 'T' ? 80 : 20);
    if (label === 'T') assert.equal(capture.atTail, true, 'tail case must actually depart from the source tail');
    await fixture.control({ op: 'append', id: ids[label], marker: `AWAY_${label}` });
    await land(page, label);
    await assertAnchor(mainRoot(page, label), capture, `${label} after growth while away`);
    assert.equal(await page.locator('[data-slot="main"] [data-composer-input]').innerText(), draft, 'source draft survives navigation');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-chat-reading-root]'))), true, 'successful return focuses native reading content');
    await fixture.control({ op: 'append', id: ids[label], marker: `AFTER_${label}` });
    await mainRoot(page, label).getByText(`AFTER_${label}_ANSWER`, { exact: false }).waitFor({ state: 'attached' });
    await page.waitForTimeout(150);
    await assertAnchor(mainRoot(page, label), capture, `${label} after passive append`);
    let readingCapture = capture;
    if (label === 'T') {
      const geometry = await mainRoot(page, label).evaluate((root, key) => {
        const scroll = root.querySelector('[data-conversation-scroll]'), viewport = scroll.getBoundingClientRect();
        const row = [...root.querySelectorAll('[data-chat-anchor-key]')].find(node => node.dataset.chatAnchorKey === key).getBoundingClientRect();
        return { x: viewport.left + 30, y: Math.max(viewport.top, row.top) + 18, gap: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop };
      }, capture.key);
      await page.mouse.click(geometry.x, geometry.y);
      const size = page.viewportSize(), height = Math.ceil(size.height + geometry.gap + 48);
      assert.ok(height < 16000, 'synthetic passive resize remains bounded');
      await page.setViewportSize({ width: size.width, height }); await page.waitForTimeout(150);
      await waitAtTail(page, label);
      assert.equal(await mainRoot(page, label).locator('[data-chat-following-tail]').count(), 0, 'ordinary click followed by passive arrival at the floor cannot enable following');
      await page.setViewportSize(size); await page.waitForTimeout(150);
      readingCapture = await visibleAnchor(mainRoot(page, label));
      assert.equal(await mainRoot(page, label).locator('[data-chat-following-tail]').count(), 0);
    }
    await fixture.control({ op: 'stream', id: ids[label], marker: `STREAM_${label}` });
    for (let index = 0; index < 4; index++) {
      if (index) await fixture.control({ op: 'release', count: 1 });
      await mainRoot(page, label).getByText(`STREAM_${label}_${index}`, { exact: false }).last().waitFor({ state: 'attached' });
      await page.waitForTimeout(120);
      await assertAnchor(mainRoot(page, label), readingCapture, `${label} stream chunk ${index}`);
    }
    await mainRoot(page, label).getByRole('button', { name: 'Back to bottom', exact: true }).click();
    await waitAtTail(page, label);
    await fixture.control({ op: 'release', count: 4 });
    await mainRoot(page, label).getByText(`STREAM_${label}_7`, { exact: false }).last().waitFor({ state: 'attached' });
    await waitAtTail(page, label);
    assert.equal(await mainRoot(page, label).locator('[data-chat-following-tail]').count(), 1, 'explicit latest resumes native follow');
    assert.equal(await page.locator('[data-slot="main"] [data-composer-input]').innerText(), draft, 'remote growth never submits or clears the draft');
    const deadline = Date.now() + 20000;
    while ((await fixture.control({ op: 'status' })).active) {
      assert.ok(Date.now() < deadline, 'real Agent stream must settle before the next case');
      await page.waitForTimeout(100);
    }
    growth[label] = { capture, readingCapture, appendedWhileAway: true, appendedAfterReturn: true, observedStreamChunks: 8, latestResumesFollow: true, draftPreserved: true };
  }
  await openFromSidebar(page, 'A'); await openCard(page, 'A', 'B');
  const captureB = await openCard(page, 'B', 'C');
  await land(page, 'B'); await assertAnchor(mainRoot(page, 'B'), captureB, 'B→C→B actual landing');
  growth.oneHop = captureB;
  record('growthAndReadingIntent', growth);

  // Remaining groups are defined below beside their concrete fixture ownership.
  await exerciseInstances(page, url, fixture, record);
  await exerciseSidebar(page, fixture, record);
  await exerciseFailures(page, url, fixture, record, output);
  await exerciseMissingSource(page, fixture, record);
  await exerciseUnload(page, fixture, record);
  return results;
}

async function holdHistoryResponse(page, label) {
  let release, seen, finished;
  const decision = new Promise(resolve => { release = resolve; });
  const observed = new Promise(resolve => { seen = resolve; });
  const completed = new Promise(resolve => { finished = resolve; });
  let captured = false;
  const pattern = '**/api/session/page';
  const handler = async route => {
    const request = route.request().postDataJSON();
    if (captured || request?.payload?.args?.request?.sessionId !== ids[label]) return route.continue();
    captured = true;
    try {
      const response = await route.fetch();
      seen();
      const mode = await decision;
      if (mode === 'fail') await route.abort('failed');
      else await route.fulfill({ response });
    } catch (error) {
      // Real cancellation can close the held request before its genuine response is released.
      if (!/closed|cancel|abort|Invalid InterceptionId|already handled/i.test(String(error))) throw error;
    } finally { finished(); }
  };
  await page.route(pattern, handler);
  return {
    async wait() {
      let timer;
      try { await Promise.race([observed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no real history response held for ${label}`)), 12000); })]); }
      finally { clearTimeout(timer); }
    },
    async finish(mode = 'release') {
      release(mode);
      if (captured) await completed;
      await page.unroute(pattern, handler);
    },
  };
}
async function prepareOldReturn(page, label) {
  await openFromSidebar(page, label); await historyThrough(page, label, 20);
  const capture = await openCard(page, label, 'B', 20);
  await waitNoRestoreReference(page, label);
  return capture;
}
async function exerciseFailures(page, url, fixture, record, output) {
  const nativeTransactions = await exerciseNativeTransactions(page, url, fixture, output);
  const capture = await prepareOldReturn(page, 'R');
  let gate = await holdHistoryResponse(page, 'R');
  try { await backButton(page, 'R').click(); await gate.wait(); await gate.finish('fail'); }
  finally { await gate.finish(); }
  await page.locator('[data-session-tools-return][data-return-phase="error"]').waitFor();
  assert.equal(await mainRoot(page, 'B').count(), 1, 'failed preparation does not navigate');
  assert.equal(await backButton(page, 'R').count(), 1, 'failure retains the same retry point');
  await waitNoRestoreReference(page, 'R');
  await land(page, 'R'); await assertAnchor(mainRoot(page, 'R'), capture, 'retry after actual transport failure');
  const outcomes = { retry: true, nativeTransactions };
  for (const action of ['wheel', 'keyboard', 'draft', 'navigation']) {
    await prepareOldReturn(page, 'R');
    gate = await holdHistoryResponse(page, 'R');
    try {
      await backButton(page, 'R').click(); await gate.wait();
      if (action === 'wheel') { await mainRoot(page, 'B').hover(); await page.mouse.wheel(0, -260); }
      else if (action === 'keyboard') await page.keyboard.press('PageUp');
      else if (action === 'draft') await page.locator('[data-slot="main"] [data-composer-input]').fill('KEEP_FOCUS_AND_DRAFT');
      else await openFromSidebar(page, 'C');
      await waitNoRestoreReference(page, 'R');
      await gate.finish();
      await page.waitForTimeout(250);
      assert.equal(await mainRoot(page, action === 'navigation' ? 'C' : 'B').count(), 1, `${action}: late response must not navigate`);
      if (action === 'draft') {
        assert.equal(await page.locator('[data-slot="main"] [data-composer-input]').innerText(), 'KEEP_FOCUS_AND_DRAFT');
        assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-composer-input')), true, 'late response cannot steal editing focus');
      }
      outcomes[action] = { lateResponseReleased: true, sourceReferences: await references(page, 'R') };
    } finally { await gate.finish(); }
  }
  record('failureRetryAndInterruption', outcomes);
}
async function exerciseUnload(page, fixture, record) {
  await prepareOldReturn(page, 'U');
  const gate = await holdHistoryResponse(page, 'U');
  try {
    await backButton(page, 'U').click(); await gate.wait();
    await fixture.setPlugin(false);
    await page.getByRole('button', { name: /返回 RETURN_/ }).waitFor({ state: 'hidden', timeout: 30000 });
    await waitNoRestoreReference(page, 'U');
    await gate.finish();
    await page.waitForTimeout(250);
    assert.equal(await mainRoot(page, 'B').count(), 1, 'unloaded restoration cannot navigate late');
  } finally { await gate.finish(); }
  await fixture.setPlugin(true);
  await openFromSidebar(page, 'U');
  const capture = await openCard(page, 'U', 'B'); await land(page, 'U');
  await assertAnchor(mainRoot(page, 'U'), capture, 'return after fresh plugin load');
  await fixture.setPlugin(false);
  await page.locator('[data-session-tools-return]').waitFor({ state: 'hidden', timeout: 30000 });
  await waitNoRestoreReference(page, 'U');
  await fixture.control({ op: 'append', id: ids.U, marker: 'AFTER_PLUGIN_UNLOAD' });
  await mainRoot(page, 'U').getByText('AFTER_PLUGIN_UNLOAD_ANSWER', { exact: false }).waitFor({ state: 'attached' });
  await page.waitForTimeout(150);
  await assertAnchor(mainRoot(page, 'U'), capture, 'committed native reading survives consumer unload');
  await mainRoot(page, 'U').getByRole('button', { name: 'Back to bottom', exact: true }).click(); await waitAtTail(page, 'U');
  await fixture.setPlugin(true);
  assert.equal(await page.getByRole('button', { name: /返回 RETURN_/ }).count(), 0, 'reloading a plugin cannot revive a consumed return point');
  record('unloadAndRelease', { pendingCancelled: true, lateResponseReleased: true, nativeReadingPreserved: true, latestStillWorks: true, sourceReferences: await references(page, 'U') });
}

async function rowPosition(root, marker) {
  return root.getByText(marker, { exact: false }).first().evaluate(element => {
    const row = element.closest('[data-chat-anchor-key]'), root = element.closest('[data-conversation-content]');
    return { key: row.dataset.chatAnchorKey, top: row.getBoundingClientRect().top - root.querySelector('[data-conversation-scroll]').getBoundingClientRect().top };
  });
}
async function openEmbeddedCard(page, root, turn = 78) {
  const card = root.locator(`[data-chat-node-key][data-chat-turn="${turn}"]`).getByRole('button', { name: 'RETURN_B', exact: true }).last();
  await card.scrollIntoViewIfNeeded(); await card.focus();
  await card.evaluate(element => {
    const root = element.closest('[data-conversation-content]');
    const scroll = root.querySelector('[data-conversation-scroll]');
    const clicked = element.closest('[data-chat-anchor-key]');
    const body = element.closest('[data-step-process-body]');
    const measure = () => {
      const viewport = scroll.getBoundingClientRect();
      let top = viewport.top + 24;
      let bottom = root.querySelector('[data-composer-seat]')?.getBoundingClientRect().top ?? viewport.bottom;
      for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
        if (!parent.hasAttribute('data-step-process-body') || parent.closest('[data-step-process]')?.hasAttribute('data-group-expanded-mode')) continue;
        const rect = parent.getBoundingClientRect();
        top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom);
      }
      const row = body && [...body.querySelectorAll('[data-chat-anchor-key][data-chat-node-key]')].find(node => {
        const rect = node.getBoundingClientRect();
        return !node.closest('[hidden]') && node.getClientRects().length && rect.bottom > top && rect.top < bottom;
      });
      return { key: row?.dataset.chatAnchorKey, top: row ? row.getBoundingClientRect().top - viewport.top : null,
        groupTop: body?.scrollTop ?? null, groupKey: body?.closest('[data-chat-group-key]')?.dataset.chatGroupKey ?? null,
        independentGroup: Boolean(body && !body.closest('[data-step-process]').hasAttribute('data-group-expanded-mode')),
        clickedKey: clicked.dataset.chatAnchorKey, clickedTop: clicked.getBoundingClientRect().top - viewport.top };
    };
    const departure = { preActivation: measure(), activation: null };
    const observe = event => { departure.activation = { ...measure(), trusted: event.isTrusted }; };
    element.addEventListener('click', observe, { capture: true, once: true });
    window.__readingReturnEmbeddedDeparture = departure;
    window.__readingReturnEmbeddedCleanup = () => element.removeEventListener('click', observe, true);
  });
  let departure;
  try {
    await page.keyboard.press('Enter');
    departure = await page.evaluate(() => window.__readingReturnEmbeddedDeparture);
  } finally {
    await page.evaluate(() => { window.__readingReturnEmbeddedCleanup?.(); delete window.__readingReturnEmbeddedCleanup; delete window.__readingReturnEmbeddedDeparture; });
  }
  assert.equal(departure?.activation?.trusted, true, 'embedded departure uses the actual trusted activation');
  assert.equal(departure.activation.independentGroup, true, 'the initiating card owns a real inner scrollport');
  assert.ok(departure.activation.key && departure.activation.top !== null, 'the inner scrollport has actual visible reading content');
  const capture = { ...departure.activation, preActivation: departure.preActivation };
  await mainRoot(page, 'B').waitFor(); await backButton(page, 'S').waitFor();
  return capture;
}
const sidebarRoots = page => page.locator(`[data-sidebar-chat] [data-conversation-content][data-conversation-session="${ids.S}"]`);
async function exerciseInstances(page, url, fixture, record) {
  const other = await page.context().newPage();
  const result = {};
  try {
    await other.goto(url, { waitUntil: 'load' });
    await openFromSidebar(other, 'H');
    await other.getByText('RETURN_H_USER_78', { exact: false }).scrollIntoViewIfNeeded();
    await mainRoot(other, 'H').hover(); await other.mouse.wheel(0, -100); await other.waitForTimeout(200);
    const before = await rowPosition(mainRoot(other, 'H'), 'RETURN_H_USER_78');
    await openFromSidebar(page, 'H'); const capture = await openCard(page, 'H', 'B');
    await land(page, 'H'); await assertAnchor(mainRoot(page, 'H'), capture, 'same-session primary return');
    const after = await rowPosition(mainRoot(other, 'H'), 'RETURN_H_USER_78');
    assert.equal(after.key, before.key); assert.ok(Math.abs(after.top - before.top) < 2, 'same-session other window reading stays unchanged');
    assert.equal(await other.getByRole('button', { name: /返回 RETURN_/ }).count(), 0);
    result.sameSessionWindows = { before, after };
  } finally { await other.close(); }

  await page.setViewportSize({ width: 2200, height: 1000 });
  await openFromSidebar(page, 'G');
  const liveGroup = await fixture.control({ op: 'group-start', id: ids.S, target: ids.B });
  await page.evaluate(({ parent, child }) => window.__readingReturnFixture.openSidebar(parent, child, 'group-one'), { parent: ids.G, child: ids.S });
  await sidebarRoots(page).first().waitFor();
  await page.evaluate(({ parent, child }) => window.__readingReturnFixture.openSidebar(parent, child, 'group-two', true), { parent: ids.G, child: ids.S });
  await page.waitForFunction(id => [...document.querySelectorAll(`[data-sidebar-chat] [data-conversation-session="${id}"]`)].filter(root => root.getClientRects().length).length === 2, ids.S);
  await page.evaluate(() => window.__readingReturnFixture.setTranscript('standard'));
  const first = sidebarRoots(page).nth(0), second = sidebarRoots(page).nth(1);
  const turn = first.locator('[data-turn-process="78"]');
  await turn.scrollIntoViewIfNeeded();
  if (await turn.getAttribute('aria-expanded') !== 'true') await turn.click();
  const group = first.locator('[data-step-process][data-chat-turn="78"]').first();
  const header = group.locator('button[aria-expanded]').first();
  if (await header.getAttribute('aria-expanded') !== 'true') await header.click();
  const body = group.locator('[data-step-process-body]').first();
  assert.equal(await body.evaluate(node => node.scrollHeight > node.clientHeight + 20), true, 'case must exercise a real independently scrolling group');
  await second.getByText('RETURN_S_USER_80', { exact: false }).scrollIntoViewIfNeeded();
  const peerBefore = await rowPosition(second, 'RETURN_S_USER_80');
  const peerGroup = second.locator('[data-step-process][data-chat-turn="78"] button[aria-expanded]').first();
  const peerExpanded = await peerGroup.getAttribute('aria-expanded');
  const capture = await openEmbeddedCard(page, first);
  assert.notEqual(capture.groupTop, null, 'source card belongs to the independently scrolling group');
  await backButton(page, 'S').click(); await backButton(page, 'S').waitFor({ state: 'hidden', timeout: 20000 });
  await mainRoot(page, 'G').waitFor();
  await assertAnchor(sidebarRoots(page).nth(0), capture, 'nested source row after return');
  const restoredInnerTop = await sidebarRoots(page).nth(0).evaluate((root, key) => {
    const group = [...root.querySelectorAll('[data-chat-group-key]')].find(node => node.dataset.chatGroupKey === key);
    if (!group) throw new Error('restored source group is missing');
    return group.querySelector('[data-step-process-body]').scrollTop;
  }, capture.groupKey);
  assert.ok(Math.abs(restoredInnerTop - capture.groupTop) < 2, 'group keeps its own saved scroll offset');
  const peerAfter = await rowPosition(sidebarRoots(page).nth(1), 'RETURN_S_USER_80');
  assert.equal(await sidebarRoots(page).nth(1).locator('[data-step-process][data-chat-turn="78"] button[aria-expanded]').first().getAttribute('aria-expanded'), peerExpanded, 'automatic reveal is occurrence-local');
  assert.ok(Math.abs(peerAfter.top - peerBefore.top) < 2, 'same-session peer instance does not move');
  await fixture.control({ op: 'append', id: ids.G, marker: 'PARENT_GROWTH_WITH_HELD_GROUP' });
  await page.waitForTimeout(200);
  await assertAnchor(sidebarRoots(page).nth(0), capture, 'nested reading after parent growth');
  result.sameSessionInstancesAndGroups = { capture, peerBefore, peerAfter, peerExpanded };
  await sidebarRoots(page).nth(0).getByRole('button', { name: 'Back to bottom', exact: true }).click();
  const ongoing = sidebarRoots(page).nth(0).locator(`[data-step-process][data-chat-turn="${liveGroup.turn}"]`).first();
  const ongoingHeader = ongoing.locator('button[aria-expanded]').first();
  await ongoingHeader.scrollIntoViewIfNeeded();
  if (await ongoingHeader.getAttribute('aria-expanded') !== 'true') await ongoingHeader.click();
  const ongoingCapture = await openEmbeddedCard(page, sidebarRoots(page).nth(0), liveGroup.turn);
  assert.notEqual(ongoingCapture.groupTop, null, 'live group case captures an inner scrollport');
  await fixture.control({ op: 'group-grow', id: ids.S, target: ids.B });
  await backButton(page, 'S').click(); await backButton(page, 'S').waitFor({ state: 'hidden', timeout: 20000 });
  await assertAnchor(sidebarRoots(page).nth(0), ongoingCapture, 'live group grows while source is unmounted');
  const grown = await fixture.control({ op: 'group-grow', id: ids.S, target: ids.B });
  await page.waitForFunction(({ id, turn, calls }) => {
    const group = document.querySelector(`[data-sidebar-chat] [data-conversation-session="${id}"] [data-step-process][data-chat-turn="${turn}"]`);
    return group && [...group.querySelectorAll('button')].filter(button => button.textContent === 'RETURN_B').length === calls;
  }, { id: ids.S, turn: liveGroup.turn, calls: grown.calls });
  await page.waitForTimeout(150);
  await assertAnchor(sidebarRoots(page).nth(0), ongoingCapture, 'held group resists its own content growth');
  const innerTop = await sidebarRoots(page).nth(0).evaluate((root, key) => {
    const group = [...root.querySelectorAll('[data-chat-group-key]')].find(node => node.dataset.chatGroupKey === key);
    if (!group) throw new Error('live source group is missing');
    return group.querySelector('[data-step-process-body]').scrollTop;
  }, ongoingCapture.groupKey);
  assert.ok(Math.abs(innerTop - ongoingCapture.groupTop) < 2, 'new group members do not resume inner following');
  result.liveGroupGrowth = { capture: ongoingCapture, finalCalls: grown.calls, innerTop };
  const fold = sidebarRoots(page).nth(0).locator(`[data-step-process][data-chat-turn="${liveGroup.turn}"] button[aria-expanded]`).first();
  await fold.click(); await page.waitForTimeout(150);
  assert.equal(await fold.getAttribute('aria-expanded'), 'false', 'an intentional fold remains closed after the accepted reading hold');
  await page.setViewportSize({ width: 2200, height: 1200 }); await page.waitForTimeout(150);
  assert.equal(await sidebarRoots(page).nth(0).locator('[data-chat-following-tail]').count(), 0, 'fold plus passive layout must not request latest');
  await page.evaluate(() => { window.__readingReturnFixture.closeSidebar('group-one'); window.__readingReturnFixture.closeSidebar('group-two'); });
  await page.evaluate(() => window.__readingReturnFixture.setTranscript('verbose'));
  await page.setViewportSize({ width: 1400, height: 900 });
  record('instancesAndNestedGroups', result);
}
async function exerciseSidebar(page, fixture, record) {
  const result = {};
  await page.evaluate(() => window.__readingReturnFixture.setTranscript('standard'));
  for (const outcome of ['remount', 'closed', 'replaced']) {
    await openFromSidebar(page, 'G');
    const identity = await page.evaluate(({ parent, child, key }) => window.__readingReturnFixture.openSidebar(parent, child, key), { parent: ids.G, child: ids.S, key: outcome });
    const root = sidebarRoots(page).first(); await root.waitFor();
    const turn = root.locator('[data-turn-process="78"]');
    await turn.scrollIntoViewIfNeeded();
    if (await turn.getAttribute('aria-expanded') !== 'true') await turn.click();
    const groupHeader = root.locator('[data-step-process][data-chat-turn="78"] button[aria-expanded]').first();
    if (await groupHeader.getAttribute('aria-expanded') !== 'true') await groupHeader.click();
    await root.evaluate(node => { window.__readingReturnSidebarSource = node; });
    const capture = await openEmbeddedCard(page, root);
    assert.equal(await page.evaluate(() => window.__readingReturnSidebarSource.isConnected), false, 'leaving the parent must unmount the source Chat for this case');
    if (outcome !== 'remount') {
      await page.evaluate(({ outcome, parent, child }) => {
        if (outcome === 'closed') window.__readingReturnFixture.closeSidebar(outcome);
        else window.__readingReturnFixture.replaceSidebar(outcome, parent, child);
      }, { outcome, parent: ids.G, child: ids.V });
      await page.waitForFunction(key => window.__readingReturnFixture.occurrence(key).aborted, outcome);
    }
    await backButton(page, 'S').click();
    if (outcome === 'remount') {
      await backButton(page, 'S').waitFor({ state: 'hidden', timeout: 20000 });
      await mainRoot(page, 'G').waitFor();
      await assertAnchor(sidebarRoots(page).first(), capture, 'original Sidebar lifetime returns after Chat remount');
      assert.equal(await sidebarRoots(page).first().evaluate(node => node !== window.__readingReturnSidebarSource), true);
      assert.equal((await page.evaluate(key => window.__readingReturnFixture.occurrence(key), outcome)).id, identity.id);
      await page.evaluate(key => window.__readingReturnFixture.closeSidebar(key), outcome);
    } else {
      await page.locator('[data-session-tools-return][data-return-phase="error"]').waitFor();
      assert.equal(await mainRoot(page, 'B').count(), 1, `${outcome} source cannot be replaced by another occurrence`);
      assert.equal(await backButton(page, 'S').count(), 0, 'invalid source return point is cleared with a visible reason');
    }
    result[outcome] = { identity, capture };
  }
  await page.evaluate(() => window.__readingReturnFixture.setTranscript('verbose'));
  record('sidebarLifetimes', result);
}
async function exerciseMissingSource(page, fixture, record) {
  const capture = await prepareOldReturn(page, 'R');
  assert.equal(typeof capture.sourceSeq, 'number', 'captured row resolves through the public Conversation target');
  await fixture.control({ op: 'rewrite', id: ids.R, seq: capture.sourceSeq, marker: 'SOURCE_REPLACED' });
  await backButton(page, 'R').click();
  await page.locator('[data-session-tools-return][data-return-phase="error"]').waitFor();
  assert.equal(await mainRoot(page, 'B').count(), 1, 'replaced content is rejected before navigation');
  await waitNoRestoreReference(page, 'R');

  await prepareOldReturn(page, 'D');
  const restoreFile = fixture.hideSource(ids.D);
  try {
    await backButton(page, 'D').click();
    await page.locator('[data-session-tools-return][data-return-phase="error"]').waitFor();
    assert.equal(await mainRoot(page, 'B').count(), 1, 'removed durable source never falls back to an approximate position');
    await waitNoRestoreReference(page, 'D');
  } finally { restoreFile(); }
  record('sourceInvalidation', { changedContentRejected: true, removedDurableSourceRejected: true, inaccessibleTransportCoveredByRetryGroup: true });
}

async function visibleAnchor(root) {
  return root.evaluate(element => {
    const scroll = element.querySelector('[data-conversation-scroll]'), boundary = scroll.getBoundingClientRect().top + 24;
    const row = [...element.querySelectorAll('[data-chat-anchor-key][data-chat-node-key]:not([data-chat-flow-kind="turn-process"])')]
      .find(node => !node.closest('[hidden]') && node.getClientRects().length && node.getBoundingClientRect().bottom > boundary);
    if (!row) throw new Error('no actual visible native row');
    return { key: row.dataset.chatAnchorKey, top: row.getBoundingClientRect().top - scroll.getBoundingClientRect().top };
  });
}
async function exerciseNativeTransactions(page, url, fixture, output) {
  const context = await page.context().browser().newContext({
    viewport: { width: 1400, height: 900 }, locale: 'en-US',
    storageState: await page.context().storageState(),
  });
  const isolated = await context.newPage();
  try {
    await isolated.goto(url, { waitUntil: 'load' });
    await isolated.getByRole('button', { name: 'Search sessions' }).waitFor({ timeout: 30000 });
    await isolated.waitForFunction(() => Boolean(window.__readingReturnFixture));

    await openFromSidebar(isolated, 'P'); await waitAtTail(isolated, 'P');
    await isolated.evaluate(id => window.__readingReturnFixture.captureNative(id, 'changed'), ids.P);
    // Collapse content after the saved reading line through the real preference API.
    await isolated.evaluate(() => window.__readingReturnFixture.setTranscript('standard'));
    await isolated.waitForTimeout(200);
    const latest = mainRoot(isolated, 'P').getByRole('button', { name: 'Back to bottom', exact: true });
    if (await latest.count()) await latest.click();
    await waitAtTail(isolated, 'P');
    assert.equal(await mainRoot(isolated, 'P').locator('[data-chat-following-tail]').count(), 1, 'failed transaction starts with true following policy');
    await isolated.evaluate(() => window.__readingReturnFixture.beginNativeRestore('changed'));
    await isolated.waitForFunction(() => window.__readingReturnFixture.nativeStatus('changed')?.pending === false);
    const changed = await isolated.evaluate(() => window.__readingReturnFixture.nativeStatus('changed'));
    assert.equal(changed.result?.kind, 'changed', 'this case must reach a changed native transaction, not fail in history preparation');
    assert.equal(await mainRoot(isolated, 'P').locator('[data-chat-following-tail]').count(), 1, 'changed rollback restores the pre-transaction follow policy');
    await fixture.control({ op: 'append', id: ids.P, marker: 'AFTER_CHANGED_ROLLBACK' });
    await mainRoot(isolated, 'P').getByText('AFTER_CHANGED_ROLLBACK_ANSWER', { exact: false }).waitFor({ state: 'attached' });
    await waitAtTail(isolated, 'P');
    await waitNoRestoreReference(isolated, 'P');
    await isolated.evaluate(() => window.__readingReturnFixture.setTranscript('verbose'));

    await openFromSidebar(isolated, 'Q'); await historyThrough(isolated, 'Q', 20);
    await mainRoot(isolated, 'Q').getByText('RETURN_Q_USER_20', { exact: false }).scrollIntoViewIfNeeded();
    const capture = await visibleAnchor(mainRoot(isolated, 'Q'));
    await isolated.evaluate(id => window.__readingReturnFixture.captureNative(id, 'interrupted'), ids.Q);
    await mainRoot(isolated, 'Q').getByRole('button', { name: 'Back to bottom', exact: true }).click(); await waitAtTail(isolated, 'Q');
    const now = Date.now();
    await isolated.clock.install({ time: new Date(now) });
    await isolated.clock.pauseAt(new Date(now + 1000));
    await isolated.evaluate(() => window.__readingReturnFixture.beginNativeRestore('interrupted'));
    await isolated.waitForTimeout(50);
    let landed = false;
    for (let frame = 0; frame < 10 && !landed; frame++) {
      const state = await isolated.evaluate(() => window.__readingReturnFixture.nativeStatus('interrupted'));
      const actual = await visibleAnchor(mainRoot(isolated, 'Q'));
      assert.equal(state.pending, true, 'first landing must be observed before the native transaction commits');
      landed = actual.key === capture.key && Math.abs(actual.top - capture.top) < 2;
      if (!landed) await isolated.clock.runFor(16);
    }
    assert.equal(landed, true, 'real geometry must reach its first native landing under one-frame stepping');
    await isolated.locator('[data-slot="main"] [data-composer-input]').focus();
    await isolated.keyboard.type('AFTER_LANDING_INPUT');
    await isolated.clock.runFor(16);
    const interrupted = await isolated.evaluate(() => window.__readingReturnFixture.nativeStatus('interrupted'));
    assert.equal(interrupted.pending, false); assert.equal(interrupted.result?.kind, 'interrupted');
    await isolated.clock.resume();
    await mainRoot(isolated, 'Q').hover(); await isolated.mouse.wheel(0, -180); await isolated.waitForTimeout(150);
    const readerPosition = await visibleAnchor(mainRoot(isolated, 'Q'));
    await fixture.control({ op: 'append', id: ids.Q, marker: 'AFTER_NATIVE_INTERRUPTION' });
    await mainRoot(isolated, 'Q').getByText('AFTER_NATIVE_INTERRUPTION_ANSWER', { exact: false }).waitFor({ state: 'attached' });
    await isolated.waitForTimeout(150);
    await assertAnchor(mainRoot(isolated, 'Q'), readerPosition, 'cancelled first landing cannot compensate back over later reader input');
    assert.equal(await isolated.locator('[data-slot="main"] [data-composer-input]').innerText(), 'AFTER_LANDING_INPUT');
    assert.equal(await isolated.evaluate(() => document.activeElement?.hasAttribute('data-composer-input')), true);
    await waitNoRestoreReference(isolated, 'Q');
    return { changed, firstLandingCancelled: interrupted, readerPosition, clockScope: 'separate browser context; native DOM and scroll geometry' };
  } catch (error) {
    // This context closes below; the runner's main-page failure capture cannot
    // show this page's actual search, selection or transaction state.
    await isolated.screenshot({ path: path.join(output, 'native-transaction-failure.png'), timeout: 5000 }).catch(() => {});
    const evidence = await isolated.evaluate(() => ({
      text: document.body.innerText,
      inputs: [...document.querySelectorAll('input')].filter(input => /^Search sessions|^Search session names/.test(input.placeholder))
        .map(input => ({ placeholder: input.placeholder, value: input.value })),
      results: [...document.querySelectorAll('[role="treeitem"]')].map(row => row.textContent),
      sessions: [...document.querySelectorAll('[data-conversation-session]')].map(root => root.dataset.conversationSession),
      fixtureLoaded: Boolean(window.__readingReturnFixture),
    })).catch(() => null);
    try {
      if (evidence) fs.writeFileSync(path.join(output, 'native-transaction-failure.json'), JSON.stringify(evidence, null, 2));
    } catch { /* Preserve the original scenario failure if artifact writing fails. */ }
    throw error;
  } finally { await context.close(); }
}
