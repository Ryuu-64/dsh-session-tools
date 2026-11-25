import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import React from 'react';

function harness() {
  let client;
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: ({ factory }) => { client = factory(() => React); } } },
    console, AbortController, setTimeout, clearTimeout,
  });
  let current = 'A';
  const opened = [], restored = [];
  const waits = new Map();
  const position = { anchorKey: 'A-paragraph', anchorTop: -40 };
  const port = {
    capture: () => ({ sessionId: current, title: current, position }),
    current: () => current,
    prepare: async (id, signal) => { if (waits.has(id)) await waits.get(id); signal.throwIfAborted(); },
    open: async id => { current = id; opened.push(id); },
    restore: async record => { restored.push(record); },
  };
  const controller = client.createReturnNavigation(port);
  return { controller, opened, restored, waits, position, port, setCurrent: id => { current = id; } };
}

test('capture source, commit only successful target, then restore and consume one return point', async () => {
  const h = harness();
  await h.controller.open('B');
  assert.equal(h.controller.getSnapshot().record.sessionId, 'A');
  await h.controller.back();
  assert.deepEqual(h.opened, ['B', 'A']);
  assert.equal(h.restored[0].position, h.position);
  assert.equal(h.controller.getSnapshot().record, null);
});

test('B to C replaces A; repeated current target and failed target preserve B return record', async () => {
  const h = harness();
  await h.controller.open('B'); await h.controller.open('C');
  const record = h.controller.getSnapshot().record;
  assert.equal(record.sessionId, 'B');
  await h.controller.open('C');
  h.port.prepare = async () => { throw new Error('missing'); };
  await h.controller.open('D');
  assert.equal(h.controller.getSnapshot().record, record);
  assert.deepEqual(h.opened, ['B', 'C']);
});

test('failed restore remains retryable without a reverse record', async () => {
  const h = harness(); await h.controller.open('B');
  h.port.restore = async () => { throw new Error('content deleted'); };
  await h.controller.back();
  assert.equal(h.controller.getSnapshot().record.sessionId, 'A');
  assert.equal(h.controller.getSnapshot().phase, 'error');
  h.port.restore = async () => {};
  await h.controller.back();
  assert.equal(h.controller.getSnapshot().record, null);
});

test('new navigation and unload cancel a pending source load without a late open', async () => {
  const h = harness(); await h.controller.open('B');
  let finish; h.waits.set('A', new Promise(resolve => { finish = resolve; }));
  const pending = h.controller.back();
  h.controller.invalidate(); h.setCurrent('C'); finish(); await pending;
  assert.deepEqual(h.opened, ['B']);
  assert.equal(h.controller.getSnapshot().record, null);
  h.controller.dispose(); await h.controller.open('D');
  assert.deepEqual(h.opened, ['B']);
});

test('repeat return clicks share one in-flight operation and two roots stay isolated', async () => {
  const h = harness(), other = harness();
  await h.controller.open('B'); await other.controller.open('C');
  let finish; h.waits.set('A', new Promise(resolve => { finish = resolve; }));
  const pending = h.controller.back(); const repeat = h.controller.back();
  finish(); await Promise.all([pending, repeat]);
  assert.deepEqual(h.opened, ['B', 'A']);
  assert.equal(other.controller.getSnapshot().record.sessionId, 'A');
});

test('opening the current session interrupts a pending return without replacing its saved point', async () => {
  const h = harness(); await h.controller.open('B');
  const record = h.controller.getSnapshot().record;
  let finish; h.waits.set('A', new Promise(resolve => { finish = resolve; }));
  const pending = h.controller.back(); await h.controller.open('B');
  finish(); await pending;
  assert.deepEqual(h.opened, ['B']);
  assert.equal(h.controller.getSnapshot().record, record);
});
