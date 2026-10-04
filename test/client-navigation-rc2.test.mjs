import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const isRc2 = require('@deepseek-ai/dsh-agent/package.json').version === '0.2.0-rc.2';
const { clientRc2 } = isRc2 ? await import('./helpers/client-rc2.mjs') : {};
const rcTest = (name, fn) => test(name, { skip: !isRc2 }, fn);
const a = 'session-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const b = 'session-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const tick = () => new Promise(resolve => setImmediate(resolve));

rcTest('published RC2 bundles own delayed navigation, repeat selection, replacement and unload', async t => {
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

rcTest('two real RC2 client roots keep independent selections and dispose all streams', async t => {
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

rcTest('failed RC2 history remains a failed selected Session, without cancelling work', async t => {
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

rcTest('browser adapter waits for its real sibling service dependencies before exposing a card', async t => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<body></body>', { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const h = await clientRc2(t, { ids: [b], browser: dom.window });
  await h.mountWorkspace();
  assert.equal(h.entry(), undefined, 'uiWorkspace alone does not authorize layout/uiConversation access');
  // Conversation assembly is not exercised by this empty-document contract.
  // The separate real-Web lane owns native Chat capture and restoration.
  await h.ctx.plugin({ name: 'conversation-provider', apply: scope => { scope.provide('uiConversation', {}); } }).await();
  await tick();
  assert.ok(h.entry());
  h.click(b); await tick();
  assert.equal(h.ctx.sessions.retainInfo(b).getSnapshot().retainedBy.mainView, 1);
  assert.equal(h.ctx.sessions.retainInfo(b).getSnapshot().referenceCount, 1, 'temporary preparation reference was released');
  assert.deepEqual(h.cancelled, []);
});
