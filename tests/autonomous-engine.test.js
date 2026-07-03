const test = require('node:test');
const assert = require('node:assert/strict');
const { AutonomousContractorEngine } = require('../autonomous-engine');

function createState() {
  return {
    jobs: [
      {
        id: 1,
        title: 'Emergency plumbing repair',
        client: 'Test Client',
        address: 'Amsterdam',
        description: 'Urgent water leak under the sink',
        status: 'pending',
        priority: 'critical',
        progress: 0
      }
    ],
    workers: [
      {
        id: 1,
        name: 'Alex Plumber',
        specialty: 'Plumbing repair',
        skills: ['plumbing', 'repair'],
        status: 'available',
        location: 'Amsterdam',
        rating: 4.9,
        currentJob: null,
        currentJobId: null
      }
    ],
    tools: [
      {
        id: 1,
        name: 'Plumbing Kit',
        category: 'hand_tools',
        status: 'available',
        currentLocation: 'Warehouse',
        homeLocation: 'Warehouse'
      }
    ]
  };
}

function createEngine() {
  return new AutonomousContractorEngine({
    now: () => new Date('2026-06-08T08:00:00.000Z')
  });
}

test('autonomous dry run does not mutate the provided state', () => {
  const engine = createEngine();
  const state = createState();
  const before = JSON.parse(JSON.stringify(state));

  const result = engine.runAutonomousCycle(state, { dryRun: true, maxActions: 5 });

  assert.equal(result.mode, 'dry_run');
  assert.equal(result.actions.length, 1);
  assert.deepEqual(state, before);
  assert.equal(result.stateSummary.scheduledJobs, 1);
});

test('executing a plan assigns a worker and reserves matching tools', () => {
  const engine = createEngine();
  const state = createState();

  const result = engine.executePlan(1, state);

  assert.equal(result.success, true);
  assert.equal(state.jobs[0].status, 'scheduled');
  assert.equal(state.jobs[0].assignedWorkerId, 1);
  assert.equal(state.workers[0].currentJobId, 1);
  assert.equal(state.workers[0].status, 'active');
  assert.equal(state.tools[0].status, 'reserved');
  assert.equal(state.tools[0].assignedJobId, 1);
  assert.equal(state.tools[0].assignedWorkerId, 1);
});

test('releasing job resources clears worker and tool assignments', () => {
  const engine = createEngine();
  const state = createState();
  engine.executePlan(1, state);

  const released = engine.releaseJobResources(state.jobs[0], state);

  assert.equal(released.worker.id, 1);
  assert.equal(released.tools.length, 1);
  assert.equal(state.workers[0].status, 'available');
  assert.equal(state.workers[0].currentJob, null);
  assert.equal(state.workers[0].currentJobId, null);
  assert.equal(state.tools[0].status, 'available');
  assert.equal(state.tools[0].assignedJobId, null);
  assert.equal(state.tools[0].assignedWorkerId, null);
  assert.equal(state.tools[0].currentLocation, 'Warehouse');
});

test('an active worker assigned to another job is not double-booked', () => {
  const engine = createEngine();
  const state = createState();
  state.workers[0].status = 'active';
  state.workers[0].currentJob = 'Existing job';
  state.workers[0].currentJobId = 99;

  const plan = engine.createPlan(state.jobs[0], state);

  assert.equal(plan.status, 'approval_recommended');
  assert.equal(plan.actions[0].type, 'escalate');
});
