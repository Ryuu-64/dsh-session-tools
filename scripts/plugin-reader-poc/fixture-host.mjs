// Temporary acceptance-profile control: real Session/Agent events, scripted model boundary only.
import { LlmAdapter, createUserMessage, createAssistantMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session';

export const name = 'reading-return-fixture';
export const inject = ['webServer', 'sessionController', 'llm', 'sessions', 'sessionPersistence', 'agents'];
export function apply(ctx) {
  const token = process.env.READING_RETURN_FIXTURE_TOKEN;
  if (!token || token.length < 32) throw new Error('reading fixture requires an isolated runner token');
  let script = null, active = null, disposed = false;
  let groupSession = null, groupTurn = 0, groupCalls = 0;
  let modelSession = null;
  let modelRegistered = false;
  const waiting = new Set();
  const release = () => { for (const wake of waiting) wake(); waiting.clear(); };
  class Model extends LlmAdapter {
    async listModels() { return [{ provider: 'reading-fixture', id: 'controlled', name: 'Controlled acceptance stream' }]; }
    async *stream(options) {
      const current = script;
      if (!current || active) throw new Error('unexpected fixture model request');
      script = null; active = current;
      const abort = () => release();
      options.signal?.addEventListener('abort', abort, { once: true });
      let text = '';
      try {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        for (let index = 0; index < current.total; index++) {
          while (current.allowed <= index && !disposed && !options.signal?.aborted) {
            await new Promise(resolve => waiting.add(resolve));
          }
          if (disposed) throw new Error('fixture disposed');
          options.signal?.throwIfAborted();
          const markdownChunks = [
            '# MD_HEADING\n\n' + '[MD_REF][reading-ref] '.repeat(45) + '\n\nMD_HOLD_ANCHOR unique stable reading line.\n\n- MD_LIST_FIRST\n- MD_LIST_SECOND\n\n```js\nconst first = 1;\n',
            'const second = 2;\n\nconst third = 3;\n',
            '```\n\n| MD_COL_A | MD_COL_B |\n| --- | --- |\n| x | y |\n\n',
            '## MD_STREAM_HEADING\n\n' + 'MD_AFTER_ANCHOR '.repeat(180) + '\n\n',
            'MD_MORE_4 ' + 'More streamed Markdown content. '.repeat(60) + '\n\n',
            'MD_MORE_5 ' + 'More streamed Markdown content. '.repeat(60) + '\n\n',
            'MD_MORE_6 ' + 'More streamed Markdown content. '.repeat(60) + '\n\n',
            '[reading-ref]: https://example.invalid/reading\n',
          ];
          const delta = current.markdown ? markdownChunks[index] : current.kind === 'append'
            ? `${current.marker}_ANSWER\n\n${'Growing real Session content. '.repeat(180)}`
            : `${current.marker}_${index} ${'Real streamed fixture text. '.repeat(30)}\n\n`;
          text += delta;
          yield { type: 'text-delta', index: 0, text: delta };
          current.emitted = index + 1;
        }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } };
        yield { type: 'usage', usage: { inputTokens: 20, outputTokens: text.length } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      } finally {
        current.finished = true;
        active = null;
        options.signal?.removeEventListener('abort', abort);
      }
    }
  }
  ctx.effect(() => () => { disposed = true; release(); });
  const ownedId = value => {
    if (!/^session-[a-f0-9-]{36}$/.test(value)) throw new Error('unexpected synthetic session identity');
    return SessionId(value);
  };
  async function session(id) {
    const result = await ctx.sessionController.resolveAgent(ownedId(id));
    if ('error' in result) throw new Error(JSON.stringify(result.error));
    return result.agent.session;
  }
  async function command(request) {
    if (request.op === 'release') {
      const current = active ?? script;
      if (!current) throw new Error('no fixture stream to release');
      current.allowed = Math.min(current.total, current.allowed + request.count);
      release();
      return { emitted: current.emitted, allowed: current.allowed };
    }
    if (request.op === 'status') return { active: active !== null || script !== null || (modelSession !== null && ctx.agents.get(modelSession)?.status === 'running'), waiting: waiting.size, emitted: active?.emitted ?? 0 };
    const id = ownedId(request.id);
    if (request.op === 'stream' || request.op === 'append') {
      // Preserve the original credential-onboarding scenario before the new cases start.
      if (!modelRegistered) {
        ctx.effect(() => ctx.llm.registerAdapter(['reading-fixture'], new Model()));
        modelRegistered = true;
      }
      if (script || active) throw new Error('one fixture stream at a time');
      script = { markdown: request.markdown === true, kind: request.op, marker: request.marker, total: request.op === 'append' ? 1 : 8, allowed: 1, emitted: 0, finished: false };
      modelSession = id;
      let finishTurn, failTurn, timer;
      let entered = false;
      const ended = new Promise((resolve, reject) => { finishTurn = resolve; failTurn = reject; });
      void ended.catch(() => {});
      // Streaming is released by the browser; append waits for its actual durable Agent turn.
      const stop = request.op === 'append' ? ctx.on('session/event', (source, event) => {
        if (source.id !== id) return;
        if (event.type === 'user/message' && event.data.content.some(part => part.type === 'text' && part.text === request.marker)) entered = true;
        if (!entered || event.type !== 'turn/end') return;
        if (event.data.reason.kind === 'completed') finishTurn();
        else failTurn(new Error(`fixture Agent ended with ${event.data.reason.kind}`));
      }, { global: true }) : () => {};
      try {
        await ctx.sessionController.selectModel({ sessionId: id, provider: 'reading-fixture', model: 'controlled' });
        await ctx.sessionController.prompt({ sessionId: id, requestId: `fixture-${request.marker}`, mode: 'queue', content: [{ type: 'text', text: request.marker }] }, new AbortController().signal);
        if (request.op === 'append') {
          timer = setTimeout(() => failTurn(new Error('fixture Agent turn did not finish')), 20000);
          await ended;
        }
        return { accepted: true };
      } catch (error) { script = null; throw error; }
      finally { clearTimeout(timer); stop(); }
    }
    if (request.op === 'group-start') {
      if (groupSession) throw new Error('one live synthetic group owner per run');
      const handle = await ctx.sessionPersistence.open(id, 'read');
      try {
        const { events } = await handle.read();
        groupSession = ctx.sessions.create(id, { seed: events, meta: { cwd: handle.header.cwd, parentSession: handle.header.parentSession, origin: 'subagent', delegationDepth: 1 } });
        groupTurn = 1 + Math.max(0, ...events.filter(event => event.type === 'turn/start').map(event => event.data.turn));
        groupSession.append('turn/start', { turn: groupTurn }); groupSession.append('step/start', { turn: groupTurn, step: 1 });
        groupSession.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'LIVE_NESTED_GROUP' }] }), { surfaceOp: 'append' });
      } finally { await handle.close(); }
    }
    if (request.op === 'group-start' || request.op === 'group-grow') {
      if (!groupSession || groupSession.id !== id) throw new Error('unknown live synthetic group');
      const target = ownedId(request.target);
      for (let index = 0; index < (request.op === 'group-start' ? 12 : 4); index++) {
        const callId = ToolCallId(`live-group-${++groupCalls}`), args = JSON.stringify({ prompt: 'synthetic group event', title: 'RETURN_B' });
        groupSession.append('assistant/message', { turn: groupTurn, step: 1, stream: [], message: createAssistantMessage({ source: { provider: 'reading-fixture', model: 'controlled' }, content: [{ type: 'tool-call', id: callId, name: 'session_create', arguments: args }] }), usage: { inputTokens: 1, outputTokens: 1 } }, { surfaceOp: 'append' });
        const call = groupSession.append('tool/call', { turn: groupTurn, step: 1, callId, name: 'session_create', arguments: args });
        groupSession.append('tool/result', { turn: groupTurn, step: 1, meta: { sessionId: target, title: 'RETURN_B' }, message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: `LIVE_GROUP_RESULT_${groupCalls}` }] }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] });
      }
      return { turn: groupTurn, calls: groupCalls };
    }
    const live = await session(id);
    if (request.op === 'rewrite') {
      let event = live.eventAt(SessionSeq(request.seq));
      if (event?.type === 'tool/call') event = live.snapshotEvents().find(x => x.type === 'tool/result' && x.data.message.callId === event.data.callId);
      if (!event) throw new Error('synthetic source marker missing');
      if (event.surfaceOp === undefined) throw new Error('captured source event is not a replaceable message');
      live.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `REWRITTEN_${request.marker}` }] }), { surfaceOp: { op: 'replace', startSeq: SessionSeq(event.seq), endSeq: SessionSeq(event.seq) } });
      return { replaced: event.seq };
    }
    throw new Error(`unknown fixture operation ${request.op}`);
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/reading-return-fixture', handler: async (req, res) => {
    if (req.method !== 'POST' || req.headers['x-reading-fixture'] !== token) { res.writeHead(403); res.end(); return; }
    try {
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 8192) throw new Error('fixture request too large'); chunks.push(chunk); }
      const result = await command(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
    } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(error) })); }
  } }));
}
