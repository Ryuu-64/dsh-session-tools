import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReceiptProjectionReader, receiptProjection } from '../lib/message-receipts.js';

const session = {};

function projectionScope() {
  let inject;
  const warnings = [];
  const read = createReceiptProjectionReader({ inject(_services, apply) { inject = apply; } });
  return {
    read,
    warnings,
    provide(sessionProjections) {
      let cleanup;
      inject({
        sessionProjections,
        effect(install) { cleanup = install(); },
        logger: { warn(...args) { warnings.push(args); } },
      });
      return cleanup;
    },
  };
}

test('a refused projection never reads another registrant under its key', async () => {
  const { read, provide, warnings } = projectionScope();
  let keyedReads = 0;
  provide({
    // The rc.3 compatibility adapter is both callable and thenable.
    register: () => Object.assign(() => {}, {
      then(_resolve, reject) { reject(new Error('projection key conflict')); },
    }),
    stateOf() { keyedReads++; return { seq: 99 }; },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(read(session), undefined);
  assert.equal(keyedReads, 0);
  assert.match(warnings[0][1], /projection key conflict/);
});

test('late registration cannot revive a disposed reader or replace a new scope reader', async () => {
  const { read, provide } = projectionScope();
  const old = Promise.withResolvers();
  const release = provide({ register: () => old.promise });
  assert.equal(read(session), undefined);
  release();
  const state = { seq: 4 };
  const releaseNew = provide({ register: async () => ({ stateOf: () => state }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(read(session), state);
  old.resolve({ stateOf: () => assert.fail('disposed scope reader used') });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(read(session), state);
  releaseNew();
  assert.equal(read(session), undefined);
});

test('rc.2 reads its owned projection by key until its scope is released', async () => {
  const { read, provide } = projectionScope();
  const state = { seq: 7 };
  const release = provide({
    register(definition) {
      assert.equal(definition, receiptProjection);
      return () => {};
    },
    stateOf(target, key) {
      assert.equal(target, session);
      assert.equal(key, receiptProjection.key);
      return state;
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(read(session), state);
  release();
  assert.equal(read(session), undefined);
});
