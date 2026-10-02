import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';
import { foldReceipts, messageReceipt, receiptProjection, turnOutput } from '../lib/message-receipts.js';

function log() {
  const events = [];
  const append = (type, data) => events.push({ seq: events.length, type, data });
  const insert = (id, target = 'next-turn', start = 0) => append('agent/inbox/spliced', { target, start, inserted: [{ id }] });
  const claim = (id, turn, target = 'next-turn') => {
    append('turn/start', { turn });
    append('agent/inbox/spliced', { target, start: 0, removedCount: 1, inserted: [] });
    append('user/message', { id });
  };
  const answer = (text, turn) => append('assistant/message', { turn, step: 1, message: { content: [{ type: 'text', text }] }, stream: [] });
  const end = (turn, kind = 'completed') => append('turn/end', { turn, reason: { kind } });
  const result = (id, inheritedEventCount) => messageReceipt(foldReceipts(events, inheritedEventCount), id, events);
  return { events, append, insert, claim, answer, end, result };
}

for (const [kind, expected] of [['completed', 'turnCompleted'], ['blocked', 'blocked'], ['aborted', 'cancelled'], ['error', 'failed'], ['interrupted', 'interrupted'], ['max-tokens', 'incomplete'], ['future-unknown-kind', 'unknown']]) {
  test(`receipt distinguishes turn end ${kind}`, () => {
    const l = log();
    l.insert('A'); l.claim('A', 1); l.answer('A only', 1); l.end(1, kind);
    const result = l.result('A');
    assert.equal(result.messageStatus, expected);
    assert.equal(result.completed, kind === 'completed');
    assert.equal(result.turn, 1);
    assert.equal(result.output, kind === 'completed' ? 'A only' : undefined);
  });
}

test('queued removal/replacement remains discarded, even after later successful turns', () => {
  const l = log();
  l.insert('A');
  l.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [{ id: 'B' }], outcome: 'canceled' });
  l.claim('B', 1); l.answer('B answer', 1); l.end(1);
  assert.deepEqual(l.result('A'), { messageStatus: 'discarded', completed: false });
  assert.equal(l.result('B').output, 'B answer');
});

test('A/B and later appended turns never overwrite earlier receipts', () => {
  const l = log();
  l.insert('A'); l.insert('B', 'next-turn', 1);
  l.claim('A', 1); l.answer('answer A', 1); l.end(1);
  l.claim('B', 2); l.answer('answer B', 2); l.end(2);
  const first = l.result('A');
  l.insert('C'); l.claim('C', 3); l.answer('answer C', 3); l.end(3);
  assert.deepEqual(l.result('A'), first);
  assert.equal(l.result('A').output, 'answer A');
  assert.equal(l.result('B').output, 'answer B');
  assert.equal(l.result('C').output, 'answer C');
});

test('multiple admitted messages in the same turn share its result', () => {
  const l = log(); l.insert('A'); l.insert('steering', 'next-step');
  l.append('turn/start', { turn: 1 });
  for (const target of ['next-step', 'next-turn']) l.append('agent/inbox/spliced', { target, start: 0, removedCount: 1, inserted: [] });
  for (const id of ['steering', 'A']) l.append('user/message', { id });
  l.answer('shared turn answer', 1); l.end(1);
  for (const id of ['steering', 'A']) assert.equal(l.result(id).output, 'shared turn answer');
});

test('pre-step rewriting a message away cannot report completed', () => {
  const l = log(); l.insert('A');
  l.append('turn/start', { turn: 1 });
  l.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] });
  l.append('user/message', { id: 'replacement' }); l.answer('replacement answer', 1); l.end(1);
  assert.equal(l.result('A').messageStatus, 'unknown');
  assert.equal(l.result('A').completed, false);
  assert.equal(l.result('A').output, undefined);
});

test('a completed turn with an admitted message and empty output is still an empty result', () => {
  const l = log(); l.insert('A'); l.claim('A', 1); l.end(1);
  assert.equal(l.result('A').completed, true);
  assert.equal(l.result('A').output, undefined);
});

const stream = text => [{ type: 'text-chunks', time0: 1, index: 0, dt: [], texts: [text] }];
test('durable compact message/attempt streams supply the fallback only within the owning turn', () => {
  const l = log(); l.insert('old'); l.claim('old', 1); l.answer('old answer', 1); l.end(1);
  l.insert('A'); l.claim('A', 2);
  l.append('assistant/attempt', { turn: 2, step: 1, stream: stream('first ') });
  l.append('assistant/message', { turn: 2, step: 1, message: { content: [] }, stream: stream('second') });
  l.end(2);
  assert.equal(l.result('A').output, 'first second');
  l.insert('B'); l.claim('B', 3); l.answer('B answer', 3); l.end(3);
  assert.equal(l.result('A').output, 'first second');
});

test('canonical nonempty content wins over stream fallback, including tool-only content', () => {
  const l = log(); l.insert('A'); l.claim('A', 1);
  l.append('assistant/attempt', { turn: 1, stream: stream('attempt text') });
  l.answer('assembled text', 1); l.end(1);
  assert.equal(l.result('A').output, 'assembled text');
  const withToolOnly = structuredClone(l.events);
  withToolOnly.at(-2).data.message.content = [{ type: 'tool-call', id: 'c', name: 'fixture', arguments: '{}' }];
  assert.equal(turnOutput(withToolOnly, 1), undefined);
});

test('a forged late event naming an old turn cannot overwrite its bounded output', () => {
  const l = log(); l.insert('A'); l.claim('A', 1); l.answer('A answer', 1); l.end(1);
  l.answer('late unrelated text', 1);
  assert.equal(l.result('A').output, 'A answer');
});

for (const mutate of [
  l => { l.events[0].seq = 5; },
  l => { l.events[2].data.start = 99; },
  l => { l.events[2].data.outcome = 'unknown'; },
  l => { l.events.at(-1).data.turn = 99; },
  l => { l.events.at(-2).data.stream = [{ type: 'text-chunks', texts: ['bad'] }]; },
]) {
  test('incomplete or malformed evidence never returns stale text or success', () => {
    const l = log(); l.insert('A'); l.claim('A', 1); l.answer('A answer', 1); l.end(1);
    mutate(l);
    assert.equal(l.result('A').completed, false);
    assert.equal(l.result('A').messageStatus, 'unknown');
    assert.equal(l.result('A').output, undefined);
  });
}

test('inherited or reused identities cannot impersonate a new receipt', () => {
  const l = log(); l.insert('A'); l.claim('A', 1); l.answer('A answer', 1); l.end(1);
  assert.equal(l.result('A', l.events.length).messageStatus, 'unknown');
  l.insert('A'); l.claim('A', 2); l.answer('second A', 2); l.end(2);
  assert.equal(l.result('A').messageStatus, 'unknown');
});

test('the pure projection is immutable, JSON-roundtrippable and validates checkpoint state', () => {
  const l = log(); l.insert('A'); l.claim('A', 1); l.answer('A answer', 1); l.end(1);
  let state = receiptProjection.init();
  for (const event of l.events) {
    const before = JSON.stringify(state);
    const next = receiptProjection.apply(state, event);
    assert.equal(JSON.stringify(state), before);
    state = receiptProjection.stateSchema.parse(JSON.parse(JSON.stringify(next)));
  }
  assert.equal(messageReceipt(state, 'A', l.events).output, 'A answer');
  assert.throws(() => receiptProjection.stateSchema.parse({ ...state, messages: { A: { state: 'finished' } } }));
});

test('idle + latest assistant text without message evidence is explicitly unknown', async () => {
  const tools = {};
  const target = { id: 'target', status: 'idle', session: { snapshotEvents: () => [{ seq: 0, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'old answer' }] } } }] } };
  apply({ tools: { register: d => { tools[d.name] = d; } }, agents: { get: () => target } });
  const result = await tools.session_wait.execute({ sessionId: 'target', messageId: 'unknown' }, {});
  assert.equal(result.scope, 'message');
  assert.equal(result.messageStatus, 'unknown');
  assert.equal(result.completed, false);
  assert.equal(result.output, undefined);
  assert.match(tools.session_wait.output.render({}, result)[0].text, /No durable receipt/);
});

test('non-waiting send reports a synchronous discard with the exact delivery receipt', async () => {
  const l = log(), tools = {};
  let delivered;
  const target = {
    id: 'target', status: 'idle', inbox: { nextTurn: [] },
    session: { header: { id: 'target', cwd: '/fixture' }, snapshotEvents: () => l.events.slice() },
    followup(message) {
      delivered = message;
      l.insert(message.id);
      l.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' });
    },
  };
  apply({
    tools: { register: d => { tools[d.name] = d; } }, agents: { get: () => target },
    get: name => ({ sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) }, approval: { overrideOf: () => 'never', request() {} } })[name],
  });
  const result = await tools.session_send.execute({ sessionId: 'target', message: 'A' }, { agent: { id: 'caller', session: { header: { id: 'caller' } } } });
  assert.equal(result.messageId, delivered.id);
  assert.equal(result.messageStatus, 'discarded'); assert.equal(result.completed, false); assert.equal(result.output, undefined);
});
