/** Published browser bundles, real Cordis, SlotRegistry, ClientSessions and UIWorkspace.
 * Only the Remote/connection, unused shell controls and unrendered primitives are scripted boundaries.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as cordis from '@deepseek-ai/cordis';
import * as store from '@deepseek-ai/dsh-client-store';
import * as slots from '@deepseek-ai/dsh-client-ui-slots';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as jsx from 'react/jsx-runtime';

const require = createRequire(import.meta.url);
export function bundles({ browser } = {}) {
  const storage = new Map();
  const modules = new Map(Object.entries({
    '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-store': store,
    '@deepseek-ai/dsh-client-ui-slots': slots, '@deepseek-ai/dsh-client-ui-primitives': {},
    react: React, 'react-dom': ReactDOM, 'react-dom/client': ReactDOMClient, 'react/jsx-runtime': jsx,
  }));
  const globals = { console, Error, AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask,
    TextEncoder, TextDecoder, crypto: globalThis.crypto, structuredClone,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
  };
  const load = (name, path) => {
    if (modules.has(name)) return modules.get(name);
    let result;
    vm.runInNewContext(readFileSync(path ?? require.resolve(name.endsWith('/client') ? name : `${name}/client`), 'utf8'), {
      ...globals, window: Object.assign(browser ?? {}, { __ModuleLoader__: { load(definition) { result = definition.factory(dependency => load(dependency)); } } }),
    });
    modules.set(name, result);
    return result;
  };
  return { load, storage };
}

const stop = signal => new Promise(resolve => {
  if (signal.aborted) resolve();
  else signal.addEventListener('abort', resolve, { once: true });
});

export async function clientRc2(t, { ids, delayed = new Map(), rejected = new Set(), pluginPath, browser } = {}) {
  const b = bundles({ browser });
  const ctx = new cordis.Context();
  t.after(() => ctx.fiber.dispose());
  const gateway = b.load('@deepseek-ai/dsh-api-gateway/client');
  const connection = { generation: store.createSnapshotStore({ id: 1 }) };
  const opened = [], closed = [], cancelled = [];
  const session = {
    list: async () => ({ ok: true, value: { items: ids.map(sessionId => ({ sessionId, updatedAt: 1, running: false, blank: false, agentAvailable: true })) } }),
    async *control(signal) { yield { type: 'baseline', value: { projections: {} } }; await stop(signal); },
    async *follow(request, signal) {
      const id = request.address.sessionId;
      opened.push(id);
      try {
        if (delayed.has(id)) await Promise.race([delayed.get(id).promise, stop(signal)]);
        if (signal.aborted) return;
        if (rejected.has(id)) throw new Error('Synthetic missing history');
        yield { type: 'snapshot', header: { version: 4, id, createdAt: 0, isSeeded: false }, cursor: -1,
          records: [], hasMore: false, projections: { asOfSeq: -1, values: {} }, assistantStream: { revision: 0 } };
        await stop(signal);
      } finally { closed.push(id); }
    },
    cancel: async () => { cancelled.push(true); return { ok: true, value: { accepted: true } }; },
  };
  const remote = { session, commands: {}, subagents: {}, directoryPicker: {},
    $on: () => () => {}, $stream: options => new gateway.RemoteStream(connection, options),
  };
  for (const [key, value] of Object.entries({ connection, remote, fileUpload: {},
    'remote.commands': remote.commands, 'remote.session': session, 'remote.subagents': remote.subagents,
    'remote.directoryPicker': remote.directoryPicker, typert: { contexts: { registerClient: () => () => {} } },
  })) ctx.provide(key, value);
  const controller = ctx.plugin(b.load('@deepseek-ai/dsh-api-session-controller'));
  await controller.await();
  await ctx.sessions.refresh();
  const renderer = b.load('@deepseek-ai/dsh-client-ui-renderer');
  await ctx.plugin(renderer.SlotRegistry).await();
  ctx.slots.register({ name: 'root', children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' }, ...(browser ? { 'conversation.session.header.actions': { kind: 'list', scope: 'session' } } : {}) } }, () => null);
  const panel = store.createSnapshotStore({ selectedPanel: 'settings' });
  const layout = new (b.load('@deepseek-ai/dsh-client-ui-layout').LayoutController)({ selectPanel: value => panel.set({ selectedPanel: value }) }, () => true, panel);
  t.after(() => layout.dispose());
  if (browser) await ctx.plugin({ name: 'layout-provider', apply: scope => { scope.provide('layout', layout); } }).await();
  else ctx.provide('layout', layout);
  ctx.provide('workspaces', { list: store.createSnapshotStore({ items: [], archivedSessionIds: [], pinnedSessionIds: [], phase: 'ready', state: 'idle', error: null }) });
  ctx.provide('locale', { register: () => () => {}, bind: () => key => key });
  ctx.provide('shortcuts', { catalog: store.createSnapshotStore([]), register: () => () => {} });
  const plugin = ctx.plugin(b.load('@ryuu-64/dsh-session-tools', pluginPath ?? new URL('../../lib/client.js', import.meta.url)));
  await plugin.await();
  const mountWorkspace = async () => { const fiber = ctx.plugin(b.load('@deepseek-ai/dsh-client-ui-workspace')); await fiber.await(); return fiber; };
  const entry = () => ctx.slots.entriesOfSlot('tool.call.toolview')[0];
  const click = id => {
    const row = entry();
    const tree = row.component({ block: { kind: 'tool-result', isError: false, meta: { sessionId: id }, content: [] }, slot: { injected: row.inject() } });
    React.Children.toArray(tree.props.children).find(child => child?.type === 'button').props.onClick();
  };
  return { ctx, plugin, controller, mountWorkspace, entry, click, opened, closed, cancelled, layout, panel };
}
