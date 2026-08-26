/** Staged, revision-fenced controller for the Task Dispatcher settings tab. */

import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { decodeDispatcherConfigSnapshot } from './config-decode.ts'
import {
  newDispatcherLane,
  type DispatcherConfigSnapshot,
  type DispatcherConfigViewState,
  type DispatcherLaneConfig,
  type DispatcherPolicyConfig,
} from './config-types.ts'

export const TASK_DISPATCHER_CONFIG_RPC_CHANNEL = '/task-dispatcher-config'

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u
const REF = /^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,127}$/u
const TOOL = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u
const ENV = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u
const READ_ONLY = new Set(['read', 'read_image', 'glob', 'grep'])
const RAW_DELEGATION = new Set([
  'dispatch_task', 'dispatch_status', 'dispatch_cancel', 'subagent', 'subagent_fork',
  'workflow', 'ralph', 'prompt_rewrite_rules', 'trigger_rules',
])

export type DispatcherValidationCode =
  | 'required' | 'trimmed' | 'invalid-id' | 'invalid-env' | 'range' | 'duplicate'
  | 'absolute-path' | 'criteria-required' | 'read-only-tools' | 'distribution-required'
  | 'mapping-required' | 'heartbeat' | 'max-lanes' | 'overlap' | 'invalid-config'
  | 'unsafe-tool' | 'orchestration' | 'planning-required'

export type DispatcherValidationErrors = Record<string, DispatcherValidationCode>

function range(errors: DispatcherValidationErrors, path: string, value: number, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) errors[path] = 'range'
}

function nonEmpty(errors: DispatcherValidationErrors, path: string, value: string): void {
  if (value.trim() === '') errors[path] = 'required'
  else if (value !== value.trim()) errors[path] = 'trimmed'
}

function absolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\')
}

function tools(errors: DispatcherValidationErrors, path: string, values: readonly string[] | undefined): void {
  if (values === undefined) return
  if (values.length > 64) errors[path] = 'range'
  const seen = new Set<string>()
  values.forEach((value, index) => {
    const itemPath = `${path}.${index}`
    if (!TOOL.test(value)) errors[itemPath] = 'invalid-id'
    else if (seen.has(value)) errors[itemPath] = 'duplicate'
    seen.add(value)
  })
}

function route(errors: DispatcherValidationErrors, path: string, value: DispatcherLaneConfig['executor']): void {
  nonEmpty(errors, `${path}.provider`, value.provider)
  nonEmpty(errors, `${path}.model`, value.model)
  range(errors, `${path}.maxTokens`, value.maxTokens, 1, 1_000_000)
}

function minimumLaneExecutionCost(
  laneId: string,
  lanes: Readonly<Record<string, DispatcherLaneConfig>>,
  remainingDepth: number,
  visiting = new Set<string>(),
): { nodes: number; modelRuns: number } {
  const lane = lanes[laneId]
  if (lane === undefined) throw new TypeError('unknown child lane')
  if (!lane.orchestration.enabled) {
    return { nodes: 1, modelRuns: lane.planner === undefined ? 2 : 5 }
  }
  if (visiting.has(laneId)) throw new TypeError('orchestration lane cycle')
  const depth = Math.min(remainingDepth, lane.orchestration.maxDepth)
  if (depth < 1) throw new TypeError('orchestration depth cannot reach a leaf lane')
  const next = new Set(visiting)
  next.add(laneId)
  const child = minimumLaneExecutionCost(lane.orchestration.childLane, lanes, depth - 1, next)
  return { nodes: child.nodes + 1, modelRuns: child.modelRuns + 3 }
}

/** Browser-side fast feedback. The Host remains authoritative on save. */
export function validateDispatcherDraft(config: DispatcherPolicyConfig): DispatcherValidationErrors {
  const errors: DispatcherValidationErrors = {}
  const laneEntries = Object.entries(config.lanes)
  if (laneEntries.length > 16) errors['lanes'] = 'max-lanes'
  range(errors, 'maxConsecutiveFailures', config.maxConsecutiveFailures, 1, 20)
  range(errors, 'circuitCooldownMs', config.circuitCooldownMs, 1_000, 86_400_000)
  range(errors, 'jobOutputLimitBytes', config.jobOutputLimitBytes, 4_096, 1_048_576)
  for (const field of ['liveRoot', 'stagingRoot'] as const) {
    const value = config[field]
    if (value !== '' && !absolutePath(value)) errors[field] = 'absolute-path'
  }
  if (config.liveRoot !== '' && config.stagingRoot !== '') {
    const clean = (value: string) => value.replace(/[\\/]+$/u, '')
    const live = clean(config.liveRoot)
    const staging = clean(config.stagingRoot)
    if (live === staging || live.startsWith(`${staging}/`) || staging.startsWith(`${live}/`)) {
      errors['stagingRoot'] = 'overlap'
    }
  }

  const distribution = config.distribution
  if (!ENV.test(distribution.databaseUrlEnv)) errors['distribution.databaseUrlEnv'] = 'invalid-env'
  nonEmpty(errors, 'distribution.scopeId', distribution.scopeId)
  if (distribution.workerId !== '') nonEmpty(errors, 'distribution.workerId', distribution.workerId)
  if (distribution.workerAgentPreset !== '') {
    nonEmpty(errors, 'distribution.workerAgentPreset', distribution.workerAgentPreset)
  }
  if (distribution.pools.length > 16) errors['distribution.pools'] = 'range'
  const pools = new Set<string>()
  distribution.pools.forEach((pool, index) => {
    const path = `distribution.pools.${index}`
    if (!ID.test(pool)) errors[path] = 'invalid-id'
    else if (pools.has(pool)) errors[path] = 'duplicate'
    pools.add(pool)
  })
  if ((distribution.role === 'worker' || distribution.role === 'hybrid') && pools.size === 0) {
    errors['distribution.pools'] = 'required'
  }
  for (const [ref, pathValue] of Object.entries(distribution.workspaceMappings)) {
    if (!REF.test(ref)) errors[`distribution.workspaceMappings.${ref}.ref`] = 'invalid-id'
    if (!absolutePath(pathValue)) errors[`distribution.workspaceMappings.${ref}.path`] = 'absolute-path'
  }
  range(errors, 'distribution.concurrency', distribution.concurrency, 1, 16)
  range(errors, 'distribution.leaseMs', distribution.leaseMs, 15_000, 300_000)
  range(errors, 'distribution.heartbeatMs', distribution.heartbeatMs, 1_000, 60_000)
  if (distribution.heartbeatMs * 3 > distribution.leaseMs) errors['distribution.heartbeatMs'] = 'heartbeat'
  range(errors, 'distribution.pollMs', distribution.pollMs, 100, 30_000)
  range(errors, 'distribution.maxDeliveryAttempts', distribution.maxDeliveryAttempts, 1, 10)

  for (const [id, lane] of laneEntries) {
    const root = `lanes.${id}`
    if (!ID.test(id)) errors[`${root}.id`] = 'invalid-id'
    if (lane.name !== lane.name.trim()) errors[`${root}.name`] = 'trimmed'
    route(errors, `${root}.executor`, lane.executor)
    route(errors, `${root}.verifier`, lane.verifier)
    if (lane.planner !== undefined) route(errors, `${root}.planner`, lane.planner)
    if (lane.planReviewer !== undefined) route(errors, `${root}.planReviewer`, lane.planReviewer)
    if (lane.replanner !== undefined) route(errors, `${root}.replanner`, lane.replanner)
    if (lane.finalVerifier !== undefined) route(errors, `${root}.finalVerifier`, lane.finalVerifier)
    if (lane.planner === undefined) {
      for (const role of ['planReviewer', 'replanner', 'finalVerifier'] as const) {
        if (lane[role] !== undefined) errors[`${root}.${role}`] = 'planning-required'
      }
    }
    tools(errors, `${root}.executorTools`, lane.executorTools)
    tools(errors, `${root}.plannerTools`, lane.plannerTools)
    tools(errors, `${root}.verifierTools`, lane.verifierTools)
    if (lane.plannerTools.some(tool => !READ_ONLY.has(tool))) {
      errors[`${root}.plannerTools`] = 'read-only-tools'
    }
    if (lane.verifierTools.some(tool => !READ_ONLY.has(tool))) {
      errors[`${root}.verifierTools`] = 'read-only-tools'
    }
    if ((lane.executorTools ?? []).some(tool => RAW_DELEGATION.has(tool))) {
      errors[`${root}.executorTools`] = 'unsafe-tool'
    }
    range(errors, `${root}.maxPlanSteps`, lane.maxPlanSteps, 1, 8)
    range(errors, `${root}.maxPlanPatches`, lane.maxPlanPatches, 0, 8)
    range(errors, `${root}.maxTotalChildRuns`, lane.maxTotalChildRuns, 5, 32)
    range(errors, `${root}.taskTimeoutMs`, lane.taskTimeoutMs, 1_000, 21_600_000)
    range(errors, `${root}.maxAttempts`, lane.maxAttempts, 1, 3)
    range(errors, `${root}.childTimeoutMs`, lane.childTimeoutMs, 1_000, 3_600_000)
    if (lane.requiredCriteria.length === 0) errors[`${root}.requiredCriteria`] = 'criteria-required'
    if (lane.requiredCriteria.length > 24) errors[`${root}.requiredCriteria`] = 'range'
    const criteria = new Set<string>()
    let criteriaLength = 0
    lane.requiredCriteria.forEach((criterion, index) => {
      const criterionRoot = `${root}.requiredCriteria.${index}`
      if (!ID.test(criterion.id)) errors[`${criterionRoot}.id`] = 'invalid-id'
      else if (criteria.has(criterion.id)) errors[`${criterionRoot}.id`] = 'duplicate'
      criteria.add(criterion.id)
      nonEmpty(errors, `${criterionRoot}.text`, criterion.text)
      if (criterion.text.length > 2_000) errors[`${criterionRoot}.text`] = 'range'
      criteriaLength += criterion.text.length
    })
    if (criteriaLength > 24_000) errors[`${root}.requiredCriteria`] = 'range'
    if (lane.kind === 'self-improvement' && (config.liveRoot === '' || config.stagingRoot === '')) {
      errors[`${root}.kind`] = 'absolute-path'
    }
    if ((lane.executorTools ?? []).some(tool => !READ_ONLY.has(tool)) && config.liveRoot === '') {
      errors[`${root}.executorTools`] ??= 'absolute-path'
      errors['liveRoot'] = 'absolute-path'
    }
    if (lane.execution.mode === 'distributed') {
      if (distribution.role === 'disabled') errors[`${root}.execution.mode`] = 'distribution-required'
      if (lane.kind !== 'general' || lane.transport !== 'spawn') errors[`${root}.execution.mode`] = 'read-only-tools'
      if (!ID.test(lane.execution.pool)) errors[`${root}.execution.pool`] = 'invalid-id'
      if (!REF.test(lane.execution.workspaceRef)) errors[`${root}.execution.workspaceRef`] = 'invalid-id'
      const distributedTools = [
        ...(lane.executorTools ?? []), ...lane.plannerTools, ...lane.verifierTools,
      ]
      if (distributedTools.some(tool => !READ_ONLY.has(tool))) {
        if (errors[`${root}.executorTools`] !== 'unsafe-tool') {
          errors[`${root}.executorTools`] = 'read-only-tools'
        }
      }
      if ((distribution.role === 'worker' || distribution.role === 'hybrid')
        && distribution.workspaceMappings[lane.execution.workspaceRef] === undefined) {
        errors[`${root}.execution.workspaceRef`] = 'mapping-required'
      }
    }
    const orchestration = lane.orchestration
    range(errors, `${root}.orchestration.maxDepth`, orchestration.maxDepth, 1, 4)
    range(errors, `${root}.orchestration.maxTaskNodes`, orchestration.maxTaskNodes, 1, 32)
    range(errors, `${root}.orchestration.maxChildrenPerNode`, orchestration.maxChildrenPerNode, 1, 8)
    range(errors, `${root}.orchestration.maxConcurrentNodes`, orchestration.maxConcurrentNodes, 1, 8)
    range(errors, `${root}.orchestration.maxTotalModelRuns`, orchestration.maxTotalModelRuns, 1, 128)
    range(errors, `${root}.orchestration.maxResultBytes`, orchestration.maxResultBytes, 4_096, 1_048_576)
    if (orchestration.maxChildrenPerNode > orchestration.maxTaskNodes - 1
      || orchestration.maxConcurrentNodes > orchestration.maxTaskNodes) {
      errors[`${root}.orchestration.enabled`] = 'orchestration'
    }
    if (orchestration.enabled) {
      const childLane = config.lanes[orchestration.childLane]
      if (!ID.test(orchestration.childLane) || childLane === undefined) {
        errors[`${root}.orchestration.childLane`] = 'orchestration'
      } else {
        const localSpawn = lane.execution.mode === 'local' && childLane.execution.mode === 'local'
          && lane.transport === 'spawn' && childLane.transport === 'spawn'
        const parentReadOnly = [
          ...(lane.executorTools ?? []), ...lane.plannerTools, ...lane.verifierTools,
        ].every(tool => READ_ONLY.has(tool))
        const childReadOnly = [
          ...(childLane.executorTools ?? []), ...childLane.plannerTools, ...childLane.verifierTools,
        ].every(tool => READ_ONLY.has(tool))
        if (lane.planner === undefined || orchestration.maxTotalModelRuns < 5
          || !localSpawn || !parentReadOnly || !childReadOnly || childLane.kind !== 'general'
          || orchestration.workspaceMode !== 'read-shared') {
          errors[`${root}.orchestration.enabled`] = 'orchestration'
        }
        const childSets = [childLane.executorTools ?? [], childLane.plannerTools, childLane.verifierTools]
        const parentSets = [lane.executorTools ?? [], lane.plannerTools, lane.verifierTools]
        if (childSets.some((set, index) => set.some(tool => !new Set(parentSets[index]).has(tool)))) {
          errors[`${root}.orchestration.childLane`] = 'orchestration'
        }
      }
    } else if (orchestration.childLane !== '') {
      errors[`${root}.orchestration.childLane`] = 'orchestration'
    }
  }
  for (const [id, lane] of laneEntries) {
    if (!lane.orchestration.enabled) continue
    const root = `lanes.${id}.orchestration`
    try {
      const minimum = minimumLaneExecutionCost(id, config.lanes, lane.orchestration.maxDepth)
      if (minimum.nodes > lane.orchestration.maxTaskNodes
        || minimum.modelRuns > lane.orchestration.maxTotalModelRuns) {
        errors[`${root}.enabled`] = 'orchestration'
      }
    } catch {
      errors[`${root}.childLane`] = 'orchestration'
    }
  }
  return errors
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type ConfigRpc = Pick<ClientConnectionRpc, 'call'>

/** One root-scoped controller shared by every mount of the settings tab. */
export class DispatcherConfigController {
  private state: DispatcherConfigViewState = {
    phase: 'loading', dirty: false, saving: false, conflicted: false, resetToBase: false, errors: {},
  }
  private readonly listeners = new Set<() => void>()
  private loadGeneration = 0
  private connectionGeneration = 0
  private controller: AbortController | undefined
  private disposed = false

  constructor(private readonly rpc: ConfigRpc) {}

  getSnapshot = (): DispatcherConfigViewState => this.state

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    if (this.listeners.size === 1 && this.state.snapshot === undefined) void this.load()
    return () => { this.listeners.delete(listener) }
  }

  async load(options: { preserveDraft?: boolean; conflicted?: boolean } = {}): Promise<void> {
    if (this.disposed) return
    const generation = ++this.loadGeneration
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    if (this.state.snapshot === undefined) this.publish({ ...this.state, phase: 'loading', error: undefined })
    try {
      const result = await this.rpc.call(TASK_DISPATCHER_CONFIG_RPC_CHANNEL, 'snapshot', {}, controller.signal)
      if (this.disposed || controller.signal.aborted || generation !== this.loadGeneration) return
      if (!result.ok) {
        const code = String(result.error.code)
        this.publish({
          ...this.state,
          phase: code === 'unavailable' ? 'unavailable' : 'error',
          error: `${code}: ${result.error.message}`,
        })
        return
      }
      this.accept(decodeDispatcherConfigSnapshot(result.value), options)
    } catch (error) {
      if (this.disposed || controller.signal.aborted || generation !== this.loadGeneration) return
      this.publish({ ...this.state, phase: 'error', error: failureText(error) })
    }
  }

  /**
   * Drop the revision baseline when DSH establishes a new Host generation.
   * Host revisions restart from zero, so equality alone cannot fence a draft
   * created against the previous process. A dirty draft survives for explicit
   * reconciliation; a clean view adopts the new composition immediately.
   */
  refreshAfterReconnect(): void {
    if (this.disposed) return
    const preserveDraft = this.state.dirty && this.state.draft !== undefined
    this.connectionGeneration += 1
    this.loadGeneration += 1
    this.controller?.abort()
    this.controller = undefined
    const { snapshot: _staleSnapshot, ...withoutSnapshot } = this.state
    this.publish({
      ...withoutSnapshot,
      phase: 'loading',
      saving: false,
      conflicted: preserveDraft,
      error: undefined,
    })
    void this.load({ preserveDraft, conflicted: preserveDraft })
  }

  edit(update: (draft: DispatcherPolicyConfig) => void): void {
    const baseline = this.state.snapshot
    const current = this.state.draft
    if (baseline === undefined || current === undefined || this.state.saving) return
    const draft = structuredClone(current)
    update(draft)
    this.publish({
      ...this.state,
      draft,
      dirty: !same(draft, baseline.value),
      conflicted: false,
      resetToBase: false,
      errors: validateDispatcherDraft(draft),
      error: undefined,
    })
  }

  addLane(preferredId?: string): string | undefined {
    const draft = this.state.draft
    if (draft === undefined || Object.keys(draft.lanes).length >= 16) return undefined
    let id = preferredId?.trim() ?? ''
    if (!ID.test(id) || draft.lanes[id] !== undefined) {
      let suffix = 1
      do id = `lane-${String(suffix++)}`
      while (draft.lanes[id] !== undefined)
    }
    this.edit(next => { next.lanes[id] = newDispatcherLane() })
    return id
  }

  removeLane(id: string): void {
    const snapshot = this.state.snapshot
    if (snapshot === undefined || id in snapshot.base.lanes) return
    this.edit((draft) => { delete draft.lanes[id] })
  }

  discard(): void {
    const snapshot = this.state.snapshot
    if (snapshot === undefined || this.state.saving) return
    this.publish({
      ...this.state,
      draft: structuredClone(snapshot.value),
      dirty: false,
      conflicted: false,
      resetToBase: false,
      errors: snapshot.invalid === undefined ? {} : { '$config': 'invalid-config' },
      error: snapshot.invalid,
    })
  }

  reset(): void {
    const snapshot = this.state.snapshot
    if (snapshot === undefined || this.state.saving) return
    const draft = structuredClone(snapshot.base)
    this.publish({
      ...this.state,
      draft,
      dirty: !same(draft, snapshot.value) || snapshot.invalid !== undefined,
      conflicted: false,
      resetToBase: true,
      errors: validateDispatcherDraft(draft),
      error: undefined,
    })
  }

  async save(): Promise<void> {
    const snapshot = this.state.snapshot
    const draft = this.state.draft
    if (snapshot === undefined || draft === undefined || this.state.saving || !snapshot.available || !snapshot.writable) return
    const errors = validateDispatcherDraft(draft)
    if (Object.keys(errors).length > 0) {
      this.publish({ ...this.state, errors })
      return
    }
    this.publish({ ...this.state, saving: true, conflicted: false, error: undefined })
    const connectionGeneration = this.connectionGeneration
    try {
      const result = await this.rpc.call(TASK_DISPATCHER_CONFIG_RPC_CHANNEL, 'save', {
        expectedRevision: snapshot.revision,
        value: structuredClone(draft),
      })
      if (this.disposed || connectionGeneration !== this.connectionGeneration) return
      if (!result.ok) {
        const code = String(result.error.code)
        if (code === 'conflict') {
          this.publish({ ...this.state, saving: false, conflicted: true, error: result.error.message })
          await this.load({ preserveDraft: true, conflicted: true })
          return
        }
        this.publish({
          ...this.state,
          saving: false,
          phase: code === 'unavailable' ? 'unavailable' : this.state.phase,
          error: `${code}: ${result.error.message}`,
        })
        return
      }
      this.accept(decodeDispatcherConfigSnapshot(result.value))
    } catch (error) {
      if (!this.disposed && connectionGeneration === this.connectionGeneration) {
        this.publish({ ...this.state, saving: false, error: failureText(error) })
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.loadGeneration += 1
    this.controller?.abort()
    this.controller = undefined
    this.listeners.clear()
  }

  private accept(snapshot: DispatcherConfigSnapshot, options: { preserveDraft?: boolean; conflicted?: boolean } = {}): void {
    const draft = options.preserveDraft && this.state.draft !== undefined
      ? this.state.draft
      : structuredClone(snapshot.value)
    const errors = validateDispatcherDraft(draft)
    if (snapshot.invalid !== undefined && !options.preserveDraft) errors['$config'] = 'invalid-config'
    this.publish({
      phase: snapshot.available ? 'ready' : 'unavailable',
      snapshot,
      draft,
      dirty: !same(draft, snapshot.value),
      saving: false,
      conflicted: options.conflicted === true,
      resetToBase: false,
      errors,
      ...(snapshot.invalid === undefined ? {} : { error: snapshot.invalid }),
    })
  }

  private publish(state: DispatcherConfigViewState): void {
    this.state = state
    for (const listener of this.listeners) {
      try { listener() } catch (error) { console.error('[task-dispatcher] config listener threw:', error) }
    }
  }
}
