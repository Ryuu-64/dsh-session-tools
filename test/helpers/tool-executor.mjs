/** Match the native executor mounted by DSH when the registry delegates execution. */
export async function mountNativeToolExecutor(ctx) {
  if (typeof ctx.tools.setExecutor === 'function') {
    const executor = await import('@deepseek-ai/dsh-tool-executor-native');
    await ctx.plugin(executor).await();
  }
}

/** Run a single call through the selected host's public execution path. */
export async function executeTool(ctx, request) {
  if (typeof ctx.tools.setExecutor !== 'function') return ctx.tools.execute(request);
  const { name, callId, arguments: args, agent, signal } = request;
  const batch = await ctx.tools.execute({
    calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }],
    agent, signal,
  });
  return batch.results[0].result;
}
