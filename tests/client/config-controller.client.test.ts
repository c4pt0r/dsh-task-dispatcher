import { describe, expect, it, vi } from 'vitest'
import {
  DispatcherConfigController,
  TASK_DISPATCHER_CONFIG_RPC_CHANNEL,
  validateDispatcherDraft,
} from '../../src/client/config-controller.ts'
import { configFixture, configSnapshot } from './config-fixture.ts'

describe('DispatcherConfigController', () => {
  it('loads, stages locally, and saves one complete revision-fenced candidate', async () => {
    const saved = configSnapshot(2)
    saved.value.defaultRunInBackground = false
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: configSnapshot(1) })
      .mockResolvedValueOnce({ ok: true, value: saved })
    const controller = new DispatcherConfigController({ call } as never)
    await controller.load()
    controller.edit(draft => { draft.defaultRunInBackground = false })
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', dirty: true, saving: false })

    await controller.save()
    expect(call.mock.calls[0]?.slice(0, 3)).toEqual([
      TASK_DISPATCHER_CONFIG_RPC_CHANNEL, 'snapshot', {},
    ])
    expect(call.mock.calls[1]?.slice(0, 3)).toEqual([
      TASK_DISPATCHER_CONFIG_RPC_CHANNEL,
      'save',
      { expectedRevision: 1, value: expect.objectContaining({ defaultRunInBackground: false }) },
    ])
    expect(controller.getSnapshot()).toMatchObject({ dirty: false, saving: false, snapshot: { revision: 2 } })
  })

  it('blocks a URL pasted into the database environment-variable field before RPC', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, value: configSnapshot() })
    const controller = new DispatcherConfigController({ call } as never)
    await controller.load()
    controller.edit(draft => { draft.distribution.databaseUrlEnv = 'postgres://secret@example/db' })
    expect(controller.getSnapshot().errors).toMatchObject({
      'distribution.databaseUrlEnv': 'invalid-env',
    })
    await controller.save()
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('refreshes a CAS conflict while preserving the user draft', async () => {
    const latest = configSnapshot(2)
    latest.value.maxConsecutiveFailures = 4
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: configSnapshot(1) })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'conflict', message: 'revision moved', details: { expected: 1, actual: 2 } },
      })
      .mockResolvedValueOnce({ ok: true, value: latest })
    const controller = new DispatcherConfigController({ call } as never)
    await controller.load()
    controller.edit(draft => { draft.defaultRunInBackground = false })
    await controller.save()

    expect(controller.getSnapshot()).toMatchObject({
      conflicted: true,
      dirty: true,
      snapshot: { revision: 2, value: { maxConsecutiveFailures: 4 } },
      draft: { defaultRunInBackground: false },
    })
  })

  it('fences an in-flight save across Host generations even when the revision number repeats', async () => {
    let resolveOldSave!: (value: unknown) => void
    const oldSave = new Promise(resolve => { resolveOldSave = resolve })
    const restarted = configSnapshot(1)
    restarted.base.maxConsecutiveFailures = 8
    restarted.value.maxConsecutiveFailures = 8
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: configSnapshot(1) })
      .mockReturnValueOnce(oldSave)
      .mockResolvedValueOnce({ ok: true, value: restarted })
    const controller = new DispatcherConfigController({ call } as never)
    await controller.load()
    controller.edit(draft => { draft.defaultRunInBackground = false })
    const saving = controller.save()

    controller.refreshAfterReconnect()
    await vi.waitFor(() => {
      expect(controller.getSnapshot()).toMatchObject({
        phase: 'ready',
        conflicted: true,
        snapshot: { revision: 1, base: { maxConsecutiveFailures: 8 } },
        draft: { defaultRunInBackground: false },
      })
    })
    resolveOldSave({ ok: true, value: configSnapshot(2) })
    await saving
    expect(controller.getSnapshot().snapshot?.base.maxConsecutiveFailures).toBe(8)
  })

  it('cannot remove a composition lane but can add and remove a user lane', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, value: configSnapshot() })
    const controller = new DispatcherConfigController({ call } as never)
    await controller.load()
    controller.removeLane('analysis')
    expect(controller.getSnapshot().draft?.lanes['analysis']).toBeDefined()
    expect(controller.addLane('review')).toBe('review')
    expect(controller.getSnapshot().draft?.lanes['review']).toBeDefined()
    controller.removeLane('review')
    expect(controller.getSnapshot().draft?.lanes['review']).toBeUndefined()
  })

  it('repairs an invalid stored candidate only after an explicit reset', async () => {
    const raw = { ...configSnapshot(), value: { broken: true }, invalid: 'broken policy' }
    const call = vi.fn().mockResolvedValue({ ok: true, value: raw })
    const controller = new DispatcherConfigController({ call } as never)
    await controller.load()
    expect(controller.getSnapshot()).toMatchObject({
      dirty: false,
      errors: { '$config': 'invalid-config' },
    })
    controller.reset()
    expect(controller.getSnapshot()).toMatchObject({ dirty: true, resetToBase: true, errors: {} })
  })
})

describe('validateDispatcherDraft', () => {
  it('requires liveRoot for a locally mutating executor and enforces distributed mapping/lease safety', () => {
    const config = configFixture()
    config.lanes.analysis!.executorTools = ['bash']
    config.lanes.analysis!.execution = { mode: 'distributed', pool: 'remote', workspaceRef: 'missing' }
    config.distribution.role = 'worker'
    config.distribution.heartbeatMs = 20_000
    config.distribution.leaseMs = 45_000
    expect(validateDispatcherDraft(config)).toMatchObject({
      liveRoot: 'absolute-path',
      'lanes.analysis.executorTools': 'read-only-tools',
      'lanes.analysis.execution.workspaceRef': 'mapping-required',
      'distribution.heartbeatMs': 'heartbeat',
    })
  })

  it('keeps planner and verifier tools read-only and caps total acceptance text', () => {
    const config = configFixture()
    config.lanes.analysis!.plannerTools = ['bash']
    config.lanes.analysis!.verifierTools = ['edit']
    config.lanes.analysis!.requiredCriteria = Array.from({ length: 13 }, (_, index) => ({
      id: `criterion-${String(index)}`,
      text: 'x'.repeat(2_000),
    }))
    expect(validateDispatcherDraft(config)).toMatchObject({
      'lanes.analysis.plannerTools': 'read-only-tools',
      'lanes.analysis.verifierTools': 'read-only-tools',
      'lanes.analysis.requiredCriteria': 'range',
    })
  })

  it('rejects raw recursion and validates the first read-only orchestration mode', () => {
    const config = configFixture()
    config.lanes.leaf = structuredClone(config.lanes.analysis!)
    config.lanes.leaf.name = 'Leaf'
    config.lanes.leaf.planner = undefined
    config.lanes.leaf.plannerTools = []
    config.lanes.leaf.orchestration.enabled = false
    config.lanes.leaf.orchestration.childLane = ''
    config.lanes.analysis!.executorTools = ['read', 'workflow']
    config.lanes.analysis!.orchestration = {
      ...config.lanes.analysis!.orchestration,
      enabled: true,
      childLane: 'leaf',
      workspaceMode: 'isolated-write',
    }
    expect(validateDispatcherDraft(config)).toMatchObject({
      'lanes.analysis.executorTools': 'unsafe-tool',
      'lanes.analysis.orchestration.enabled': 'orchestration',
    })

    config.lanes.analysis!.executorTools = ['read']
    config.lanes.analysis!.orchestration.workspaceMode = 'read-shared'
    expect(validateDispatcherDraft(config)).toEqual({})
  })

  it('rejects recursive cycles and orchestration policies that cannot fund a verified leaf', () => {
    const config = configFixture()
    config.lanes.leaf = structuredClone(config.lanes.analysis!)
    config.lanes.leaf.planner = undefined
    config.lanes.leaf.plannerTools = []
    config.lanes.leaf.orchestration.enabled = false
    config.lanes.leaf.orchestration.childLane = ''
    config.lanes.analysis!.orchestration = {
      ...config.lanes.analysis!.orchestration,
      enabled: true,
      childLane: 'analysis',
      maxDepth: 2,
      maxTaskNodes: 2,
      maxChildrenPerNode: 1,
      maxConcurrentNodes: 1,
      maxTotalModelRuns: 5,
      workspaceMode: 'read-shared',
    }
    expect(validateDispatcherDraft(config)).toMatchObject({
      'lanes.analysis.orchestration.childLane': 'orchestration',
    })

    config.lanes.analysis!.orchestration.childLane = 'leaf'
    config.lanes.analysis!.orchestration.maxTaskNodes = 1
    expect(validateDispatcherDraft(config)).toMatchObject({
      'lanes.analysis.orchestration.enabled': 'orchestration',
    })

    config.lanes.analysis!.orchestration.maxTaskNodes = 2
    config.lanes.analysis!.orchestration.maxTotalModelRuns = 4
    expect(validateDispatcherDraft(config)).toMatchObject({
      'lanes.analysis.orchestration.enabled': 'orchestration',
    })
  })
})
