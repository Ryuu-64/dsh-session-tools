// Official Session/JSONL constructors and ordinary Web UI. No model or fake Chat.
// Reference: deepseek-ai/deepseek-harness@639ed015 apps/web/tests/chat-scroll-fixture.ts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ids = {
  A: 'session-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  B: 'session-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  C: 'session-cccccccc-cccc-cccc-cccc-cccccccccccc',
  T: 'session-dddddddd-dddd-dddd-dddd-dddddddddddd',
  H: 'session-eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  G: 'session-ffffffff-ffff-ffff-ffff-ffffffffffff',
  S: 'session-11111111-1111-1111-1111-111111111111',
  D: 'session-22222222-2222-2222-2222-222222222222',
  R: 'session-33333333-3333-3333-3333-333333333333',
  U: 'session-44444444-4444-4444-4444-444444444444',
  V: 'session-55555555-5555-5555-5555-555555555555',
  P: 'session-66666666-6666-6666-6666-666666666666',
  Q: 'session-77777777-7777-7777-7777-777777777777',
};
export async function seedHistory(require, home, workspace) {
  const load = name => import(pathToFileURL(require.resolve(name)).href);
  const { Session, SessionId, SESSION_FORMAT_VERSION } = await load('@deepseek-ai/dsh-session');
  const { createUserMessage, createAssistantMessage, createToolResultMessage, ToolCallId } = await load('@deepseek-ai/dsh-llm');
  const { snapshotSubagentDescriptor } = await load('@deepseek-ai/dsh-subagent');
  const { Context } = await load('@deepseek-ai/cordis');
  const { default: Jsonl } = await load('@deepseek-ai/dsh-session-persistence-jsonl');
  fs.mkdirSync(workspace, { recursive: true });
  const ctx = new Context(), result = [];
  try {
    await ctx.plugin(Jsonl, { root: path.join(home, '.dsh/sessions') });
    for (const label of ['A', 'B', 'C']) {
      const id = SessionId(ids[label]), session = Session.create(id);
      for (let turn = 1; turn <= 80; turn++) {
        session.append('turn/start', { turn }); session.append('step/start', { turn, step: 1 });
        const user = session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `RETURN_${label}_USER_${turn}\n\nRepeated paragraph.\n\nRepeated paragraph.` }] }), { surfaceOp: 'append' });
        if (turn === 1) session.append('session/title', { title: `RETURN_${label}`, messageSeqs: [user.seq], source: { kind: 'fallback' } });
        session.append('request/header', { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }, reason: turn === 1 ? 'initial' : 'change' });
        const target = label === 'A' ? 'B' : 'C';
        if ([20, 40, 60, 78].includes(turn) && label !== 'C') {
          const callId = ToolCallId(`return-${label}-${turn}`), args = JSON.stringify({ prompt: 'synthetic', title: `RETURN_${target}` });
          session.append('assistant/message', { turn, step: 1, stream: [], message: createAssistantMessage({ source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, content: [{ type: 'tool-call', id: callId, name: 'session_create', arguments: args }] }), usage: { inputTokens: 1, outputTokens: 1 } }, { surfaceOp: 'append' });
          const call = session.append('tool/call', { turn, step: 1, callId, name: 'session_create', arguments: args });
          session.append('tool/result', { turn, step: 1, meta: { sessionId: ids[target], title: `RETURN_${target}` }, message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: `Created session RETURN_${target}` }] }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] });
        }
        session.append('assistant/message', { turn, step: 1, stream: [], message: createAssistantMessage({ source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, content: [{ type: 'text', text: `RETURN_${label}_ANSWER_${turn}\n\n${'A long synthetic reading paragraph. '.repeat(18)}\n\n${'Repeated answer text. '.repeat(12)}` }] }), usage: { inputTokens: 1, outputTokens: 1 } }, { surfaceOp: 'append' });
        session.append('step/end', { turn, step: 1 }); session.append('turn/end', { turn, reason: { kind: 'completed' } });
      }
      const events = session.snapshotEvents();
      const handle = await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, createdAt: Date.now() - 60000, isSeeded: false, cwd: workspace, delegationDepth: 0 });
      await handle.append(events); await handle.close(); result.push({ id, turns: 80, events: events.length });
    }
    for (const label of ['T', 'H', 'G', 'S', 'D', 'R', 'U', 'V', 'P', 'Q']) {
      const id = SessionId(ids[label]), session = Session.create(id);
      const child = ['S', 'V'].includes(label);
      for (let turn = 1; turn <= 80; turn++) {
        session.append('turn/start', { turn }); session.append('step/start', { turn, step: 1 });
        if (child && turn === 1) session.append('subagent/descriptor', snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'reading-fixture', label: `RETURN_${label}` }));
        const user = session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `RETURN_${label}_USER_${turn}\n\n${'Synthetic source reading paragraph. '.repeat(12)}` }] }), { surfaceOp: 'append' });
        if (turn === 1) session.append('session/title', { title: `RETURN_${label}`, messageSeqs: [user.seq], source: { kind: 'fallback' } });
        session.append('request/header', { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }, reason: turn === 1 ? 'initial' : 'change' });
        const tail = ['T', 'P'].includes(label) && turn === 80;
        const answer = () => session.append('assistant/message', { turn, step: 1, stream: [], message: createAssistantMessage({ source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, content: [{ type: 'text', text: `RETURN_${label}_ANSWER_${turn}\n\n${'Additional synthetic reading content. '.repeat(tail ? 1 : 30)}` }] }), usage: { inputTokens: 1, outputTokens: 1 } }, { surfaceOp: 'append' });
        if (tail) answer();
        if ([20, 40, 60, 78].includes(turn) || tail) {
          const count = ['G', 'S'].includes(label) && turn === 78 ? 12 : 1;
          for (let index = 0; index < count; index++) {
            const callId = ToolCallId(`extra-${label}-${turn}-${index}`), args = JSON.stringify({ prompt: 'synthetic', title: 'RETURN_B' });
            session.append('assistant/message', { turn, step: 1, stream: [], message: createAssistantMessage({ source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, content: [{ type: 'tool-call', id: callId, name: 'session_create', arguments: args }] }), usage: { inputTokens: 1, outputTokens: 1 } }, { surfaceOp: 'append' });
            const call = session.append('tool/call', { turn, step: 1, callId, name: 'session_create', arguments: args });
            session.append('tool/result', { turn, step: 1, meta: { sessionId: ids.B, title: 'RETURN_B' }, message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: `Created session RETURN_B ${label}_${turn}_${index}` }] }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] });
          }
        }
        if (!tail) answer();
        session.append('step/end', { turn, step: 1 }); session.append('turn/end', { turn, reason: { kind: 'completed' } });
      }
      const events = session.snapshotEvents();
      const handle = await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, createdAt: Date.now() - 60000, isSeeded: false, cwd: workspace, delegationDepth: child ? 1 : 0, ...(child ? { origin: 'subagent', parentSession: ids.G } : {}) });
      await handle.append(events); await handle.close(); result.push({ id, turns: 80, events: events.length });
    }
  } finally { await ctx.fiber.dispose(); }
  return result;
}

