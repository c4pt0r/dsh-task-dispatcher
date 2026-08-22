import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'

import {
  DistributedDispatcherRuntime,
  DispatcherRuntime,
  EXECUTOR_OUTPUT_SCHEMA,
  INITIAL_PLAN_OUTPUT_SCHEMA,
  MASTER_PLAN_RESULT_SCHEMA,
  PLAN_PATCH_OUTPUT_SCHEMA,
  PLAN_REVIEW_OUTPUT_SCHEMA,
  VERIFIER_OUTPUT_SCHEMA,
  acceptanceGate,
  apply,
  applyPlanPatch,
  assertExactDispatcherConfig,
  assertSafeWorkspace,
  buildPlanReviewPrompt,
  createDispatcherTelemetry,
  createDispatcherTelemetryRpcHandler,
  createDispatcherTool,
  createDispatcherConfigController,
  createDispatcherConfigRpcHandler,
  createDistributedTaskEnvelope,
  createMasterPlan,
  dispatcherTelemetrySnapshot,
  dispatcherConfigOverride,
  dispatcherWorkerRole,
  distributedAdmissionDigest,
  distributedLanePolicyDigest,
  distributedTaskTimeoutMs,
  executeDistributedTask,
  ensureDispatcherTelemetryState,
  mergeCriteria,
  parseDispatcherTelemetryRpcPayload,
  parseInitialPlan,
  parsePlanPatch,
  registerDispatcherTelemetryRpc,
  resolveDispatcherConfig,
  runStructuredChild,
  runTaskPipeline,
  validateDistributedTaskResult,
  watchDispatcherTelemetry,
} from './dispatcher.js'
import { MemoryTaskStore } from './distributed-store.js'

function lane(overrides = {}) {
  return {
    name: 'Code change',
    description: 'Implement and verify a bounded code change.',
    executor: { provider: 'executor-provider', model: 'executor-model', maxTokens: 12_345 },
    verifier: { provider: 'verifier-provider', model: 'verifier-model', maxTokens: 6_789 },
    requiredCriteria: [{ id: 'requirements', text: 'Every requirement is implemented.' }],
    executorTools: ['read', 'write', 'bash'],
    verifierTools: ['read', 'grep'],
    plannerTools: [],
    maxPlanSteps: 6,
    maxPlanPatches: 4,
    maxTotalChildRuns: 24,
    taskTimeoutMs: 60_000,
    maxAttempts: 2,
    childTimeoutMs: 5_000,
    ...overrides,
  }
}

function config(overrides = {}) {
  return resolveDispatcherConfig({
    defaultRunInBackground: false,
    liveRoot: dirname(realpathSync.native(process.execPath)),
    lanes: { code: lane() },
    ...overrides,
  })
}

function executorReport(overrides = {}) {
  return {
    status: 'completed',
    summary: 'Implementation complete.',
    artifacts: [{ path: 'src/change.js', description: 'Implemented change.' }],
    criteria: [{ id: 'requirements', status: 'pass', evidence: 'Focused test passed.' }],
    ...overrides,
  }
}

function verifierReport(criteria = ['requirements'], overrides = {}) {
  return {
    decision: 'accept',
    summary: 'Independent verification passed.',
    criteria: criteria.map(id => ({ id, status: 'pass', evidence: `Evidence for ${id}.` })),
    feedback: '',
    ...overrides,
  }
}

function planReviewReport(overrides = {}) {
  return {
    decision: 'accept',
    summary: 'The plan remains inside the immutable task scope.',
    issues: [],
    ...overrides,
  }
}

function planStep(id, overrides = {}) {
  return {
    id,
    title: `Complete ${id}`,
    objective: `Complete only the ${id} portion of the task.`,
    acceptanceCriteria: [{ id: `${id}-ok`, text: `${id} is complete with evidence.` }],
    covers: [],
    deliverableIds: [],
    ...overrides,
  }
}

function twoStepPlan(overrides = {}) {
  return {
    summary: 'Inspect the requirement, then produce the requested implementation.',
    steps: [
      planStep('inspect', { covers: ['requirements'] }),
      planStep('implement', { deliverableIds: ['code'] }),
    ],
    ...overrides,
  }
}

function plannedPipelineSpec(overrides = {}) {
  const { lane: laneOverrides, ...specOverrides } = overrides
  return pipelineSpec({
    lane: {
      planner: { provider: 'planner-provider', model: 'planner-model', maxTokens: 4_321 },
      plannerTools: ['read'],
      maxPlanSteps: 6,
      maxPlanPatches: 4,
      maxTotalChildRuns: 24,
      taskTimeoutMs: 60_000,
      ...laneOverrides,
    },
    ...specOverrides,
  })
}

function childRun(id, structured, options = {}) {
  let disposals = 0
  const run = {
    id,
    result: options.result ?? Promise.resolve({
      output: options.output ?? [],
      structured,
      stopReason: options.stopReason ?? 'completed',
    }),
    dispose() {
      disposals += 1
      if (options.disposeError !== undefined) throw options.disposeError
    },
  }
  return { run, disposals: () => disposals }
}

function pipelineSpec(overrides = {}) {
  const { lane: laneOverrides, ...specOverrides } = overrides
  const configuredLane = lane({ executorTools: ['read', 'grep'], ...laneOverrides })
  return {
    taskId: 'task-1',
    laneId: 'code',
    lane: configuredLane,
    title: 'Implement a bounded change',
    objective: 'Change the implementation and prove it works.',
    context: 'Keep the public API stable.',
    deliverables: [{ id: 'code', description: 'The implementation.' }],
    criteria: configuredLane.requiredCriteria,
    parent: { id: 'root-1', session: { header: { cwd: '/workspace' } } },
    workspace: '/workspace',
    liveRoot: '',
    stagingRoot: '',
    ...specOverrides,
  }
}

function taskArgs(overrides = {}) {
  return {
    lane: 'code',
    title: 'Safe task',
    objective: 'Complete a bounded task.',
    run_in_background: false,
    ...overrides,
  }
}

function runtimeFixture(options = {}) {
  const parent = options.parent ?? {
    id: 'root-1',
    session: { header: { cwd: options.cwd ?? process.cwd() } },
  }
  const starts = []
  const jobs = []
  const ctx = {
    agents: {
      get: id => id === parent.id ? parent : undefined,
      roots: () => [parent],
    },
    jobs: {
      start(descriptor) {
        jobs.push({ descriptor, handle: descriptor.run() })
        return `job-${jobs.length}`
      },
    },
    logger: { warn() {}, error() {} },
    sandboxPolicy: {
      resolve: () => ({ mode: 'workspace-write', workspaceRoot: parent.session.header.cwd }),
    },
    subagents: {
      start(transport, request) {
        starts.push({ transport, request })
        if (options.start !== undefined) return options.start(transport, request, starts.length)
        return childRun(`run-${starts.length}`, executorReport()).run
      },
    },
  }
  let id = 0
  const processState = options.processState ?? { locks: new Map(), circuits: new Map() }
  const runtime = new DispatcherRuntime(ctx, options.config ?? config(), {
    processState,
    now: options.now,
    createId: () => `id-${++id}`,
  })
  return { ctx, jobs, parent, processState, runtime, starts }
}

test('configuration resolves defaults and enforces cross-field policy', async (t) => {
  const resolved = config()
  assert.equal(resolved.defaultRunInBackground, false)
  assert.equal(resolved.lanes.code.transport, 'spawn')
  assert.equal(resolved.lanes.code.kind, 'general')
  assert.equal(resolved.lanes.code.maxAttempts, 2)

  const invalidCases = [
    {
      name: 'invalid lane id',
      value: { lanes: { 'Bad lane': lane() } },
      pattern: /invalid lane id/u,
    },
    {
      name: 'blank route',
      value: { lanes: { code: lane({ executor: { provider: ' ', model: 'model' } }) } },
      pattern: /provider must be non-empty/u,
    },
    {
      name: 'duplicate criteria',
      value: {
        lanes: {
          code: lane({
            requiredCriteria: [
              { id: 'same', text: 'First.' },
              { id: 'same', text: 'Second.' },
            ],
          }),
        },
      },
      pattern: /duplicate criterion id/u,
    },
    {
      name: 'duplicate tool',
      value: { lanes: { code: lane({ executorTools: ['read', 'read'] }) } },
      pattern: /duplicate tool name/u,
    },
    {
      name: 'missing self-improvement roots',
      value: { lanes: { improve: lane({ kind: 'self-improvement' }) } },
      pattern: /requires disjoint liveRoot and stagingRoot/u,
    },
    {
      name: 'overlapping roots',
      value: {
        liveRoot: '/srv/dsh',
        stagingRoot: '/srv/dsh/staging',
        lanes: { improve: lane({ kind: 'self-improvement' }) },
      },
      pattern: /must not overlap/u,
    },
    {
      name: 'unprotected mutating lane',
      value: { lanes: { code: lane() } },
      pattern: /requires liveRoot protection/u,
    },
    {
      name: 'mutating verifier tool',
      value: {
        liveRoot: tmpdir(),
        lanes: { code: lane({ verifierTools: ['read', 'write'] }) },
      },
      pattern: /verifierTools must be read-only/u,
    },
    {
      name: 'too many configured criteria',
      value: {
        liveRoot: dirname(realpathSync.native(process.execPath)),
        lanes: {
          code: lane({
            requiredCriteria: Array.from(
              { length: 25 },
              (_value, index) => ({ id: `criterion-${index}`, text: `Criterion ${index}.` }),
            ),
          }),
        },
      },
      pattern: /24|length|array/u,
    },
    {
      name: 'database setting is an environment variable name, not a URL',
      value: {
        distribution: { role: 'coordinator', databaseUrlEnv: 'postgres://secret@example.invalid/db' },
        lanes: {},
      },
      pattern: /environment variable name/u,
    },
  ]

  for (const example of invalidCases) {
    await t.test(example.name, () => {
      assert.throws(() => resolveDispatcherConfig(example.value), example.pattern)
    })
  }
})

test('configuration RPC is strict, restart-scoped, minimal, and revision fenced', async () => {
  const base = JSON.parse(JSON.stringify(config()))
  const freeze = (value) => {
    if (value !== null && typeof value === 'object') {
      for (const entry of Object.values(value)) freeze(entry)
      Object.freeze(value)
    }
    return value
  }
  const merge = (under, over) => {
    if (Array.isArray(over) || typeof over !== 'object' || over === null) return structuredClone(over)
    const result = typeof under === 'object' && under !== null && !Array.isArray(under)
      ? structuredClone(under)
      : {}
    for (const [key, value] of Object.entries(over)) result[key] = merge(result[key], value)
    return result
  }
  let revision = 0
  let user = {}
  let effective = freeze(structuredClone(base))
  const settings = {
    writable: true,
    register(ns, _schema, options) {
      assert.equal(ns, 'dsh-task-dispatcher')
      assert.equal(options.applies, 'restart')
      assert.deepEqual(options.base, base)
      return { get: () => effective }
    },
    describe(options) {
      assert.deepEqual(options, { redactSecrets: true })
      return [{ ns: 'dsh-task-dispatcher', revision, user, value: effective, base, applies: 'restart' }]
    },
    async replace(ns, section, expectedRevision) {
      assert.equal(ns, 'dsh-task-dispatcher')
      if (expectedRevision !== revision) {
        throw Object.assign(new Error('stale configuration'), {
          code: 'SETTINGS_CONFLICT', expected: expectedRevision, actual: revision,
        })
      }
      user = structuredClone(section)
      effective = freeze(merge(base, user))
      revision += 1
    },
  }
  const controller = createDispatcherConfigController(settings, base, { warn() {} })
  assert.deepEqual(controller.activeConfig(), resolveDispatcherConfig(base))
  const initial = controller.snapshot()
  assert.equal(initial.available, true)
  assert.equal(initial.applies, 'restart')
  assert.equal(initial.revision, 0)
  assert.deepEqual(initial.userLaneIds, [])

  const changed = structuredClone(base)
  changed.maxConsecutiveFailures = 7
  changed.lanes.code.executor.model = 'executor-model-v2'
  changed.lanes.review = structuredClone(base.lanes.code)
  changed.lanes.review.name = 'User review lane'
  const saved = await controller.save(changed, 0)
  assert.equal(saved.revision, 1)
  assert.deepEqual(user.lanes.code, { executor: { model: 'executor-model-v2' } })
  assert.deepEqual(user.lanes.review, changed.lanes.review)
  assert.equal(user.maxConsecutiveFailures, 7)
  assert.deepEqual(saved.userLaneIds, ['review'])

  const handler = createDispatcherConfigRpcHandler(controller)
  const read = await handler('snapshot', {})
  assert.equal(read.ok, true)
  assert.equal(read.value.value.lanes.code.executor.model, 'executor-model-v2')
  const stale = await handler('save', { expectedRevision: 0, value: changed })
  assert.deepEqual(stale, {
    ok: false,
    error: {
      code: 'conflict',
      message: 'stale configuration',
      details: { expected: 0, actual: 1 },
    },
  })
  const extra = await handler('save', { expectedRevision: 1, value: { ...changed, surprise: true } })
  assert.equal(extra.ok, false)
  assert.equal(extra.error.code, 'invalid-config')
  const badPayload = await handler('snapshot', { unexpected: true })
  assert.equal(badPayload.ok, false)
  assert.equal(badPayload.error.code, 'bad-request')
  const oversized = await handler('save', {
    expectedRevision: 1,
    value: { note: '界'.repeat(400_000) },
  })
  assert.equal(oversized.ok, false)
  assert.match(oversized.error.message, /exceeds/u)
  const aborted = new AbortController()
  aborted.abort()
  assert.equal((await handler('snapshot', {}, aborted.signal)).error.code, 'cancelled')

  const withoutUserLane = structuredClone(changed)
  delete withoutUserLane.lanes.review
  const removedUserLane = await controller.save(withoutUserLane, 1)
  assert.deepEqual(removedUserLane.userLaneIds, [])
  assert.equal('review' in user.lanes, false)

  const removedBaseLane = structuredClone(changed)
  delete removedBaseLane.lanes.code
  assert.throws(() => dispatcherConfigOverride(removedBaseLane, base), /deployment-owned/u)
  assert.throws(() => assertExactDispatcherConfig({ ...changed, unknown: true }), /unknown field/u)
})

test('configuration RPC stays unavailable without Settings and never exposes an environment value', async () => {
  const base = JSON.parse(JSON.stringify(config({
    distribution: { role: 'disabled', databaseUrlEnv: 'PRIVATE_DATABASE_URL' },
  })))
  process.env.PRIVATE_DATABASE_URL = 'postgres://user:password@example.invalid/private'
  try {
    const controller = createDispatcherConfigController(undefined, base, { warn() {} })
    const snapshot = controller.snapshot()
    assert.equal(snapshot.available, false)
    assert.equal(snapshot.writable, false)
    assert.equal(JSON.stringify(snapshot).includes(process.env.PRIVATE_DATABASE_URL), false)
    const response = await createDispatcherConfigRpcHandler(controller)(
      'save',
      { expectedRevision: 0, value: base },
    )
    assert.equal(response.ok, false)
    assert.equal(response.error.code, 'unavailable')
  } finally {
    delete process.env.PRIVATE_DATABASE_URL
  }
})

test('distributed lanes are explicitly read-only, spawn-only, and policy pinned', () => {
  const distributed = resolveDispatcherConfig({
    distribution: { role: 'coordinator' },
    lanes: {
      remote: lane({
        executorTools: ['read', 'grep'],
        verifierTools: ['read'],
        plannerTools: ['glob'],
        execution: { mode: 'distributed', pool: 'ds4-readonly', workspaceRef: 'harness-main' },
      }),
    },
  })
  assert.equal(distributed.lanes.remote.execution.mode, 'distributed')
  assert.equal(distributed.lanes.remote.execution.pool, 'ds4-readonly')
  assert.match(distributedLanePolicyDigest('remote', distributed.lanes.remote), /^[a-f0-9]{64}$/u)

  assert.throws(() => resolveDispatcherConfig({
    distribution: { role: 'coordinator' },
    liveRoot: dirname(realpathSync.native(process.execPath)),
    lanes: {
      remote: lane({
        execution: { mode: 'distributed', pool: 'default', workspaceRef: 'harness-main' },
      }),
    },
  }), /must use read-only tools/u)
  assert.throws(() => resolveDispatcherConfig({
    distribution: { role: 'coordinator' },
    lanes: {
      remote: lane({
        transport: 'fork',
        executorTools: [],
        execution: { mode: 'distributed', pool: 'default', workspaceRef: 'harness-main' },
      }),
    },
  }), /general spawn lane/u)
  assert.throws(() => resolveDispatcherConfig({
    lanes: {
      remote: lane({
        executorTools: [],
        execution: { mode: 'distributed', pool: 'default', workspaceRef: 'harness-main' },
      }),
    },
  }), /requires distribution\.role/u)
})

test('distributed envelope excludes process objects and admission digest excludes task identity', () => {
  const distributed = resolveDispatcherConfig({
    distribution: { role: 'coordinator' },
    lanes: {
      remote: lane({
        executorTools: [],
        verifierTools: [],
        plannerTools: [],
        execution: { mode: 'distributed', pool: 'default', workspaceRef: 'repo-at-commit' },
      }),
    },
  })
  const spec = {
    taskId: 'task-one',
    laneId: 'remote',
    lane: distributed.lanes.remote,
    title: 'Inspect safely',
    objective: 'Inspect the immutable workspace.',
    context: '',
    deliverables: [],
    criteria: [{ id: 'requirements', text: 'Every requirement is implemented.' }],
    parent: { id: 'live-parent', secret: Symbol('must-not-cross-wire') },
  }
  const first = createDistributedTaskEnvelope(spec)
  const second = createDistributedTaskEnvelope({ ...spec, taskId: 'task-two' })
  assert.equal('parent' in first, false)
  assert.equal('workspace' in first, false)
  assert.equal(first.workspaceRef, 'repo-at-commit')
  assert.equal(distributedAdmissionDigest(first), distributedAdmissionDigest(second))
  assert.notEqual(first.taskId, second.taskId)
})

test('distributed terminal acceptance is re-gated against immutable criteria', () => {
  const envelope = {
    taskId: 'task-accepted',
    laneId: 'remote',
    title: 'Inspect safely',
    criteria: [{ id: 'requirements', text: 'Must pass.' }],
  }
  const accepted = {
    taskId: 'task-accepted',
    lane: 'remote',
    title: 'Inspect safely',
    status: 'accepted',
    modelVerified: true,
    attempts: 1,
    message: 'All requirements passed.',
    workspaceQuarantined: false,
    failureClass: 'none',
    criteria: [{ id: 'requirements', status: 'pass', evidence: 'Independent evidence.' }],
    executorRuns: [],
    verifierRuns: [],
  }
  assert.strictEqual(validateDistributedTaskResult(envelope, accepted), accepted)
  assert.throws(
    () => validateDistributedTaskResult(envelope, {
      ...accepted,
      criteria: [{ id: 'requirements', status: 'pass', evidence: '' }],
    }),
    /host gate/u,
  )
  assert.throws(
    () => validateDistributedTaskResult(envelope, { ...accepted, taskId: 'foreign-task' }),
    /invalid task result/u,
  )
  for (const invalid of [
    { ...accepted, title: undefined },
    { ...accepted, unexpected: true },
    { ...accepted, criteria: [{ id: 'requirements', status: 'maybe', evidence: 'No.' }] },
    { ...accepted, executorRuns: [{ attempt: 1, status: 'completed', unexpected: true }] },
    { ...accepted, failureClass: 'infrastructure' },
    { ...accepted, workspaceQuarantined: true },
  ]) {
    assert.throws(() => validateDistributedTaskResult(envelope, invalid), /invalid task result|host gate/u)
  }
})

test('distributed ledger deadlines preserve both planned and legacy pipeline budgets', () => {
  const legacy = lane({ maxAttempts: 3, childTimeoutMs: 60 * 60 * 1_000 })
  assert.equal(distributedTaskTimeoutMs(legacy), 6 * (60 * 60 * 1_000 + 10_000) + 30_000)
  const planned = lane({
    planner: { provider: 'planner-provider', model: 'planner-model', maxTokens: 1_000 },
    taskTimeoutMs: 123_456,
  })
  assert.equal(distributedTaskTimeoutMs(planned), 123_456)
})

test('distributed worker composes a temporary root preset before spawning the bounded pipeline', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-distributed-worker-'))
  const configured = resolveDispatcherConfig({
    distribution: {
      role: 'worker',
      workerAgentPreset: 'worker-readonly',
      pools: ['ds4-readonly'],
      workspaceMappings: { 'harness-main': workspace },
    },
    lanes: {
      remote: lane({
        executorTools: ['read', 'grep'],
        verifierTools: ['read'],
        plannerTools: [],
        maxAttempts: 1,
        execution: { mode: 'distributed', pool: 'ds4-readonly', workspaceRef: 'harness-main' },
      }),
    },
  })
  const sourceSpec = {
    ...pipelineSpec(),
    taskId: 'distributed-task-1',
    laneId: 'remote',
    lane: configured.lanes.remote,
    criteria: configured.lanes.remote.requiredCriteria,
  }
  const envelope = createDistributedTaskEnvelope(sourceSpec)
  const mounts = []
  const creations = []
  const starts = []
  let parentDisposals = 0
  const agentPresets = {
    defaultId: 'default-worker',
    async mount(agentCtx, presetId) {
      mounts.push({ agentCtx, presetId })
      agentCtx.composedPreset = presetId
    },
  }
  const reports = [executorReport(), verifierReport()]
  const ctx = {
    get(name) {
      return name === 'agentPresets' ? agentPresets : undefined
    },
    agents: {
      async create(options) {
        const agentCtx = {}
        const agent = {
          id: options.sessionId,
          session: { header: { cwd: options.meta.cwd, agentPreset: options.meta.agentPreset } },
          ctx: agentCtx,
        }
        agentCtx.agent = agent
        await options.setup(agentCtx)
        creations.push({ options, agent })
        return {
          agent,
          async dispose() {
            parentDisposals += 1
          },
        }
      },
    },
    logger: { warn() {} },
    subagents: {
      start(transport, request) {
        starts.push({ transport, request })
        assert.equal(request.parent.ctx.composedPreset, 'worker-readonly')
        return childRun(`remote-run-${starts.length}`, reports[starts.length - 1]).run
      },
    },
  }

  try {
    const result = await executeDistributedTask(
      ctx,
      configured,
      envelope,
      new AbortController().signal,
      { leaseGeneration: '7' },
    )

    assert.equal(result.status, 'accepted')
    assert.equal(result.modelVerified, true)
    assert.equal(creations.length, 1)
    assert.equal(creations[0].options.meta.cwd, realpathSync.native(workspace))
    assert.equal(creations[0].options.meta.agentPreset, 'worker-readonly')
    assert.deepEqual(mounts.map(item => item.presetId), ['worker-readonly'])
    assert.deepEqual(starts.map(item => item.transport), ['spawn', 'spawn'])
    assert.equal(starts.every(item => item.request.parent === creations[0].agent), true)
    assert.equal(parentDisposals, 1)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('distributed worker fails closed before Agent creation without a preset roster', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-distributed-no-preset-'))
  const configured = resolveDispatcherConfig({
    distribution: {
      role: 'worker',
      pools: ['default'],
      workspaceMappings: { snapshot: workspace },
    },
    lanes: {
      remote: lane({
        executorTools: ['read'],
        verifierTools: ['grep'],
        execution: { mode: 'distributed', pool: 'default', workspaceRef: 'snapshot' },
      }),
    },
  })
  const envelope = createDistributedTaskEnvelope({
    ...pipelineSpec(),
    taskId: 'distributed-task-no-preset',
    laneId: 'remote',
    lane: configured.lanes.remote,
    criteria: configured.lanes.remote.requiredCriteria,
  })
  let creations = 0
  try {
    const result = await executeDistributedTask({
      get() { return undefined },
      agents: { create() { creations += 1 } },
      logger: { warn() {} },
      subagents: { start() { throw new Error('must not start') } },
    }, configured, envelope, new AbortController().signal)

    assert.equal(result.status, 'error')
    assert.equal(result.failureClass, 'infrastructure')
    assert.match(result.message, /agentPresets service/u)
    assert.equal(creations, 0)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('mergeCriteria preserves mandatory criteria and accepts only stricter unique additions', () => {
  const required = [{ id: 'base', text: 'Base must pass.' }]
  const merged = mergeCriteria(required, [{ id: 'extra', text: 'Extra must pass.' }])
  assert.deepEqual(merged, [
    { id: 'base', text: 'Base must pass.' },
    { id: 'extra', text: 'Extra must pass.' },
  ])
  assert.notStrictEqual(merged[0], required[0])
  assert.throws(
    () => mergeCriteria(required, [{ id: 'base', text: 'Replace deployment policy.' }]),
    /cannot replace a lane criterion/u,
  )
  assert.throws(
    () => mergeCriteria(required, [{ id: 'new', text: ' not trimmed' }]),
    /must be trimmed/u,
  )
})

test('acceptanceGate requires exact unique ids, pass status, and non-empty evidence', async (t) => {
  const criteria = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }]
  assert.deepEqual(
    acceptanceGate(criteria, verifierReport(['b', 'a'])),
    { accepted: true, reason: 'every criterion passed with evidence' },
  )

  const rejected = [
    verifierReport(['a'], { decision: 'accept' }),
    verifierReport(['a', 'a'], { decision: 'accept' }),
    verifierReport(['a', 'other'], { decision: 'accept' }),
    verifierReport(['a', 'b'], {
      decision: 'accept',
      criteria: [
        { id: 'a', status: 'pass', evidence: 'yes' },
        { id: 'b', status: 'fail', evidence: 'failed test' },
      ],
    }),
    verifierReport(['a', 'b'], {
      decision: 'accept',
      criteria: [
        { id: 'a', status: 'pass', evidence: 'yes' },
        { id: 'b', status: 'pass', evidence: '   ' },
      ],
    }),
    verifierReport(['a', 'b'], { decision: 'revise' }),
  ]

  for (const [index, report] of rejected.entries()) {
    await t.test(`rejects invalid acceptance report ${index + 1}`, () => {
      assert.equal(acceptanceGate(criteria, report).accepted, false)
    })
  }
})

test('master-plan APIs preserve atomicity, revision ownership, and immutable history snapshots', () => {
  const spec = plannedPipelineSpec()
  const rawProposal = twoStepPlan()
  const rawSnapshot = structuredClone(rawProposal)
  const proposal = parseInitialPlan(rawProposal, spec)

  assert.deepEqual(rawProposal, rawSnapshot)
  assert.notStrictEqual(proposal.steps[0], rawProposal.steps[0])
  assert.notStrictEqual(proposal.steps[0].acceptanceCriteria, rawProposal.steps[0].acceptanceCriteria)

  const plan = createMasterPlan(spec, proposal)
  assert.equal(plan.planId, 'plan-task-1')
  assert.equal(plan.revision, 1)
  assert.equal(plan.patchCount, 0)
  assert.deepEqual(plan.steps.map(step => step.status), ['pending', 'pending'])
  assert.deepEqual(plan.history, [{
    revision: 1,
    kind: 'created',
    summary: rawProposal.summary,
    stepIds: ['inspect', 'implement'],
  }])
  assert.equal(Object.isFrozen(plan.history[0]), true)
  assert.equal(Object.isFrozen(plan.history[0].stepIds), true)
  assert.throws(() => plan.history[0].stepIds.push('tamper'), TypeError)

  rawProposal.steps[0].title = 'Mutated raw proposal'
  proposal.steps[0].title = 'Mutated parsed proposal'
  assert.equal(plan.steps[0].title, 'Complete inspect')

  const seenStepIds = new Set(plan.steps.map(step => step.id))
  const beforeInvalid = structuredClone(plan)
  const seenBeforeInvalid = [...seenStepIds]
  assert.throws(
    () => parsePlanPatch({
      baseRevision: plan.revision,
      action: 'replace_pending',
      rationale: 'This replacement accidentally drops required coverage.',
      steps: [planStep('invalid', { deliverableIds: ['code'] })],
    }, spec, plan, seenStepIds),
    /does not cover task criterion "requirements"/u,
  )
  assert.deepEqual(plan, beforeInvalid)
  assert.deepEqual([...seenStepIds], seenBeforeInvalid)

  const keep = parsePlanPatch({
    baseRevision: plan.revision,
    action: 'keep',
    rationale: 'The pending suffix is still correct.',
    steps: [],
  }, spec, plan, seenStepIds)
  const beforeKeep = structuredClone(plan)
  assert.equal(applyPlanPatch(plan, keep, seenStepIds), false)
  assert.deepEqual(plan, beforeKeep)

  const stalePatch = parsePlanPatch({
    baseRevision: plan.revision,
    action: 'replace_pending',
    rationale: 'First valid replacement proposal.',
    steps: [planStep('alternative-a', {
      covers: ['requirements'],
      deliverableIds: ['code'],
    })],
  }, spec, plan, seenStepIds)
  const replacementInput = {
    baseRevision: plan.revision,
    action: 'replace_pending',
    rationale: 'Use the independently selected replacement.',
    steps: [planStep('alternative-b', {
      covers: ['requirements'],
      deliverableIds: ['code'],
    })],
  }
  const patch = parsePlanPatch(replacementInput, spec, plan, seenStepIds)
  assert.deepEqual(plan, beforeKeep)

  assert.equal(applyPlanPatch(plan, patch, seenStepIds), true)
  assert.equal(plan.revision, 2)
  assert.equal(plan.patchCount, 1)
  assert.deepEqual(plan.steps.map(step => step.id), ['alternative-b'])
  assert.deepEqual(plan.history[1], {
    revision: 2,
    kind: 'revised',
    rationale: replacementInput.rationale,
    added: ['alternative-b'],
    removed: ['inspect', 'implement'],
    order: ['alternative-b'],
  })
  assert.equal(Object.isFrozen(plan.history[1]), true)
  assert.equal(Object.isFrozen(plan.history[1].added), true)
  assert.equal(Object.isFrozen(plan.history[1].removed), true)
  assert.equal(Object.isFrozen(plan.history[1].order), true)
  assert.deepEqual([...seenStepIds], ['inspect', 'implement', 'alternative-b'])

  replacementInput.steps[0].title = 'Mutated input after parsing'
  patch.steps[0].title = 'Mutated patch after commit'
  assert.equal(plan.steps[0].title, 'Complete alternative-b')

  const beforeStaleApply = structuredClone(plan)
  const seenBeforeStaleApply = [...seenStepIds]
  assert.throws(
    () => applyPlanPatch(plan, stalePatch, seenStepIds),
    /plan patch revision conflict: expected 2/u,
  )
  assert.deepEqual(plan, beforeStaleApply)
  assert.deepEqual([...seenStepIds], seenBeforeStaleApply)
})

test('telemetry projects a session-isolated linear plan, live worker, route, and terminal result', () => {
  let now = 1_000
  const warnings = []
  const shared = { locks: new Map(), circuits: new Map() }
  const state = ensureDispatcherTelemetryState(shared)
  assert.strictEqual(state, shared.telemetry)
  assert.ok(state.tasks instanceof Map)
  assert.ok(state.sessionRevisions instanceof Map)
  assert.ok(state.listeners instanceof Map)

  const telemetry = createDispatcherTelemetry(shared, {
    now: () => now,
    logger: { warn: warning => warnings.push(String(warning)) },
  })
  const spec = plannedPipelineSpec()
  telemetry.startTask(spec)
  now += 1
  telemetry.setJobId(spec.taskId, 'subagent-7')

  const plan = createMasterPlan(spec, parseInitialPlan(twoStepPlan(), spec))
  now += 1
  telemetry.setMasterPlan(spec.taskId, plan)
  const workerId = telemetry.startWorker(spec.taskId, {
    attempt: 1,
    phase: 'step-executor',
    stepId: 'inspect',
    planRevision: plan.revision,
  }, {
    transport: 'spawn',
    route: spec.lane.executor,
  })
  now += 1
  telemetry.updateWorker(spec.taskId, workerId, { status: 'running', runId: 'child-session-1' })

  let peerNotifications = 0
  telemetry.subscribe(spec.parent.id, () => { throw new Error('dashboard listener exploded') })
  const unsubscribePeer = telemetry.subscribe(spec.parent.id, () => { peerNotifications += 1 })
  now += 1
  telemetry.updateWorker(spec.taskId, workerId, { status: 'cleanup', runId: 'child-session-1' })
  assert.equal(peerNotifications, 1)
  assert.equal(warnings.length, 1)

  const live = telemetry.snapshot(spec.parent.id)
  assert.equal(live.protocolVersion, 1)
  assert.equal(live.sessionId, 'root-1')
  assert.equal(live.tasks.length, 1)
  assert.deepEqual(live.tasks[0].masterPlan.steps.map(step => ({
    id: step.id,
    status: step.status,
    dependsOn: step.dependsOn,
  })), [
    { id: 'inspect', status: 'working', dependsOn: [] },
    { id: 'implement', status: 'pending', dependsOn: ['inspect'] },
  ])
  assert.deepEqual(live.tasks[0].workers[0], {
    workerId,
    agentId: 'child-session-1',
    role: 'executor',
    phase: 'step-executor',
    stepId: 'inspect',
    planRevision: 1,
    attempt: 1,
    transport: 'spawn',
    provider: 'executor-provider',
    model: 'executor-model',
    maxTokens: 12_345,
    status: 'cleanup',
    startedAt: 1_002,
    updatedAt: 1_004,
  })
  assert.deepEqual([
    dispatcherWorkerRole('initial-plan'),
    dispatcherWorkerRole('initial-plan-review'),
    dispatcherWorkerRole('replan'),
    dispatcherWorkerRole('plan-patch-review'),
    dispatcherWorkerRole('final-verification'),
  ], ['planner', 'plan-reviewer', 'replanner', 'plan-reviewer', 'final-verifier'])

  // Returned values are copies, not handles into process-stable state.
  live.tasks[0].title = 'tampered title'
  live.tasks[0].masterPlan.steps[0].dependsOn.push('tamper')
  assert.equal(telemetry.snapshot(spec.parent.id).tasks[0].title, spec.title)
  assert.deepEqual(telemetry.snapshot(spec.parent.id).tasks[0].masterPlan.steps[0].dependsOn, [])
  assert.deepEqual(dispatcherTelemetrySnapshot(state, 'another-session', now).tasks, [])

  now += 1
  telemetry.finishWorker(spec.taskId, workerId, { ok: true, runId: 'child-session-1', report: {} })
  plan.steps[0].status = 'completed'
  plan.steps[0].attempts = 1
  telemetry.setMasterPlan(spec.taskId, plan)
  now += 1
  telemetry.finishTask(spec.taskId, {
    status: 'accepted',
    message: 'Verified.',
    modelVerified: true,
    workspaceQuarantined: false,
    failureClass: 'none',
    masterPlan: { ...plan, status: 'accepted' },
  })
  unsubscribePeer()

  const terminal = telemetry.snapshot(spec.parent.id).tasks[0]
  assert.equal(terminal.status, 'accepted')
  assert.equal(terminal.phase, 'finished')
  assert.equal(terminal.finishedAt, now)
  assert.equal(terminal.workers[0].status, 'completed')
  assert.equal(terminal.workers[0].finishedAt, 1_005)
  assert.deepEqual(terminal.result, {
    status: 'accepted',
    message: 'Verified.',
    modelVerified: true,
    workspaceQuarantined: false,
    failureClass: 'none',
  })
})

test('telemetry retains all active tasks and only the newest twenty terminal tasks per session', () => {
  let now = 0
  const telemetry = createDispatcherTelemetry({}, { now: () => ++now })
  const parent = { id: 'bounded-session' }
  for (let index = 0; index < 22; index++) {
    const taskId = `terminal-${index}`
    telemetry.startTask({ taskId, parent, laneId: 'code', title: taskId })
    telemetry.finishTask(taskId, {
      status: 'accepted',
      message: 'done',
      modelVerified: true,
      workspaceQuarantined: false,
      failureClass: 'none',
    })
  }
  telemetry.startTask({ taskId: 'still-running', parent, laneId: 'code', title: 'still running' })

  const tasks = telemetry.snapshot(parent.id).tasks
  assert.equal(tasks.length, 21)
  assert.equal(tasks[0].taskId, 'still-running')
  assert.equal(tasks.some(task => task.taskId === 'terminal-0'), false)
  assert.equal(tasks.some(task => task.taskId === 'terminal-1'), false)
  assert.equal(tasks.some(task => task.taskId === 'terminal-21'), true)
})

test('telemetry globally retains only the newest two hundred terminal tasks across sessions', () => {
  const telemetry = createDispatcherTelemetry({}, { now: () => 1_000 })
  for (let index = 0; index < 205; index++) {
    const taskId = `global-${index}`
    telemetry.startTask({
      taskId,
      parent: { id: `session-${index}` },
      laneId: 'code',
      title: taskId,
    })
    telemetry.finishTask(taskId, {
      status: 'accepted',
      message: 'done',
      modelVerified: true,
      workspaceQuarantined: false,
      failureClass: 'none',
    })
  }

  assert.equal(telemetry.state.tasks.size, 200)
  for (let index = 0; index < 5; index++) {
    assert.equal(telemetry.state.tasks.has(`global-${index}`), false)
    assert.equal(telemetry.state.sessionRevisions.has(`session-${index}`), false)
  }
  assert.equal(telemetry.state.tasks.has('global-204'), true)
  assert.equal(telemetry.state.sessionRevisions.size, 200)
})

test('telemetry TTL evicts only terminal tasks and wakes a live cross-session watcher', async () => {
  let now = 10_000
  const telemetry = createDispatcherTelemetry({}, { now: () => now })
  telemetry.startTask({
    taskId: 'expired-terminal',
    parent: { id: 'expired-session' },
    laneId: 'code',
    title: 'expired terminal',
  })
  telemetry.finishTask('expired-terminal', {
    status: 'accepted',
    message: 'done',
    modelVerified: true,
    workspaceQuarantined: false,
    failureClass: 'none',
  })
  telemetry.startTask({
    taskId: 'long-running',
    parent: { id: 'running-session' },
    laneId: 'code',
    title: 'long running',
  })

  const baseline = telemetry.snapshot('expired-session')
  const changedPromise = watchDispatcherTelemetry(
    telemetry,
    'expired-session',
    baseline.revision,
    new AbortController().signal,
    1_000,
  )
  now += 60 * 60 * 1_000
  telemetry.startTask({
    taskId: 'retention-trigger',
    parent: { id: 'trigger-session' },
    laneId: 'code',
    title: 'retention trigger',
  })

  const changed = await changedPromise
  assert.ok(changed.revision > baseline.revision)
  assert.deepEqual(changed.tasks, [])
  assert.equal(telemetry.state.tasks.has('expired-terminal'), false)
  assert.equal(telemetry.state.tasks.has('long-running'), true)
  // The revision survives the prune that woke this watcher, then a later
  // unobserved retention pass may reclaim the now-empty session metadata.
  assert.equal(telemetry.state.sessionRevisions.has('expired-session'), true)
  const reset = telemetry.snapshot('expired-session')
  assert.equal(reset.revision, 0)
  assert.equal(telemetry.state.sessionRevisions.has('expired-session'), false)
})

test('startTask skips global retention scans until the next terminal TTL boundary', () => {
  class CountingMap extends Map {
    constructor(...args) {
      super(...args)
      this.iterations = 0
    }

    [Symbol.iterator]() {
      this.iterations += 1
      return super[Symbol.iterator]()
    }

    values() {
      this.iterations += 1
      return super.values()
    }
  }

  let now = 0
  const tasks = new CountingMap()
  const telemetry = createDispatcherTelemetry({
    telemetry: {
      tasks,
      listeners: new Map(),
      sessionRevisions: new Map(),
    },
  }, { now: () => now })
  tasks.iterations = 0
  for (let index = 0; index < 4_000; index++) {
    telemetry.startTask({
      taskId: `running-${index}`,
      parent: { id: `running-session-${index}` },
      laneId: 'code',
      title: `running ${index}`,
    })
  }
  assert.equal(tasks.iterations, 0)

  telemetry.finishTask('running-0', {
    status: 'accepted',
    message: 'done',
    modelVerified: true,
    workspaceQuarantined: false,
    failureClass: 'none',
  })
  assert.equal(telemetry.state.nextTerminalPruneAt, 60 * 60 * 1_000)
  tasks.iterations = 0
  now = 60 * 60 * 1_000 - 1
  for (let index = 4_000; index < 8_000; index++) {
    telemetry.startTask({
      taskId: `running-${index}`,
      parent: { id: `running-session-${index}` },
      laneId: 'code',
      title: `running ${index}`,
    })
  }
  assert.equal(tasks.iterations, 0)

  now += 1
  telemetry.startTask({
    taskId: 'at-retention-boundary',
    parent: { id: 'retention-boundary-session' },
    laneId: 'code',
    title: 'at retention boundary',
  })
  assert.ok(tasks.iterations > 0)
  assert.equal(tasks.has('running-0'), false)
  assert.equal(telemetry.state.nextTerminalPruneAt, undefined)
})

test('telemetry uses a process-global cursor so revision GC cannot create an equal-revision ABA', async () => {
  let now = 0
  const telemetry = createDispatcherTelemetry({}, { now: () => now })
  const task = taskId => ({
    taskId,
    parent: { id: 'reused-session' },
    laneId: 'code',
    title: taskId,
  })
  telemetry.startTask(task('old-task'))
  telemetry.finishTask('old-task', {
    status: 'accepted',
    message: 'done',
    modelVerified: true,
    workspaceQuarantined: false,
    failureClass: 'none',
  })
  now = 60 * 60 * 1_000 + 1
  const oldEmptyView = telemetry.snapshot('reused-session', { retainRevision: true })
  assert.equal(oldEmptyView.revision, 3)
  assert.deepEqual(oldEmptyView.tasks, [])

  // An unrelated retention pass may reclaim empty per-session metadata, but
  // it must not rewind the process-wide allocator used by a later task.
  telemetry.snapshot('another-session')
  assert.equal(telemetry.state.sessionRevisions.has('reused-session'), false)
  assert.equal(telemetry.state.globalRevisionCursor, oldEmptyView.revision)
  telemetry.startTask(task('new-task'))

  const changed = await watchDispatcherTelemetry(
    telemetry,
    'reused-session',
    oldEmptyView.revision,
    new AbortController().signal,
    10_000,
  )
  assert.ok(changed.revision > oldEmptyView.revision)
  assert.deepEqual(changed.tasks.map(item => item.taskId), ['new-task'])
})

test('telemetry HMR migration seeds the global cursor from the largest legacy session revision', () => {
  const shared = {
    locks: new Map(),
    circuits: new Map(),
    telemetry: {
      tasks: new Map(),
      listeners: new Map(),
      sessionRevisions: new Map([
        ['legacy-low', 7],
        ['legacy-high', 41],
        ['legacy-corrupt', 'not-a-revision'],
      ]),
    },
  }
  const first = createDispatcherTelemetry(shared)
  assert.equal(first.state.globalRevisionCursor, 41)
  assert.equal(first.state.sessionRevisions.has('legacy-corrupt'), false)
  assert.equal(first.snapshot('legacy-corrupt').revision, 0)
  first.startTask({
    taskId: 'after-migration',
    parent: { id: 'new-session' },
    laneId: 'code',
    title: 'after migration',
  })
  assert.equal(first.snapshot('new-session').revision, 42)

  const replacement = createDispatcherTelemetry(shared)
  assert.strictEqual(replacement.state, first.state)
  replacement.setJobId('after-migration', 'job-after-hmr')
  assert.equal(replacement.snapshot('new-session').revision, 43)
  assert.equal(replacement.state.globalRevisionCursor, 43)
})

test('telemetry cursor absorbs late legacy writers during mixed-version HMR overlap', () => {
  const legacyShared = revision => ({
    telemetry: {
      tasks: new Map(),
      listeners: new Map(),
      sessionRevisions: new Map([['mixed-session', revision]]),
    },
  })

  const afterLegacyWrite = legacyShared(5)
  const replacementA = createDispatcherTelemetry(afterLegacyWrite)
  // An old controller that does not know globalRevisionCursor publishes late.
  replacementA.state.sessionRevisions.set('mixed-session', 6)
  replacementA.startTask({
    taskId: 'replacement-a',
    parent: { id: 'mixed-session' },
    laneId: 'code',
    title: 'replacement A',
  })
  assert.equal(replacementA.snapshot('mixed-session').revision, 7)
  assert.equal(replacementA.state.globalRevisionCursor, 7)

  const interleaved = legacyShared(5)
  const replacementB = createDispatcherTelemetry(interleaved)
  replacementB.startTask({
    taskId: 'replacement-b',
    parent: { id: 'mixed-session' },
    laneId: 'code',
    title: 'replacement B',
  })
  assert.equal(replacementB.snapshot('mixed-session').revision, 6)
  // The legacy writer observes 6 and advances only its per-session value.
  replacementB.state.sessionRevisions.set('mixed-session', 7)
  replacementB.setJobId('replacement-b', 'job-after-legacy-write')
  assert.equal(replacementB.snapshot('mixed-session').revision, 8)
  assert.equal(replacementB.state.globalRevisionCursor, 8)

  const beforeLegacyGc = legacyShared(5)
  const replacementC = createDispatcherTelemetry(beforeLegacyGc)
  // A different legacy session can advance beyond the global cursor. Its
  // revision must become the global floor when empty metadata is reclaimed.
  replacementC.state.sessionRevisions.set('legacy-session-b', 100)
  replacementC.snapshot('gc-trigger')
  assert.equal(replacementC.state.sessionRevisions.has('legacy-session-b'), false)
  assert.equal(replacementC.state.globalRevisionCursor, 100)
  replacementC.startTask({
    taskId: 'replacement-c',
    parent: { id: 'legacy-session-b' },
    laneId: 'code',
    title: 'replacement C',
  })
  assert.equal(replacementC.snapshot('legacy-session-b').revision, 101)
})

test('a replacement HMR controller wakes a pending watch owned by the prior controller', async () => {
  const shared = {}
  const spec = plannedPipelineSpec()
  const prior = createDispatcherTelemetry(shared)
  prior.startTask(spec)
  const baseline = prior.snapshot(spec.parent.id)
  const pending = watchDispatcherTelemetry(
    prior,
    spec.parent.id,
    baseline.revision,
    new AbortController().signal,
    10_000,
  )

  const replacement = createDispatcherTelemetry(shared)
  replacement.setJobId(spec.taskId, 'replacement-job')
  const changed = await pending
  assert.ok(changed.revision > baseline.revision)
  assert.equal(changed.tasks[0].jobId, 'replacement-job')
  assert.equal(shared.telemetry.listeners.has(spec.parent.id), false)
})

test('telemetry raw state survives controller replacement in the shared PROCESS_STATE v1 object', () => {
  const shared = { locks: new Map(), circuits: new Map() }
  const spec = plannedPipelineSpec()
  const first = createDispatcherTelemetry(shared)
  first.startTask(spec)
  first.setJobId(spec.taskId, 'job-before-hmr')

  const replacement = createDispatcherTelemetry(shared)
  assert.strictEqual(replacement.state, first.state)
  assert.deepEqual(replacement.snapshot(spec.parent.id).tasks.map(task => ({
    taskId: task.taskId,
    jobId: task.jobId,
    status: task.status,
  })), [{ taskId: spec.taskId, jobId: 'job-before-hmr', status: 'running' }])
})

test('telemetry removes only a corrupt raw HMR task and preserves a truthful session snapshot', async () => {
  const warnings = []
  const shared = {}
  const telemetry = createDispatcherTelemetry(shared, {
    logger: { warn: warning => warnings.push(String(warning)) },
  })
  const spec = plannedPipelineSpec()
  telemetry.startTask(spec)
  const baseline = telemetry.snapshot(spec.parent.id)
  const pending = watchDispatcherTelemetry(
    telemetry,
    spec.parent.id,
    baseline.revision,
    new AbortController().signal,
    10_000,
  )

  telemetry.state.tasks.set('poison-workers', {
    taskId: 'poison-workers',
    sessionId: spec.parent.id,
    lane: 'code',
    title: 'legacy incompatible task',
    status: 'running',
    phase: 'preparing',
    startedAt: 1,
    updatedAt: 1,
    workers: null,
  })
  const repaired = telemetry.snapshot(spec.parent.id)
  const watched = await pending
  for (const snapshot of [repaired, watched]) {
    assert.ok(snapshot.revision > baseline.revision)
    assert.deepEqual(snapshot.tasks.map(task => task.taskId), [spec.taskId])
  }
  assert.equal(telemetry.state.tasks.has('poison-workers'), false)
  assert.equal(telemetry.state.tasks.has(spec.taskId), true)
  assert.equal(shared.telemetry.listeners.has(spec.parent.id), false)

  // A shape that projects without throwing but violates the exact v1 enum is
  // also removed, while RPC still returns the valid task and real revision.
  telemetry.state.tasks.set('poison-phase', {
    taskId: 'poison-phase',
    sessionId: spec.parent.id,
    lane: 'code',
    title: 'legacy enum task',
    status: 'running',
    phase: 'legacy-phase',
    startedAt: 1,
    updatedAt: 1,
    workers: [],
  })
  const response = await createDispatcherTelemetryRpcHandler(telemetry)(
    'snapshot',
    { sessionId: spec.parent.id },
    new AbortController().signal,
  )
  assert.equal(response.ok, true)
  assert.ok(response.value.revision > repaired.revision)
  assert.deepEqual(response.value.tasks.map(task => task.taskId), [spec.taskId])
  assert.equal(telemetry.state.tasks.has('poison-phase'), false)
  telemetry.state.tasks.set('poison-undefined', undefined)
  const afterUndefinedPoison = telemetry.snapshot(spec.parent.id)
  assert.deepEqual(afterUndefinedPoison.tasks.map(task => task.taskId), [spec.taskId])
  assert.equal(telemetry.state.tasks.has('poison-undefined'), false)

  assert.equal(warnings.length, 3)
  assert.match(warnings[0], /discarded corrupt task poison-workers/u)
  assert.match(warnings[1], /discarded corrupt task poison-phase/u)
  assert.match(warnings[2], /discarded corrupt task poison-undefined/u)
})

test('telemetry watch is lossless across subscription, timeout, and cancellation cleanup', async () => {
  const shared = {}
  const telemetry = createDispatcherTelemetry(shared)
  const spec = plannedPipelineSpec()
  telemetry.startTask(spec)
  const baseline = telemetry.snapshot(spec.parent.id)

  const changedPromise = watchDispatcherTelemetry(
    telemetry,
    spec.parent.id,
    baseline.revision,
    new AbortController().signal,
    1_000,
  )
  telemetry.setJobId(spec.taskId, 'subagent-1')
  const changed = await changedPromise
  assert.ok(changed.revision > baseline.revision)
  assert.equal(changed.tasks[0].jobId, 'subagent-1')
  assert.equal(shared.telemetry.listeners.has(spec.parent.id), false)
  assert.equal(shared.telemetry.watchReservations.has(spec.parent.id), false)

  const timedBaseline = telemetry.snapshot(spec.parent.id)
  const timed = await watchDispatcherTelemetry(
    telemetry,
    spec.parent.id,
    timedBaseline.revision,
    new AbortController().signal,
    5,
  )
  assert.equal(timed.revision, timedBaseline.revision)
  assert.equal(shared.telemetry.listeners.has(spec.parent.id), false)
  assert.equal(shared.telemetry.watchReservations.has(spec.parent.id), false)

  const cancelled = new AbortController()
  const cancelledWatch = watchDispatcherTelemetry(
    telemetry,
    spec.parent.id,
    timed.revision,
    cancelled.signal,
    1_000,
  )
  cancelled.abort(new Error('view unmounted'))
  await assert.rejects(cancelledWatch, /view unmounted/u)
  assert.equal(shared.telemetry.listeners.has(spec.parent.id), false)
  assert.equal(shared.telemetry.watchReservations.has(spec.parent.id), false)

  const preAborted = new AbortController()
  preAborted.abort(new Error('view already unmounted'))
  await assert.rejects(
    watchDispatcherTelemetry(telemetry, spec.parent.id, 0, preAborted.signal, 1_000),
    /already unmounted/u,
  )
  assert.equal(shared.telemetry.listeners.has(spec.parent.id), false)

  const reentrantAbort = new AbortController()
  let reentrantSubscriptions = 0
  await assert.rejects(watchDispatcherTelemetry({
    snapshot: sessionId => {
      reentrantAbort.abort(new Error('aborted during snapshot'))
      return {
        protocolVersion: 1,
        revision: 1,
        sessionId,
        generatedAt: 0,
        tasks: [],
      }
    },
    subscribe() {
      reentrantSubscriptions += 1
      return () => {}
    },
  }, 'reentrant-session', 0, reentrantAbort.signal, 1_000), /during snapshot/u)
  assert.equal(reentrantSubscriptions, 0)

  // A mutation in the first-read/subscription window is caught by the recheck.
  let raceRevision = 0
  let raceSubscribed = false
  const raced = await watchDispatcherTelemetry({
    snapshot: sessionId => ({
      protocolVersion: 1,
      revision: raceRevision,
      sessionId,
      generatedAt: 0,
      tasks: [],
    }),
    subscribe(_sessionId, _listener) {
      raceSubscribed = true
      raceRevision = 1
      return () => {
        raceSubscribed = false
        throw new Error('broken unsubscribe')
      }
    },
  }, 'race-session', 0, new AbortController().signal, 1_000)
  assert.equal(raced.revision, 1)
  assert.equal(raceSubscribed, false)

  // A custom registry may eagerly publish during subscribe. Its disposer is
  // returned only after the watch has resolved and still must run once.
  let eagerRevision = 0
  let eagerSubscribed = false
  let eagerDisposeCount = 0
  const eager = await watchDispatcherTelemetry({
    snapshot: sessionId => ({
      protocolVersion: 1,
      revision: eagerRevision,
      sessionId,
      generatedAt: 0,
      tasks: [],
    }),
    subscribe(_sessionId, listener) {
      eagerSubscribed = true
      eagerRevision = 1
      listener()
      return () => {
        eagerSubscribed = false
        eagerDisposeCount += 1
      }
    },
  }, 'eager-session', 0, new AbortController().signal, 1_000)
  assert.equal(eager.revision, 1)
  assert.equal(eagerSubscribed, false)
  assert.equal(eagerDisposeCount, 1)

  let brokenReservations = 0
  await assert.rejects(watchDispatcherTelemetry({
    snapshot: sessionId => ({
      protocolVersion: 1,
      revision: 0,
      sessionId,
      generatedAt: 0,
      tasks: [],
    }),
    reserveWatch() {
      brokenReservations += 1
      return () => { brokenReservations -= 1 }
    },
    subscribe() {
      throw new Error('broken subscribe')
    },
  }, 'broken-session', 0, new AbortController().signal, 1_000), /broken subscribe/u)
  assert.equal(brokenReservations, 0)
})

test('telemetry watch capacity is bounded, shared across HMR, and released on every exit', async () => {
  const shared = {}
  const first = createDispatcherTelemetry(shared)
  const sessionId = 'bounded-watch-session'
  const controllers = Array.from({ length: 8 }, () => new AbortController())
  const watches = controllers.map(controller => watchDispatcherTelemetry(
    first,
    sessionId,
    0,
    controller.signal,
    10_000,
  ))
  assert.equal(shared.telemetry.listeners.get(sessionId).size, 8)
  assert.equal(shared.telemetry.watchReservations.get(sessionId).size, 8)

  const replacement = createDispatcherTelemetry(shared)
  assert.strictEqual(replacement.state.watchReservations, first.state.watchReservations)
  const capacity = await createDispatcherTelemetryRpcHandler(replacement)(
    'watch',
    { sessionId, afterRevision: 0 },
    new AbortController().signal,
  )
  assert.deepEqual(capacity, {
    ok: false,
    error: {
      code: 'internal',
      message: 'task dispatcher telemetry watch capacity exhausted',
      details: {},
    },
  })
  assert.equal(shared.telemetry.listeners.get(sessionId).size, 8)
  assert.equal(shared.telemetry.watchReservations.get(sessionId).size, 8)

  controllers[0].abort(new Error('old HMR watch disposed'))
  await assert.rejects(watches[0], /old HMR watch disposed/u)
  assert.equal(shared.telemetry.watchReservations.get(sessionId).size, 7)
  const refillController = new AbortController()
  const refill = watchDispatcherTelemetry(
    replacement,
    sessionId,
    0,
    refillController.signal,
    10_000,
  )
  assert.equal(shared.telemetry.watchReservations.get(sessionId).size, 8)

  replacement.startTask({
    taskId: 'release-watch-budget',
    parent: { id: sessionId },
    laneId: 'code',
    title: 'release watch budget',
  })
  const changed = await Promise.all([...watches.slice(1), refill])
  assert.equal(changed.every(snapshot => snapshot.revision > 0), true)
  assert.equal(shared.telemetry.listeners.has(sessionId), false)
  assert.equal(shared.telemetry.watchReservations.has(sessionId), false)

  const globalShared = {}
  const globalTelemetry = createDispatcherTelemetry(globalShared)
  const globalControllers = []
  const globalWatches = []
  for (let index = 0; index < 256; index++) {
    const controller = new AbortController()
    globalControllers.push(controller)
    globalWatches.push(watchDispatcherTelemetry(
      globalTelemetry,
      `global-watch-${Math.floor(index / 8)}`,
      0,
      controller.signal,
      10_000,
    ))
  }
  assert.equal(globalShared.telemetry.watchReservations.size, 32)
  assert.equal(
    [...globalShared.telemetry.watchReservations.values()]
      .reduce((total, reservations) => total + reservations.size, 0),
    256,
  )
  await assert.rejects(
    watchDispatcherTelemetry(
      globalTelemetry,
      'global-overflow',
      0,
      new AbortController().signal,
      10_000,
    ),
    /watch capacity exhausted/u,
  )
  globalControllers.forEach(controller => { controller.abort(new Error('global watch cleanup')) })
  await Promise.all(globalWatches.map(watch => assert.rejects(watch, /global watch cleanup/u)))
  assert.equal(globalShared.telemetry.listeners.size, 0)
  assert.equal(globalShared.telemetry.watchReservations.size, 0)
})

test('telemetry RPC has strict payloads, contained RpcResult errors, and optional loopback registration', async () => {
  assert.deepEqual(parseDispatcherTelemetryRpcPayload('snapshot', { sessionId: 'root-1' }), {
    sessionId: 'root-1',
  })
  assert.deepEqual(parseDispatcherTelemetryRpcPayload('watch', {
    sessionId: 'root-1',
    afterRevision: 0,
  }), { sessionId: 'root-1', afterRevision: 0 })
  for (const [endpoint, payload] of [
    ['snapshot', { sessionId: 'root-1', extra: true }],
    ['snapshot', { sessionId: ' root-1' }],
    ['watch', { sessionId: 'root-1', afterRevision: -1 }],
    ['watch', { sessionId: 'root-1', afterRevision: 1.5 }],
    ['unknown', { sessionId: 'root-1' }],
  ]) {
    assert.throws(() => parseDispatcherTelemetryRpcPayload(endpoint, payload), TypeError)
  }

  const telemetry = createDispatcherTelemetry({})
  const handler = createDispatcherTelemetryRpcHandler(telemetry)
  const snapshot = await handler('snapshot', { sessionId: 'root-1' }, new AbortController().signal)
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.value.protocolVersion, 1)

  const invalid = await handler('snapshot', { sessionId: '' }, new AbortController().signal)
  assert.deepEqual(invalid, {
    ok: false,
    error: {
      code: 'bad-request',
      message: 'task dispatcher RPC sessionId must be a non-empty trimmed string of at most 256 characters',
      details: { issues: [] },
    },
  })
  const aborted = new AbortController()
  aborted.abort()
  telemetry.startTask({
    taskId: 'newer-than-aborted-watch',
    parent: { id: 'root-1' },
    laneId: 'code',
    title: 'newer than aborted watch',
  })
  const cancelled = await handler('watch', {
    sessionId: 'root-1',
    afterRevision: 0,
  }, aborted.signal)
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.error.code, 'cancelled')

  const internal = await createDispatcherTelemetryRpcHandler({
    snapshot() { throw new Error('snapshot failed') },
  })('snapshot', { sessionId: 'root-1' }, new AbortController().signal)
  assert.deepEqual(internal, {
    ok: false,
    error: { code: 'internal', message: 'snapshot failed', details: {} },
  })
  const internalTypeError = await createDispatcherTelemetryRpcHandler({
    snapshot() { throw new TypeError('corrupt read model') },
  })('snapshot', { sessionId: 'root-1' }, new AbortController().signal)
  assert.deepEqual(internalTypeError, {
    ok: false,
    error: { code: 'internal', message: 'corrupt read model', details: {} },
  })

  let registration
  const ctx = {
    logger: { warn() {} },
    inject(dependencies, callback) {
      assert.deepEqual(dependencies, ['connection'])
      callback({
        logger: this.logger,
        connection: {
          rpc: {
            handle(channel, registeredHandler, options) {
              registration = { channel, registeredHandler, options }
            },
          },
        },
      })
    },
  }
  registerDispatcherTelemetryRpc(ctx, telemetry)
  assert.equal(registration.channel, '/task-dispatcher')
  assert.deepEqual(registration.options, { authority: 'loopback' })
  assert.equal((await registration.registeredHandler(
    'snapshot',
    { sessionId: 'root-1' },
    new AbortController().signal,
  )).ok, true)
  assert.doesNotThrow(() => registerDispatcherTelemetryRpc({ logger: { warn() {} } }, telemetry))
  assert.doesNotThrow(() => registerDispatcherTelemetryRpc({
    logger: { warn() { throw new Error('logger failed') } },
    inject(_dependencies, callback) {
      callback({
        logger: this.logger,
        connection: { rpc: { handle() { throw new Error('route collision') } } },
      })
    },
  }, telemetry))
})

test('runStructuredChild forwards the exact route, tools, schema, and parent contract', async () => {
  const route = { provider: 'provider-a', model: 'model-a', maxTokens: 4321 }
  const tools = ['read', 'grep']
  const parent = { id: 'root' }
  const structured = { answer: 42 }
  const child = childRun('child-1', structured)
  let call
  const ctx = {
    subagents: {
      start(transport, request) {
        call = { transport, request }
        return child.run
      },
    },
  }
  const outputSchema = { type: 'object', required: ['answer'] }
  const result = await runStructuredChild(ctx, {
    transport: 'fork',
    label: 'exact forwarding',
    prompt: 'Do the bounded task.',
    parent,
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    route,
    tools,
    outputSchema,
    persona: 'Exact persona.',
    validate: value => value,
  })

  assert.deepEqual(result, { ok: true, runId: 'child-1', report: structured })
  assert.equal(call.transport, 'fork')
  assert.strictEqual(call.request.parent, parent)
  assert.strictEqual(call.request.agentOptions, route)
  assert.strictEqual(call.request.outputSchema, outputSchema)
  assert.deepEqual(call.request.prompt, [{ type: 'text', text: 'Do the bounded task.' }])
  assert.deepEqual(call.request.toolFilter, { allow: tools })
  assert.equal(call.request.maxDepth, 1)
  assert.equal(call.request.persona, 'Exact persona.')
  assert.ok(call.request.signal instanceof AbortSignal)
  assert.equal(child.disposals(), 1)
})

test('runStructuredChild contains child stop, rejection, disposal, cancellation, and timeout failures', async (t) => {
  const base = {
    transport: 'spawn',
    label: 'failure boundary',
    prompt: 'Task.',
    parent: { id: 'root' },
    timeoutMs: 1_000,
    route: { provider: 'p', model: 'm', maxTokens: 100 },
    tools: [],
    outputSchema: { type: 'object' },
    persona: 'persona',
    validate: value => value,
  }

  await t.test('abnormal stop is structured and disposed exactly once', async () => {
    const child = childRun('refused', undefined, {
      stopReason: 'refusal',
      output: [{ type: 'text', text: 'policy refusal' }],
    })
    const result = await runStructuredChild(
      { subagents: { start: () => child.run } },
      { ...base, signal: new AbortController().signal },
    )
    assert.equal(result.ok, false)
    assert.equal(result.kind, 'error')
    assert.match(result.error, /refused.*policy refusal/u)
    assert.equal(child.disposals(), 1)
  })

  await t.test('start rejection is observed', async () => {
    const result = await runStructuredChild(
      { subagents: { start: () => { throw new Error('start exploded') } } },
      { ...base, signal: new AbortController().signal },
    )
    assert.deepEqual(result, {
      ok: false,
      kind: 'error',
      error: 'start exploded',
      infrastructureFailure: true,
    })
  })

  await t.test('result rejection is observed and disposed', async () => {
    const child = childRun('result-error', undefined, {
      result: Promise.resolve().then(() => { throw new Error('result exploded') }),
    })
    const result = await runStructuredChild(
      { subagents: { start: () => child.run } },
      { ...base, signal: new AbortController().signal },
    )
    assert.equal(result.ok, false)
    assert.equal(result.error, 'result exploded')
    assert.equal(child.disposals(), 1)
  })

  await t.test('dispose rejection overrides a nominal success', async () => {
    const child = childRun('dispose-error', { ok: true }, { disposeError: new Error('dispose exploded') })
    const result = await runStructuredChild(
      { subagents: { start: () => child.run } },
      { ...base, signal: new AbortController().signal },
    )
    assert.equal(result.ok, false)
    assert.match(result.error, /child cleanup failed: dispose exploded/u)
    assert.equal(result.quarantine, true)
    assert.equal(child.disposals(), 1)
  })

  await t.test('parent cancellation becomes cancelled', async () => {
    const controller = new AbortController()
    const child = childRun('cancelled', undefined, { result: new Promise(() => {}) })
    const pending = runStructuredChild(
      { subagents: { start: () => child.run } },
      { ...base, signal: controller.signal },
    )
    controller.abort(new Error('stop'))
    const result = await pending
    assert.equal(result.ok, false)
    assert.equal(result.kind, 'cancelled')
    assert.match(result.error, /was cancelled/u)
    assert.equal(child.disposals(), 1)
  })

  await t.test('parent cancellation during cleanup cannot return success', async () => {
    const controller = new AbortController()
    let disposals = 0
    const run = {
      id: 'cancelled-during-cleanup',
      result: Promise.resolve({
        output: [],
        structured: { ok: true },
        stopReason: 'completed',
      }),
      async dispose() {
        disposals += 1
        await new Promise(resolvePromise => setTimeout(resolvePromise, 30))
      },
    }
    const pending = runStructuredChild(
      { subagents: { start: () => run } },
      { ...base, signal: controller.signal },
    )
    setTimeout(() => controller.abort(new Error('stop during cleanup')), 10)
    const result = await pending
    assert.equal(result.ok, false)
    assert.equal(result.kind, 'cancelled')
    assert.match(result.error, /was cancelled/u)
    assert.equal(result.quarantine, undefined)
    assert.equal(disposals, 1)
  })

  await t.test('deadline becomes a bounded timeout and disposes the run', async () => {
    const child = childRun('timed-out', undefined, { result: new Promise(() => {}) })
    const result = await runStructuredChild(
      { subagents: { start: () => child.run } },
      { ...base, signal: new AbortController().signal, timeoutMs: 20 },
    )
    assert.equal(result.ok, false)
    assert.equal(result.kind, 'error')
    assert.match(result.error, /timed out after 20ms/u)
    assert.equal(child.disposals(), 1)
  })

  await t.test('deadline before child publication quarantines until process restart', async () => {
    const child = childRun('published-late', { ok: true })
    const start = new Promise(resolvePromise => {
      setTimeout(() => resolvePromise(child.run), 40)
    })
    const result = await runStructuredChild(
      { subagents: { start: () => start } },
      { ...base, signal: new AbortController().signal, timeoutMs: 10 },
    )
    assert.equal(result.ok, false)
    assert.equal(result.quarantine, true)
    assert.equal(child.disposals(), 0)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 45))
    assert.equal(child.disposals(), 1)
  })
})

test('runTaskPipeline accepts only after executor and independent verifier with exact forwarding', async () => {
  const spec = pipelineSpec()
  const children = [
    childRun('executor-1', executorReport()),
    childRun('verifier-1', verifierReport()),
  ]
  const calls = []
  const ctx = {
    logger: { warn() {} },
    subagents: {
      start(transport, request) {
        calls.push({ transport, request })
        return children[calls.length - 1].run
      },
    },
  }
  const result = await runTaskPipeline(ctx, spec, new AbortController().signal)

  assert.equal(result.status, 'accepted')
  assert.equal(result.modelVerified, true)
  assert.equal(result.attempts, 1)
  assert.deepEqual(result.executorRuns.map(item => item.runId), ['executor-1'])
  assert.deepEqual(result.verifierRuns.map(item => item.runId), ['verifier-1'])
  assert.equal(calls.length, 2)
  assert.equal(calls[0].transport, spec.lane.transport)
  assert.strictEqual(calls[0].request.agentOptions, spec.lane.executor)
  assert.strictEqual(calls[0].request.outputSchema, EXECUTOR_OUTPUT_SCHEMA)
  assert.deepEqual(calls[0].request.toolFilter, { allow: spec.lane.executorTools })
  assert.strictEqual(calls[1].request.agentOptions, spec.lane.verifier)
  assert.strictEqual(calls[1].request.outputSchema, VERIFIER_OUTPUT_SCHEMA)
  assert.deepEqual(calls[1].request.toolFilter, { allow: spec.lane.verifierTools })
  assert.notEqual(calls[0].request.signal, calls[1].request.signal)
  assert.equal(children[0].disposals(), 1)
  assert.equal(children[1].disposals(), 1)
})

test('runTaskPipeline performs only explicitly enabled bounded revisions and carries prior evidence forward', async () => {
  const revise = verifierReport(['requirements'], {
    decision: 'revise',
    summary: 'Needs another attempt.',
    criteria: [{ id: 'requirements', status: 'fail', evidence: 'Test failed.' }],
    feedback: 'Fix the failing test.',
  })
  const spec = pipelineSpec({ lane: { maxAttempts: 2, retryOnRevise: true } })
  const children = [
    childRun('executor-1', executorReport()),
    childRun('verifier-1', revise),
    childRun('executor-2', executorReport({ summary: 'Second attempt.' })),
    childRun('verifier-2', revise),
  ]
  const calls = []
  const ctx = {
    logger: { warn() {} },
    subagents: {
      start(_transport, request) {
        calls.push(request)
        return children[calls.length - 1].run
      },
    },
  }
  const telemetry = createDispatcherTelemetry({})
  telemetry.startTask(spec)

  const result = await runTaskPipeline(ctx, spec, new AbortController().signal, ctx.logger, telemetry)
  telemetry.finishTask(spec.taskId, result)
  assert.equal(result.status, 'rejected')
  assert.equal(result.modelVerified, false)
  assert.equal(result.attempts, 2)
  assert.equal(calls.length, 4)
  assert.match(calls[2].prompt[0].text, /previous_attempt_json/u)
  assert.match(calls[2].prompt[0].text, /Fix the failing test\./u)
})

test('runTaskPipeline does not repeat executor side effects unless the lane opts in', async () => {
  const revise = verifierReport(['requirements'], {
    decision: 'revise',
    summary: 'A second attempt could help.',
    criteria: [{ id: 'requirements', status: 'fail', evidence: 'A gap remains.' }],
    feedback: 'Try again.',
  })
  const children = [childRun('executor', executorReport()), childRun('verifier', revise)]
  let calls = 0
  const result = await runTaskPipeline(
    { logger: { warn() {} }, subagents: { start: () => children[calls++].run } },
    pipelineSpec({ lane: { maxAttempts: 3, retryOnRevise: false } }),
    new AbortController().signal,
  )

  assert.equal(result.status, 'rejected')
  assert.equal(result.attempts, 1)
  assert.equal(calls, 2)
})

test('runTaskPipeline rechecks a mutating sandbox before a revision attempt', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-dispatcher-retry-workspace-'))
  const live = dirname(realpathSync.native(process.execPath))
  const revise = verifierReport(['requirements'], {
    decision: 'revise',
    summary: 'Needs another attempt.',
    criteria: [{ id: 'requirements', status: 'fail', evidence: 'A gap remains.' }],
    feedback: 'Revise it.',
  })
  const children = [childRun('executor-1', executorReport()), childRun('verifier-1', revise)]
  let calls = 0
  let mode = 'workspace-write'
  const spec = pipelineSpec({
    lane: { executorTools: ['read', 'write'], maxAttempts: 2, retryOnRevise: true },
    parent: { id: 'root-1', session: { header: { cwd: workspace } } },
    workspace,
    liveRoot: live,
  })
  const ctx = {
    logger: { warn() {} },
    sandboxPolicy: { resolve: () => ({ mode, workspaceRoot: workspace }) },
    subagents: {
      start() {
        const child = children[calls++]
        if (calls === 2) mode = 'danger-full-access'
        return child.run
      },
    },
  }
  try {
    const result = await runTaskPipeline(ctx, spec, new AbortController().signal)
    assert.equal(result.status, 'error')
    assert.match(result.message, /workspace-write sandbox mode/u)
    assert.equal(calls, 2)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('runTaskPipeline does not retry reject and never rejects on unexpected prompt failure', async () => {
  const rejected = verifierReport(['requirements'], {
    decision: 'reject',
    summary: 'Final result is unacceptable.',
    criteria: [{ id: 'requirements', status: 'fail', evidence: 'Regression remains.' }],
    feedback: 'Do not retry.',
  })
  const queue = [childRun('executor', executorReport()), childRun('verifier', rejected)]
  let calls = 0
  const ctx = {
    logger: { warn() {} },
    subagents: { start: () => queue[calls++].run },
  }
  const result = await runTaskPipeline(ctx, pipelineSpec(), new AbortController().signal)
  assert.equal(result.status, 'rejected')
  assert.equal(result.attempts, 1)
  assert.equal(calls, 2)

  const circular = {}
  circular.self = circular
  const containedPromise = runTaskPipeline(
    { logger: { warn() {} }, subagents: { start() { throw new Error('must not start') } } },
    pipelineSpec({ context: circular }),
    new AbortController().signal,
  )
  await assert.doesNotReject(containedPromise)
  const contained = await containedPromise
  assert.equal(contained.status, 'error')
  assert.equal(contained.modelVerified, false)
})

test('adaptive master plan runs two steps with an intervening keep decision and a final verifier', async () => {
  const spec = plannedPipelineSpec()
  const children = [
    childRun('planner-initial', twoStepPlan()),
    childRun('plan-review-initial', planReviewReport()),
    childRun('inspect-executor', executorReport({
      summary: 'Inspection completed.',
      artifacts: [],
      criteria: [{ id: 'inspect-ok', status: 'pass', evidence: 'Inspection evidence.' }],
    })),
    childRun('inspect-verifier', verifierReport(['inspect-ok'])),
    childRun('replanner-keep', {
      baseRevision: 3,
      action: 'keep',
      rationale: 'The implementation step is still the correct next action.',
      steps: [],
    }),
    childRun('implement-executor', executorReport({
      summary: 'Implementation completed.',
      criteria: [{ id: 'implement-ok', status: 'pass', evidence: 'Implementation test passed.' }],
    })),
    childRun('implement-verifier', verifierReport(['implement-ok'])),
    childRun('final-verifier', verifierReport(['requirements'])),
  ]
  const calls = []
  const ctx = {
    logger: { warn() {} },
    subagents: {
      start(transport, request) {
        calls.push({ transport, request })
        const child = children[calls.length - 1]
        assert.ok(child, `unexpected child start ${calls.length}: ${request.label}`)
        return child.run
      },
    },
  }
  const telemetry = createDispatcherTelemetry({})
  telemetry.startTask(spec)
  const result = await runTaskPipeline(
    ctx,
    spec,
    new AbortController().signal,
    ctx.logger,
    telemetry,
  )
  telemetry.finishTask(spec.taskId, result)

  assert.equal(result.status, 'accepted')
  assert.equal(result.modelVerified, true)
  assert.equal(result.attempts, 2)
  assert.deepEqual(calls.map(call => call.request.label), [
    `${spec.title} / initial planner`,
    `${spec.title} / initial plan review`,
    `${spec.title} / inspect executor 1`,
    `${spec.title} / inspect verifier 1`,
    `${spec.title} / replanner 2`,
    `${spec.title} / implement executor 1`,
    `${spec.title} / implement verifier 1`,
    `${spec.title} / final verifier`,
  ])
  assert.deepEqual(calls.map(call => call.request.outputSchema), [
    INITIAL_PLAN_OUTPUT_SCHEMA,
    PLAN_REVIEW_OUTPUT_SCHEMA,
    EXECUTOR_OUTPUT_SCHEMA,
    VERIFIER_OUTPUT_SCHEMA,
    PLAN_PATCH_OUTPUT_SCHEMA,
    EXECUTOR_OUTPUT_SCHEMA,
    VERIFIER_OUTPUT_SCHEMA,
    VERIFIER_OUTPUT_SCHEMA,
  ])
  assert.strictEqual(calls[0].request.agentOptions, spec.lane.planner)
  assert.strictEqual(calls[4].request.agentOptions, spec.lane.planner)
  assert.deepEqual(calls[0].request.toolFilter, { allow: spec.lane.plannerTools })
  assert.deepEqual(calls[4].request.toolFilter, { allow: spec.lane.plannerTools })
  assert.strictEqual(calls[2].request.agentOptions, spec.lane.executor)
  assert.strictEqual(calls[5].request.agentOptions, spec.lane.executor)
  assert.strictEqual(calls[1].request.agentOptions, spec.lane.verifier)
  assert.strictEqual(calls[7].request.agentOptions, spec.lane.verifier)
  assert.match(calls[2].request.prompt[0].text, /"id": "inspect"/u)
  assert.match(calls[5].request.prompt[0].text, /"id": "implement"/u)

  assert.deepEqual(result.plannerRuns.map(run => [run.phase, run.runId]), [
    ['initial-plan', 'planner-initial'],
    ['replan', 'replanner-keep'],
  ])
  assert.deepEqual(result.planReviewRuns.map(run => [run.phase, run.runId]), [
    ['initial-plan-review', 'plan-review-initial'],
  ])
  assert.deepEqual(result.executorRuns.map(run => [run.stepId, run.runId]), [
    ['inspect', 'inspect-executor'],
    ['implement', 'implement-executor'],
  ])
  assert.deepEqual(result.verifierRuns.map(run => [run.phase, run.stepId, run.runId]), [
    ['step-verifier', 'inspect', 'inspect-verifier'],
    ['step-verifier', 'implement', 'implement-verifier'],
    ['final-verification', undefined, 'final-verifier'],
  ])
  assert.equal(result.masterPlan.status, 'accepted')
  assert.equal(result.masterPlan.revision, 6)
  assert.equal(result.masterPlan.patchCount, 0)
  assert.deepEqual(result.masterPlan.steps.map(step => [step.id, step.status, step.attempts]), [
    ['inspect', 'completed', 1],
    ['implement', 'completed', 1],
  ])
  assert.deepEqual(result.masterPlan.history.map(event => event.kind), [
    'created',
    'step_started',
    'step_completed',
    'step_started',
    'step_completed',
    'finished',
  ])
  assert.deepEqual(result.masterPlan.history.map(event => event.revision), [1, 2, 3, 4, 5, 6])
  assert.deepEqual(
    validateAgainstSchema(result.masterPlan, MASTER_PLAN_RESULT_SCHEMA),
    [],
    'the actual accepted pipeline masterPlan must satisfy the public result schema',
  )
  const readModel = telemetry.snapshot(spec.parent.id).tasks[0]
  assert.deepEqual(readModel.masterPlan.steps.map(step => [step.id, step.status, step.dependsOn]), [
    ['inspect', 'completed', []],
    ['implement', 'completed', ['inspect']],
  ])
  assert.deepEqual(readModel.workers.map(worker => [
    worker.role,
    worker.phase,
    worker.agentId,
    worker.provider,
    worker.model,
    worker.status,
  ]), [
    ['planner', 'initial-plan', 'planner-initial', 'planner-provider', 'planner-model', 'completed'],
    ['plan-reviewer', 'initial-plan-review', 'plan-review-initial', 'verifier-provider', 'verifier-model', 'completed'],
    ['executor', 'step-executor', 'inspect-executor', 'executor-provider', 'executor-model', 'completed'],
    ['verifier', 'step-verifier', 'inspect-verifier', 'verifier-provider', 'verifier-model', 'completed'],
    ['replanner', 'replan', 'replanner-keep', 'planner-provider', 'planner-model', 'completed'],
    ['executor', 'step-executor', 'implement-executor', 'executor-provider', 'executor-model', 'completed'],
    ['verifier', 'step-verifier', 'implement-verifier', 'verifier-provider', 'verifier-model', 'completed'],
    ['final-verifier', 'final-verification', 'final-verifier', 'verifier-provider', 'verifier-model', 'completed'],
  ])
  for (const child of children) assert.equal(child.disposals(), 1)
})

test('master-plan telemetry failures never change an accepted pipeline result', async () => {
  const spec = plannedPipelineSpec()
  const children = [
    childRun('planner-contained', {
      summary: 'Complete the bounded implementation in one independently verified step.',
      steps: [planStep('implement', {
        covers: ['requirements'],
        deliverableIds: ['code'],
      })],
    }),
    childRun('plan-review-contained', planReviewReport()),
    childRun('executor-contained', executorReport({
      criteria: [{ id: 'implement-ok', status: 'pass', evidence: 'Implementation passed.' }],
    })),
    childRun('step-verifier-contained', verifierReport(['implement-ok'])),
    childRun('final-verifier-contained', verifierReport(['requirements'])),
  ]
  const warnings = []
  let publications = 0
  const telemetry = {
    startWorker() { return 'contained-worker' },
    updateWorker() {},
    finishWorker() {},
    setMasterPlan() {
      publications += 1
      if (publications % 2 === 1) throw new Error(`sync telemetry failure ${publications}`)
      return Promise.reject(new Error(`async telemetry failure ${publications}`))
    },
  }
  let starts = 0
  const ctx = {
    logger: { warn: warning => warnings.push(String(warning)) },
    subagents: {
      start() {
        const child = children[starts]
        starts += 1
        assert.ok(child)
        return child.run
      },
    },
  }

  const result = await runTaskPipeline(
    ctx,
    spec,
    new AbortController().signal,
    ctx.logger,
    telemetry,
  )
  await Promise.resolve()
  assert.equal(result.status, 'accepted')
  assert.equal(result.modelVerified, true)
  assert.equal(publications, 4)
  assert.equal(warnings.length, 4)
  assert.equal(warnings.every(warning => warning.includes('telemetry contained failure')), true)
  for (const child of children) assert.equal(child.disposals(), 1)
})

test('adaptive replanning replaces only the pending suffix before executing the replacement', async () => {
  const spec = plannedPipelineSpec()
  const replacement = planStep('repair', { deliverableIds: ['code'] })
  const children = [
    childRun('planner-initial', twoStepPlan()),
    childRun('plan-review-initial', planReviewReport()),
    childRun('inspect-executor', executorReport({
      artifacts: [],
      criteria: [{ id: 'inspect-ok', status: 'pass', evidence: 'Inspection evidence.' }],
    })),
    childRun('inspect-verifier', verifierReport(['inspect-ok'])),
    childRun('replanner-replace', {
      baseRevision: 3,
      action: 'replace_pending',
      rationale: 'Inspection showed that a focused repair should replace the generic implementation step.',
      steps: [replacement],
    }),
    childRun('plan-review-replacement', planReviewReport()),
    childRun('repair-executor', executorReport({
      summary: 'Focused repair completed.',
      criteria: [{ id: 'repair-ok', status: 'pass', evidence: 'Repair regression test passed.' }],
    })),
    childRun('repair-verifier', verifierReport(['repair-ok'])),
    childRun('final-verifier', verifierReport(['requirements'])),
  ]
  const calls = []
  const ctx = {
    logger: { warn() {} },
    subagents: {
      start(_transport, request) {
        calls.push(request)
        const child = children[calls.length - 1]
        assert.ok(child, `unexpected child start ${calls.length}: ${request.label}`)
        return child.run
      },
    },
  }

  const result = await runTaskPipeline(ctx, spec, new AbortController().signal)

  assert.equal(result.status, 'accepted')
  assert.deepEqual(calls.map(call => call.label), [
    `${spec.title} / initial planner`,
    `${spec.title} / initial plan review`,
    `${spec.title} / inspect executor 1`,
    `${spec.title} / inspect verifier 1`,
    `${spec.title} / replanner 2`,
    `${spec.title} / plan patch review 2`,
    `${spec.title} / repair executor 1`,
    `${spec.title} / repair verifier 1`,
    `${spec.title} / final verifier`,
  ])
  assert.equal(calls.some(call => /implement executor/u.test(call.label)), false)
  assert.deepEqual(result.masterPlan.steps.map(step => [step.id, step.status]), [
    ['inspect', 'completed'],
    ['repair', 'completed'],
  ])
  assert.equal(result.masterPlan.patchCount, 1)
  assert.equal(result.masterPlan.revision, 7)
  assert.deepEqual(result.masterPlan.history.map(event => event.kind), [
    'created',
    'step_started',
    'step_completed',
    'revised',
    'step_started',
    'step_completed',
    'finished',
  ])
  assert.deepEqual(result.masterPlan.history[3], {
    revision: 4,
    kind: 'revised',
    rationale: 'Inspection showed that a focused repair should replace the generic implementation step.',
    added: ['repair'],
    removed: ['implement'],
    order: ['repair'],
  })
  assert.deepEqual(result.planReviewRuns.map(run => run.phase), [
    'initial-plan-review',
    'plan-patch-review',
  ])
  assert.deepEqual(result.executorRuns.map(run => run.stepId), ['inspect', 'repair'])
  assert.deepEqual(result.verifierRuns.map(run => run.phase), [
    'step-verifier',
    'step-verifier',
    'final-verification',
  ])
})

test('patch-review veto: reject and blocked decisions prevent commit and keep pending suffix', async (t) => {
  for (const veto of [
    { decision: 'reject',  terminal: 'rejected',  label: 'reject' },
    { decision: 'blocked', terminal: 'blocked',   label: 'blocked' },
  ]) {
    await t.test(veto.label, async () => {
      const spec = plannedPipelineSpec()
      const replacement = planStep('repair', { deliverableIds: ['code'] })
      const children = [
        childRun('planner-initial', twoStepPlan()),
        childRun('plan-review-initial', planReviewReport()),
        childRun('inspect-executor', executorReport({
          artifacts: [],
          criteria: [{ id: 'inspect-ok', status: 'pass', evidence: 'Inspection evidence.' }],
        })),
        childRun('inspect-verifier', verifierReport(['inspect-ok'])),
        childRun('replanner-replace', {
          baseRevision: 3,
          action: 'replace_pending',
          rationale: 'Inspection showed that a focused repair should replace the generic implementation step.',
          steps: [replacement],
        }),
        childRun('plan-review-veto', planReviewReport({
          decision: veto.decision,
          summary: `Patch review ${veto.label}.`,
          issues: ['Scope concern.'],
        })),
      ]
      const calls = []
      const ctx = {
        logger: { warn() {} },
        subagents: {
          start(_transport, request) {
            calls.push(request)
            const child = children[calls.length - 1]
            assert.ok(child, `unexpected child start ${calls.length}: ${request.label}`)
            return child.run
          },
        },
      }

      const result = await runTaskPipeline(ctx, spec, new AbortController().signal)

      assert.equal(result.status, veto.terminal)
      // No commit: patch is not applied, no replacement executor starts
      assert.equal(calls.length, 6, `expected 6 child starts for ${veto.label}`)
      assert.equal(calls.some(call => /repair executor/u.test(call.label)), false, 'no replacement executor starts')
      // patchCount stays 0
      assert.equal(result.masterPlan.patchCount, 0, 'patchCount remains 0')
      // Original pending suffix remains
      assert.deepEqual(result.masterPlan.steps.map(step => [step.id, step.status]), [
        ['inspect', 'completed'],
        ['implement', 'pending'],
      ], 'original pending suffix unchanged')
      // No revised history appears
      assert.equal(result.masterPlan.history.filter(event => event.kind === 'revised').length, 0, 'no revised event')
      // Final event is finished with matching terminal status
      const terminal = result.masterPlan.history.at(-1)
      assert.equal(terminal.kind, 'finished')
      assert.equal(terminal.status, veto.terminal)
      // Plan-level status matches
      assert.equal(result.masterPlan.status, veto.terminal)
      // planReviewRuns has the veto phase
      assert.deepEqual(result.planReviewRuns.map(run => run.phase), [
        'initial-plan-review',
        'plan-patch-review',
      ])
    })
  }
})

test('adaptive planning reserves mandatory child slots before optional replanning', async () => {
  const spec = plannedPipelineSpec({ lane: { maxTotalChildRuns: 7 } })
  const children = [
    childRun('planner-initial', twoStepPlan()),
    childRun('plan-review-initial', planReviewReport()),
    childRun('inspect-executor', executorReport({
      artifacts: [],
      criteria: [{ id: 'inspect-ok', status: 'pass', evidence: 'Inspection evidence.' }],
    })),
    childRun('inspect-verifier', verifierReport(['inspect-ok'])),
    childRun('implement-executor', executorReport({
      criteria: [{ id: 'implement-ok', status: 'pass', evidence: 'Implementation evidence.' }],
    })),
    childRun('implement-verifier', verifierReport(['implement-ok'])),
    childRun('final-verifier', verifierReport(['requirements'])),
  ]
  const calls = []
  const result = await runTaskPipeline({
    logger: { warn() {} },
    subagents: {
      start(_transport, request) {
        calls.push(request)
        return children[calls.length - 1].run
      },
    },
  }, spec, new AbortController().signal)

  assert.equal(result.status, 'accepted')
  assert.equal(calls.length, 7)
  assert.equal(calls.some(call => /replanner/u.test(call.label)), false)
  assert.equal(calls.at(-1).label, `${spec.title} / final verifier`)
})

test('adaptive planning does not spend mandatory child slots on a step retry', async () => {
  const spec = plannedPipelineSpec({
    lane: {
      maxTotalChildRuns: 7,
      maxPlanPatches: 0,
      retryOnRevise: true,
      maxAttempts: 2,
    },
  })
  const children = [
    childRun('planner-initial', twoStepPlan()),
    childRun('plan-review-initial', planReviewReport()),
    childRun('inspect-executor', executorReport({
      artifacts: [],
      criteria: [{ id: 'inspect-ok', status: 'unknown', evidence: '' }],
    })),
    childRun('inspect-verifier', verifierReport(['inspect-ok'], {
      decision: 'revise',
      summary: 'Inspection evidence is incomplete.',
      criteria: [{ id: 'inspect-ok', status: 'fail', evidence: 'No concrete evidence.' }],
      feedback: 'Collect concrete inspection evidence.',
    })),
  ]
  const calls = []
  const result = await runTaskPipeline({
    logger: { warn() {} },
    subagents: {
      start(_transport, request) {
        calls.push(request)
        return children[calls.length - 1].run
      },
    },
  }, spec, new AbortController().signal)

  assert.equal(result.status, 'rejected')
  assert.equal(calls.length, 4)
  assert.deepEqual(result.executorRuns.map(run => run.stepId), ['inspect'])
  assert.equal(result.masterPlan.steps[0].attempts, 1)
})

test('adaptive planning checks a mutating boundary before recording step start', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-dispatcher-plan-boundary-'))
  const live = dirname(realpathSync.native(process.execPath))
  const spec = plannedPipelineSpec({
    lane: {
      executorTools: ['read', 'write'],
      maxPlanSteps: 1,
      maxPlanPatches: 0,
      maxTotalChildRuns: 5,
    },
    parent: { id: 'root-1', session: { header: { cwd: workspace } } },
    workspace,
    liveRoot: live,
  })
  const initial = twoStepPlan({
    steps: [planStep('implement', { covers: ['requirements'], deliverableIds: ['code'] })],
  })
  const children = [
    childRun('planner-initial', initial),
    childRun('plan-review-initial', planReviewReport()),
  ]
  let starts = 0
  let mode = 'workspace-write'
  const ctx = {
    logger: { warn() {} },
    sandboxPolicy: { resolve: () => ({ mode, workspaceRoot: workspace }) },
    subagents: {
      start() {
        const child = children[starts++]
        if (starts === 2) mode = 'danger-full-access'
        return child.run
      },
    },
  }
  try {
    const result = await runTaskPipeline(ctx, spec, new AbortController().signal)
    assert.equal(result.status, 'error')
    assert.match(result.message, /workspace-write sandbox mode/u)
    assert.equal(starts, 2)
    assert.equal(result.attempts, 0)
    assert.equal(result.masterPlan.steps[0].attempts, 0)
    assert.deepEqual(result.masterPlan.history.map(event => event.kind), ['created', 'finished'])
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('final remediation starts only when both step and child budgets can finish it', async (t) => {
  for (const example of [
    { name: 'two remaining child slots', maxPlanSteps: 2, maxTotalChildRuns: 7 },
    { name: 'no remaining active step slot', maxPlanSteps: 1, maxTotalChildRuns: 10 },
  ]) {
    await t.test(example.name, async () => {
      const spec = plannedPipelineSpec({
        lane: {
          maxPlanSteps: example.maxPlanSteps,
          maxTotalChildRuns: example.maxTotalChildRuns,
          retryOnRevise: true,
        },
      })
      const initial = twoStepPlan({
        steps: [planStep('calculate', { covers: ['requirements'], deliverableIds: ['code'] })],
      })
      const children = [
        childRun('planner-initial', initial),
        childRun('plan-review-initial', planReviewReport()),
        childRun('calculate-executor', executorReport({
          criteria: [{ id: 'calculate-ok', status: 'pass', evidence: 'Calculation evidence.' }],
        })),
        childRun('calculate-verifier', verifierReport(['calculate-ok'])),
        childRun('final-verifier', verifierReport(['requirements'], {
          decision: 'revise',
          summary: 'A remediation step would be useful.',
          criteria: [{ id: 'requirements', status: 'fail', evidence: 'Final gap.' }],
          feedback: 'Add remediation.',
        })),
      ]
      const calls = []
      const result = await runTaskPipeline({
        logger: { warn() {} },
        subagents: {
          start(_transport, request) {
            calls.push(request)
            return children[calls.length - 1].run
          },
        },
      }, spec, new AbortController().signal)

      assert.equal(result.status, 'rejected')
      assert.equal(calls.length, 5)
      assert.equal(calls.some(call => /replanner/u.test(call.label)), false)
      assert.match(result.message, /A remediation step would be useful/u)
    })
  }
})

test('legacy lanes are not shortened by the planner-only whole-task deadline', async () => {
  const spec = pipelineSpec({ lane: { taskTimeoutMs: 1 } })
  const reports = [executorReport(), verifierReport()]
  let starts = 0
  const result = await runTaskPipeline({
    logger: { warn() {} },
    subagents: {
      start() {
        const structured = reports[starts++]
        return {
          id: `legacy-${starts}`,
          result: new Promise((resolvePromise) => {
            setTimeout(() => resolvePromise({ output: [], structured, stopReason: 'completed' }), 10)
          }),
          dispose() {},
        }
      },
    },
  }, spec, new AbortController().signal)

  assert.equal(result.status, 'accepted')
  assert.equal(starts, 2)
})

test('the tool timeout covers the longest valid legacy pipeline lifecycle', () => {
  const definition = createDispatcherTool({ config: { lanes: {} } })
  const maxLegacyLifecycle = 2 * 3 * (60 * 60 * 1_000 + 10_000)
  assert.ok(definition.timeoutMs >= maxLegacyLifecycle + 30_000)
})

test('createDispatcherTool wires MASTER_PLAN_RESULT_SCHEMA by identity into foreground dispatch_task output', () => {
  const definition = createDispatcherTool({ config: { lanes: {} } })
  // The output schema is TOOL_OUTPUT_SCHEMA which has foreground.task.masterPlan
  // Verify that foreground.task.masterPlan is exactly the MASTER_PLAN_RESULT_SCHEMA reference
  const output = definition.output.schema
  // TOOL_OUTPUT_SCHEMA is a oneOf; find the foreground variant
  const foregroundVariant = output.oneOf.find(v => v.properties?.kind?.const === 'foreground')
  assert.ok(foregroundVariant, 'foreground variant exists')
  const taskSchema = foregroundVariant.properties.task
  // TASK_RESULT_SCHEMA properties includes masterPlan: MASTER_PLAN_RESULT_SCHEMA
  const masterPlanProp = taskSchema.properties.masterPlan
  assert.strictEqual(masterPlanProp, MASTER_PLAN_RESULT_SCHEMA,
    'foreground task.masterPlan is exactly the exported MASTER_PLAN_RESULT_SCHEMA by identity')
})

test('a planned task deadline preserves infrastructure quarantine classification', async () => {
  const spec = plannedPipelineSpec({ lane: { taskTimeoutMs: 20 } })
  const result = await runTaskPipeline({
    logger: { warn() {} },
    subagents: {
      start() {
        return new Promise(() => {})
      },
    },
  }, spec, new AbortController().signal)

  assert.equal(result.status, 'error')
  assert.equal(result.failureClass, 'infrastructure')
  assert.equal(result.workspaceQuarantined, true)
  assert.equal(result.modelVerified, false)
  assert.match(result.message, /task timed out/u)
})

test('a planned task cannot become accepted after cleanup crosses its deadline', async () => {
  const spec = plannedPipelineSpec({
    lane: {
      taskTimeoutMs: 20,
      maxPlanSteps: 1,
      maxPlanPatches: 0,
      maxTotalChildRuns: 5,
    },
  })
  const initial = twoStepPlan({
    steps: [planStep('calculate', { covers: ['requirements'], deliverableIds: ['code'] })],
  })
  const children = [
    childRun('planner-initial', initial),
    childRun('plan-review-initial', planReviewReport()),
    childRun('calculate-executor', executorReport({
      criteria: [{ id: 'calculate-ok', status: 'pass', evidence: 'Calculation evidence.' }],
    })),
    childRun('calculate-verifier', verifierReport(['calculate-ok'])),
    {
      run: {
        id: 'final-verifier',
        result: Promise.resolve({
          output: [],
          structured: verifierReport(['requirements']),
          stopReason: 'completed',
        }),
        async dispose() {
          await new Promise(resolvePromise => setTimeout(resolvePromise, 50))
        },
      },
    },
  ]
  let starts = 0
  const result = await runTaskPipeline({
    logger: { warn() {} },
    subagents: {
      start() {
        return children[starts++].run
      },
    },
  }, spec, new AbortController().signal)

  assert.equal(starts, 5)
  assert.equal(result.status, 'error')
  assert.equal(result.failureClass, 'task')
  assert.equal(result.workspaceQuarantined, false)
  assert.equal(result.modelVerified, false)
  assert.equal(result.masterPlan.status, 'error')
  assert.match(result.masterPlan.history.at(-1).message, /task timed out/u)
})

test('invalid or independently rejected plans never start an executor', async (t) => {
  await t.test('mechanically invalid plan stops after the planner', async () => {
    const spec = plannedPipelineSpec()
    const invalid = {
      summary: 'This plan omits immutable criterion coverage.',
      steps: [planStep('only', { deliverableIds: ['code'] })],
    }
    const children = [childRun('planner-invalid', invalid)]
    const calls = []
    const result = await runTaskPipeline({
      logger: { warn() {} },
      subagents: {
        start(_transport, request) {
          calls.push(request)
          return children[calls.length - 1].run
        },
      },
    }, spec, new AbortController().signal)

    assert.equal(result.status, 'error')
    assert.equal(result.modelVerified, false)
    assert.match(result.message, /initial planner: child returned missing or invalid structured output/u)
    assert.equal(calls.length, 1)
    assert.strictEqual(calls[0].agentOptions, spec.lane.planner)
    assert.strictEqual(calls[0].outputSchema, INITIAL_PLAN_OUTPUT_SCHEMA)
    assert.deepEqual(result.executorRuns, [])
    assert.deepEqual(result.verifierRuns, [])
    assert.equal(result.masterPlan, undefined)
  })

  await t.test('semantic plan rejection stops after independent review', async () => {
    const spec = plannedPipelineSpec()
    const children = [
      childRun('planner-valid', twoStepPlan()),
      childRun('plan-review-reject', planReviewReport({
        decision: 'reject',
        summary: 'The proposed steps expand the immutable scope.',
        issues: ['The second step performs work outside the objective.'],
      })),
    ]
    const calls = []
    const result = await runTaskPipeline({
      logger: { warn() {} },
      subagents: {
        start(_transport, request) {
          calls.push(request)
          return children[calls.length - 1].run
        },
      },
    }, spec, new AbortController().signal)

    assert.equal(result.status, 'rejected')
    assert.equal(result.modelVerified, false)
    assert.match(result.message, /initial plan review: The proposed steps expand the immutable scope\./u)
    assert.deepEqual(calls.map(call => call.label), [
      `${spec.title} / initial planner`,
      `${spec.title} / initial plan review`,
    ])
    assert.strictEqual(calls[0].agentOptions, spec.lane.planner)
    assert.strictEqual(calls[1].agentOptions, spec.lane.verifier)
    assert.deepEqual(result.executorRuns, [])
    assert.deepEqual(result.verifierRuns, [])
    assert.equal(result.masterPlan.status, 'rejected')
  })
})

test('DispatcherRuntime allows only the exact registered live root agent', async () => {
  const fixture = runtimeFixture()
  const impostor = { ...fixture.parent }
  const subagent = {
    id: 'subagent',
    session: { header: { cwd: '/workspace', origin: 'subagent' } },
  }

  const impostorResult = await fixture.runtime.execute(taskArgs(), {
    agent: impostor,
    signal: new AbortController().signal,
  })
  assert.equal(impostorResult.kind, 'foreground')
  assert.equal(impostorResult.task.status, 'error')
  assert.match(impostorResult.task.message, /exact live root session/u)

  const subagentResult = await fixture.runtime.execute(taskArgs(), {
    agent: subagent,
    signal: new AbortController().signal,
  })
  assert.equal(subagentResult.task.status, 'error')
  assert.equal(fixture.starts.length, 0)
})

test('DispatcherRuntime routes distributed lanes to the durable coordinator without local locks or children', async () => {
  const distributedConfig = resolveDispatcherConfig({
    defaultRunInBackground: true,
    distribution: { role: 'coordinator' },
    lanes: {
      remote: lane({
        executorTools: ['read'],
        verifierTools: ['grep'],
        plannerTools: [],
        execution: { mode: 'distributed', pool: 'ds4-readonly', workspaceRef: 'harness-main' },
      }),
    },
  })
  const fixture = runtimeFixture({ config: distributedConfig })
  let received
  fixture.runtime.distributed = {
    async enqueue(spec, exec) {
      received = { spec, exec }
      return { kind: 'distributed', taskId: 'durable-task', state: 'queued' }
    },
  }
  const exec = {
    agent: fixture.parent,
    callId: 'tool-call-1',
    signal: new AbortController().signal,
  }
  const result = await fixture.runtime.execute(taskArgs({ lane: 'remote', run_in_background: true }), exec)
  assert.deepEqual(result, { kind: 'distributed', taskId: 'durable-task', state: 'queued' })
  assert.strictEqual(received.exec, exec)
  assert.equal(received.spec.lane.execution.mode, 'distributed')
  assert.equal(fixture.processState.locks.size, 0)
  assert.equal(fixture.starts.length, 0)
  assert.equal(fixture.jobs.length, 0)

  const foreground = await fixture.runtime.execute(taskArgs({ lane: 'remote', run_in_background: false }), exec)
  assert.equal(foreground.kind, 'foreground')
  assert.match(foreground.task.message, /must run in the background/u)
})

test('durable coordinator works with an injected store and normalizes queued cancellation for tools and telemetry', async () => {
  const configured = resolveDispatcherConfig({
    defaultRunInBackground: true,
    distribution: { role: 'coordinator', scopeId: 'tenant-a' },
    lanes: {
      remote: lane({
        executorTools: ['read'],
        verifierTools: ['grep'],
        plannerTools: [],
        execution: { mode: 'distributed', pool: 'ds4-readonly', workspaceRef: 'snapshot' },
      }),
    },
  })
  const parent = { id: 'origin-session', session: { header: { cwd: process.cwd() } } }
  const spec = {
    ...pipelineSpec(),
    taskId: 'durable-cancelled-task',
    laneId: 'remote',
    lane: configured.lanes.remote,
    criteria: configured.lanes.remote.requiredCriteria,
    runInBackground: true,
    parent,
  }
  const store = new MemoryTaskStore()
  const telemetry = createDispatcherTelemetry({ locks: new Map(), circuits: new Map() }, { now: Date.now })
  const runtime = new DistributedDispatcherRuntime(
    { logger: { warn() {} } },
    configured,
    telemetry,
    { store, disposeTimeoutMs: 20 },
  )
  try {
    const queued = await runtime.enqueue(spec, { callId: 'call-1' })
    assert.deepEqual(queued, { kind: 'distributed', taskId: spec.taskId, state: 'queued' })

    const cancelled = await runtime.cancel(parent, spec.taskId, 'operator cancelled')
    assert.equal(cancelled.state, 'terminal')
    assert.equal(cancelled.outcome, 'cancelled')
    assert.equal(cancelled.result.taskId, spec.taskId)
    assert.equal(cancelled.result.lane, 'remote')
    assert.equal(cancelled.result.status, 'cancelled')
    assert.equal(cancelled.result.modelVerified, false)
    assert.equal(cancelled.result.failureClass, 'none')
    assert.deepEqual(cancelled.result.criteria, [])
    assert.deepEqual(cancelled.result.executorRuns, [])
    assert.deepEqual(cancelled.result.verifierRuns, [])
    assert.equal('workerId' in cancelled, false)
    assert.equal('leaseGeneration' in cancelled, false)

    const status = await runtime.status(parent, spec.taskId)
    assert.deepEqual(status, cancelled)
    const projected = telemetry.snapshot(parent.id).tasks
    assert.equal(projected.length, 1)
    assert.equal(projected[0].taskId, spec.taskId)
    assert.equal(projected[0].status, 'cancelled')
    assert.equal(projected[0].distribution.state, 'terminal')
  } finally {
    await runtime.dispose()
  }
})

test('durable status never exposes accepted when an invalid stored acceptance is normalized to error', async () => {
  const configured = resolveDispatcherConfig({
    distribution: { role: 'coordinator', scopeId: 'tenant-a' },
    lanes: {
      remote: lane({
        executorTools: ['read'],
        verifierTools: [],
        execution: { mode: 'distributed', pool: 'readonly', workspaceRef: 'snapshot' },
      }),
    },
  })
  const parent = { id: 'origin-session' }
  let storedOutcome = 'accepted'
  let storedResult = { status: 'accepted', message: 'incomplete result' }
  const store = {
    async initialize() {},
    async get() {
      return {
        taskId: 'invalid-acceptance',
        scopeId: 'tenant-a',
        originSessionId: parent.id,
        laneId: 'remote',
        pool: 'readonly',
        payload: {
          taskId: 'invalid-acceptance',
          laneId: 'remote',
          title: 'Invalid acceptance',
          criteria: configured.lanes.remote.requiredCriteria,
        },
        state: 'terminal',
        outcome: storedOutcome,
        result: storedResult,
        claimCount: 1,
        cancelRequested: false,
        completedWorkerId: 'node-9',
        completedLeaseGeneration: '4',
      }
    },
    async close() {},
  }
  const telemetry = createDispatcherTelemetry({ locks: new Map(), circuits: new Map() }, { now: Date.now })
  const runtime = new DistributedDispatcherRuntime(
    { logger: { warn() {} } },
    configured,
    telemetry,
    { store, disposeTimeoutMs: 20 },
  )
  try {
    const status = await runtime.status(parent, 'invalid-acceptance')
    assert.equal(status.outcome, 'error')
    assert.equal(status.result.status, 'error')
    assert.equal(status.result.failureClass, 'infrastructure')
    assert.match(status.result.message, /durable distributed acceptance was invalid/u)
    assert.equal(status.workerId, 'node-9')
    assert.equal(status.leaseGeneration, '4')
    let projected = telemetry.snapshot(parent.id).tasks[0]
    assert.equal(projected.distribution.nodeId, 'node-9')
    assert.equal(projected.distribution.leaseGeneration, '4')

    storedOutcome = 'error'
    storedResult = {
      taskId: 'invalid-acceptance',
      lane: 'remote',
      title: 'Invalid acceptance',
      status: 'accepted',
      modelVerified: true,
      attempts: 1,
      message: 'falsely accepted',
      workspaceQuarantined: false,
      failureClass: 'none',
      criteria: configured.lanes.remote.requiredCriteria.map(item => ({
        id: item.id,
        status: 'pass',
        evidence: 'independent evidence',
      })),
      executorRuns: [],
      verifierRuns: [],
    }
    const mismatched = await runtime.status(parent, 'invalid-acceptance')
    assert.equal(mismatched.outcome, 'error')
    assert.equal(mismatched.result.status, 'error')
    assert.equal(mismatched.result.failureClass, 'infrastructure')
    assert.match(mismatched.result.message, /did not match result status/u)
    projected = telemetry.snapshot(parent.id).tasks[0]
    assert.equal(projected.status, 'error')
  } finally {
    await runtime.dispose()
  }
})

test('distributed running telemetry reports only verified placement and never invents a child model or phase', async () => {
  const configured = resolveDispatcherConfig({
    distribution: { role: 'coordinator', scopeId: 'tenant-a' },
    lanes: {
      remote: lane({
        executorTools: ['read'],
        verifierTools: [],
        execution: { mode: 'distributed', pool: 'readonly', workspaceRef: 'snapshot' },
      }),
    },
  })
  const parent = { id: 'origin-session' }
  const telemetry = createDispatcherTelemetry({ locks: new Map(), circuits: new Map() }, { now: Date.now })
  const runtime = new DistributedDispatcherRuntime(
    { logger: { warn() {} } },
    configured,
    telemetry,
    { store: new MemoryTaskStore(), disposeTimeoutMs: 20 },
  )
  try {
    runtime.observe(parent, {
      taskId: 'remote-running',
      laneId: 'remote',
      pool: 'readonly',
      payload: { title: 'Remote running' },
      state: 'running',
      workerId: 'node-a',
      leaseGeneration: '3',
      leaseUntil: '2026-08-22T20:15:30.000Z',
      claimCount: 2,
      cancelRequested: false,
    })
    const task = telemetry.snapshot(parent.id).tasks[0]
    assert.equal(task.distribution.state, 'running')
    assert.equal(task.distribution.nodeId, 'node-a')
    assert.deepEqual(task.workers, [])
    assert.equal(task.phase, 'preparing')
  } finally {
    await runtime.dispose()
  }
})

test('durable coordinator teardown is bounded when monitor reads and store close never settle', async () => {
  const configured = resolveDispatcherConfig({
    distribution: { role: 'coordinator' },
    lanes: {
      remote: lane({
        executorTools: ['read'],
        verifierTools: [],
        execution: { mode: 'distributed', pool: 'default', workspaceRef: 'snapshot' },
      }),
    },
  })
  const pending = new Promise(() => {})
  const record = {
    taskId: 'stuck-monitor',
    scopeId: 'default',
    originSessionId: 'origin-session',
    laneId: 'remote',
    pool: 'default',
    payload: { title: 'Stuck monitor' },
    state: 'queued',
    claimCount: 0,
    cancelRequested: false,
  }
  const store = {
    async initialize() {},
    async enqueue() { return record },
    get() { return pending },
    close() { return pending },
  }
  const telemetry = createDispatcherTelemetry({ locks: new Map(), circuits: new Map() }, { now: Date.now })
  const runtime = new DistributedDispatcherRuntime(
    { logger: { warn() {} } },
    configured,
    telemetry,
    { store, disposeTimeoutMs: 10 },
  )
  const parent = { id: 'origin-session' }
  const spec = {
    ...pipelineSpec(),
    taskId: 'stuck-monitor',
    laneId: 'remote',
    lane: configured.lanes.remote,
    criteria: configured.lanes.remote.requiredCriteria,
    runInBackground: true,
    parent,
  }
  await runtime.enqueue(spec, { callId: 'call-stuck' })
  const started = Date.now()
  await runtime.dispose()
  assert.ok(Date.now() - started < 100, 'dispose should return after its configured bounds')
})

test('distributed monitor recovers after a transient read failure and publishes the terminal result', async () => {
  const configured = resolveDispatcherConfig({
    distribution: { role: 'coordinator', scopeId: 'tenant-a' },
    lanes: {
      remote: lane({
        executorTools: ['read'],
        verifierTools: [],
        execution: { mode: 'distributed', pool: 'default', workspaceRef: 'snapshot' },
      }),
    },
  })
  const parent = { id: 'origin-session', session: { header: { cwd: process.cwd() } } }
  const spec = {
    ...pipelineSpec(),
    taskId: 'transient-monitor-task',
    laneId: 'remote',
    lane: configured.lanes.remote,
    criteria: configured.lanes.remote.requiredCriteria,
    runInBackground: true,
    parent,
  }
  let getCalls = 0
  const store = {
    async initialize() {},
    async get() {
      getCalls += 1
      if (getCalls === 1) throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
      return {
        taskId: spec.taskId,
        scopeId: 'tenant-a',
        originSessionId: parent.id,
        laneId: 'remote',
        pool: 'default',
        payload: { title: spec.title },
        state: 'terminal',
        outcome: 'cancelled',
        result: { status: 'cancelled', message: 'cancelled by operator' },
        claimCount: 0,
        cancelRequested: true,
      }
    },
    async close() {},
  }
  const warnings = []
  const telemetry = createDispatcherTelemetry({ locks: new Map(), circuits: new Map() }, { now: Date.now })
  const runtime = new DistributedDispatcherRuntime(
    { logger: { warn(message) { warnings.push(message) } } },
    configured,
    telemetry,
    { store, monitorPollMs: 1, disposeTimeoutMs: 20 },
  )
  try {
    runtime.monitor(spec)
    for (let attempt = 0; attempt < 50; attempt++) {
      const task = telemetry.snapshot(parent.id).tasks[0]
      if (task?.status === 'cancelled') break
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    assert.equal(getCalls, 2)
    assert.equal(runtime.monitors.has(spec.taskId), false)
    assert.equal(telemetry.snapshot(parent.id).tasks[0].status, 'cancelled')
    assert.equal(warnings.some(message => /connection reset/u.test(message)), true)
  } finally {
    await runtime.dispose()
  }
})

test('distributed monitor concurrency is bounded when database reads do not settle', async () => {
  const configured = resolveDispatcherConfig({ distribution: { role: 'coordinator' } })
  const pending = new Promise(() => {})
  let getCalls = 0
  const warnings = []
  const store = {
    async initialize() {},
    get() { getCalls += 1; return pending },
    async close() {},
  }
  const runtime = new DistributedDispatcherRuntime(
    { logger: { warn(message) { warnings.push(message) } } },
    configured,
    createDispatcherTelemetry({ locks: new Map(), circuits: new Map() }, { now: Date.now }),
    { store, monitorLimit: 2, disposeTimeoutMs: 10 },
  )
  const parent = { id: 'bounded-monitor-session' }
  const spec = taskId => ({
    ...pipelineSpec(),
    taskId,
    laneId: 'unused',
    lane: lane(),
    parent,
  })
  assert.equal(runtime.monitor(spec('monitor-one')), true)
  assert.equal(runtime.monitor(spec('monitor-two')), true)
  assert.equal(runtime.monitor(spec('monitor-three')), false)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(getCalls, 2)
  assert.equal(runtime.monitors.size, 2)
  assert.equal(warnings.some(message => /capacity 2 is exhausted/u.test(message)), true)
  await runtime.dispose()
})

test('distributed startup retries transient store failure and begins claiming without a host restart', async () => {
  const configured = resolveDispatcherConfig({
    distribution: {
      role: 'worker',
      scopeId: 'recovery-scope',
      workerId: 'recovering-worker',
      pools: ['readonly'],
      pollMs: 100,
    },
  })
  let createCalls = 0
  let initializeCalls = 0
  let claimCalls = 0
  let fiberDisposals = 0
  const warnings = []
  const store = {
    async initialize() { initializeCalls += 1 },
    async claim(input) {
      claimCalls += 1
      assert.equal(input.scopeId, 'recovery-scope')
      assert.equal(input.workerId, 'recovering-worker')
      return null
    },
    async heartbeat() { throw new Error('no task was claimed') },
    async complete() { throw new Error('no task was claimed') },
    async close() {},
  }
  const ctx = {
    logger: { warn(message) { warnings.push(message) }, error() {} },
    get(name) { return name === 'agentPresets' ? {} : undefined },
    inject(dependencies, mount) {
      assert.deepEqual(dependencies, ['agentPresets'])
      mount({ logger: ctx.logger })
      return { dispose() { fiberDisposals += 1 } }
    },
  }
  const telemetry = createDispatcherTelemetry({ locks: new Map(), circuits: new Map() }, { now: Date.now })
  const runtime = new DistributedDispatcherRuntime(ctx, configured, telemetry, {
    connectionString: 'postgresql://recovery.invalid/dispatcher',
    async createStore() {
      createCalls += 1
      if (createCalls === 1) throw new Error('database is starting')
      return store
    },
    retryInitialMs: 1,
    retryMaximumMs: 1,
    async retrySleep() {},
    disposeTimeoutMs: 20,
  })
  try {
    assert.strictEqual(await runtime.ready, store)
    assert.equal(createCalls, 2)
    assert.equal(initializeCalls, 1)
    assert.strictEqual(await runtime.requireStore('worker'), store)
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(claimCalls >= 1)
    assert.equal(warnings.some(message => /database is starting/u.test(message)), true)
  } finally {
    await runtime.dispose()
  }
  assert.equal(fiberDisposals, 1)
})

test('worker readiness waits for a real Cordis agentPresets dependency and activates when it appears', async () => {
  const ctx = new Context()
  const configured = resolveDispatcherConfig({
    distribution: {
      role: 'worker',
      scopeId: 'late-preset-scope',
      workerId: 'late-preset-worker',
      pools: ['readonly'],
      pollMs: 100,
    },
  })
  const store = new MemoryTaskStore()
  const telemetry = createDispatcherTelemetry({ locks: new Map(), circuits: new Map() }, { now: Date.now })
  const runtime = new DistributedDispatcherRuntime(ctx, configured, telemetry, {
    store,
    retryInitialMs: 1,
    retryMaximumMs: 1,
    disposeTimeoutMs: 20,
  })
  let ready = false
  void runtime.ready.then(() => { ready = true })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(ready, false)
  assert.equal(runtime.worker, undefined)

  const removePreset = ctx.provide('agentPresets', {
    defaultId: 'readonly-worker',
    async mount() {},
  })
  try {
    assert.strictEqual(await runtime.ready, store)
    assert.notEqual(runtime.worker, undefined)
    assert.equal(runtime.workerFiber.state, 2)
  } finally {
    await runtime.dispose()
    await removePreset()
  }
})

test('apply registers runtime cleanup before a fallible tool registration can strand retry loops', async () => {
  const effects = []
  let warnings = 0
  const ctx = {
    agents: { get() {}, roots: () => [] },
    jobs: { start() { throw new Error('not used') } },
    logger: { warn() { warnings += 1 }, error() {} },
    sandboxPolicy: { resolve: () => ({ mode: 'read-only' }) },
    subagents: { start() { throw new Error('not used') } },
    tools: {
      register() {
        assert.equal(effects.length, 1, 'runtime cleanup must exist before tool registration')
        throw new Error('duplicate tool registration')
      },
    },
    on() {},
    effect(factory) {
      effects.push(factory())
    },
  }
  const missingDatabaseEnv = `DSH_DISPATCHER_MISSING_${Date.now()}`
  assert.equal(process.env[missingDatabaseEnv], undefined)
  assert.throws(() => apply(ctx, {
    distribution: {
      role: 'coordinator',
      databaseUrlEnv: missingDatabaseEnv,
      pollMs: 100,
    },
    lanes: {
      remote: lane({
        executorTools: ['read'],
        verifierTools: [],
        plannerTools: [],
        execution: { mode: 'distributed', pool: 'readonly', workspaceRef: 'snapshot' },
      }),
    },
  }), /duplicate tool registration/u)

  assert.equal(effects.length, 1)
  await effects[0]()
  const warningsAfterDispose = warnings
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(warnings, warningsAfterDispose, 'disposed startup must not keep retrying')
})

test('DispatcherRuntime background cancellation resolves done and releases the workspace lock', async () => {
  const pending = new Promise(() => {})
  const fixture = runtimeFixture({
    start: (_transport, _request, index) => childRun(`pending-${index}`, undefined, { result: pending }).run,
  })
  const exec = { agent: fixture.parent, signal: new AbortController().signal }
  const first = await fixture.runtime.execute(taskArgs({ run_in_background: true }), exec)
  assert.deepEqual(first, { kind: 'background', taskId: 'task-id-1', jobId: 'job-1' })
  assert.equal(fixture.processState.locks.size, 1)
  const liveTask = fixture.runtime.telemetry.snapshot(fixture.parent.id).tasks[0]
  assert.equal(liveTask.taskId, first.taskId)
  assert.equal(liveTask.jobId, first.jobId)
  assert.equal(liveTask.status, 'running')
  assert.ok(['preparing', 'executor'].includes(liveTask.phase))

  const competing = await fixture.runtime.execute(taskArgs({ run_in_background: true }), exec)
  assert.equal(competing.kind, 'foreground')
  assert.equal(competing.task.status, 'error')
  assert.match(competing.task.message, /workspace already has active task/u)

  fixture.jobs[0].handle.cancel('operator cancelled')
  const outcome = await fixture.jobs[0].handle.done
  assert.deepEqual(outcome, { status: 'killed' })
  assert.equal(fixture.processState.locks.size, 0)
  const terminalTask = fixture.runtime.telemetry.snapshot(fixture.parent.id).tasks
    .find(task => task.taskId === first.taskId)
  assert.equal(terminalTask.status, 'cancelled')
  assert.equal(terminalTask.phase, 'finished')
  assert.equal(terminalTask.result.status, 'cancelled')
  assert.equal(typeof terminalTask.finishedAt, 'number')
})

test('DispatcherRuntime background done never rejects when infrastructure fails', async () => {
  const fixture = runtimeFixture({
    start: () => { throw new Error('provider unavailable') },
  })
  const launched = await fixture.runtime.execute(taskArgs({ run_in_background: true }), {
    agent: fixture.parent,
    signal: new AbortController().signal,
  })
  assert.equal(launched.kind, 'background')
  const done = fixture.jobs[0].handle.done
  await assert.doesNotReject(done)
  const outcome = await done
  assert.equal(outcome.status, 'failed')
  assert.match(outcome.detail, /provider unavailable/u)
  assert.equal(fixture.processState.locks.size, 0)
})

test('a contained model failure completes the Job with a non-accepted task result', async () => {
  const fixture = runtimeFixture({
    start: () => childRun('refused', undefined, {
      stopReason: 'refusal',
      output: [{ type: 'text', text: 'policy refusal' }],
    }).run,
  })
  const launched = await fixture.runtime.execute(taskArgs({ run_in_background: true }), {
    agent: fixture.parent,
    signal: new AbortController().signal,
  })
  const outcome = await fixture.jobs[0].handle.done

  assert.equal(launched.kind, 'background')
  assert.equal(outcome.status, 'completed')
  const task = JSON.parse(outcome.output)
  assert.equal(task.status, 'error')
  assert.equal(task.failureClass, 'task')
  assert.equal(task.modelVerified, false)
})

test('DispatcherRuntime quarantines a workspace when child cleanup is uncertain', async () => {
  const shared = { locks: new Map(), circuits: new Map() }
  const first = runtimeFixture({
    processState: shared,
    start: () => childRun(
      'cleanup-failed',
      executorReport(),
      { disposeError: new Error('dispose exploded') },
    ).run,
  })
  const result = await first.runtime.execute(taskArgs(), {
    agent: first.parent,
    signal: new AbortController().signal,
  })

  assert.equal(result.kind, 'foreground')
  assert.equal(result.task.status, 'error')
  assert.equal(result.task.workspaceQuarantined, true)
  assert.match(result.task.message, /child cleanup failed: dispose exploded/u)
  assert.equal(shared.locks.size, 1)

  const replacement = runtimeFixture({ processState: shared })
  const blocked = await replacement.runtime.execute(taskArgs(), {
    agent: replacement.parent,
    signal: new AbortController().signal,
  })
  assert.equal(blocked.kind, 'foreground')
  assert.equal(blocked.task.workspaceQuarantined, false)
  assert.match(blocked.task.message, /workspace already has active task/u)
  assert.equal(replacement.starts.length, 0)
})

test('a quarantined cancellation is reported as failed rather than killed', async () => {
  const shared = { locks: new Map(), circuits: new Map() }
  const fixture = runtimeFixture({
    processState: shared,
    start: () => childRun(
      'unclean-cancel',
      undefined,
      { result: new Promise(() => {}), disposeError: new Error('dispose exploded') },
    ).run,
  })
  const launched = await fixture.runtime.execute(taskArgs({ run_in_background: true }), {
    agent: fixture.parent,
    signal: new AbortController().signal,
  })
  await new Promise(resolvePromise => setImmediate(resolvePromise))
  assert.equal(fixture.starts.length, 1)
  fixture.jobs[0].handle.cancel('operator cancelled')
  const outcome = await fixture.jobs[0].handle.done

  assert.equal(launched.kind, 'background')
  assert.equal(outcome.status, 'failed')
  assert.match(outcome.detail, /"workspaceQuarantined": true/u)
  assert.equal(shared.locks.size, 1)
})

test('DispatcherRuntime circuit opens after bounded infrastructure failures and cools down', async () => {
  let now = 10_000
  const configured = config({
    maxConsecutiveFailures: 2,
    circuitCooldownMs: 1_000,
  })
  const fixture = runtimeFixture({
    config: configured,
    now: () => now,
    start: () => { throw new Error('provider unavailable') },
  })
  const exec = { agent: fixture.parent, signal: new AbortController().signal }

  const first = await fixture.runtime.execute(taskArgs(), exec)
  const second = await fixture.runtime.execute(taskArgs(), exec)
  assert.equal(first.task.status, 'error')
  assert.equal(second.task.status, 'error')
  assert.equal(fixture.starts.length, 2)

  const open = await fixture.runtime.execute(taskArgs(), exec)
  assert.equal(open.task.status, 'error')
  assert.match(open.task.message, /circuit is open until/u)
  assert.equal(fixture.starts.length, 2)

  now += 1_001
  const afterCooldown = await fixture.runtime.execute(taskArgs(), exec)
  assert.equal(afterCooldown.task.status, 'error')
  assert.equal(fixture.starts.length, 3)
})

test('task and model failures do not open the infrastructure circuit', async () => {
  const configured = config({ maxConsecutiveFailures: 2 })
  const fixture = runtimeFixture({
    config: configured,
    start: (_transport, _request, index) => childRun(`refused-${index}`, undefined, {
      stopReason: 'refusal',
      output: [{ type: 'text', text: 'cannot perform this task' }],
    }).run,
  })
  const exec = { agent: fixture.parent, signal: new AbortController().signal }

  for (let index = 0; index < 3; index++) {
    const result = await fixture.runtime.execute(taskArgs(), exec)
    assert.equal(result.task.status, 'error')
    assert.equal(result.task.failureClass, 'task')
    assert.doesNotMatch(result.task.message, /circuit is open/u)
  }
  assert.equal(fixture.starts.length, 3)
  assert.equal(fixture.processState.circuits.size, 0)
})

test('self-improvement canonicalizes a staging symlink and requires exact workspace-write sandboxing', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dispatcher-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const live = join(root, 'live')
  const staging = join(root, 'staging')
  const workspace = join(staging, 'worktree')
  const workspaceAlias = join(root, 'workspace-alias')
  mkdirSync(live)
  mkdirSync(workspace, { recursive: true })
  symlinkSync(workspace, workspaceAlias)

  const configured = resolveDispatcherConfig({
    liveRoot: live,
    stagingRoot: staging,
    defaultRunInBackground: true,
    lanes: { improve: lane({ kind: 'self-improvement' }) },
  })
  const spec = {
    lane: configured.lanes.improve,
    workspace: workspaceAlias,
    liveRoot: configured.liveRoot,
  }
  assertSafeWorkspace(spec, configured)
  assert.equal(spec.workspace, realpathSync.native(workspace))
  assert.equal(spec.liveRoot, realpathSync.native(live))

  const fixture = runtimeFixture({ cwd: workspaceAlias, config: configured })
  fixture.ctx.sandboxPolicy.resolve = () => ({
    mode: 'read-only',
    workspaceRoot: workspaceAlias,
  })
  const wrongMode = await fixture.runtime.execute(taskArgs({ lane: 'improve', run_in_background: true }), {
    agent: fixture.parent,
    signal: new AbortController().signal,
  })
  assert.equal(wrongMode.task.status, 'error')
  assert.match(wrongMode.task.message, /workspace-write sandbox mode/u)
  assert.equal(fixture.jobs.length, 0)

  fixture.ctx.sandboxPolicy.resolve = () => ({
    mode: 'workspace-write',
    workspaceRoot: staging,
  })
  const wrongRoot = await fixture.runtime.execute(taskArgs({ lane: 'improve', run_in_background: true }), {
    agent: fixture.parent,
    signal: new AbortController().signal,
  })
  assert.equal(wrongRoot.task.status, 'error')
  assert.match(wrongRoot.task.message, /sandbox workspace root to equal/u)
  assert.equal(fixture.jobs.length, 0)
})

test('self-improvement rejects realpath aliases that resolve into the live Harness root', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dispatcher-live-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const live = join(root, 'live')
  const liveWorkspace = join(live, 'worktree')
  const stagingAlias = join(root, 'staging-alias')
  mkdirSync(liveWorkspace, { recursive: true })
  symlinkSync(live, stagingAlias)
  const configured = resolveDispatcherConfig({
    liveRoot: live,
    stagingRoot: stagingAlias,
    lanes: { improve: lane({ kind: 'self-improvement' }) },
  })
  const spec = {
    lane: configured.lanes.improve,
    workspace: liveWorkspace,
    liveRoot: configured.liveRoot,
  }
  assert.throws(() => assertSafeWorkspace(spec, configured), /canonical liveRoot and stagingRoot not to overlap/u)
})

test('a mutating general lane cannot be relabelled to operate inside configured liveRoot', async (t) => {
  const live = mkdtempSync(join(tmpdir(), 'dsh-dispatcher-protected-live-'))
  const staging = mkdtempSync(join(tmpdir(), 'dsh-dispatcher-protected-staging-'))
  t.after(() => rmSync(live, { recursive: true, force: true }))
  t.after(() => rmSync(staging, { recursive: true, force: true }))
  const configured = config({ liveRoot: live, stagingRoot: staging })
  const fixture = runtimeFixture({ cwd: live, config: configured })
  const output = await fixture.runtime.execute(taskArgs(), {
    agent: fixture.parent,
    signal: new AbortController().signal,
  })
  assert.equal(output.kind, 'foreground')
  assert.equal(output.task.status, 'error')
  assert.match(output.task.message, /cannot run in liveRoot/u)
  assert.equal(fixture.starts.length, 0)
})

test('a mutating workspace cannot be an ancestor of liveRoot', async (t) => {
  const root = mkdtempSync(join(process.cwd(), '.dsh-dispatcher-live-ancestor-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const live = join(root, 'live')
  mkdirSync(live)
  const configured = config({ liveRoot: live })
  const fixture = runtimeFixture({ cwd: root, config: configured })
  const output = await fixture.runtime.execute(taskArgs(), {
    agent: fixture.parent,
    signal: new AbortController().signal,
  })

  assert.equal(output.kind, 'foreground')
  assert.equal(output.task.status, 'error')
  assert.match(output.task.message, /cannot run in liveRoot/u)
  assert.equal(fixture.starts.length, 0)
})

test('self-improvement rejects a staging symlink that resolves above liveRoot', async (t) => {
  const root = mkdtempSync(join(process.cwd(), '.dsh-dispatcher-staging-ancestor-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const container = join(root, 'container')
  const live = join(container, 'live')
  const stagingAlias = join(root, 'staging-alias')
  mkdirSync(live, { recursive: true })
  symlinkSync(container, stagingAlias)
  const configured = resolveDispatcherConfig({
    liveRoot: live,
    stagingRoot: stagingAlias,
    lanes: { improve: lane({ kind: 'self-improvement' }) },
  })
  const spec = {
    lane: configured.lanes.improve,
    workspace: container,
    liveRoot: configured.liveRoot,
    stagingRoot: configured.stagingRoot,
  }

  assert.throws(
    () => assertSafeWorkspace(spec, configured),
    /canonical liveRoot and stagingRoot not to overlap/u,
  )
})

test('mutating lanes reject a liveRoot under sandbox temporary write roots', async () => {
  const fixture = runtimeFixture({
    cwd: process.cwd(),
    config: config({ liveRoot: tmpdir() }),
  })
  const output = await fixture.runtime.execute(taskArgs(), {
    agent: fixture.parent,
    signal: new AbortController().signal,
  })

  assert.equal(output.kind, 'foreground')
  assert.equal(output.task.status, 'error')
  assert.match(output.task.message, /outside sandbox temporary write roots/u)
  assert.equal(fixture.starts.length, 0)
})

test('a mutating general lane requires an exact workspace-write sandbox', async (t) => {
  const live = mkdtempSync(join(tmpdir(), 'dsh-dispatcher-sandbox-live-'))
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-dispatcher-sandbox-workspace-'))
  const broaderRoot = mkdtempSync(join(tmpdir(), 'dsh-dispatcher-sandbox-broad-'))
  t.after(() => rmSync(live, { recursive: true, force: true }))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  t.after(() => rmSync(broaderRoot, { recursive: true, force: true }))
  const configured = config({ liveRoot: live })
  const fixture = runtimeFixture({ cwd: workspace, config: configured })

  fixture.ctx.sandboxPolicy.resolve = () => ({
    mode: 'danger-full-access',
    workspaceRoot: workspace,
  })
  const unrestricted = await fixture.runtime.execute(taskArgs(), {
    agent: fixture.parent,
    signal: new AbortController().signal,
  })
  assert.equal(unrestricted.task.status, 'error')
  assert.match(unrestricted.task.message, /workspace-write sandbox mode/u)
  assert.equal(fixture.starts.length, 0)

  fixture.ctx.sandboxPolicy.resolve = () => ({
    mode: 'workspace-write',
    workspaceRoot: broaderRoot,
  })
  const wrongRoot = await fixture.runtime.execute(taskArgs(), {
    agent: fixture.parent,
    signal: new AbortController().signal,
  })
  assert.equal(wrongRoot.task.status, 'error')
  assert.match(wrongRoot.task.message, /sandbox workspace root to equal/u)
  assert.equal(fixture.starts.length, 0)
})

test('process-stable workspace state fences a replacement runtime during hot reload', async () => {
  const shared = { locks: new Map(), circuits: new Map() }
  const pending = new Promise(() => {})
  const first = runtimeFixture({
    processState: shared,
    start: (_transport, _request, index) => childRun(`pending-${index}`, undefined, { result: pending }).run,
  })
  const launched = await first.runtime.execute(taskArgs({ run_in_background: true }), {
    agent: first.parent,
    signal: new AbortController().signal,
  })
  assert.equal(launched.kind, 'background')

  const replacement = runtimeFixture({ processState: shared })
  const blocked = await replacement.runtime.execute(taskArgs({ run_in_background: true }), {
    agent: replacement.parent,
    signal: new AbortController().signal,
  })
  assert.equal(blocked.kind, 'foreground')
  assert.match(blocked.task.message, /workspace already has active task/u)
  assert.equal(replacement.starts.length, 0)

  first.jobs[0].handle.cancel('test cleanup')
  await first.jobs[0].handle.done
  assert.equal(shared.locks.size, 0)
})

test('workspace locking canonicalizes symlink aliases', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dispatcher-lock-alias-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const firstAlias = join(root, 'first-alias')
  const secondAlias = join(root, 'second-alias')
  mkdirSync(workspace)
  symlinkSync(workspace, firstAlias)
  symlinkSync(workspace, secondAlias)

  const shared = { locks: new Map(), circuits: new Map() }
  const configured = config({ liveRoot: process.cwd() })
  const pending = new Promise(() => {})
  const first = runtimeFixture({
    cwd: firstAlias,
    config: configured,
    processState: shared,
    start: (_transport, _request, index) => childRun(`pending-${index}`, undefined, { result: pending }).run,
  })
  const launched = await first.runtime.execute(taskArgs({ run_in_background: true }), {
    agent: first.parent,
    signal: new AbortController().signal,
  })
  assert.equal(launched.kind, 'background')

  const second = runtimeFixture({ cwd: secondAlias, config: configured, processState: shared })
  const blocked = await second.runtime.execute(taskArgs({ run_in_background: true }), {
    agent: second.parent,
    signal: new AbortController().signal,
  })
  assert.equal(blocked.kind, 'foreground')
  assert.match(blocked.task.message, /workspace already has active task/u)
  assert.equal(second.starts.length, 0)

  first.jobs[0].handle.cancel('test cleanup')
  await first.jobs[0].handle.done
  assert.equal(shared.locks.size, 0)
})

test('workspace locking fences nested workspace roots', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dispatcher-nested-lock-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const nested = join(root, 'nested')
  mkdirSync(nested)
  const shared = { locks: new Map(), circuits: new Map() }
  const configured = config()
  const pending = new Promise(() => {})
  const first = runtimeFixture({
    cwd: root,
    config: configured,
    processState: shared,
    start: (_transport, _request, index) => childRun(`pending-${index}`, undefined, { result: pending }).run,
  })
  const launched = await first.runtime.execute(taskArgs({ run_in_background: true }), {
    agent: first.parent,
    signal: new AbortController().signal,
  })
  assert.equal(launched.kind, 'background')

  const second = runtimeFixture({ cwd: nested, config: configured, processState: shared })
  const blocked = await second.runtime.execute(taskArgs({ run_in_background: true }), {
    agent: second.parent,
    signal: new AbortController().signal,
  })
  assert.equal(blocked.kind, 'foreground')
  assert.match(blocked.task.message, /workspace already has active task/u)
  assert.equal(second.starts.length, 0)

  first.jobs[0].handle.cancel('test cleanup')
  await first.jobs[0].handle.done
  assert.equal(shared.locks.size, 0)
})

/**
 * Recursive JSON Schema validator for the subset used in MASTER_PLAN_RESULT_SCHEMA.
 * Returns an array of error messages; empty array means valid.
 */
function validateAgainstSchema(value, schema, path = '$') {
  const errors = []

  if (schema.oneOf) {
    let matched = false
    for (const [i, sub] of schema.oneOf.entries()) {
      const subErrors = validateAgainstSchema(value, sub, `${path}/oneOf[${i}]`)
      if (subErrors.length === 0) {
        matched = true
        break
      }
    }
    if (!matched) {
      errors.push(`${path}: does not match any oneOf variant`)
    }
    return errors
  }

  if (schema.type === undefined && schema.properties === undefined && schema.items === undefined && schema.enum === undefined && schema.const === undefined && schema.oneOf === undefined) {
    return errors
  }

  if (schema.type) {
    if (schema.type === 'object') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path}: expected object but got ${typeof value}`)
        return errors
      }
      if (schema.additionalProperties === false && schema.properties) {
        const allowedKeys = new Set(Object.keys(schema.properties))
        for (const key of Object.keys(value)) {
          if (!allowedKeys.has(key)) {
            errors.push(`${path}: extra property "${key}" not allowed`)
          }
        }
      }
      if (schema.required) {
        for (const key of schema.required) {
          if (!Object.prototype.hasOwnProperty.call(value, key)) {
            errors.push(`${path}: missing required property "${key}"`)
          }
        }
      }
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            const subErrors = validateAgainstSchema(value[key], propSchema, `${path}.${key}`)
            errors.push(...subErrors)
          }
        }
      }
    } else if (schema.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array but got ${typeof value}`)
        return errors
      }
      if (schema.items) {
        for (const [i, item] of value.entries()) {
          const subErrors = validateAgainstSchema(item, schema.items, `${path}[${i}]`)
          errors.push(...subErrors)
        }
      }
    } else if (schema.type === 'string') {
      if (typeof value !== 'string') {
        errors.push(`${path}: expected string but got ${typeof value}`)
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${path}: "${value}" is not one of ${JSON.stringify(schema.enum)}`)
      }
    } else if (schema.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`${path}: expected integer but got ${typeof value} ${value}`)
      }
    } else if (schema.type === 'boolean') {
      if (typeof value !== 'boolean') {
        errors.push(`${path}: expected boolean but got ${typeof value}`)
      }
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)} but got ${JSON.stringify(value)}`)
  }

  return errors
}

/** A representative completed masterPlan for a successful one-step accepted pipeline run. */
function completedMasterPlan() {
  return {
    planId: 'plan-task-123',
    taskId: 'task-123',
    revision: 4,
    patchCount: 0,
    status: 'accepted',
    summary: 'Implemented the change.',
    steps: [
      {
        id: 'inspect',
        title: 'Inspect the requirement',
        objective: 'Inspect only.',
        acceptanceCriteria: [
          { id: 'inspect-ok', text: 'Inspection complete with evidence.' },
        ],
        covers: ['requirements'],
        deliverableIds: [],
        status: 'completed',
        attempts: 1,
        evidence: [
          { id: 'inspect-ok', status: 'pass', evidence: 'Inspection passed.', reason: '' },
        ],
      },
    ],
    history: [
      { revision: 1, kind: 'created', summary: 'Initial plan', stepIds: ['inspect'] },
      { revision: 2, kind: 'step_started', stepId: 'inspect', attempt: 1 },
      { revision: 3, kind: 'step_completed', stepId: 'inspect', attempt: 1, passedCriterionIds: ['inspect-ok'] },
      { revision: 4, kind: 'finished', status: 'accepted', message: 'All steps done.' },
    ],
  }
}

test('MASTER_PLAN_RESULT_SCHEMA accepts a typical completed masterPlan', () => {
  const plan = completedMasterPlan()
  const errors = validateAgainstSchema(plan, MASTER_PLAN_RESULT_SCHEMA)
  assert.deepEqual(errors, [], `Schema validation failed: ${errors.join('; ')}`)
})

test('MASTER_PLAN_RESULT_SCHEMA rejects a step missing required fields (missing evidence)', () => {
  const plan = completedMasterPlan()
  delete plan.steps[0].evidence
  const errors = validateAgainstSchema(plan, MASTER_PLAN_RESULT_SCHEMA)
  assert.ok(errors.length > 0, 'Expected schema to reject missing evidence')
  assert.match(errors[0], /missing required property/, `Error does not mention missing required property: ${errors.join('; ')}`)
})

test('MASTER_PLAN_RESULT_SCHEMA rejects a step with an extra property', () => {
  const plan = completedMasterPlan()
  plan.steps[0].extraProperty = 'should not be allowed'
  const errors = validateAgainstSchema(plan, MASTER_PLAN_RESULT_SCHEMA)
  assert.ok(errors.length > 0, 'Expected schema to reject extra property')
  assert.match(errors[0], /extra property/, `Error does not mention extra property: ${errors.join('; ')}`)
})

test('MASTER_PLAN_RESULT_SCHEMA accepts all five history event kinds', () => {
  const kinds = ['created', 'revised', 'step_started', 'step_completed', 'finished']
  for (const kind of kinds) {
    const plan = completedMasterPlan()
    const eventTemplate = {
      created: { revision: 1, kind: 'created', summary: 'Initial', stepIds: ['inspect'] },
      revised: { revision: 2, kind: 'revised', rationale: 'Updated', added: ['a'], removed: [], order: ['a'] },
      step_started: { revision: 2, kind: 'step_started', stepId: 'inspect', attempt: 1 },
      step_completed: { revision: 2, kind: 'step_completed', stepId: 'inspect', attempt: 1, passedCriterionIds: ['inspect-ok'] },
      finished: { revision: 2, kind: 'finished', status: 'accepted', message: 'Done.' },
    }
    plan.history = [eventTemplate[kind]]
    const errors = validateAgainstSchema(plan, MASTER_PLAN_RESULT_SCHEMA)
    assert.deepEqual(errors, [], `Kind "${kind}" should be valid: ${errors.join('; ')}`)
  }
})

test('MASTER_PLAN_RESULT_SCHEMA rejects a history event with an unknown kind', () => {
  const plan = completedMasterPlan()
  plan.history = [
    { revision: 1, kind: 'unknown_kind', summary: 'Bad event' },
  ]
  const errors = validateAgainstSchema(plan, MASTER_PLAN_RESULT_SCHEMA)
  assert.ok(errors.length > 0, 'Expected schema to reject unknown kind')
  assert.match(errors[0], /does not match any oneOf variant/, `Error does not mention oneOf mismatch: ${errors.join('; ')}`)
})

test('MASTER_PLAN_RESULT_SCHEMA rejects invalid plan-level status', () => {
  const plan = completedMasterPlan()
  plan.status = 'invalid_status'
  const errors = validateAgainstSchema(plan, MASTER_PLAN_RESULT_SCHEMA)
  assert.ok(errors.length > 0, 'Expected schema to reject invalid plan status')
  assert.match(errors[0], /is not one of/, `Error does not mention enum: ${errors.join('; ')}`)
})

test('MASTER_PLAN_RESULT_SCHEMA rejects invalid step-level status', () => {
  const plan = completedMasterPlan()
  plan.steps[0].status = 'invalid_step_status'
  const errors = validateAgainstSchema(plan, MASTER_PLAN_RESULT_SCHEMA)
  assert.ok(errors.length > 0, 'Expected schema to reject invalid step status')
  assert.match(errors[0], /is not one of/, `Error does not mention enum: ${errors.join('; ')}`)
})

test('MASTER_PLAN_RESULT_SCHEMA rejects invalid finished-event status', () => {
  const plan = completedMasterPlan()
  plan.history[plan.history.length - 1].status = 'invalid_terminal'
  const errors = validateAgainstSchema(plan, MASTER_PLAN_RESULT_SCHEMA)
  assert.ok(errors.length > 0, 'Expected schema to reject invalid finished status')
  assert.match(errors[0], /does not match any oneOf variant/, `Error does not mention oneOf: ${errors.join('; ')}`)
})

test('initial plan-review prompt contains the required reviewer contract phrases', () => {
  const spec = pipelineSpec()
  const proposal = {
    planId: 'plan-task-123',
    taskId: spec.taskId,
    revision: 1,
    patchCount: 0,
    summary: 'Initial plan',
    steps: [
      {
        id: 'inspect',
        title: 'Inspect the requirement',
        objective: 'Inspect only.',
        acceptanceCriteria: [{ id: 'inspect-ok', text: 'Inspection complete with evidence.' }],
        covers: ['requirements'],
        deliverableIds: [],
        status: 'pending',
        attempts: 0,
        evidence: [],
      },
    ],
    history: [
      { revision: 1, kind: 'created', summary: 'Initial plan', stepIds: ['inspect'] },
    ],
  }
  const prompt = buildPlanReviewPrompt(spec, proposal, 'initial')
  assert.ok(prompt.includes('decision=accept requires issues=[] exactly'),
    'Prompt must include the decision=accept contract')
  assert.ok(prompt.includes('Advisory notes must not accompany accept'),
    'Prompt must include the advisory notes rule')
})
