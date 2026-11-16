import { HarnessError } from '@deepseek-ai/dsh-llm';
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
const queues = new WeakMap();
const legacyDefaults = Object.freeze({ send: true, receive: true });
export class CommunicationDenied extends HarnessError {
  constructor(direction) {
    super(`未送达、未排队：${direction === 'send' ? '来源会话已关闭发送。' : '目标会话已关闭接收。'}没有消息回执；通信权限改变前不要重复发送。`, 'session-tools/permission-denied');
    this.name = 'CommunicationDenied';
  }
}
export const sessionIdentitySchema = z.string().min(1).max(1024);
function sessionKey(id) {
  sessionIdentitySchema.parse(id);
  return id;
}
export function trustedSource(exec) { return sessionKey(exec?.agent?.session?.header?.id); }

/** Share the durable table and serialization across plugin instances. */
function communicationQueue(ctx) {
  const service = ctx.get('storageDomain');
  if (typeof service?.open !== 'function') throw new Error('Session communication controls require DSH 0.2.0-rc.2 storageDomain.');
  const identity = service[symbols.original] ?? service;
  const existing = queues.get(identity);
  if (existing) return existing;
  const ready = service.open(spec);
  // Keep a malformed/unavailable domain closed, while avoiding unhandled rejection.
  ready.catch(() => {});
  let tail = Promise.resolve();
  const serial = (action) => {
    const result = tail.then(async () => action((await ready).table('sessions')));
    tail = result.then(() => {}, () => {});
    return result;
  };
  queues.set(identity, serial);
  return serial;
}

export function communicationPermissions(ctx, getDefaults) {
  const enqueue = communicationQueue(ctx);
  const snapshotDefaults = () => ({ ...getDefaults(), revision: 0 });
  const serial = action => enqueue(table => action(table, snapshotDefaults()));
  const read = (table, id, defaults) => ({ ...recordSchema.parse(table.get(sessionKey(id)) ?? defaults) });
  const check = (table, sourceId, targetId, defaults) => {
    if (!read(table, sourceId, defaults).send) throw new CommunicationDenied('send');
    if (targetId !== undefined && !read(table, targetId, defaults).receive) throw new CommunicationDenied('receive');
  };
  return {
    get: (id) => serial((table, defaults) => read(table, id, defaults)),
    check: (sourceId, targetId) => serial((table, defaults) => check(table, sourceId, targetId, defaults)),
    prepareCreation: (sourceId, targetId, exec) => serial((table, defaults) => {
      exec.signal?.throwIfAborted();
      check(table, sourceId, targetId, defaults);
      return {
        // DSH invokes this synchronously after setup and just before publishing the child.
        commit() {
          exec.signal?.throwIfAborted();
          check(table, sourceId, targetId, snapshotDefaults());
        },
      };
    }),
    // One authoritative snapshot for the current visible page; never retain it
    // in discovery cursors. This is switch capability, not delivery or approval.
    statuses: (sourceId, targetIds) => serial((table, defaults) => {
      const source = read(table, sourceId, defaults);
      const checkedAt = Date.now();
      return targetIds.map(targetId => {
        const target = read(table, targetId, defaults);
        const reason = !source.send && !target.receive ? 'both_disabled'
          : !source.send ? 'sender_send_disabled' : !target.receive ? 'target_receive_disabled' : 'switches_allow';
        return { state: source.send && target.receive ? 'allowed' : 'blocked', reason,
          senderSend: source.send, targetReceive: target.receive, checkedAt };
      });
    }),
    set: (id, patch, expectedRevision, expectedDefaults = legacyDefaults) => serial(async (table, defaults) => {
      const parsed = recordSchema.parse({ ...patch, revision: expectedRevision });
      const current = read(table, id, defaults);
      if (current.revision !== expectedRevision) return { status: 'conflict', current };
      // Inherited values can change while revision zero still denotes no stored record.
      if (current.revision === 0 && (current.send !== expectedDefaults.send || current.receive !== expectedDefaults.receive)) {
        return { status: 'conflict', current };
      }
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error('Permission revision exhausted');
      const next = { send: parsed.send, receive: parsed.receive, revision: current.revision + 1 };
      await table.put(sessionKey(id), next);
      return { status: 'saved', current: { ...next } };
    }),
    // No await between the final synchronous read/check and followup callback.
    admit: (sourceId, targetId, exec, followup) => serial((table, defaults) => {
      exec.signal?.throwIfAborted();
      check(table, sourceId, targetId, defaults);
      return followup();
    }),
  };
}

// Explicit unknown never invents open defaults when identity/storage is unavailable.
export const unknownCommunication = () => ({ state: 'unknown', reason: 'unavailable', checkedAt: Date.now() });
export const communicationStatusSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    state: { type: 'string', required: true, enum: ['allowed', 'blocked', 'unknown'] },
    reason: { type: 'string', required: true, enum: ['switches_allow', 'sender_send_disabled', 'target_receive_disabled', 'both_disabled', 'unavailable'] },
    senderSend: { type: 'boolean' }, targetReceive: { type: 'boolean' },
    checkedAt: { type: 'number', required: true },
  },
};
export function communicationStatusText(status) {
  return ({ switches_allow: '通信开关允许', sender_send_disabled: '当前会话已关闭发送',
    target_receive_disabled: '目标已关闭接收', both_disabled: '当前会话已关闭发送，目标已关闭接收',
    unavailable: '通信状态无法确认' })[status.reason] ?? '通信状态无法确认';
}
