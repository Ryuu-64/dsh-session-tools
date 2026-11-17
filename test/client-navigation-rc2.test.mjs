import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientRc2 } from './helpers/client-rc2.mjs';
const a = 'session-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const b = 'session-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const tick = () => new Promise(resolve => setImmediate(resolve));

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
