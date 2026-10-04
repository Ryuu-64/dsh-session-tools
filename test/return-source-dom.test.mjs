// Contract tests for the isolated RC2 DOM seam. Geometry/transport are scripted;
// real Chat ownership and scroll sampling are verified in Reading return RC2 CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React from 'react';

function harness(t) {
  const dom = new JSDOM('<div data-slot="main"><div data-slot="main.conversation"><header></header><div data-conversation-content data-conversation-session="A"><div data-conversation-scroll><div data-slot="conversation.view"><div data-chat-flow></div></div></div></div></div></div>', { pretendToBeVisual: true });
  const { window } = dom;
  let client;
  window.__ModuleLoader__ = { load: ({ factory }) => { client = factory(() => React); } };
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), { window, console, AbortController, setTimeout, clearTimeout });
  const root = window.document.querySelector('[data-conversation-content]');
  const scroll = root.firstElementChild, flow = root.querySelector('[data-chat-flow]');
  scroll.getBoundingClientRect = () => ({ top: 100, bottom: 600, width: 900, height: 500 });
  const nodes = new Map(), retained = new Map(), delayed = new Map();
  const opened = [], loaded = [];
  let sourceText = "Repeated paragraph.", replaceContent = false;
  let nav = new AbortController();
  const rect = (top, height = 100) => ({ top: top - scroll.scrollTop, bottom: top + height - scroll.scrollTop, width: 900, height });
  function row(key, top, text = 'Repeated paragraph.', part = '') {
    const element = window.document.createElement('div');
    element.dataset.chatAnchorKey = key + part; element.dataset.chatNodeKey = key;
    element.getBoundingClientRect = () => rect(top); element.getClientRects = () => [rect(top)];
    const paragraph = window.document.createElement('p'); paragraph.textContent = text;
    paragraph.getBoundingClientRect = () => rect(top); paragraph.getClientRects = () => [rect(top)];
    element.append(paragraph); flow.append(element);
    return element;
  }
  const sourceRow = row('A-1', 80); row('A-2', 400);
  const button = window.document.createElement('button'); sourceRow.append(button);
  nodes.set('A', new Map([['A-1', { anchorSeq: 12 }], ['A-2', { anchorSeq: 25 }]]));
  nodes.set('B', new Map([['B-1', { anchorSeq: 32 }]]));
  const bindings = new Map();
  for (const id of ['A','B','C']) bindings.set(id, { sessionId: id, session: {
    getSnapshot: () => ({ openState: 'open' }),
    loadThrough: async seq => { loaded.push([id, seq]); },
  } });
  const ctx = {
    sessions: {
      list: { getSnapshot: () => ({ byId: { A: { displayTitle: 'Alpha' }, B: { displayTitle: 'Beta' } } }) },
      binding: id => bindings.get(id),
      retain(id, { signal }) {
        retained.set(id, (retained.get(id) ?? 0) + 1);
        let released = false;
        return { ready: delayed.get(id) ?? Promise.resolve(bindings.get(id)), release() { if (!released) { released = true; retained.set(id, retained.get(id)-1); } } };
      },
    },
    uiConversation: { binding: binding => ({ target: () => ({ getSnapshot: () => ({ nodes: nodes.get(binding.sessionId) ?? new Map() }) }) }) },
    layout: {
      beginNavigation() { nav.abort(); nav = new AbortController(); return nav.signal; },
      panelInfo: { subscribe: () => () => {}, getSnapshot: () => ({ activePanelId: null }) },
    },
  };
  const controller = client.createReadingReturnAdapter(ctx, id => {
    ctx.layout.beginNavigation();
    opened.push(id); root.dataset.conversationSession = id;
    flow.replaceChildren();
    if (id === 'A') { row('A-1', 80, sourceText); row('A-2', 400); }
    else row(`${id}-1`, 120);
    if (replaceContent) root.replaceWith(root.cloneNode(true));
  }, window);
  t.after(() => { controller.dispose(); window.close(); });
  return { controller, ctx, root, scroll, flow, button, opened, retained, nodes, delayed, bindings, row, window, loaded, rewrite: text => { sourceText = text; }, replaceContent: () => { replaceContent = true; } };
}

test('DOM contract captures the clicked occurrence, stable row and paragraph offset', async t => {
  const h = harness(t);
  await h.controller.open('B', { sessionId: 'A', element: h.button });
  const record = h.controller.getSnapshot().record;
  assert.equal(record.sessionId, 'A'); assert.equal(record.title, 'Alpha');
  assert.equal(record.position.anchorKey, 'A-1'); assert.equal(record.position.top, -20);
  await h.controller.back();
  assert.equal(h.controller.getSnapshot().record, null);
  assert.deepEqual(h.opened, ['B','A']);
  assert.equal(h.retained.get('A'), 0); assert.equal(h.retained.get('B'), 0);
  assert.equal(h.window.document.activeElement.textContent, 'Repeated paragraph.');
});

test('DOM contract ignores repeated text in other stable rows and rejects rewritten source text', async t => {
  const h = harness(t); await h.controller.open('B', { sessionId: 'A', element: h.button });
  await h.controller.back();
  assert.equal(h.scroll.scrollTop, 0, 'first matching text elsewhere did not choose another row');
  const button = h.window.document.createElement('button'); h.flow.firstElementChild.append(button);
  await h.controller.open('B', { sessionId: 'A', element: button });
  h.rewrite('Rewritten content');
  await h.controller.back();
  assert.equal(h.controller.getSnapshot().phase, 'error');
  assert.match(h.controller.getSnapshot().message, /内容已变化/);
  assert.ok(h.controller.getSnapshot().record);
});

test('DOM contract cancels late preparation when navigation changes and releases the temporary reference', async t => {
  const h = harness(t); await h.controller.open('B', { sessionId: 'A', element: h.button });
  let resolve; h.delayed.set('A', new Promise(r => { resolve = r; }));
  const pending = h.controller.back();
  h.ctx.layout.beginNavigation(); h.root.dataset.conversationSession = 'C';
  await pending; resolve(h.bindings.get('A'));
  assert.deepEqual(h.opened, ['B']); assert.equal(h.retained.get('A'), 0);
  assert.equal(h.controller.getSnapshot().record, null);
});

test('DOM contract never adopts a same-session embedded occurrence as main source', async t => {
  const h = harness(t), embedded = h.window.document.createElement('div');
  embedded.dataset.conversationContent = ''; embedded.dataset.conversationSession = 'A';
  const button = h.window.document.createElement('button'); embedded.append(button); h.root.append(embedded);
  await h.controller.open('B', { sessionId: 'A', element: button });
  assert.equal(h.controller.getSnapshot().record, null);
  assert.match(h.controller.getSnapshot().message, /暂不支持/);
});

test('DOM contract uses the host loader once and verifies content after soft completion', async t => {
  const h = harness(t); await h.controller.open('B', { sessionId: 'A', element: h.button });
  h.nodes.set('A', new Map());
  await h.controller.back();
  assert.deepEqual(h.loaded, [['A',12]]);
  assert.deepEqual(h.opened, ['B']);
  assert.match(h.controller.getSnapshot().message, /来源内容已删除或未能加载/);
  assert.equal(h.retained.get('A'), 0);
});

test('DOM contract user scroll intent cancels only this restoration and keeps a retry point', async t => {
  const h = harness(t); await h.controller.open('B', { sessionId: 'A', element: h.button });
  let resolve; h.delayed.set('A', new Promise(r => { resolve = r; }));
  const pending = h.controller.back();
  h.scroll.dispatchEvent(new h.window.WheelEvent('wheel'));
  await pending; resolve(h.bindings.get('A'));
  assert.deepEqual(h.opened, ['B']); assert.equal(h.retained.get('A'), 0);
  assert.ok(h.controller.getSnapshot().record);
});

test('DOM contract switching to another view during preparation prevents late navigation and focus', async t => {
  const h = harness(t); await h.controller.open('B', { sessionId: 'A', element: h.button });
  let resolve; h.delayed.set('A', new Promise(r => { resolve = r; }));
  const pending = h.controller.back();
  const outlet = h.root.querySelector('[data-slot="conversation.view"]');
  outlet.replaceChildren(h.window.document.createElement('section'));
  // MutationObserver delivers the actual view change before history finishes.
  await new Promise(r => setImmediate(r));
  resolve(h.bindings.get('A')); await pending;
  assert.deepEqual(h.opened, ['B']);
  assert.equal(h.controller.getSnapshot().record, null);
  assert.equal(h.retained.get('A'), 0);
  assert.equal(h.window.document.activeElement, h.window.document.body);
});

test('DOM contract actual tab identity cancels even when Chat returns before history does', async t => {
  const h = harness(t);
  const tabs = h.window.document.createElement('div'); tabs.dataset.conversationTabs = '';
  tabs.innerHTML = '<button role="tab" aria-selected="true">Chat</button><button role="tab" aria-selected="false">Trajectory</button>';
  h.root.parentElement.querySelector('header').append(tabs);
  await h.controller.open('B', { sessionId: 'A', element: h.button });
  let resolve; h.delayed.set('A', new Promise(r => { resolve = r; }));
  const pending = h.controller.back();
  tabs.children[0].setAttribute('aria-selected', 'false'); tabs.children[1].setAttribute('aria-selected', 'true');
  await new Promise(r => setImmediate(r));
  tabs.children[0].setAttribute('aria-selected', 'true'); tabs.children[1].setAttribute('aria-selected', 'false');
  resolve(h.bindings.get('A')); await pending;
  assert.deepEqual(h.opened, ['B']); assert.equal(h.controller.getSnapshot().record, null);
});

test('DOM contract unmounting the whole reading occurrence clears its return point', async t => {
  const h = harness(t); await h.controller.open('B', { sessionId: 'A', element: h.button });
  h.root.closest('[data-slot="main"]').remove();
  await new Promise(r => setImmediate(r));
  assert.equal(h.controller.getSnapshot().record, null);
  assert.equal(h.controller.root(), null);
});

test('DOM contract deleted source fails before navigation even if its old rows remain cached', async t => {
  const h = harness(t); await h.controller.open('B', { sessionId: 'A', element: h.button });
  h.bindings.get('A').session.getSnapshot = () => ({ openState: 'open', removed: true });
  await h.controller.back();
  assert.deepEqual(h.opened, ['B']);
  assert.equal(h.controller.getSnapshot().phase, 'error');
  assert.match(h.controller.getSnapshot().message, /已删除/);
  assert.equal(h.retained.get('A'), 0);
});

test('DOM contract accepts expected session content replacement inside the exact same main occurrence', async t => {
  const h = harness(t); h.replaceContent();
  await h.controller.open('B', { sessionId: 'A', element: h.button });
  assert.equal(h.controller.getSnapshot().record?.sessionId, 'A');
  assert.notEqual(h.controller.root(), h.root);
  assert.equal(h.controller.root().dataset.conversationSession, 'B');
  assert.equal(h.controller.root().closest('[data-slot="main"]'), h.window.document.querySelector('[data-slot="main"]'));
});
