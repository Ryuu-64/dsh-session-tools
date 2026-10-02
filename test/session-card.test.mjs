import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionCard } from './helpers/session-card.mjs';

const target = 'session-22222222-2222-2222-2222-222222222222';
const decoy = 'session-11111111-1111-1111-1111-111111111111';
const settled = (meta, text = `Created session: Discuss ${decoy} · ${target} (ungrouped)`) => ({
  kind: 'tool-result', isError: false, content: [{ type: 'text', text }], meta,
});

for (const title of [`Discuss ${decoy}`, `${decoy} and ${target}`, `line one\n${decoy}\n<&> " · end`, 'same title']) {
  test(`only durable metadata chooses the target: ${JSON.stringify(title)}`, async t => {
    const card = await sessionCard(t);
    const { button, html } = card.render(settled({ sessionId: target, title }));
    assert.equal(button.props.title, target);
    assert.equal(button.props.children, title);
    assert.equal(button.props.disabled, false);
    assert.match(html, /已创建会话/);
    button.props.onClick();
    button.props.onClick();
    assert.deepEqual(card.opened, [target, target], 'repeated clicks keep the same identity');
    assert.deepEqual(card.errors, []);
  });
}

test('identical titles with different IDs remain separate targets', async t => {
  const card = await sessionCard(t);
  for (const sessionId of [target, decoy]) card.render(settled({ sessionId, title: 'same title' })).button.props.onClick();
  assert.deepEqual(card.opened, [target, decoy]);
});

test('the title is optional display data, never a requirement for navigation', async t => {
  const card = await sessionCard(t);
  for (const title of [undefined, '', 42]) {
    const { button } = card.render(settled({ sessionId: target, title }));
    assert.equal(button.props.children, '会话');
    button.props.onClick();
  }
  assert.deepEqual(card.opened, [target, target, target]);
});

test('even a legacy receipt containing only one ID is text, not proof of identity', async t => {
  const card = await sessionCard(t);
  const text = `Created session: ${target} (ungrouped)`;
  const view = card.render(settled(undefined, text));
  assert.equal(view.button, undefined);
  assert.ok(view.html.includes(text));
});

for (const [name, meta] of [
  ['missing', undefined], ['null', null], ['array', []], ['string', target],
  ['no id', { title: target }], ['wrong type', { sessionId: 42 }],
  ['empty', { sessionId: '' }], ['title', { sessionId: 'my session' }],
  ['prefix', { sessionId: `prefix ${target}` }], ['suffix', { sessionId: `${target}\n` }],
  ['URL', { sessionId: `https://example.com/${target}` }], ['short uuid', { sessionId: 'session-2222' }],
]) {
  test(`untrusted ${name} metadata leaves the original text without navigation`, async t => {
    const card = await sessionCard(t);
    const text = `Created session: ${decoy} · ${target} (ungrouped)`;
    const block = { ...settled(meta, text), value: { sessionId: decoy }, output: { sessionId: decoy } };
    const { button, html } = card.render(block, { output: `Created session: ${decoy}` });
    assert.equal(button, undefined, 'never scan text, output or ephemeral value for a target');
    assert.ok(html.includes(text));
    assert.doesNotMatch(html, /已创建会话/);
    assert.deepEqual(card.opened, []);
  });
}

test('an error cannot show a successful card even with plausible success metadata', async t => {
  const card = await sessionCard(t);
  const { button, html } = card.render({ ...settled({ sessionId: target }), isError: true, content: [{ type: 'text', text: 'Creation denied' }] });
  assert.equal(button, undefined);
  assert.match(html, /Creation denied/);
  assert.doesNotMatch(html, /已创建会话/);
});

test('a running or malformed block cannot announce successful creation', async t => {
  const card = await sessionCard(t);
  for (const block of [null, undefined, {}, { name: 'session_create', meta: { sessionId: target } }, { ...settled({ sessionId: target }), isError: undefined }]) {
    const { button, html } = card.render(block);
    assert.equal(button, undefined);
    assert.doesNotMatch(html, /已创建会话/);
  }
});

test('an unavailable navigation target is caught and never replaced by a title ID', async t => {
  const requested = [];
  const card = await sessionCard(t, { open(id) { requested.push(id); throw new Error(`sessions.select: unknown session ${id}`); } });
  const { button } = card.render(settled({ sessionId: target, title: decoy }));
  assert.doesNotThrow(() => button.props.onClick());
  assert.doesNotThrow(() => button.props.onClick());
  assert.deepEqual(requested, [target, target]);
  assert.equal(card.errors.length, 2);
});
