import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile, writeFile, appendFile, readdir, rename, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { createActivitySorter } from '../lib/session-activity.js';
import { receiptHost, user } from './helpers/message-receipts-host.mjs';
const rec = (id, createdAt=100) => ({header:{id, createdAt}});
const ev = time => ({ type:'user/message',time,data:{} });
function fixture(count=8) {
 const records=Array.from({length:count},(_,i)=>rec(String(i),i));
 const logs=new Map(records.map(r=>[r.header.id,[ev(100)]]));
 const revisions=new Map(records.map(r=>[r.header.id,'r1']));
 const stats={active:0,max:0,opens:0,closes:0,reads:0,stats:0};
 let onOpen=async()=>{}, onRead=async()=>{}, onClose=async()=>{}, onStat=async()=>{};
 const persistence={
  async stat(id,opts) {stats.stats++;await onStat(id,opts);return {revision:revisions.get(id)}},
  async open(id,mode,opts) {assert.equal(mode,'read');stats.opens++;stats.max=Math.max(stats.max,++stats.active);await onOpen(id,opts);return {
   header:records.find(x=>x.header.id===id).header,inheritedEventCount:0,
   async read(_offset,_length,options) {stats.reads++; await onRead(id,options);return {events:logs.get(id)}},
   async close() {stats.closes++;stats.active--;await onClose(id)}
  }}
 };
 const ctx={get:key=>key==='sessionPersistence'?persistence:undefined, agents:{get(){}}};
 return {records,logs,revisions,stats,persistence,sort:createActivitySorter(ctx),
 onOpen:f=>onOpen=f,onRead:f=>onRead=f,onClose:f=>onClose=f,onStat:f=>onStat=f};
}
const ids=x=>x.map(r=>r.header.id);

test('async completion order cannot change equal-time host order',async()=>{
 const h=fixture(20);h.onRead(async id=>delay((19-Number(id))%4));
 assert.deepEqual(ids(await h.sort(h.records)),ids(h.records));
 assert.equal(h.stats.max,4);assert.equal(h.stats.active,0);
});
test('queued second list cancels without stealing slots or leaking listeners',async()=>{
 const h=fixture(8);const started=Promise.withResolvers(),gate=Promise.withResolvers();let entered=0;
 h.onRead(async()=>{if(++entered===4)started.resolve();await gate.promise});
 const first=h.sort(h.records);await started.promise;
 const ac=new AbortController(),second=h.sort(h.records,ac.signal);ac.abort();
 await assert.rejects(second,{name:'AbortError'});
 assert.equal(h.stats.opens,4);assert.equal(getEventListeners(ac.signal,'abort').length,0);
 gate.resolve();await first;await h.sort(h.records);
 assert.equal(h.stats.active,0);assert.equal(h.stats.opens,h.stats.closes);assert.equal(h.stats.max,4);
});
test('late successful open after cancellation is closed without read',async()=>{
 const h=fixture(1);const ac=new AbortController();h.onOpen(async()=>ac.abort());
 await assert.rejects(h.sort(h.records,ac.signal),{name:'AbortError'});
 assert.equal(h.stats.reads,0);assert.equal(h.stats.opens,1);assert.equal(h.stats.closes,1);
});
test('one failure waits for all active read handles to close',async()=>{
 const h=fixture(9);let done=false;const gate=Promise.withResolvers(),started=Promise.withResolvers();let entered=0;
 h.onRead(async id=>{if(++entered===4)started.resolve();if(id==='0')throw Error('broken');await gate.promise});
 const result=h.sort(h.records).finally(()=>done=true);const rejected=assert.rejects(result,/broken/);await started.promise;await delay(1);
 assert.equal(done,false);assert.equal(h.stats.active,3);gate.resolve();await rejected;
 assert.equal(h.stats.opens,4);assert.equal(h.stats.opens,h.stats.closes);assert.equal(h.stats.active,0);
});
test('failed close is propagated and does not cache a successful fold',async()=>{
 const h=fixture(1);h.onClose(async()=>{throw Error('close failed')});
 await assert.rejects(h.sort(h.records),/close failed/);h.onClose(async()=>{});await h.sort(h.records);
 assert.equal(h.stats.reads,2);
});
test('no revision token means every cold call rereads and reflects truncation',async()=>{
 const h=fixture(2);h.revisions.clear();h.logs.set('0',[ev(300)]);
 assert.deepEqual(ids(await h.sort(h.records)),['0','1']);h.logs.set('0',[]);
 assert.deepEqual(ids(await h.sort(h.records)),['1','0']);assert.equal(h.stats.reads,4);
});
test('removing a record prunes cache before same id and token return',async()=>{
 const h=fixture(2);h.logs.set('0',[ev(300)]);await h.sort(h.records);await h.sort([h.records[1]]);h.logs.set('0',[]);
 assert.deepEqual(ids(await h.sort(h.records)),['1','0']);assert.equal(h.stats.reads,3);
});
test('stat failure cannot silently use cached activity',async()=>{
 const h=fixture(1);await h.sort(h.records);h.onStat(async()=>{throw Error('stat inaccessible')});
 await assert.rejects(h.sort(h.records),/stat inaccessible/);assert.equal(h.stats.reads,1);
});
async function findLog(root,id) {
 const files=await readdir(join(root,'sessions'),{recursive:true});
 const path=files.find(x=>x.includes(id)&&x.endsWith('.zstd'));
 assert.ok(path,JSON.stringify(files));return join(root,'sessions',path);
}
test('real JSONL append, valid rollback, atomic replacement and torn tail invalidate cache',async t=>{
 let h=await receiptHost(t);let now=100;t.mock.method(Date,'now',()=>now);
 const a=await h.create('cache-A');a.agent.session.append('user/message',user('first'),{surfaceOp:'append'});await a.dispose();
 const path=await findLog(h.root,'cache-A'),original=await readFile(path);
 now=200;const b=await h.create('cache-B');h.ctx.sessionTitle.rename(b.agent.session,'B');await b.dispose();h=await h.restart();
 await h.loader.create({name:'@deepseek-ai/dsh-session-query'});await h.loader.await();
 const list=async()=> (await h.ctx.tools.get('list_sessions').execute({limit:1},{})).sessions[0].sessionId;
 assert.equal(await list(),'cache-B');
 const writer=await h.ctx.sessionPersistence.open('cache-A','write');const {events}=await writer.read();
 await writer.append([{seq:events.length,type:'user/message',time:300,data:user('new'),surfaceOp:'append'}]);await writer.flush();await writer.close();
 const appended=await readFile(path);assert.equal(await list(),'cache-A');
 await writeFile(path,original);assert.equal(await list(),'cache-B','valid shorter log cannot reuse old high watermark');
 const oldStat=await stat(path);await writeFile(path+'.new',appended);await utimes(path+'.new',oldStat.atime,oldStat.mtime);await rename(path+'.new',path);
 assert.equal(await list(),'cache-A','inode/ctime invalidates after atomic replacement even with preserved mtime');
 const before=await readFile(path);await appendFile(path,Buffer.from([0x28,0xb5,0x2f,0xfd,0]));
 assert.equal(await list(),'cache-A','incomplete compressed tail cannot invent activity');
 assert.deepEqual(await readFile(path),Buffer.concat([before,Buffer.from([0x28,0xb5,0x2f,0xfd,0])]),'listing does not rewrite torn file');
 assert.equal(h.ctx.agents.get('cache-A'),undefined);assert.equal(h.ctx.sessions.list().length,0);assert.equal(h.model.requests.length,0);
});
