import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ConfigProposalAuthority,
  canonicalProposalJson,
  proposalDigest,
} from './config-proposals.js'

const START = Date.parse('2026-08-24T00:00:00.000Z')
const EMPTY = proposalDigest({})
const CHANGED = proposalDigest({ rules: { changed: true } })
const LATER = proposalDigest({ rules: { later: true } })

function subject(overrides = {}) {
  return {
    taskId: 'task-1',
    runId: 'run-1',
    childSessionId: 'child-1',
    parentSessionId: 'root-1',
    laneId: 'development',
    policyDigest: 'policy-v1',
    ...overrides,
  }
}

function promptAdd(overrides = {}) {
  return {
    scope: 'persistent',
    resource: 'prompt-rewrite',
    expectedRawDigest: EMPTY,
    operation: {
      kind: 'add',
      rule: {
        name: 'Task prefix',
        enabled: false,
        mode: 'prepend',
        text: 'Treat input as test data.',
        ...overrides,
      },
    },
  }
}

function triggerAdd(overrides = {}) {
  return {
    scope: 'persistent',
    resource: 'trigger',
    expectedRawDigest: EMPTY,
    operation: {
      kind: 'add',
      trigger: {
        name: 'Review task',
        enabled: false,
        cron: '0 9 * * 1-5',
        timeZone: 'UTC',
        prompt: 'Review the task status.',
        ...overrides,
      },
    },
  }
}

function harness(options = {}) {
  let now = START
  let id = 0
  const calls = []
  const externalAudit = []
  const transact = options.transact ?? (async (request) => {
    calls.push(request)
    return {
      status: 'committed',
      beforeRawDigest: request.expectedRawDigest,
      afterRawDigest: CHANGED,
      inverseOps: [{ op: 'unset', path: [request.namespace === 'dsh-trigger' ? 'triggers' : 'rules', request.ops[0].path[1]] }],
      revision: 1,
      idempotent: false,
    }
  })
  const authority = new ConfigProposalAuthority({
    now: () => now,
    createId: () => `id-${++id}`,
    transact,
    appendAudit: options.appendAudit ?? (async entry => { externalAudit.push(entry) }),
    proposalTtlMs: options.proposalTtlMs ?? 10_000,
    ephemeralTtlMs: options.ephemeralTtlMs ?? 5_000,
  })
  return {
    authority,
    calls,
    externalAudit,
    advance(ms) { now += ms },
    now() { return now },
  }
}

async function approved(authority, request = promptAdd()) {
  const proposal = await authority.createPersistent(subject(), request)
  await authority.approvePersistent({
    proposalId: proposal.proposalId,
    digest: proposal.digest,
    expectedRawDigest: proposal.expectedRawDigest,
    expiresAt: proposal.expiresAt,
    approvedBy: 'human-operator',
  })
  return authority.inspectPersistent(proposal.proposalId)
}

function applyInput(proposal) {
  return {
    proposalId: proposal.proposalId,
    digest: proposal.digest,
    expectedRawDigest: proposal.expectedRawDigest,
    expiresAt: proposal.expiresAt,
  }
}

test('canonical proposal JSON is deterministic, strict, and digest-stable', () => {
  const left = { z: [{ b: 2, a: 1 }], a: -0 }
  const right = { a: 0, z: [{ a: 1, b: 2 }] }
  assert.equal(canonicalProposalJson(left), '{"a":0,"z":[{"a":1,"b":2}]}')
  assert.equal(canonicalProposalJson(left), canonicalProposalJson(right))
  assert.equal(proposalDigest(left), proposalDigest(right))
  assert.match(proposalDigest(left), /^[a-f0-9]{64}$/u)
  assert.throws(() => canonicalProposalJson({ value: 1n }), error => error.code === 'INVALID_ARGUMENT')
  assert.throws(() => canonicalProposalJson({ value: undefined }), error => error.code === 'INVALID_ARGUMENT')
  let deep = {}
  for (let index = 0; index < 70; index++) deep = { child: deep }
  assert.throws(() => canonicalProposalJson(deep), error => error.code === 'OVERSIZE')
})

test('preview is deterministic, deeply frozen, and has zero authority side effects', () => {
  const h = harness()
  const before = h.authority.stats()
  const first = h.authority.preview(subject(), promptAdd())
  const second = h.authority.preview(subject(), {
    operation: promptAdd().operation,
    expectedRawDigest: EMPTY,
    resource: 'prompt-rewrite',
    scope: 'persistent',
  })
  assert.deepEqual(h.authority.stats(), before)
  assert.equal(first.digest, second.digest)
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first.operation.rule), true)
  assert.throws(() => { first.operation.rule.name = 'tampered' }, TypeError)
})

test('strict wire rejects namespaces, protected fields, unknown keys, and unsafe enabled adds', () => {
  const h = harness()
  assert.throws(
    () => h.authority.preview(subject(), { ...promptAdd(), namespace: 'dsh-task-dispatcher' }),
    error => error.code === 'PROTECTED_NAMESPACE',
  )
  assert.throws(
    () => h.authority.preview(subject(), {
      ...triggerAdd(),
      operation: {
        kind: 'add',
        trigger: { ...triggerAdd().operation.trigger, targetAgentId: 'root-2' },
      },
    }),
    error => error.code === 'PROTECTED_FIELD',
  )
  assert.throws(
    () => h.authority.preview(subject(), { ...promptAdd(), surprise: true }),
    error => error.code === 'UNKNOWN_KEY',
  )
  assert.throws(
    () => h.authority.preview(subject(), promptAdd({ enabled: true })),
    error => error.code === 'UNSAFE_INITIAL_STATE',
  )
})

test('oversize prompt/trigger content fails before proposal or audit state changes', async () => {
  const h = harness()
  assert.throws(
    () => h.authority.preview(subject(), promptAdd({ text: 'x'.repeat(4_097) })),
    error => error.code === 'OVERSIZE',
  )
  await assert.rejects(
    h.authority.createPersistent(subject(), triggerAdd({ prompt: 'x'.repeat(4_097) })),
    error => error.code === 'OVERSIZE',
  )
  assert.deepEqual(h.authority.stats(), { proposals: 0, overlays: 0, auditEvents: 0 })
})

test('task-ephemeral overlays are subject-bound, non-durable, non-extensible, and disposed', async () => {
  const h = harness()
  const request = {
    ...promptAdd(),
    scope: 'task-ephemeral',
  }
  delete request.expectedRawDigest
  const staged = await h.authority.stageEphemeral(subject(), request)
  const ruleId = Object.keys(staged.objects['prompt-rewrite'])[0]
  assert.ok(ruleId)
  assert.equal(staged.objects['prompt-rewrite'][ruleId].enabled, false)
  assert.equal(h.calls.length, 0, 'ephemeral overlay must not call the durable transaction provider')

  const enabled = await h.authority.stageEphemeral(subject(), {
    scope: 'task-ephemeral',
    resource: 'prompt-rewrite',
    operation: { kind: 'set_enabled', objectId: ruleId, enabled: true },
  }, { expiresAt: new Date(START + 4_000).toISOString() })
  assert.equal(enabled.objects['prompt-rewrite'][ruleId].enabled, true)
  assert.equal(enabled.expiresAt, new Date(START + 4_000).toISOString(), 'later calls may shorten but never extend a lease')
  assert.deepEqual((await h.authority.ephemeralSnapshot(subject({ runId: 'other' }))).objects['prompt-rewrite'], {})

  const disposed = await h.authority.disposeEphemeral(subject(), 'child-cleanup')
  assert.deepEqual(disposed, { disposed: true })
  assert.equal((await h.authority.ephemeralSnapshot(subject())).revision, 0)
  assert.equal((await h.authority.disposeEphemeral(subject())).disposed, false)
})

test('task-ephemeral overlays expire and cannot manage another subject object', async () => {
  const h = harness()
  const request = { ...promptAdd(), scope: 'task-ephemeral' }
  delete request.expectedRawDigest
  const staged = await h.authority.stageEphemeral(subject(), request)
  const ruleId = Object.keys(staged.objects['prompt-rewrite'])[0]
  await assert.rejects(
    h.authority.stageEphemeral(subject({ runId: 'other' }), {
      scope: 'task-ephemeral',
      resource: 'prompt-rewrite',
      operation: { kind: 'remove', objectId: ruleId },
    }),
    error => error.code === 'OVERLAY_OBJECT_NOT_FOUND',
  )
  h.advance(5_001)
  const expired = await h.authority.ephemeralSnapshot(subject())
  assert.equal(expired.revision, 0)
  assert.deepEqual(expired.objects['prompt-rewrite'], {})
})

test('persistent approval binds exact digest, raw CAS digest, and expiry', async () => {
  const h = harness()
  const proposal = await h.authority.createPersistent(subject(), promptAdd())
  await assert.rejects(h.authority.approvePersistent({
    proposalId: proposal.proposalId,
    digest: CHANGED,
    expectedRawDigest: proposal.expectedRawDigest,
    expiresAt: proposal.expiresAt,
    approvedBy: 'human',
  }), error => error.code === 'PROPOSAL_TAMPERED')
  await assert.rejects(h.authority.approvePersistent({
    proposalId: proposal.proposalId,
    digest: proposal.digest,
    expectedRawDigest: CHANGED,
    expiresAt: proposal.expiresAt,
    approvedBy: 'human',
  }), error => error.code === 'APPROVAL_MISMATCH')
  const approvedProposal = await h.authority.approvePersistent({
    proposalId: proposal.proposalId,
    digest: proposal.digest,
    expectedRawDigest: proposal.expectedRawDigest,
    expiresAt: proposal.expiresAt,
    approvedBy: 'human',
  })
  assert.equal(approvedProposal.state, 'approved')
  await assert.rejects(h.authority.approvePersistent({
    proposalId: proposal.proposalId,
    digest: proposal.digest,
    expectedRawDigest: proposal.expectedRawDigest,
    expiresAt: proposal.expiresAt,
    approvedBy: 'human',
  }), error => error.code === 'INVALID_STATE')
})

test('typed trigger set_enabled/remove map only to the fixed trigger namespace and reject fire', async () => {
  const calls = []
  const h = harness({
    transact: async (request) => {
      calls.push(request)
      const op = request.ops[0]
      return {
        status: 'committed',
        beforeRawDigest: request.expectedRawDigest,
        afterRawDigest: CHANGED,
        inverseOps: op.path.length === 3
          ? [{ op: 'set', path: op.path, value: false }]
          : [{
              op: 'set',
              path: op.path,
              value: {
                name: 'Existing trigger', enabled: false, cron: '0 9 * * *',
                timeZone: 'UTC', prompt: 'Restored by the provider.',
              },
            }],
      }
    },
  })
  assert.throws(() => h.authority.preview(subject(), {
    scope: 'persistent',
    resource: 'trigger',
    expectedRawDigest: EMPTY,
    operation: { kind: 'fire', objectId: 'trigger-existing' },
  }), error => error.code === 'INVALID_ARGUMENT')

  for (const operation of [
    { kind: 'set_enabled', objectId: 'trigger-existing', enabled: true },
    { kind: 'remove', objectId: 'trigger-existing' },
  ]) {
    const proposal = await approved(h.authority, {
      scope: 'persistent',
      resource: 'trigger',
      expectedRawDigest: EMPTY,
      operation,
    })
    await h.authority.applyPersistent(applyInput(proposal))
  }
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map(call => call.namespace), ['dsh-trigger', 'dsh-trigger'])
  assert.deepEqual(calls.map(call => call.ops[0].path), [
    ['triggers', 'trigger-existing', 'enabled'],
    ['triggers', 'trigger-existing'],
  ])
})

test('expired proposal cannot be approved or applied', async () => {
  const h = harness({ proposalTtlMs: 1_000 })
  const pending = await h.authority.createPersistent(subject(), promptAdd())
  h.advance(1_001)
  await assert.rejects(h.authority.approvePersistent({
    proposalId: pending.proposalId,
    digest: pending.digest,
    expectedRawDigest: pending.expectedRawDigest,
    expiresAt: pending.expiresAt,
    approvedBy: 'human',
  }), error => error.code === 'PROPOSAL_EXPIRED')

  const h2 = harness({ proposalTtlMs: 1_000 })
  const proposal = await approved(h2.authority)
  h2.advance(1_001)
  await assert.rejects(h2.authority.applyPersistent(applyInput(proposal)), error => error.code === 'PROPOSAL_EXPIRED')
  assert.equal(h2.calls.length, 0)
})

test('tampered apply is rejected before transact and exact replay is idempotent', async () => {
  const h = harness()
  const proposal = await approved(h.authority)
  await assert.rejects(
    h.authority.applyPersistent({ ...applyInput(proposal), digest: CHANGED }),
    error => error.code === 'PROPOSAL_TAMPERED',
  )
  assert.equal(h.calls.length, 0)
  const first = await h.authority.applyPersistent(applyInput(proposal))
  const replay = await h.authority.applyPersistent(applyInput(proposal))
  assert.equal(first.status, 'committed')
  assert.equal(first.idempotentReplay, false)
  assert.equal(replay.idempotentReplay, true)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].mutationId, `mutation-${proposal.proposalId}`)
  assert.equal(Object.hasOwn(h.calls[0], 'token'), false)
})

test('concurrent apply calls coalesce to one stable mutationId', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const calls = []
  const h = harness({
    transact: async (request) => {
      calls.push(request)
      await gate
      return {
        status: 'committed',
        beforeRawDigest: request.expectedRawDigest,
        afterRawDigest: CHANGED,
        inverseOps: [{ op: 'unset', path: ['rules', request.ops[0].path[1]] }],
      }
    },
  })
  const proposal = await approved(h.authority)
  const first = h.authority.applyPersistent(applyInput(proposal))
  const second = h.authority.applyPersistent(applyInput(proposal))
  await Promise.resolve()
  release()
  const [left, right] = await Promise.all([first, second])
  assert.equal(calls.length, 1)
  assert.equal(left.afterRawDigest, right.afterRawDigest)
})

test('an indeterminate provider failure retries with the same mutationId', async () => {
  const calls = []
  const h = harness({
    transact: async (request) => {
      calls.push(request)
      if (calls.length === 1) throw new Error('connection lost after transaction boundary')
      return {
        status: 'committed',
        beforeRawDigest: request.expectedRawDigest,
        afterRawDigest: CHANGED,
        inverseOps: [{ op: 'unset', path: ['rules', request.ops[0].path[1]] }],
        idempotent: true,
      }
    },
  })
  const proposal = await approved(h.authority)
  await assert.rejects(h.authority.applyPersistent(applyInput(proposal)), /connection lost/u)
  assert.equal(h.authority.inspectPersistent(proposal.proposalId).state, 'approved')
  const retried = await h.authority.applyPersistent(applyInput(proposal))
  assert.equal(retried.transactionIdempotent, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].mutationId, calls[1].mutationId)
})

test('CAS conflict is terminal, audited, and never reported as committed', async () => {
  const calls = []
  const h = harness({
    transact: async (request) => {
      calls.push(request)
      return { status: 'conflict', actualRawDigest: LATER }
    },
  })
  const proposal = await approved(h.authority)
  const conflict = await h.authority.applyPersistent(applyInput(proposal))
  assert.deepEqual(conflict, {
    proposalId: proposal.proposalId,
    digest: proposal.digest,
    status: 'conflict',
    state: 'conflict',
    expectedRawDigest: EMPTY,
    actualRawDigest: LATER,
    idempotentReplay: false,
  })
  assert.equal((await h.authority.applyPersistent(applyInput(proposal))).idempotentReplay, true)
  assert.equal(calls.length, 1)
  assert.match(h.authority.auditLog().map(entry => entry.kind).join(','), /persistent\.apply\.conflict/u)
})

test('conditional rollback restores only the committed digest and uses a distinct idempotency key', async () => {
  const calls = []
  const h = harness({
    transact: async (request) => {
      calls.push(request)
      if (calls.length === 1) {
        return {
          status: 'committed',
          beforeRawDigest: EMPTY,
          afterRawDigest: CHANGED,
          inverseOps: [{ op: 'unset', path: ['rules', request.ops[0].path[1]] }],
        }
      }
      return {
        status: 'committed',
        beforeRawDigest: CHANGED,
        afterRawDigest: EMPTY,
        inverseOps: [{ op: 'set', path: ['rules', request.ops[0].path[1]], value: { enabled: false } }],
      }
    },
  })
  const proposal = await approved(h.authority)
  const committed = await h.authority.applyPersistent(applyInput(proposal))
  await assert.rejects(h.authority.rollbackPersistent({
    proposalId: proposal.proposalId,
    digest: proposal.digest,
    expectedRawDigest: LATER,
  }), error => error.code === 'ROLLBACK_MISMATCH')
  const rolledBack = await h.authority.rollbackPersistent({
    proposalId: proposal.proposalId,
    digest: proposal.digest,
    expectedRawDigest: committed.afterRawDigest,
  })
  assert.equal(rolledBack.state, 'rolled-back')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].expectedRawDigest, CHANGED)
  assert.equal(calls[1].mutationId, `mutation-${proposal.proposalId}-rollback`)
  assert.equal((await h.authority.rollbackPersistent({
    proposalId: proposal.proposalId,
    digest: proposal.digest,
    expectedRawDigest: committed.afterRawDigest,
  })).idempotentReplay, true)
})

test('rollback CAS conflict preserves the later digest', async () => {
  let call = 0
  const h = harness({
    transact: async (request) => {
      call += 1
      if (call === 1) {
        return {
          status: 'committed',
          beforeRawDigest: EMPTY,
          afterRawDigest: CHANGED,
          inverseOps: [{ op: 'unset', path: ['rules', request.ops[0].path[1]] }],
        }
      }
      return { status: 'conflict', actualRawDigest: LATER }
    },
  })
  const proposal = await approved(h.authority)
  const committed = await h.authority.applyPersistent(applyInput(proposal))
  const conflict = await h.authority.rollbackPersistent({
    proposalId: proposal.proposalId,
    digest: proposal.digest,
    expectedRawDigest: committed.afterRawDigest,
  })
  assert.equal(conflict.state, 'rollback-conflict')
  assert.equal(conflict.actualRawDigest, LATER)
  assert.equal(call, 2)
})

test('audit is append-only and redacts rule/trigger content', async () => {
  const h = harness()
  const prompt = await h.authority.createPersistent(subject(), promptAdd({
    text: 'VERY-SECRET-RULE-TEXT',
    contains: 'PRIVATE-MATCH',
  }))
  await h.authority.createPersistent(subject(), triggerAdd({ prompt: 'PRIVATE-TRIGGER-PROMPT' }))
  const log = h.authority.auditLog()
  const encoded = JSON.stringify(log)
  assert.equal(encoded.includes('VERY-SECRET-RULE-TEXT'), false)
  assert.equal(encoded.includes('PRIVATE-MATCH'), false)
  assert.equal(encoded.includes('PRIVATE-TRIGGER-PROMPT'), false)
  assert.match(encoded, /"redacted":true/u)
  assert.equal(Object.isFrozen(log), true)
  assert.equal(Object.isFrozen(log[0]), true)
  assert.equal(h.authority.inspectPersistent(prompt.proposalId).state, 'pending')
})

test('audit sink failure is fail-closed before ephemeral, proposal, approval, apply, and rollback effects', async () => {
  let failNext = true
  const transactionCalls = []
  const h = harness({
    appendAudit: async () => {
      if (failNext) throw new Error('audit disk unavailable')
    },
    transact: async (request) => {
      transactionCalls.push(request)
      return {
        status: 'committed',
        beforeRawDigest: request.expectedRawDigest,
        afterRawDigest: CHANGED,
        inverseOps: [{ op: 'unset', path: ['rules', request.ops[0].path[1]] }],
      }
    },
  })
  const ephemeral = { ...promptAdd(), scope: 'task-ephemeral' }
  delete ephemeral.expectedRawDigest
  await assert.rejects(h.authority.stageEphemeral(subject(), ephemeral), error => error.code === 'AUDIT_UNAVAILABLE')
  assert.equal(h.authority.stats().overlays, 0)
  await assert.rejects(h.authority.createPersistent(subject(), promptAdd()), error => error.code === 'AUDIT_UNAVAILABLE')
  assert.equal(h.authority.stats().proposals, 0)

  failNext = false
  const proposal = await h.authority.createPersistent(subject(), promptAdd())
  failNext = true
  await assert.rejects(h.authority.approvePersistent({
    proposalId: proposal.proposalId,
    digest: proposal.digest,
    expectedRawDigest: proposal.expectedRawDigest,
    expiresAt: proposal.expiresAt,
    approvedBy: 'human',
  }), error => error.code === 'AUDIT_UNAVAILABLE')
  assert.equal(h.authority.inspectPersistent(proposal.proposalId).state, 'pending')

  failNext = false
  await h.authority.approvePersistent({
    proposalId: proposal.proposalId,
    digest: proposal.digest,
    expectedRawDigest: proposal.expectedRawDigest,
    expiresAt: proposal.expiresAt,
    approvedBy: 'human',
  })
  failNext = true
  await assert.rejects(h.authority.applyPersistent(applyInput(proposal)), error => error.code === 'AUDIT_UNAVAILABLE')
  assert.equal(transactionCalls.length, 0)
  assert.equal(h.authority.inspectPersistent(proposal.proposalId).state, 'approved')

  failNext = false
  const committed = await h.authority.applyPersistent(applyInput(proposal))
  failNext = true
  await assert.rejects(h.authority.rollbackPersistent({
    proposalId: proposal.proposalId,
    digest: proposal.digest,
    expectedRawDigest: committed.afterRawDigest,
  }), error => error.code === 'AUDIT_UNAVAILABLE')
  assert.equal(transactionCalls.length, 1)
  assert.equal(h.authority.inspectPersistent(proposal.proposalId).state, 'committed')
})
