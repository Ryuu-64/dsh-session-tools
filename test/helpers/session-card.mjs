import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';

/** Real bundle registration, SlotCore and React; only navigation is injected. */
export async function sessionCard(t, { path = new URL('../../lib/client.js', import.meta.url), open } = {}) {
  let client;
  const errors = [];
  const opened = [];
  const services = {};
  vm.runInNewContext(await readFile(path, 'utf8'), {
    console: { error: (...args) => errors.push(args) },
    window: { __ModuleLoader__: { load(definition) {
      assert.equal(definition.id, '@ryuu-64/dsh-session-tools');
      client = definition.factory(name => { assert.equal(name, 'react'); return React; });
    } } },
  });
  const slots = new SlotCore();
  t.after(slots.register({ name: 'root', children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' } } }, () => null));
  client.apply({
    provide(name, value) { services[name] = value; },
    slots: {
      inject(name, register) { assert.ok(slots.spec(name)); t.after(register()); },
      register: (options, component) => slots.register(options, component),
    },
    sessions: { open: open ?? (id => opened.push(id)) },
  });
  const [entry] = slots.entriesOfSlot('tool.call.toolview');
  assert.equal(entry.options.key, 'session_create');
  return {
    opened, errors, services, component: entry.component,
    render(block, extra = {}) {
      const props = { block, slot: { injected: entry.inject() }, ...extra };
      const tree = entry.component(props);
      const button = React.Children.toArray(tree.props.children).find(child => child?.type === 'button');
      return { button, html: renderToStaticMarkup(React.createElement(entry.component, props)) };
    },
  };
}

/**
 * Both supported rootResult contracts: event.data.meta belongs on the ToolResultNode,
 * never on its tool-result content block. This is a shape adapter, not the
 * official conversation projector or a full browser replay.
 * 0.2: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-chat/src/client/conversation-nodes/tool.ts
 * https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/client/ui-chat/src/client/conversation-nodes/tool.ts
 */
export function resultNode(event) {
  const result = toolResult(event);
  return {
    kind: 'tool-result', seq: event.seq, time: event.time,
    callId: String(event.data.message.source.callId), call: null, callTime: null,
    content: result.content, isError: result.isError === true,
    meta: event.data.meta, subCalls: [],
  };
}

/** The public tool-result representation moved from a content block to a role in 0.2. */
export function toolResult(event) {
  const message = event.data.message;
  return message.role === 'tool' ? message : message.content[0];
}

