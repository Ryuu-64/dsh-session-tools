import { symbols } from '@deepseek-ai/cordis';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';

const recordSchema = z.object({
  send: z.boolean(), receive: z.boolean(), revision: z.number().int().nonnegative().safe(),
}).strict();
const spec = defineDomain({
  name: 'session_tools_communication', version: 1,
  // Authoritative data: malformed records reject the whole domain, never skip.
  tables: { sessions: domainTable(recordSchema) },
});
const states = new WeakMap();
const defaults = Object.freeze({ send: true, receive: true, revision: 0 });
export class CommunicationDenied extends Error {
  constructor(direction) {
    super(`未发送：权限拒绝。${direction === 'send' ? '来源会话已关闭发送。' : '目标会话已关闭接收。'}`);
    this.name = 'CommunicationDenied';
    this.code = 'session-tools/permission-denied';
  }
}
export const sessionIdentitySchema = z.string().min(1).max(1024);
function sessionKey(id) {
  sessionIdentitySchema.parse(id);
  return id;
}
export function trustedSource(exec) { return sessionKey(exec?.agent?.session?.header?.id); }

/** One queue shared by all plugin instances, writes and final admissions alike. */
export function communicationPermissions(ctx) {
  const service = ctx.get('storageDomain');
  if (typeof service?.open !== 'function') throw new Error('Session communication controls require DSH 0.2.0-rc.2 storageDomain.');
  const identity = service[symbols.original] ?? service;
  let state = states.get(identity);
  if (state) return state;
  const ready = service.open(spec);
  // Keep a malformed/unavailable domain closed, while avoiding unhandled rejection.
  ready.catch(() => {});
  let tail = Promise.resolve();
  const serial = (action) => {
    const result = tail.then(async () => action((await ready).table('sessions')));
    tail = result.then(() => {}, () => {});
    return result;
  };
  const read = (table, id) => ({ ...recordSchema.parse(table.get(sessionKey(id)) ?? defaults) });
  const check = (table, sourceId, targetId) => {
    if (!read(table, sourceId).send) throw new CommunicationDenied('send');
    if (targetId !== undefined && !read(table, targetId).receive) throw new CommunicationDenied('receive');
  };
  state = {
    get: (id) => serial(table => read(table, id)),
    check: (sourceId, targetId) => serial(table => check(table, sourceId, targetId)),
    set: (id, patch, expectedRevision) => serial(async table => {
      const parsed = recordSchema.parse({ ...patch, revision: expectedRevision });
      const current = read(table, id);
      if (current.revision !== expectedRevision) return { status: 'conflict', current };
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error('Permission revision exhausted');
      const next = { send: parsed.send, receive: parsed.receive, revision: current.revision + 1 };
      await table.put(sessionKey(id), next);
      return { status: 'saved', current: { ...next } };
    }),
    // No await between the final synchronous read/check and followup callback.
    admit: (sourceId, targetId, exec, followup) => serial(table => {
      exec.signal?.throwIfAborted();
      check(table, sourceId, targetId);
      return followup();
    }),
  };
  states.set(identity, state);
  return state;
}
