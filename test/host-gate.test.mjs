import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { apply } from '../lib/index.js';

// Real official ToolRuntime and Cordis event dispatch, isolated from DSH UI,
// persistence and agent execution. The runtime gate must precede plugin policy.
for (const name of ['session_create', 'session_send']) {
  test(`${name}: full access cannot override the host pre-execute denial`, async () => {
    const ctx = new Context();
    ctx.provide('systemPrompt', { tools() {} });
    new ToolRuntime(ctx);
    let serviceReads = 0;
    const toolContext = {
      tools: ctx.tools,
      get() { serviceReads++; throw new Error('plugin body must not run'); },
      agents: { get() { throw new Error('plugin body must not run'); } },
    };
    apply(toolContext);
    ctx.on('tools/pre-execute', () => ({ kind: 'deny', reason: 'host says no' }));
    const result = await ctx.tools.execute({
      name, callId: 'host-gate',
      arguments: name === 'session_create' ? { prompt: 'hello' } : { sessionId: 'target', message: 'hello' },
      signal: new AbortController().signal,
      agent: { id: 'caller', session: { header: { id: 'caller', cwd: '/workspace' } } },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /host says no/);
    assert.equal(serviceReads, 0);
    await ctx.fiber.dispose();
  });
}
