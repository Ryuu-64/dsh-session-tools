import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { receiptHost, gate, textChunks, user } from './helpers/message-receipts-host.mjs';
import { executeTool } from './helpers/tool-executor.mjs';

const goalCall = (h, caller, args) => h.ctx.agents.withInitiator(caller.exec.agent,
  () => h.ctx.tools.get('session_goal').execute(args, { ...caller.exec, name: 'session_goal' }));

const createCall = (h, caller, args) => h.ctx.agents.withInitiator(caller.exec.agent, () => executeTool(h.ctx, {
  ...caller.exec, name: 'session_create', arguments: args,
}));

test('a human turn creates a child goal, sends the first task, and the native driver respects its round cap', { timeout: 15000 }, async t => {
  const approvals = [];
  const h = await receiptHost(t, { withGoals: true, onApproval: ({ reason }) => { approvals.push(reason); return 'allowed-once'; } });
  const caller = await h.holdCaller();
  const objective = 'Finish the migration and verify the result';
  const blocked = Promise.withResolvers();
  h.ctx.on('goal/changed', ({ change }) => {
    if (change.goal?.phase === 'blocked') blocked.resolve();
  });
  h.model.text('first answer');
  h.model.text('automatic round');
  const result = await createCall(h, caller, { prompt: objective, goal: { rounds: 1 }, wait: true });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.match(JSON.stringify(result), /Persistent goal granted.*1 automatic rounds/);
  await blocked.promise;
  const children = h.ctx.agents.list().filter(agent => agent.session.header.parentSession === caller.exec.agent.id);
  assert.equal(children.length, 1);
  const [child] = children;
  await child.whenIdle();
  const args = { sessionId: child.id };
  const view = await goalCall(h, caller, { ...args, action: 'get' });
  assert.equal(view.managed, true);
  assert.equal(view.goal.objective, objective);
  assert.equal(view.goal.phase, 'blocked');
  const inputs = child.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind !== 'runtime-context');
  assert.deepEqual(inputs.map(e => e.data.source.kind), ['tool-session', 'goal']);
  assert.equal(inputs[0].data.content[0].text, objective);
  assert.equal(view.goal.roundsStarted, 1);
  assert.match(approvals[0], /persistent goal.*1 automatic rounds/);

  const edited = await goalCall(h, caller, { ...args, action: 'set', objective: 'Verify migration again', rounds: 2 });
  assert.equal(edited.goal.id, view.goal.id);
  assert.equal(edited.goal.phase, 'blocked');
  assert.equal(edited.goal.roundsStarted, 1);
  assert.equal(edited.goal.maxGoalRounds, 2);
  assert.equal(edited.goal.objective, 'Verify migration again');
  const noChange = await goalCall(h, caller, { ...args, action: 'set' });
  assert.equal(noChange.goal.revision, edited.goal.revision);
  await goalCall(h, caller, { ...args, action: 'clear' });
  assert.deepEqual(await goalCall(h, caller, { ...args, action: 'get' }), { ...args, managed: false, goal: null });
});

test('goals without a driver reject new grants while session creation and messaging still work', { timeout: 15000 }, async t => {
  const h = await receiptHost(t, { withGoals: true, withGoalDriver: false });
  const caller = await h.holdCaller();
  const failure = await createCall(h, caller, { prompt: 'A goal without a driver', goal: true });
  assert.equal(failure.isError, true);
  assert.match(JSON.stringify(failure), /active DSH goal round driver/);
  const children = () => h.ctx.agents.list().filter(agent => agent.session.header.parentSession === caller.exec.agent.id);
  assert.equal(children().length, 0);

  h.model.text('ordinary first answer');
  const plain = await createCall(h, caller, { prompt: 'An ordinary task', wait: true });
  assert.notEqual(plain.isError, true, JSON.stringify(plain));
  const [child] = children();
  assert.ok(child);
  await assert.rejects(goalCall(h, caller, { sessionId: child.id, action: 'set', objective: 'Set without a driver' }), /active DSH goal round driver/);
  assert.equal(h.ctx.goals.get(child), undefined);
  assert.equal(child.session.snapshotEvents().some(e => e.type === 'goal/change'), false);
  h.model.text('ordinary followup answer');
  const followup = await h.ctx.tools.get('session_send').execute({
    sessionId: child.id, message: 'Follow up', wait: true,
  }, { ...caller.exec, name: 'session_send' });
  assert.equal(followup.delivery, 'steer');
  assert.equal(followup.output, 'ordinary followup answer');
});

test('both goal creation entry points use the configured native round limit', { timeout: 15000 }, async t => {
  const approvals = [];
  const h = await receiptHost(t, {
    withGoals: true, goalConfig: { defaultMaxGoalRounds: 2 },
    onApproval: ({ reason }) => { approvals.push(reason); return 'allowed-once'; },
  });
  const caller = await h.holdCaller();
  function waitForLimit() {
    const blocked = Promise.withResolvers();
    const off = h.ctx.on('goal/changed', ({ agent, change }) => {
      if (change.goal?.phase === 'blocked') {
        off();
        blocked.resolve(agent);
      }
    });
    return blocked.promise;
  }
  const firstBlocked = waitForLimit();
  h.model.text('first answer');
  h.model.text('first continuation');
  h.model.text('second continuation');
  const created = await createCall(h, caller, { prompt: 'Use the host default', goal: true, wait: true });
  assert.notEqual(created.isError, true, JSON.stringify(created));
  assert.match(JSON.stringify(created), /Persistent goal granted.*2 automatic rounds/);
  const child = await firstBlocked;
  assert.equal(h.ctx.goals.get(child).roundsStarted, 2);
  await goalCall(h, caller, { sessionId: child.id, action: 'clear' });

  const secondBlocked = waitForLimit();
  h.model.text('first continuation after setting');
  h.model.text('second continuation after setting');
  const set = await goalCall(h, caller, { sessionId: child.id, action: 'set', objective: 'Use the same default later' });
  assert.equal(set.goal.maxGoalRounds, 2);
  assert.equal(set.goal.roundsStarted, 0);
  assert.equal(await secondBlocked, child);
  assert.equal(h.ctx.goals.get(child).roundsStarted, 2);
  assert.equal(approvals.filter(reason => reason.includes("using the host's configured round limit")).length, 2);
});

test('a completed delegated goal needs no pause and can be replaced without clearing it', { timeout: 15000 }, async t => {
  const approvals = [];
  let approval = 'allowed-once';
  const h = await receiptHost(t, {
    withGoals: true, goalConfig: { defaultMaxGoalRounds: 2 },
    onApproval: ({ reason }) => { approvals.push(reason); return approval; },
  });
  const caller = await h.holdCaller();
  const sessionId = 'child';
  const { agent: child } = await h.ctx.agents.create({
    sessionId, meta: { cwd: h.root, parentSession: caller.exec.agent.id },
    agentOptions: { provider: 'fixture', model: 'scripted' },
  });
  const blocked = Promise.withResolvers();
  h.ctx.on('goal/changed', ({ agent, change }) => {
    if (agent === child && change.goal?.phase === 'blocked') blocked.resolve(change.goal);
  });
  h.model.text('initial goal round');
  await goalCall(h, caller, { sessionId, action: 'set', objective: 'Initial goal', rounds: 1 });
  const { id, revision } = await blocked.promise;
  const completed = h.ctx.goals.complete(child, { id, revision });
  assert.equal(completed.roundsStarted, 1);

  const pause = await h.ctx.agents.withInitiator(caller.exec.agent, () => executeTool(h.ctx, {
    ...caller.exec, name: 'session_goal', arguments: { sessionId, action: 'pause' },
  }));
  assert.equal(pause.isError, true);
  assert.match(JSON.stringify(pause.content), /This goal is already complete\. There is no need to pause it\./);
  await assert.rejects(goalCall(h, caller, { sessionId, action: 'set', rounds: 2 }), /needs an objective/);
  assert.equal(approvals.length, 1);

  const set = { sessionId, action: 'set', objective: 'Next goal' };
  approval = 'rejected';
  await assert.rejects(goalCall(h, caller, set), /the person declined/);
  assert.deepEqual(h.ctx.goals.get(child), completed);

  approval = 'allowed-once';
  h.model.text('new goal round one');
  h.model.text('new goal round two');
  const replacement = await goalCall(h, caller, set);
  assert.equal(replacement.managed, true);
  assert.notEqual(replacement.goal.id, id);
  assert.equal(replacement.goal.objective, set.objective);
  assert.equal(replacement.goal.phase, 'active');
  assert.equal(replacement.goal.roundsStarted, 0);
  assert.equal(replacement.goal.maxGoalRounds, 2);
  assert.match(approvals.at(-1), /replace the completed goal.*using the host's configured round limit/);
  const changes = child.session.snapshotEvents().filter(event => event.type === 'goal/change');
  assert.ok(changes.some(event => event.data.operation === 'complete' && event.data.goal.id === id));
  assert.ok(changes.some(event => event.data.operation === 'create' && event.data.goal.id === replacement.goal.id));
  assert.ok(changes.every(event => event.data.operation !== 'clear'));
});

test('goal mutations require the calling human turn and preserve a goal created outside this plugin', { timeout: 15000 }, async t => {
  const h = await receiptHost(t, { withGoals: true });
  const parent = await h.create('parent');
  const { agent: target } = await h.ctx.agents.create({
    sessionId: 'child', meta: { cwd: h.root, parentSession: parent.agent.id },
    agentOptions: { provider: 'fixture', model: 'scripted' },
  });
  const childGoal = h.ctx.goals.create(target, { objective: 'Native goal', maxGoalRounds: 1 });
  h.ctx.goals.disarm(target);
  const held = gate(), started = Promise.withResolvers();
  t.after(held.release);
  h.model.scripts.push(async function* (options) { started.resolve(); await held.wait(options.signal); yield* textChunks('done'); });
  parent.agent.followup(createUserMessage({ source: { kind: 'tool-session', form: 'relay' }, content: [{ type: 'text', text: 'start another goal' }] }));
  await started.promise;
  const caller = { exec: { agent: parent.agent, callId: 'fixture', signal: new AbortController().signal } };
  await assert.rejects(goalCall(h, caller, { action: 'clear', sessionId: target.id }), /direct human turn/);
  held.release();
  await parent.agent.whenIdle();
  const humanHold = gate(), humanStarted = Promise.withResolvers();
  t.after(humanHold.release);
  h.model.scripts.push(async function* (options) { humanStarted.resolve(); await humanHold.wait(options.signal); yield* textChunks('done'); });
  parent.agent.followup(user('Manage the child goal'));
  await humanStarted.promise;
  await assert.rejects(goalCall(h, caller, { action: 'set', sessionId: target.id, objective: 'Replace' }), /did not grant/);
  await assert.rejects(goalCall(h, caller, { action: 'set', sessionId: target.id, objective: 'Replace', rounds: 257 }), /from 1 to 256/);
  const current = await goalCall(h, caller, { action: 'get', sessionId: target.id });
  assert.equal(current.managed, false);
  assert.equal(current.goal.id, childGoal.id);
  const complete = h.ctx.goals.complete(target, { id: current.goal.id, revision: current.goal.revision });
  await assert.rejects(goalCall(h, caller, { action: 'set', sessionId: target.id, objective: 'Replace' }), /did not grant/);
  assert.deepEqual(h.ctx.goals.get(target), complete);
});

test('a grant survives restart and can be paused, resumed and revoked by the parent', { timeout: 15000 }, async t => {
  let h = await receiptHost(t, { withGoals: true });
  let caller = await h.holdCaller('parent');
  const sessionId = 'child';
  const { agent: child } = await h.ctx.agents.create({
    sessionId, meta: { cwd: h.root, parentSession: 'parent' },
    agentOptions: { provider: 'fixture', model: 'scripted' },
  });
  const holding = gate(), started = Promise.withResolvers();
  t.after(holding.release);
  h.model.scripts.push(async function* (options) { started.resolve(); await holding.wait(options.signal); });
  const created = await goalCall(h, caller, { sessionId, action: 'set', objective: 'Verify output', rounds: 2 });
  assert.equal(created.goal.phase, 'active');
  await started.promise;
  const paused = await goalCall(h, caller, { sessionId, action: 'pause' });
  assert.equal(paused.goal.phase, 'paused');
  holding.release();
  await child.whenIdle();
  caller.release();
  await caller.exec.agent.whenIdle();
  h = await h.restart(false);
  const modelSelection = { provider: 'fixture', model: 'scripted' };
  const restoredParent = await h.ctx.agents.resume({ resumeSessionId: 'parent', agentOptions: modelSelection });
  const restoredChild = await h.ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: modelSelection });
  const humanHold = gate(), humanStarted = Promise.withResolvers();
  t.after(humanHold.release);
  h.model.scripts.push(async function* (options) { humanStarted.resolve(); await humanHold.wait(options.signal); yield* textChunks('done'); });
  restoredParent.agent.followup(user('Resume the child goal'));
  await humanStarted.promise;
  caller = { exec: { agent: restoredParent.agent, callId: 'fixture', signal: new AbortController().signal } };
  const restored = await goalCall(h, caller, { sessionId, action: 'get' });
  assert.equal(restored.managed, true);
  assert.equal(restored.goal.id, created.goal.id);
  assert.equal(restored.goal.phase, 'paused');
  assert.equal(restored.goal.roundsStarted, 1);
  await assert.rejects(goalCall(h, caller, { sessionId, action: 'resume' }), /active DSH goal round driver/);
  assert.deepEqual(h.ctx.goals.get(restoredChild.agent), restored.goal);
  await h.loader.create({ name: '@deepseek-ai/dsh-goal-round-driver' });
  await h.loader.await();
  const blocked = Promise.withResolvers();
  h.ctx.on('goal/changed', ({ change }) => {
    if (change.goal?.phase === 'blocked') blocked.resolve();
  });
  h.model.text('automatic round two');
  const resumed = await goalCall(h, caller, { sessionId, action: 'resume' });
  assert.equal(resumed.goal.phase, 'active');
  await blocked.promise;
  assert.equal(h.ctx.goals.get(restoredChild.agent).roundsStarted, 2);
  assert.equal((await goalCall(h, caller, { sessionId, action: 'clear' })).goal, null);
});
