import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { realHost } from './helpers/real-host.mjs';
import { resultNode, sessionCard } from './helpers/session-card.mjs';

const first = 'session-11111111-1111-1111-1111-111111111111';
const second = 'session-33333333-3333-3333-3333-333333333333';

async function createAndReload(h, id, title) {
  h.model.tool('session_create', { prompt: 'synthetic card target', title, wait: true });
  h.model.text('child done');
  h.model.text('caller done');
  const caller = await h.createAgent(id);
  caller.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'create fixture' }] }));
  await caller.agent.whenIdle();
  const live = caller.agent.session.snapshotEvents().find(e => e.type === 'tool/result');
  assert.equal(live.data.message.content[0].isError, false);
  const sessionId = live.data.meta.sessionId;
  assert.ok(h.ctx.agents.get(sessionId), 'metadata names the actual created Agent');
  assert.equal(live.data.meta.title, h.ctx.sessionTitle.get(h.ctx.agents.get(sessionId).session).title);
  assert.notEqual(sessionId, first);
  assert.notEqual(sessionId, second);
  await caller.dispose();
  const reader = await h.ctx.sessionPersistence.open(id, 'read');
  let replay;
  try { replay = (await reader.read()).events.find(e => e.type === 'tool/result'); }
  finally { await reader.close(); }
  assert.deepEqual(replay.data.meta, live.data.meta);
  assert.equal('value' in replay.data, false, 'canonical values are not the replay contract');
  assert.equal('meta' in replay.data.message.content[0], false, 'metadata belongs to the event, not content');
  assert.match(JSON.stringify(replay.data.message.content[0].content), /Created session:/);
  return { live, replay, sessionId };
}

for (const title of [`Discuss ${first}`, `${first} ${second}`, `first line\n${first}\n<&> "`, 'same title']) {
  test(`rc.2 persists and reloads a trustworthy target for ${JSON.stringify(title)}`, { timeout: 15000 }, async t => {
    const h = await realHost(t);
    h.ctx.on('approval/request', () => 'allowed-once');
    const a = await createAndReload(h, 'card-caller-a', title);
    const b = title === 'same title' ? await createAndReload(h, 'card-caller-b', title) : undefined;
    const liveCard = await sessionCard(t);
    liveCard.render(resultNode(a.live)).button.props.onClick();
    assert.deepEqual(liveCard.opened, [a.sessionId]);
    const agents = h.ctx.agents;
    await h.ctx.fiber.dispose();
    assert.equal(agents.get(a.sessionId), undefined, 'target is closed before history replay');
    // A fresh bundle/slot registration models a browser refresh. Navigation is
    // still a callback boundary; this does not claim a desktop UI was opened.
    const refreshed = await sessionCard(t);
    const card = refreshed.render(resultNode(a.replay));
    card.button.props.onClick();
    card.button.props.onClick();
    assert.deepEqual(refreshed.opened, [a.sessionId, a.sessionId]);
    if (b) {
      assert.notEqual(a.sessionId, b.sessionId);
      refreshed.render(resultNode(b.replay)).button.props.onClick();
      assert.deepEqual(refreshed.opened, [a.sessionId, a.sessionId, b.sessionId]);
    }
  });
}

test('a durable real-host denial retains its error without a success card', { timeout: 15000 }, async t => {
  const h = await realHost(t);
  h.ctx.on('approval/request', () => 'rejected');
  h.model.tool('session_create', { prompt: 'must not be created', title: first });
  h.model.text('caller done');
  const caller = await h.createAgent('card-denied');
  caller.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'denied fixture' }] }));
  await caller.agent.whenIdle();
  await caller.dispose();
  const reader = await h.ctx.sessionPersistence.open('card-denied', 'read');
  let event;
  try { event = (await reader.read()).events.find(e => e.type === 'tool/result'); }
  finally { await reader.close(); }
  assert.equal(event.data.meta, undefined);
  assert.equal(event.data.message.content[0].isError, true);
  const card = await sessionCard(t);
  const view = card.render(resultNode(event));
  assert.equal(view.button, undefined);
  assert.match(view.html, /declined/);
  assert.doesNotMatch(view.html, /已创建会话/);
});
