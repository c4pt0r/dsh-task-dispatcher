import { describe, expect, it } from 'vitest'
import { decodeDispatcherSnapshot, DispatcherDecodeError } from '../../src/client/decode.ts'

function validSnapshot(): Record<string, unknown> {
  return {
    protocolVersion: 1,
    revision: 4,
    sessionId: 'session-1',
    generatedAt: 1_700_000_000_000,
    tasks: [{
      taskId: 'task-1',
      jobId: 'job-1',
      lane: 'safe-change',
      title: 'Improve the dispatcher',
      status: 'running',
      phase: 'step-executor',
      startedAt: 1_700_000_000_000,
      updatedAt: 1_700_000_001_000,
      masterPlan: {
        planId: 'plan-1',
        revision: 2,
        patchCount: 1,
        status: 'active',
        summary: 'Implement and verify.',
        steps: [{
          id: 's1',
          title: 'Implement',
          objective: 'Make the change.',
          status: 'working',
          attempts: 1,
          dependsOn: [],
        }],
      },
      workers: [{
        workerId: 'worker-1',
        agentId: 'agent-1',
        role: 'executor',
        phase: 'step-executor',
        stepId: 's1',
        planRevision: 2,
        attempt: 1,
        transport: 'spawn',
        provider: 'local',
        model: 'deepseek',
        maxTokens: 32_000,
        status: 'running',
        startedAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
      }],
    }],
  }
}

describe('decodeDispatcherSnapshot', () => {
  it('accepts the complete exact v1 contract', () => {
    const snapshot = decodeDispatcherSnapshot(validSnapshot(), 'session-1')
    expect(snapshot.revision).toBe(4)
    expect(snapshot.tasks[0]?.masterPlan?.steps[0]?.dependsOn).toEqual([])
    expect(snapshot.tasks[0]?.workers[0]).toMatchObject({
      workerId: 'worker-1',
      agentId: 'agent-1',
      provider: 'local',
      model: 'deepseek',
    })
  })

  it('accepts and preserves every distributed placement field', () => {
    const snapshot = validSnapshot()
    const distribution = {
      pool: 'gpu-west',
      state: 'running',
      nodeId: 'worker-node-7',
      leaseGeneration: '12',
      leaseUntil: '2026-08-22T20:15:30.000Z',
      claimCount: 3,
      cancelRequested: true,
    }
    ;(snapshot['tasks'] as Array<Record<string, unknown>>)[0]!['distribution'] = distribution

    expect(decodeDispatcherSnapshot(snapshot).tasks[0]?.distribution).toEqual(distribution)
  })

  it('accepts a queued distributed task before a node or lease is assigned', () => {
    const snapshot = validSnapshot()
    ;(snapshot['tasks'] as Array<Record<string, unknown>>)[0]!['distribution'] = {
      pool: 'gpu-default',
      state: 'queued',
      claimCount: 0,
      cancelRequested: false,
    }

    expect(decodeDispatcherSnapshot(snapshot).tasks[0]?.distribution).toEqual({
      pool: 'gpu-default',
      state: 'queued',
      claimCount: 0,
      cancelRequested: false,
    })
  })

  it.each([
    ['a non-object value', null],
    ['a missing required field', { state: 'queued', claimCount: 0, cancelRequested: false }],
    ['an unknown field', {
      pool: 'gpu-default', state: 'queued', claimCount: 0, cancelRequested: false, surprise: true,
    }],
    ['an empty pool', { pool: '', state: 'queued', claimCount: 0, cancelRequested: false }],
    ['an unknown state', { pool: 'gpu-default', state: 'waiting', claimCount: 0, cancelRequested: false }],
    ['an empty node id', {
      pool: 'gpu-default', state: 'running', nodeId: '', claimCount: 1, cancelRequested: false,
    }],
    ['an empty lease generation', {
      pool: 'gpu-default', state: 'running', leaseGeneration: '', claimCount: 1, cancelRequested: false,
    }],
    ['an empty lease deadline', {
      pool: 'gpu-default', state: 'running', leaseUntil: '', claimCount: 1, cancelRequested: false,
    }],
    ['a negative claim count', { pool: 'gpu-default', state: 'queued', claimCount: -1, cancelRequested: false }],
    ['a fractional claim count', { pool: 'gpu-default', state: 'queued', claimCount: 1.5, cancelRequested: false }],
    ['a non-boolean cancel flag', {
      pool: 'gpu-default', state: 'queued', claimCount: 0, cancelRequested: 'false',
    }],
  ])('rejects distributed placement with %s', (_label, distribution) => {
    const snapshot = validSnapshot()
    ;(snapshot['tasks'] as Array<Record<string, unknown>>)[0]!['distribution'] = distribution
    expect(() => decodeDispatcherSnapshot(snapshot)).toThrowError(DispatcherDecodeError)
    expect(() => decodeDispatcherSnapshot(snapshot)).toThrow('snapshot.tasks[0].distribution')
  })

  it('rejects unknown keys at every object boundary', () => {
    const snapshot = validSnapshot()
    ;(snapshot['tasks'] as Array<Record<string, unknown>>)[0]!['surprise'] = true
    expect(() => decodeDispatcherSnapshot(snapshot)).toThrowError(DispatcherDecodeError)
    expect(() => decodeDispatcherSnapshot(snapshot)).toThrow('snapshot.tasks[0].surprise must be absent')
  })

  it('binds replies to their requested session and exact protocol version', () => {
    expect(() => decodeDispatcherSnapshot(validSnapshot(), 'session-2')).toThrow('snapshot.sessionId')
    expect(() => decodeDispatcherSnapshot({ ...validSnapshot(), protocolVersion: 2 })).toThrow('protocolVersion')
  })

  it('rejects running as a terminal DispatcherResult status', () => {
    const snapshot = validSnapshot()
    ;(snapshot['tasks'] as Array<Record<string, unknown>>)[0]!['result'] = {
      status: 'running',
      message: '',
      modelVerified: false,
      workspaceQuarantined: false,
      failureClass: 'none',
    }
    expect(() => decodeDispatcherSnapshot(snapshot)).toThrow('snapshot.tasks[0].result.status')
  })

  it('rejects unsafe revisions, invalid enums, and malformed optional values', () => {
    expect(() => decodeDispatcherSnapshot({ ...validSnapshot(), revision: Number.MAX_SAFE_INTEGER + 1 }))
      .toThrow('snapshot.revision')

    const badStatus = validSnapshot()
    ;(badStatus['tasks'] as Array<Record<string, unknown>>)[0]!['status'] = 'done'
    expect(() => decodeDispatcherSnapshot(badStatus)).toThrow('snapshot.tasks[0].status')

    const badAgent = validSnapshot()
    ;((badAgent['tasks'] as Array<Record<string, unknown>>)[0]!['workers'] as Array<Record<string, unknown>>)[0]!
      ['agentId'] = null
    expect(() => decodeDispatcherSnapshot(badAgent)).toThrow('agentId')
  })
})
