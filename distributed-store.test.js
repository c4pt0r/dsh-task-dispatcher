import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
  DISTRIBUTED_SCHEMA_SQL,
  MemoryTaskStore,
  PostgresTaskStore,
  canonicalJson,
  createPostgresTaskStore,
  sha256Json,
} from './distributed-store.js'

const START = Date.parse('2026-08-22T00:00:00.000Z')

function harness() {
  let current = START
  let token = 0
  const store = new MemoryTaskStore({
    now: () => current,
    createLeaseToken: () => (++token).toString(16).padStart(64, '0'),
  })
  return {
    store,
    advance(ms) { current += ms },
    now() { return current },
  }
}

function enqueueInput(overrides = {}) {
  return {
    taskId: 'task-1',
    scopeId: 'scope-1',
    originSessionId: 'session-1',
    idempotencyKey: 'call-1',
    laneId: 'code',
    policyDigest: 'policy-v1',
    pool: 'general',
    payload: { title: 'Implement change', nested: { b: 2, a: 1 } },
    deadlineAt: new Date(START + 60_000).toISOString(),
    maxClaims: 3,
    ...overrides,
  }
}

function claimInput(overrides = {}) {
  return {
    workerId: '00000000-0000-4000-8000-000000000001',
    scopeId: 'scope-1',
    pools: ['general'],
    leaseMs: 10_000,
    ...overrides,
  }
}

function postgresRunningRow(overrides = {}) {
  const leaseToken = 'a'.repeat(64)
  return {
    task_id: 'task-pg',
    scope_id: 'scope-1',
    origin_session_id: 'session-1',
    idempotency_key: 'call-pg',
    request_hash: 'request-pg',
    lane_id: 'code',
    policy_digest: 'policy-v1',
    pool: 'general',
    payload: { taskId: 'task-pg', title: 'PostgreSQL task' },
    deadline_at: new Date(START + 60_000),
    max_claims: 3,
    state: 'running',
    outcome: null,
    result: null,
    result_hash: null,
    available_at: new Date(START),
    claim_count: 1,
    lease_owner: claimInput().workerId,
    lease_generation: '1',
    lease_token_hash: createHash('sha256').update(leaseToken, 'utf8').digest('hex'),
    lease_until: new Date(START + 1),
    cancel_requested_at: null,
    cancel_reason: null,
    completion_id: null,
    completed_worker_id: null,
    completed_lease_generation: null,
    completed_token_hash: null,
    created_at: new Date(START),
    updated_at: new Date(START),
    finished_at: null,
    database_now: new Date(START),
    ...overrides,
  }
}

function successfulMigrationClient(onRelease = () => {}) {
  let transactionOpen = false
  return {
    async query(query) {
      if (query === 'BEGIN') {
        assert.equal(transactionOpen, false)
        transactionOpen = true
        return { rows: [] }
      }
      if (query === 'COMMIT') {
        assert.equal(transactionOpen, true)
        transactionOpen = false
        return { rows: [] }
      }
      assert.equal(transactionOpen, true)
      assert.equal(typeof query, 'object')
      assert.match(query.text, /CREATE TABLE IF NOT EXISTS dispatcher_tasks/u)
      return { rows: [] }
    },
    release(error) {
      assert.equal(transactionOpen, false)
      assert.equal(error, undefined)
      onRelease()
    },
  }
}

function withSuccessfulMigration(pool) {
  return {
    ...pool,
    async connect() { return successfulMigrationClient() },
  }
}

test('canonical JSON sorts object keys recursively and hashes equal JSON equally', () => {
  const left = { z: [{ b: 2, a: 1 }], a: -0 }
  const right = { a: 0, z: [{ a: 1, b: 2 }] }
  assert.equal(canonicalJson(left), '{"a":0,"z":[{"a":1,"b":2}]}')
  assert.equal(canonicalJson(right), canonicalJson(left))
  assert.equal(sha256Json(right), sha256Json(left))
  assert.match(sha256Json(left), /^[a-f0-9]{64}$/u)
  assert.throws(() => canonicalJson({ value: 1n }), /JSON-compatible/u)
  assert.throws(() => canonicalJson(undefined), /JSON-compatible/u)
})

test('schema contains durable leases, idempotency, and SKIP LOCKED claim support', () => {
  assert.match(DISTRIBUTED_SCHEMA_SQL, /^\s*BEGIN;/u)
  assert.match(DISTRIBUTED_SCHEMA_SQL, /SET LOCAL statement_timeout = '300000ms'/u)
  assert.match(DISTRIBUTED_SCHEMA_SQL, /SET LOCAL lock_timeout = '300000ms'/u)
  assert.match(DISTRIBUTED_SCHEMA_SQL, /SELECT pg_advisory_xact_lock\([0-9]+::bigint\)/u)
  assert.match(DISTRIBUTED_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS dispatcher_task_store_schema/u)
  assert.match(DISTRIBUTED_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS dispatcher_tasks/u)
  assert.match(DISTRIBUTED_SCHEMA_SQL, /lease_generation\s+bigint/u)
  assert.match(DISTRIBUTED_SCHEMA_SQL, /lease_token_hash\s+text/u)
  assert.match(
    DISTRIBUTED_SCHEMA_SQL,
    /UNIQUE INDEX[\s\S]*?\(scope_id, origin_session_id, idempotency_key\)/u,
  )
  assert.match(
    DISTRIBUTED_SCHEMA_SQL,
    /DROP CONSTRAINT IF EXISTS dispatcher_tasks_scope_id_idempotency_key_key/u,
  )
  assert.match(
    DISTRIBUTED_SCHEMA_SQL,
    /IF current_version IS NULL OR current_version < 2 THEN[\s\S]*?DROP CONSTRAINT IF EXISTS dispatcher_tasks_scope_id_idempotency_key_key;[\s\S]*?END IF;/u,
  )
  const legacyMigration = DISTRIBUTED_SCHEMA_SQL.match(
    /IF current_version IS NULL OR current_version < 2 THEN(?<body>[\s\S]*?)ELSIF current_version > 2 THEN/u,
  )
  assert.ok(legacyMigration?.groups?.body, 'legacy migration must have an explicit version gate')
  assert.match(legacyMigration.groups.body, /ALTER TABLE dispatcher_tasks/u)
  assert.match(legacyMigration.groups.body, /DROP INDEX IF EXISTS dispatcher_tasks_claim_idx/u)
  assert.doesNotMatch(
    DISTRIBUTED_SCHEMA_SQL.replace(legacyMigration.groups.body, ''),
    /(?:ALTER TABLE dispatcher_tasks|DROP CONSTRAINT IF EXISTS|DROP INDEX IF EXISTS)/u,
    'lock-heavy legacy DDL must not occur on the steady-state path',
  )
  assert.match(
    DISTRIBUTED_SCHEMA_SQL,
    /to_regclass\('dispatcher_tasks_scope_id_idempotency_key_key'\) IS NOT NULL/u,
  )
  assert.match(
    DISTRIBUTED_SCHEMA_SQL,
    /INSERT INTO dispatcher_task_store_schema[\s\S]*?VALUES \('task-store', 2, clock_timestamp\(\)\)/u,
  )
  assert.match(
    DISTRIBUTED_SCHEMA_SQL,
    /ON dispatcher_tasks \(scope_id, pool, available_at, created_at, task_id\)/u,
  )
  assert.match(
    DISTRIBUTED_SCHEMA_SQL,
    /ON dispatcher_tasks \(scope_id, updated_at, task_id\)\s+WHERE state IN \('queued', 'running'\)/u,
  )
  assert.match(DISTRIBUTED_SCHEMA_SQL, /FOR UPDATE OF t SKIP LOCKED/u)
  assert.doesNotMatch(DISTRIBUTED_SCHEMA_SQL, /lease_token\s+text/u)
  assert.match(DISTRIBUTED_SCHEMA_SQL, /COMMIT;[\s\S]*$/u)
})

test('PostgreSQL initialize coalesces concurrent calls and never reruns schema SQL after success', async () => {
  let releaseInitialization
  const initializationGate = new Promise(resolve => { releaseInitialization = resolve })
  const calls = []
  let connects = 0
  let releases = 0
  let transactionOpen = false
  const client = {
    async query(query) {
      calls.push(query)
      if (query === 'BEGIN') {
        transactionOpen = true
        return { rows: [] }
      }
      if (query === 'COMMIT') {
        assert.equal(transactionOpen, true)
        transactionOpen = false
        return { rows: [] }
      }
      assert.equal(transactionOpen, true)
      await initializationGate
      return { rows: [] }
    },
    release(error) {
      assert.equal(error, undefined)
      assert.equal(transactionOpen, false)
      releases += 1
    },
  }
  const pool = {
    async query() { return { rows: [] } },
    async connect() {
      connects += 1
      return client
    },
  }
  const store = new PostgresTaskStore(pool)

  const first = store.initialize()
  const concurrent = store.initialize()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(connects, 1)
  assert.equal(calls.length, 2)
  assert.equal(calls[0], 'BEGIN')
  assert.equal(calls[1].query_timeout, 300_000)
  assert.equal(
    calls[1].text.trim(),
    DISTRIBUTED_SCHEMA_SQL.replace(/^\s*BEGIN;\s*/u, '').replace(/\s*COMMIT;\s*$/u, '').trim(),
  )
  assert.doesNotMatch(calls[1].text, /(?:^|\n)\s*(?:BEGIN|COMMIT);/u)

  releaseInitialization()
  await Promise.all([first, concurrent])
  await store.initialize()
  assert.deepEqual(calls.slice(2), ['COMMIT'])
  assert.equal(connects, 1)
  assert.equal(releases, 1)
})

test('PostgreSQL initialize rolls back and releases before retrying the same client', async () => {
  const calls = []
  const waitFailure = Object.assign(new Error('migration advisory lock wait expired'), { code: '55P03' })
  let bodyAttempts = 0
  let releases = 0
  let transactionState = 'idle'
  const client = {
    async query(query) {
      calls.push(query)
      if (query === 'BEGIN') {
        assert.equal(transactionState, 'idle', 'retry must not inherit an aborted transaction')
        transactionState = 'open'
        return { rows: [] }
      }
      if (query === 'ROLLBACK') {
        assert.equal(transactionState, 'aborted')
        transactionState = 'idle'
        return { rows: [] }
      }
      if (query === 'COMMIT') {
        assert.equal(transactionState, 'open')
        transactionState = 'idle'
        return { rows: [] }
      }
      assert.equal(transactionState, 'open')
      bodyAttempts += 1
      if (bodyAttempts === 1) {
        transactionState = 'aborted'
        throw waitFailure
      }
      return { rows: [] }
    },
    release(error) {
      assert.equal(error, undefined, 'a successful rollback keeps the connection reusable')
      assert.equal(transactionState, 'idle')
      releases += 1
    },
  }
  const pool = {
    async query() { return { rows: [] } },
    async connect() { return client },
  }
  const store = new PostgresTaskStore(pool, { migrationTimeoutMs: 90_000 })

  const first = store.initialize()
  const firstWaiter = store.initialize()
  const failed = await Promise.allSettled([first, firstWaiter])
  assert.deepEqual(failed.map(result => result.status), ['rejected', 'rejected'])

  await store.initialize()
  assert.deepEqual(calls.filter(call => typeof call === 'string'), [
    'BEGIN', 'ROLLBACK', 'BEGIN', 'COMMIT',
  ])
  assert.equal(releases, 2)
  const migrationCalls = calls.filter(call => typeof call === 'object')
  assert.equal(migrationCalls.length, 2)
  for (const call of migrationCalls) {
    assert.equal(call.query_timeout, 90_000)
    assert.match(call.text, /SET LOCAL statement_timeout = '90000ms'/u)
    assert.match(call.text, /SET LOCAL lock_timeout = '90000ms'/u)
  }
})

test('PostgreSQL claim emits one valid two-CTE statement with complete bindings', async () => {
  const calls = []
  const pool = withSuccessfulMigration({
    async query(sql, values = []) {
      calls.push({ sql, values })
      return { rows: [] }
    },
  })
  const store = new PostgresTaskStore(pool, {
    createLeaseToken: () => 'a'.repeat(64),
  })
  await store.initialize()
  assert.equal(await store.claim(claimInput()), null)

  const claim = calls.find(call => /candidate AS MATERIALIZED/u.test(call.sql))
  assert.ok(claim, 'claim SQL was issued')
  assert.match(
    claim.sql,
    /WITH db_clock AS MATERIALIZED\s*\([\s\S]*?\),\s*candidate AS MATERIALIZED\s*\([\s\S]*?\)\s*UPDATE dispatcher_tasks/u,
  )
  assert.match(claim.sql, /WHERE t\.scope_id = \$2/u)
  assert.match(
    claim.sql,
    /ORDER BY CASE\s+WHEN t\.state = 'running' THEN t\.lease_until\s+ELSE t\.available_at\s+END/u,
  )
  assert.match(
    claim.sql,
    /available_at = CASE WHEN t\.state = 'running' THEN d\.at ELSE t\.available_at END/u,
  )
  assert.doesNotMatch(claim.sql, /\)\s*,\s*\)\s*,/u)
  const placeholders = [...claim.sql.matchAll(/\$([1-9][0-9]*)/gu)].map(match => Number(match[1]))
  assert.equal(Math.max(...placeholders), claim.values.length)
  assert.deepEqual(claim.values.slice(0, 3), [
    claimInput().workerId,
    claimInput().scopeId,
    claimInput().pools,
  ])
  assert.match(claim.values[3], /^[a-f0-9]{64}$/u, 'only a token digest is bound')
  assert.notEqual(claim.values[3], 'a'.repeat(64), 'raw token is not sent to PostgreSQL')
})

test('PostgreSQL claim lets queued work run before reclaiming an expired poison task', async () => {
  const workerId = claimInput().workerId
  const claimedRows = [
    postgresRunningRow({
      task_id: 'task-b-queued',
      lease_owner: workerId,
      lease_generation: '1',
      lease_until: new Date(START + 10_000),
      server_now: new Date(START),
    }),
    postgresRunningRow({
      task_id: 'task-a-expired',
      lease_owner: workerId,
      lease_generation: '2',
      lease_until: new Date(START + 20_000),
      server_now: new Date(START + 10_000),
    }),
  ]
  let claimSql
  const housekeeping = []
  const pool = withSuccessfulMigration({
    async query(sql, values = []) {
      if (/candidate AS MATERIALIZED/u.test(sql)) {
        claimSql = sql
        return { rows: [claimedRows.shift()] }
      }
      if (/terminalizable AS MATERIALIZED/u.test(sql)) {
        housekeeping.push({ sql, values })
        if (!/LIMIT 64\s+FOR UPDATE OF t SKIP LOCKED/u.test(sql)) {
          throw new Error('simulated timeout for an unbounded backlog sweep')
        }
        assert.match(sql, /t\.state IN \('queued', 'running'\)/u)
        throw Object.assign(new Error('simulated bounded housekeeping timeout'), { code: '57014' })
      }
      return { rows: [] }
    },
  })
  const store = new PostgresTaskStore(pool, { createLeaseToken: () => 'a'.repeat(64) })

  assert.equal((await store.claim(claimInput())).taskId, 'task-b-queued')
  assert.equal((await store.claim(claimInput())).taskId, 'task-a-expired')
  assert.match(
    claimSql,
    /ORDER BY CASE\s+WHEN t\.state = 'running' THEN t\.lease_until\s+ELSE t\.available_at\s+END/u,
  )
  assert.equal(housekeeping.length, 2)
  assert.deepEqual(housekeeping.map(call => call.values), [['scope-1'], ['scope-1']])
})

test('PostgreSQL status housekeeping is task- or Session-precise and never cross-scope', async () => {
  const housekeeping = []
  const requeues = []
  const pool = withSuccessfulMigration({
    async query(sql, values = []) {
      if (/terminalizable AS MATERIALIZED/u.test(sql)) housekeeping.push({ sql, values })
      if (/requeueable AS MATERIALIZED/u.test(sql)) requeues.push({ sql, values })
      return { rows: [] }
    },
  })
  const store = new PostgresTaskStore(pool)

  assert.equal(await store.get('task-precise'), undefined)
  assert.deepEqual(await store.listBySession('scope-precise', 'session-precise'), [])
  assert.equal(housekeeping.length, 2)
  assert.match(housekeeping[0].sql, /WHERE t\.task_id = \$1/u)
  assert.deepEqual(housekeeping[0].values, ['task-precise'])
  assert.match(housekeeping[1].sql, /WHERE t\.scope_id = \$1\s+AND t\.origin_session_id = \$2/u)
  assert.deepEqual(housekeeping[1].values, ['scope-precise', 'session-precise'])
  assert.doesNotMatch(housekeeping[0].sql, /\$[123]::text IS NULL/u)
  assert.doesNotMatch(housekeeping[1].sql, /\$[123]::text IS NULL/u)
  assert.equal(requeues.length, 2)
  assert.match(requeues[0].sql, /WHERE t\.task_id = \$1/u)
  assert.deepEqual(requeues[0].values, ['task-precise'])
  assert.match(requeues[1].sql, /WHERE t\.scope_id = \$1\s+AND t\.origin_session_id = \$2/u)
  assert.deepEqual(requeues[1].values, ['scope-precise', 'session-precise'])
  for (const call of requeues) {
    assert.match(call.sql, /t\.state = 'running'/u)
    assert.match(call.sql, /t\.lease_until <= d\.at/u)
    assert.match(call.sql, /t\.cancel_requested_at IS NULL/u)
    assert.match(call.sql, /t\.deadline_at IS NULL OR t\.deadline_at > d\.at/u)
    assert.match(call.sql, /t\.claim_count < t\.max_claims/u)
    assert.match(call.sql, /SET state = 'queued'/u)
    assert.match(call.sql, /available_at = d\.at/u)
    assert.match(call.sql, /lease_owner = NULL/u)
    assert.match(call.sql, /lease_token_hash = NULL/u)
    assert.match(call.sql, /lease_until = NULL/u)
    assert.doesNotMatch(call.sql, /lease_generation\s*=/u)
  }
})

test('PostgreSQL get/list requeue an ordinary expired lease with Memory-equivalent output', async () => {
  const memory = harness()
  await memory.store.enqueue(enqueueInput({ taskId: 'task-parity' }))
  await memory.store.claim(claimInput())
  memory.advance(10_001)
  const memoryRecord = await memory.store.get('task-parity')

  let row = postgresRunningRow({
    task_id: 'task-parity',
    idempotency_key: 'call-1',
    request_hash: sha256Json(enqueueInput().payload),
    payload: enqueueInput().payload,
    available_at: new Date(START),
    lease_until: new Date(START + 10_000),
    updated_at: new Date(START),
  })
  const requeueCalls = []
  const pool = withSuccessfulMigration({
    async query(sql, values = []) {
      if (/requeueable AS MATERIALIZED/u.test(sql)) {
        requeueCalls.push({ sql, values })
        if (row.state === 'running') {
          row = {
            ...row,
            state: 'queued',
            available_at: new Date(START + 10_001),
            lease_owner: null,
            lease_token_hash: null,
            lease_until: null,
            updated_at: new Date(START + 10_001),
          }
        }
        return { rows: [] }
      }
      if (/SELECT \* FROM dispatcher_tasks WHERE task_id = \$1/u.test(sql)) return { rows: [row] }
      if (/SELECT \*\s+FROM dispatcher_tasks\s+WHERE scope_id = \$1 AND origin_session_id = \$2/u.test(sql)) {
        return { rows: [row] }
      }
      return { rows: [] }
    },
  })
  const postgres = new PostgresTaskStore(pool)
  const postgresRecord = await postgres.get('task-parity')
  const postgresList = await postgres.listBySession('scope-1', 'session-1')

  const visibleLeaseState = record => ({
    taskId: record.taskId,
    state: record.state,
    outcome: record.outcome,
    leaseOwner: record.leaseOwner,
    leaseGeneration: record.leaseGeneration,
    leaseUntil: record.leaseUntil,
    cancelRequested: record.cancelRequested,
    claimCount: record.claimCount,
  })
  assert.deepEqual(visibleLeaseState(postgresRecord), visibleLeaseState(memoryRecord))
  assert.deepEqual(postgresList.map(visibleLeaseState), [visibleLeaseState(memoryRecord)])
  assert.equal(postgresRecord.state, 'queued')
  assert.equal(postgresRecord.leaseOwner, null)
  assert.equal(postgresRecord.leaseGeneration, '1', 'the monotonic generation counter is retained')
  assert.equal(postgresRecord.leaseUntil, null)
  assert.deepEqual(requeueCalls.map(call => call.values), [
    ['task-parity'],
    ['scope-1', 'session-1'],
  ])
})

test('PostgreSQL enqueue binds idempotency to scope plus origin Session', async () => {
  const calls = []
  const row = {
    ...postgresRunningRow(),
    task_id: 'task-enqueue-pg',
    state: 'queued',
    lease_owner: null,
    lease_token_hash: null,
    lease_until: null,
    lease_generation: '0',
    claim_count: 0,
  }
  const pool = withSuccessfulMigration({
    async query(sql, values = []) {
      calls.push({ sql, values })
      if (/INSERT INTO dispatcher_tasks/u.test(sql)) return { rows: [row] }
      return { rows: [] }
    },
  })
  const store = new PostgresTaskStore(pool)
  await store.initialize()
  await store.enqueue(enqueueInput({
    taskId: row.task_id,
    taskTimeoutMs: 60_000,
    deadlineAt: '1970-01-01T00:00:00.000Z',
  }))
  const insert = calls.find(call => /INSERT INTO dispatcher_tasks/u.test(call.sql))
  assert.match(
    insert.sql,
    /ON CONFLICT \(scope_id, origin_session_id, idempotency_key\) DO NOTHING/u,
  )
  assert.match(insert.sql, /ELSE d\.at \+ \(\$10::double precision \* INTERVAL '1 millisecond'\)/u)
  assert.deepEqual(insert.values.slice(1, 4), ['scope-1', 'session-1', 'call-1'])
  assert.equal(insert.values[9], 60_000)
  assert.equal(insert.values[10], null, 'origin deadline is ignored when taskTimeoutMs is supplied')
})

test('PostgreSQL factory owns a bounded Pool and permits explicit safe overrides', async () => {
  let received
  let initializationQuery
  let ends = 0
  class FakePool {
    constructor(options) { received = options }
    async query() { return { rows: [] } }
    async connect() {
      const client = successfulMigrationClient()
      const query = client.query.bind(client)
      client.query = async (config) => {
        if (typeof config === 'object') initializationQuery = config
        return query(config)
      }
      return client
    }
    async end() { ends += 1 }
  }
  const store = await createPostgresTaskStore({
    connectionString: 'postgresql://dispatcher.invalid/tasks',
    Pool: FakePool,
    migrationTimeoutMs: 120_000,
    poolOptions: { max: 3, query_timeout: 2_000 },
  })
  assert.deepEqual(received, {
    max: 3,
    connectionTimeoutMillis: 5_000,
    query_timeout: 2_000,
    statement_timeout: 5_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
    connectionString: 'postgresql://dispatcher.invalid/tasks',
  })
  assert.equal(initializationQuery.query_timeout, 120_000)
  assert.match(initializationQuery.text, /SET LOCAL statement_timeout = '120000ms'/u)
  assert.match(initializationQuery.text, /SET LOCAL lock_timeout = '120000ms'/u)
  await store.close()
  assert.equal(ends, 1)
})

test('PostgreSQL store contains idle Pool errors and removes only its listener on close', async () => {
  class FakePool extends EventEmitter {
    async query() { return { rows: [] } }
    async connect() { return successfulMigrationClient() }
  }
  const pool = new FakePool()
  const existingListener = () => {}
  pool.on('error', existingListener)
  let logged = 0
  const store = new PostgresTaskStore(pool, {
    logger: {
      warn() {
        logged += 1
        throw new Error('broken logger')
      },
    },
  })

  assert.equal(pool.listenerCount('error'), 2)
  assert.doesNotThrow(() => pool.emit('error', new Error('idle connection failed')))
  assert.equal(logged, 1)
  await store.close()
  assert.equal(pool.listenerCount('error'), 1)
  assert.equal(pool.listeners('error')[0], existingListener)
})

test('PostgreSQL completion rechecks every fence in UPDATE when its SELECT-time lease crosses expiry', async () => {
  const calls = []
  let released = false
  const row = postgresRunningRow()
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values })
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] }
      if (/SELECT \*, clock_timestamp\(\) AS database_now/u.test(sql)) return { rows: [row] }
      if (/completed_lease_generation/u.test(sql)) {
        // The SELECT observed one remaining millisecond. Returning no row
        // simulates the UPDATE's fresh DB clock crossing the lease boundary.
        return { rows: [] }
      }
      throw new Error(`unexpected fake PostgreSQL query: ${sql}`)
    },
    release() { released = true },
  }
  const pool = {
    async query() { return { rows: [] } },
    connectCount: 0,
    async connect() {
      this.connectCount += 1
      return this.connectCount === 1 ? successfulMigrationClient() : client
    },
  }
  const store = new PostgresTaskStore(pool)
  await store.initialize()
  const lease = {
    taskId: row.task_id,
    workerId: row.lease_owner,
    leaseGeneration: row.lease_generation,
    leaseToken: 'a'.repeat(64),
  }
  const result = { status: 'accepted', message: 'too late' }

  await assert.rejects(
    store.complete(lease, {
      completionId: 'completion-pg',
      result,
      resultHash: sha256Json(result),
    }),
    error => error?.code === 'STALE_LEASE',
  )

  const update = calls.find(call => /completed_lease_generation/u.test(call.sql))
  assert.ok(update, 'terminal UPDATE was attempted')
  assert.match(update.sql, /t\.state = 'running'/u)
  assert.match(update.sql, /t\.lease_owner = \$6/u)
  assert.match(update.sql, /t\.lease_generation = \$7::bigint/u)
  assert.match(update.sql, /t\.lease_token_hash = \$8/u)
  assert.match(update.sql, /t\.lease_until > d\.at/u)
  assert.match(update.sql, /t\.deadline_at IS NULL OR t\.deadline_at > d\.at/u)
  assert.match(update.sql, /t\.cancel_requested_at IS NULL OR \$2 = 'cancelled'/u)
  assert.equal(calls.at(-1).sql, 'ROLLBACK')
  assert.equal(released, true)
})

test('PostgreSQL completion reports cancellation stably without issuing a non-cancelled UPDATE', async () => {
  const calls = []
  const row = postgresRunningRow({
    cancel_requested_at: new Date(START),
    cancel_reason: 'operator request',
    lease_until: new Date(START + 10_000),
  })
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values })
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] }
      if (/SELECT \*, clock_timestamp\(\) AS database_now/u.test(sql)) return { rows: [row] }
      throw new Error('a non-cancelled completion must not issue UPDATE after cancellation')
    },
    release() {},
  }
  const store = new PostgresTaskStore({
    async query() { return { rows: [] } },
    connectCount: 0,
    async connect() {
      this.connectCount += 1
      return this.connectCount === 1 ? successfulMigrationClient() : client
    },
  })
  await store.initialize()
  const result = { status: 'accepted' }
  await assert.rejects(
    store.complete({
      taskId: row.task_id,
      workerId: row.lease_owner,
      leaseGeneration: row.lease_generation,
      leaseToken: 'a'.repeat(64),
    }, {
      completionId: 'completion-after-cancel',
      result,
      resultHash: sha256Json(result),
    }),
    error => error?.code === 'CANCEL_REQUESTED',
  )
  assert.equal(calls.some(call => /completed_lease_generation/u.test(call.sql)), false)
  assert.equal(calls.at(-1).sql, 'ROLLBACK')
})

test('PostgreSQL transaction destroys a client when rollback fails', async () => {
  const operationFailure = new Error('connection failed during task read')
  const rollbackFailure = new Error('rollback failed')
  let releasedWith
  const transactionClient = {
    async query(sql) {
      if (sql === 'BEGIN') return { rows: [] }
      if (sql === 'ROLLBACK') throw rollbackFailure
      throw operationFailure
    },
    release(error) { releasedWith = error },
  }
  const pool = {
    connectCount: 0,
    async query() { return { rows: [] } },
    async connect() {
      this.connectCount += 1
      return this.connectCount === 1 ? successfulMigrationClient() : transactionClient
    },
  }
  const store = new PostgresTaskStore(pool)
  await store.initialize()

  await assert.rejects(store.cancel({
    taskId: 'task-pg',
    scopeId: 'scope-1',
    originSessionId: 'session-1',
    reason: 'test rollback containment',
  }), error => error === operationFailure)
  assert.equal(releasedWith, rollbackFailure)
})

test('enqueue owns immutable JSON and retries one admission idempotently', async () => {
  const { store } = harness()
  const input = enqueueInput({ requestHash: 'admission-hash' })
  const first = await store.enqueue(input)
  input.payload.nested.a = 99

  assert.equal(first.taskId, 'task-1')
  assert.equal(first.requestHash, 'admission-hash')
  assert.deepEqual(first.payload, { title: 'Implement change', nested: { b: 2, a: 1 } })
  assert.ok(Object.isFrozen(first))
  assert.ok(Object.isFrozen(first.payload.nested))
  assert.throws(() => { first.payload.title = 'mutated' }, TypeError)

  const replay = await store.enqueue(enqueueInput({
    taskId: 'task-random-retry',
    requestHash: 'admission-hash',
    payload: { ignored: 'requestHash is authoritative for admission replay' },
  }))
  assert.equal(replay.taskId, first.taskId)
  assert.deepEqual(replay.payload, first.payload)
})

test('enqueue derives a stable request hash from payload when omitted', async () => {
  const { store } = harness()
  const first = await store.enqueue(enqueueInput({ payload: { b: 2, a: 1 } }))
  const replay = await store.enqueue(enqueueInput({
    taskId: 'task-2',
    payload: { a: 1, b: 2 },
  }))
  assert.equal(replay.taskId, first.taskId)
  assert.equal(replay.requestHash, sha256Json({ a: 1, b: 2 }))
})

test('taskTimeoutMs derives the deadline from the store clock, not an origin timestamp', async () => {
  const { store } = harness()
  const record = await store.enqueue(enqueueInput({
    taskTimeoutMs: 45_000,
    deadlineAt: '1970-01-01T00:00:00.000Z',
  }))
  assert.equal(record.deadlineAt, new Date(START + 45_000).toISOString())
})

test('the same call id is idempotent within one Session but independent across Sessions', async () => {
  const { store } = harness()
  const first = await store.enqueue(enqueueInput({
    taskId: 'task-session-a',
    requestHash: 'same-admission',
  }))
  const sameSessionReplay = await store.enqueue(enqueueInput({
    taskId: 'task-session-a-retry',
    requestHash: 'same-admission',
  }))
  const otherSession = await store.enqueue(enqueueInput({
    taskId: 'task-session-b',
    originSessionId: 'session-2',
    requestHash: 'same-admission',
  }))

  assert.equal(sameSessionReplay.taskId, first.taskId)
  assert.equal(otherSession.taskId, 'task-session-b')
  assert.notEqual(otherSession.taskId, first.taskId)
})

test('an idempotency key cannot be reused for a different admission hash', async () => {
  const { store } = harness()
  await store.enqueue(enqueueInput({ requestHash: 'hash-a' }))
  await assert.rejects(
    store.enqueue(enqueueInput({ taskId: 'task-2', requestHash: 'hash-b' })),
    error => error?.code === 'IDEMPOTENCY_CONFLICT',
  )
})

test('claim filters pools and publishes a raw token only in the immutable lease', async () => {
  const { store } = harness()
  await store.enqueue(enqueueInput())
  assert.equal(await store.claim(claimInput({ pools: ['other'] })), null)

  const lease = await store.claim(claimInput())
  assert.equal(lease.taskId, 'task-1')
  assert.equal(lease.leaseGeneration, '1')
  assert.match(lease.leaseToken, /^[a-f0-9]{64}$/u)
  assert.equal(lease.serverNow, new Date(START).toISOString())
  assert.equal(lease.leaseUntil, new Date(START + 10_000).toISOString())
  assert.equal(lease.cancelRequested, false)
  assert.ok(Object.isFrozen(lease))
  assert.ok(Object.isFrozen(lease.payload))

  const visible = await store.get('task-1')
  assert.equal(visible.state, 'running')
  assert.equal(visible.leaseOwner, claimInput().workerId)
  assert.equal('leaseToken' in visible, false)
  assert.equal('leaseTokenHash' in visible, false)
})

test('concurrent claimers cannot receive the same task generation', async () => {
  const { store } = harness()
  await store.enqueue(enqueueInput())
  const claims = await Promise.all(Array.from({ length: 16 }, (_, index) => store.claim(claimInput({
    workerId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  }))))
  assert.equal(claims.filter(Boolean).length, 1)
})

test('claim never crosses scope boundaries even when pool names are equal', async () => {
  const { store } = harness()
  await store.enqueue(enqueueInput({ taskId: 'task-scope-a', idempotencyKey: 'a' }))
  await store.enqueue(enqueueInput({
    taskId: 'task-scope-b',
    scopeId: 'scope-2',
    idempotencyKey: 'b',
  }))

  const scopeB = await store.claim(claimInput({
    scopeId: 'scope-2',
    workerId: '00000000-0000-4000-8000-000000000002',
  }))
  assert.equal(scopeB.taskId, 'task-scope-b')
  assert.equal(scopeB.scopeId, 'scope-2')
  assert.equal(await store.claim(claimInput({ scopeId: 'scope-2' })), null)

  const scopeA = await store.claim(claimInput())
  assert.equal(scopeA.taskId, 'task-scope-a')
  assert.equal(scopeA.scopeId, 'scope-1')
})

test('heartbeat uses exact owner, generation, token, and an unexpired lease', async () => {
  const h = harness()
  await h.store.enqueue(enqueueInput())
  const lease = await h.store.claim(claimInput())

  await assert.rejects(
    h.store.heartbeat({ ...lease, workerId: '00000000-0000-4000-8000-999999999999' }, 10_000),
    error => error?.code === 'STALE_LEASE',
  )
  await assert.rejects(
    h.store.heartbeat({ ...lease, leaseGeneration: '2' }, 10_000),
    error => error?.code === 'STALE_LEASE',
  )
  await assert.rejects(
    h.store.heartbeat({ ...lease, leaseToken: 'f'.repeat(64) }, 10_000),
    error => error?.code === 'STALE_LEASE',
  )

  h.advance(5_000)
  const renewed = await h.store.heartbeat(lease, 20_000)
  assert.equal(renewed.serverNow, new Date(START + 5_000).toISOString())
  assert.equal(renewed.leaseUntil, new Date(START + 25_000).toISOString())
  assert.equal(renewed.cancelRequested, false)

  h.advance(20_001)
  await assert.rejects(
    h.store.heartbeat(lease, 10_000),
    error => error?.code === 'STALE_LEASE',
  )
})

test('an expired task is reclaimed with a new token and monotonically increasing generation', async () => {
  const h = harness()
  await h.store.enqueue(enqueueInput())
  const first = await h.store.claim(claimInput())
  h.advance(10_001)
  const second = await h.store.claim(claimInput({
    workerId: '00000000-0000-4000-8000-000000000002',
  }))
  assert.equal(second.leaseGeneration, '2')
  assert.notEqual(second.leaseToken, first.leaseToken)
  await assert.rejects(
    h.store.complete(first, {
      completionId: '00000000-0000-4000-8000-000000000011',
      result: { status: 'accepted' },
      resultHash: sha256Json({ status: 'accepted' }),
    }),
    error => error?.code === 'STALE_LEASE',
  )
})

test('complete validates the result digest and supports lost-response replay', async () => {
  const { store } = harness()
  await store.enqueue(enqueueInput())
  const lease = await store.claim(claimInput())
  const result = { status: 'accepted', message: 'verified', nested: { evidence: true } }
  const completion = {
    completionId: '00000000-0000-4000-8000-000000000021',
    result,
    resultHash: sha256Json(result),
  }

  await assert.rejects(
    store.complete(lease, { ...completion, resultHash: '0'.repeat(64) }),
    error => error?.code === 'RESULT_HASH_MISMATCH',
  )
  const first = await store.complete(lease, completion)
  result.nested.evidence = false
  assert.equal(first.state, 'terminal')
  assert.equal(first.outcome, 'accepted')
  assert.equal(first.result.nested.evidence, true)
  assert.ok(Object.isFrozen(first.result.nested))

  const replay = await store.complete(lease, {
    ...completion,
    result: { nested: { evidence: true }, message: 'verified', status: 'accepted' },
  })
  assert.deepEqual(replay, first)

  await assert.rejects(
    store.complete(lease, {
      completionId: completion.completionId,
      result: { status: 'rejected' },
      resultHash: sha256Json({ status: 'rejected' }),
    }),
    error => error?.code === 'COMPLETION_CONFLICT',
  )
})

test('worker completion attribution survives Memory and PostgreSQL get/list without token material', async () => {
  const memory = harness()
  await memory.store.enqueue(enqueueInput())
  const lease = await memory.store.claim(claimInput())
  const result = { status: 'accepted', message: 'verified placement' }
  const completionId = '00000000-0000-4000-8000-000000000022'
  const completed = await memory.store.complete(lease, {
    completionId,
    result,
    resultHash: sha256Json(result),
  })
  const memoryGet = await memory.store.get('task-1')
  const memoryList = await memory.store.listBySession('scope-1', 'session-1')

  const terminalRow = postgresRunningRow({
    task_id: 'task-1',
    idempotency_key: 'call-1',
    request_hash: sha256Json(enqueueInput().payload),
    payload: enqueueInput().payload,
    state: 'terminal',
    outcome: 'accepted',
    result,
    result_hash: sha256Json(result),
    lease_owner: null,
    lease_token_hash: null,
    lease_until: null,
    completion_id: completionId,
    completed_worker_id: lease.workerId,
    completed_lease_generation: lease.leaseGeneration,
    completed_token_hash: 'f'.repeat(64),
    finished_at: new Date(START),
  })
  const postgres = new PostgresTaskStore(withSuccessfulMigration({
    async query(sql) {
      if (/SELECT \* FROM dispatcher_tasks WHERE task_id = \$1/u.test(sql)) {
        return { rows: [terminalRow] }
      }
      if (/SELECT \*\s+FROM dispatcher_tasks\s+WHERE scope_id = \$1 AND origin_session_id = \$2/u.test(sql)) {
        return { rows: [terminalRow] }
      }
      return { rows: [] }
    },
  }))
  const postgresGet = await postgres.get('task-1')
  const postgresList = await postgres.listBySession('scope-1', 'session-1')

  const views = [completed, memoryGet, ...memoryList, postgresGet, ...postgresList]
  for (const view of views) {
    assert.equal(view.completedWorkerId, lease.workerId)
    assert.equal(view.completedLeaseGeneration, '1')
    assert.equal(view.completionId, completionId)
    assert.equal(Object.keys(view).some(key => /token/iu.test(key)), false)
  }
  assert.deepEqual(
    [postgresGet.completedWorkerId, postgresGet.completedLeaseGeneration],
    [memoryGet.completedWorkerId, memoryGet.completedLeaseGeneration],
  )
})

test('queued cancellation is immediately terminal and session-scoped', async () => {
  const { store } = harness()
  await store.enqueue(enqueueInput())
  await assert.rejects(
    store.cancel({
      taskId: 'task-1', scopeId: 'other', originSessionId: 'session-1', reason: 'stop',
    }),
    error => error?.code === 'TASK_NOT_FOUND',
  )
  const cancelled = await store.cancel({
    taskId: 'task-1', scopeId: 'scope-1', originSessionId: 'session-1', reason: 'user stopped it',
  })
  assert.equal(cancelled.state, 'terminal')
  assert.equal(cancelled.outcome, 'cancelled')
  assert.deepEqual(cancelled.result, { status: 'cancelled', message: 'user stopped it' })
  assert.equal(await store.claim(claimInput()), null)
})

test('running cancellation is observed by heartbeat and may complete as cancelled', async () => {
  const { store } = harness()
  await store.enqueue(enqueueInput())
  const lease = await store.claim(claimInput())
  const pending = await store.cancel({
    taskId: 'task-1', scopeId: 'scope-1', originSessionId: 'session-1', reason: 'changed priorities',
  })
  assert.equal(pending.state, 'running')
  assert.equal(pending.cancelRequested, true)

  const heartbeat = await store.heartbeat(lease, 10_000)
  assert.equal(heartbeat.cancelRequested, true)
  assert.equal(heartbeat.cancelReason, 'changed priorities')

  await assert.rejects(
    store.complete(lease, {
      completionId: '00000000-0000-4000-8000-000000000031',
      result: { status: 'accepted' },
      resultHash: sha256Json({ status: 'accepted' }),
    }),
    error => error?.code === 'CANCEL_REQUESTED',
  )

  const result = { status: 'cancelled', message: 'changed priorities' }
  const complete = await store.complete(lease, {
    completionId: '00000000-0000-4000-8000-000000000032',
    result,
    resultHash: sha256Json(result),
  })
  assert.equal(complete.outcome, 'cancelled')
})

test('an abandoned cancelled lease closes as cancelled instead of being reclaimed', async () => {
  const h = harness()
  await h.store.enqueue(enqueueInput())
  await h.store.claim(claimInput())
  await h.store.cancel({
    taskId: 'task-1', scopeId: 'scope-1', originSessionId: 'session-1', reason: 'stop',
  })
  h.advance(10_001)
  assert.equal(await h.store.claim(claimInput()), null)
  assert.equal((await h.store.get('task-1')).outcome, 'cancelled')
})

test('claim closes exhausted and overdue work instead of leaving it immortal', async () => {
  const exhausted = harness()
  await exhausted.store.enqueue(enqueueInput({ maxClaims: 1 }))
  await exhausted.store.claim(claimInput())
  exhausted.advance(10_001)
  assert.equal(await exhausted.store.claim(claimInput()), null)
  const exhaustedTask = await exhausted.store.get('task-1')
  assert.equal(exhaustedTask.state, 'terminal')
  assert.equal(exhaustedTask.outcome, 'error')
  assert.match(exhaustedTask.result.message, /maximum claim count/u)
  assert.equal(exhaustedTask.completedWorkerId, null)
  assert.equal(exhaustedTask.completedLeaseGeneration, null)

  const overdue = harness()
  await overdue.store.enqueue(enqueueInput({ deadlineAt: new Date(START + 1_000).toISOString() }))
  overdue.advance(1_001)
  assert.equal(await overdue.store.claim(claimInput()), null)
  const overdueTask = await overdue.store.get('task-1')
  assert.equal(overdueTask.state, 'terminal')
  assert.match(overdueTask.result.message, /deadline/u)
  assert.equal(overdueTask.completedWorkerId, null)
  assert.equal(overdueTask.completedLeaseGeneration, null)
})

test('listBySession is isolated, ordered, cloned, and frozen', async () => {
  const h = harness()
  assert.equal(await h.store.get('missing-task'), undefined)
  await h.store.enqueue(enqueueInput({ taskId: 'task-a', idempotencyKey: 'a' }))
  h.advance(1)
  await h.store.enqueue(enqueueInput({ taskId: 'task-b', idempotencyKey: 'b' }))
  await h.store.enqueue(enqueueInput({
    taskId: 'task-other', idempotencyKey: 'c', originSessionId: 'other-session',
  }))
  const tasks = await h.store.listBySession('scope-1', 'session-1')
  assert.deepEqual(tasks.map(task => task.taskId), ['task-b', 'task-a'])
  assert.ok(Object.isFrozen(tasks))
  assert.ok(tasks.every(Object.isFrozen))
})

test('close is idempotent and rejects later work through ordinary awaited promises', async () => {
  const { store } = harness()
  await store.close()
  await store.close()
  await assert.rejects(store.enqueue(enqueueInput()), /closed/u)
  await assert.rejects(store.claim(claimInput()), /closed/u)
})
