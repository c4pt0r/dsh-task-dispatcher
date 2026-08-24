import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u
const GIT_OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/u
const DEFAULT_MAX_SCOPES = 32
const DEFAULT_MAX_CHANGED_PATHS = 256
const DEFAULT_MAX_CHANGED_BYTES = 16 * 1024 * 1024
const MAX_PATH_BYTES = 1_024
const CANDIDATE_STATES = new Set(['planned', 'applying', 'committed', 'aborted', 'quarantined'])

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(code, message, details = {}) {
  throw new WorkspaceIsolationError(code, message, details)
}

function exactObject(value, keys, label) {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('INVALID_INPUT', `${label} must be a plain object`)
  }
  const unexpected = Object.keys(value).find(key => !keys.includes(key))
  if (unexpected !== undefined) fail('INVALID_INPUT', `${label} contains unknown field ${JSON.stringify(unexpected)}`)
  return value
}

function deepFreeze(value) {
  if ((!isRecord(value) && !Array.isArray(value)) || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function immutable(value) {
  return deepFreeze(structuredClone(value))
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function safeInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('INVALID_INPUT', `${label} must be a safe integer from ${minimum} through ${maximum}`)
  }
  return value
}

function boundedString(value, label, maximum = 1_000) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.length > maximum) {
    fail('INVALID_INPUT', `${label} must be a non-empty trimmed string of at most ${maximum} characters`)
  }
  if (value.includes('\0')) fail('INVALID_INPUT', `${label} must not contain NUL`)
  return value
}

function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) fail('INVALID_ID', `${label} has an invalid id`)
  return value
}

function gitOid(value, label) {
  if (typeof value !== 'string' || !GIT_OID.test(value)) fail('INVALID_GIT_OID', `${label} must be a lowercase Git object id`)
  return value
}

function caseKey(value) {
  return value.normalize('NFC').toLowerCase()
}

function pathParts(value) {
  return value.split('/')
}

function partsPrefix(left, right) {
  const prefix = pathParts(left)
  const candidate = pathParts(right)
  return prefix.length <= candidate.length && prefix.every((part, index) => part === candidate[index])
}

function scopePathsConflict(left, right) {
  const leftKey = caseKey(left.path)
  const rightKey = caseKey(right.path)
  return partsPrefix(leftKey, rightKey) || partsPrefix(rightKey, leftKey)
}

function normalizeRepoPath(value, label) {
  boundedString(value, label, MAX_PATH_BYTES)
  if (Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES) fail('INVALID_PATH', `${label} is too long`)
  if (isAbsolute(value) || WINDOWS_ABSOLUTE.test(value) || value.startsWith('/') || value.includes('\\')) {
    fail('INVALID_PATH', `${label} must be a portable repository-relative path`)
  }
  const normalized = value.normalize('NFC')
  const parts = pathParts(normalized)
  if (parts.length === 0 || parts.some(part => part === '' || part === '.' || part === '..')) {
    fail('PATH_ESCAPE', `${label} contains an empty, dot, or parent component`)
  }
  if (parts.some(part => caseKey(part) === '.git')) fail('RESERVED_PATH', `${label} must not address .git`)
  if (parts.some(part => part.includes(':'))) fail('INVALID_PATH', `${label} contains a non-portable colon`)
  return normalized
}

function normalizeRoot(value, label, canonicalize) {
  boundedString(value, label, 4_096)
  if (!isAbsolute(value)) fail('INVALID_ROOT', `${label} must be absolute`)
  let canonical
  try {
    canonical = canonicalize(resolve(value))
  } catch (error) {
    fail('ROOT_UNAVAILABLE', `${label} is unavailable: ${errorText(error)}`)
  }
  if (typeof canonical !== 'string' || !isAbsolute(canonical)) {
    fail('INVALID_ROOT', `${label} canonicalizer returned an invalid path`)
  }
  return resolve(canonical)
}

function rootsOverlap(left, right) {
  const direct = relative(left, right)
  const reverse = relative(right, left)
  if (direct === '' || reverse === '') return true
  const inside = value => value !== '' && !value.startsWith('..') && !isAbsolute(value)
  if (inside(direct) || inside(reverse)) return true
  const foldedLeft = caseKey(left)
  const foldedRight = caseKey(right)
  const foldedDirect = relative(foldedLeft, foldedRight)
  const foldedReverse = relative(foldedRight, foldedLeft)
  return foldedDirect === '' || foldedReverse === '' || inside(foldedDirect) || inside(foldedReverse)
}

function command(args, purpose) {
  return immutable({ file: 'git', args, purpose })
}

function assertNotAborted(signal, label) {
  if (signal?.aborted) fail('CANCELLED', `${label} was cancelled`, { reason: errorText(signal.reason ?? 'cancelled') })
}

function execResultStdout(result) {
  if (typeof result === 'string') return result.trim()
  if (Buffer.isBuffer(result)) return result.toString('utf8').trim()
  return isRecord(result) && typeof result.stdout === 'string' ? result.stdout.trim() : ''
}

/** Typed fail-closed error returned by every validation and execution boundary. */
export class WorkspaceIsolationError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'WorkspaceIsolationError'
    this.code = code
    this.quarantined = code.includes('QUARANTINED')
    this.details = immutable(details)
  }
}

/** Strictly normalize repository-relative file/tree write scopes. */
export function normalizeWriteScopes(rawScopes, options = {}) {
  exactObject(options, ['maxScopes'], 'write-scope options')
  const maximum = options.maxScopes === undefined
    ? DEFAULT_MAX_SCOPES
    : safeInteger(options.maxScopes, 'maxScopes', 1, 256)
  if (!Array.isArray(rawScopes) || rawScopes.length === 0 || rawScopes.length > maximum) {
    fail('INVALID_WRITE_SCOPES', `writeScopes must contain 1-${maximum} entries`)
  }
  const seen = new Map()
  const scopes = rawScopes.map((raw, index) => {
    const value = exactObject(raw, ['path', 'kind'], `writeScopes[${index}]`)
    if (!['file', 'tree'].includes(value.kind)) fail('INVALID_WRITE_SCOPE', `writeScopes[${index}].kind must be file or tree`)
    const path = normalizeRepoPath(value.path, `writeScopes[${index}].path`)
    const folded = caseKey(path)
    const previous = seen.get(folded)
    if (previous !== undefined) {
      const code = previous === path ? 'DUPLICATE_WRITE_SCOPE' : 'PATH_CASE_COLLISION'
      fail(code, `writeScopes contains a duplicate or case-colliding path ${JSON.stringify(path)}`)
    }
    seen.set(folded, path)
    return { path, kind: value.kind }
  }).sort((left, right) => {
    const leftKey = caseKey(left.path)
    const rightKey = caseKey(right.path)
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : left.kind < right.kind ? -1 : 1
  })
  for (let left = 0; left < scopes.length; left += 1) {
    for (let right = left + 1; right < scopes.length; right += 1) {
      if (scopePathsConflict(scopes[left], scopes[right])) {
        fail('OVERLAPPING_WRITE_SCOPE', `writeScopes overlap at ${JSON.stringify(scopes[left].path)} and ${JSON.stringify(scopes[right].path)}`)
      }
    }
  }
  return immutable(scopes)
}

/** Validate a Host-observed Git change manifest against one normalized lease. */
export function validateChangedPaths(rawChanges, rawScopes, options = {}) {
  exactObject(options, ['maxPaths', 'maxBytes'], 'changed-path options')
  const maxPaths = options.maxPaths === undefined
    ? DEFAULT_MAX_CHANGED_PATHS
    : safeInteger(options.maxPaths, 'maxPaths', 1, 10_000)
  const maxBytes = options.maxBytes === undefined
    ? DEFAULT_MAX_CHANGED_BYTES
    : safeInteger(options.maxBytes, 'maxBytes', 0, Number.MAX_SAFE_INTEGER)
  const scopes = normalizeWriteScopes(rawScopes)
  if (!Array.isArray(rawChanges) || rawChanges.length > maxPaths) {
    fail('CHANGED_PATH_LIMIT', `changed paths exceed the limit of ${maxPaths}`)
  }
  const seen = new Map()
  let totalBytes = 0
  const changes = rawChanges.map((raw, index) => {
    const value = exactObject(raw, ['path', 'type', 'bytes'], `changes[${index}]`)
    const path = normalizeRepoPath(value.path, `changes[${index}].path`)
    if (!['file', 'delete', 'symlink'].includes(value.type)) {
      fail('INVALID_CHANGE_TYPE', `changes[${index}].type is unsupported`)
    }
    if (value.type === 'symlink') fail('SYMLINK_CHANGE', `symlink change ${JSON.stringify(path)} is forbidden`)
    const bytes = safeInteger(value.bytes, `changes[${index}].bytes`, 0, Number.MAX_SAFE_INTEGER)
    if (value.type === 'delete' && bytes !== 0) fail('INVALID_CHANGE_SIZE', `deleted path ${JSON.stringify(path)} must have zero bytes`)
    const folded = caseKey(path)
    const previous = seen.get(folded)
    if (previous !== undefined) {
      const code = previous === path ? 'DUPLICATE_CHANGED_PATH' : 'PATH_CASE_COLLISION'
      fail(code, `changed paths contains a duplicate or case-colliding path ${JSON.stringify(path)}`)
    }
    seen.set(folded, path)
    const covered = scopes.some((scope) => {
      if (scope.kind === 'file') return path === scope.path
      return partsPrefix(scope.path, path)
    })
    if (!covered) fail('CHANGED_PATH_OUT_OF_SCOPE', `changed path ${JSON.stringify(path)} is outside its write lease`)
    totalBytes += bytes
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBytes) {
      fail('CHANGED_BYTES_LIMIT', `changed bytes exceed the limit of ${maxBytes}`)
    }
    return { path, type: value.type, bytes }
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  return immutable({ changes, totalBytes })
}

/** Process-local all-or-none repository path lease table. */
export class PathLeaseTable {
  #leases = new Map()
  #createId
  #nextId = 0

  constructor(options = {}) {
    exactObject(options, ['createId'], 'path-lease options')
    if (options.createId !== undefined && typeof options.createId !== 'function') {
      fail('INVALID_INPUT', 'path-lease createId must be a function')
    }
    this.#createId = options.createId
  }

  get size() {
    return this.#leases.size
  }

  acquire(ownerId, rawScopes) {
    boundedString(ownerId, 'path lease ownerId', 256)
    const scopes = normalizeWriteScopes(rawScopes)
    for (const record of this.#leases.values()) {
      const conflict = scopes.find(scope => record.scopes.some(held => scopePathsConflict(scope, held)))
      if (conflict !== undefined) {
        fail('PATH_LEASE_CONFLICT', `write scope ${JSON.stringify(conflict.path)} conflicts with active lease ${record.handle.leaseId}`, {
          conflictingLeaseId: record.handle.leaseId,
          conflictingOwnerId: record.handle.ownerId,
        })
      }
    }
    this.#nextId += 1
    const supplied = this.#createId?.()
    const leaseId = supplied === undefined ? `path-lease-${this.#nextId}` : boundedString(supplied, 'path lease id', 256)
    if (this.#leases.has(leaseId)) fail('DUPLICATE_LEASE_ID', `path lease id ${JSON.stringify(leaseId)} already exists`)
    const handle = immutable({ leaseId, ownerId, state: 'active', scopes })
    this.#leases.set(leaseId, { handle, scopes, state: 'active', reason: undefined })
    return handle
  }

  release(handle) {
    const record = this.#record(handle)
    if (record.state === 'quarantined') {
      fail('PATH_LEASE_QUARANTINED', `path lease ${record.handle.leaseId} is quarantined and cannot be released`, {
        reason: record.reason,
      })
    }
    this.#leases.delete(record.handle.leaseId)
    return true
  }

  quarantine(handle, reason) {
    const record = this.#record(handle)
    if (record.state === 'quarantined') {
      fail('PATH_LEASE_QUARANTINED', `path lease ${record.handle.leaseId} is already quarantined`, {
        reason: record.reason,
      })
    }
    boundedString(reason, 'path lease quarantine reason', 2_000)
    record.state = 'quarantined'
    record.reason = reason
    return immutable({ ...record.handle, state: 'quarantined', reason })
  }

  snapshot() {
    const leases = [...this.#leases.values()].map(record => ({
      ...record.handle,
      state: record.state,
      ...(record.reason === undefined ? {} : { reason: record.reason }),
    })).sort((left, right) => left.leaseId < right.leaseId ? -1 : left.leaseId > right.leaseId ? 1 : 0)
    return immutable(leases)
  }

  #record(handle) {
    if (!isRecord(handle) || typeof handle.leaseId !== 'string') fail('INVALID_LEASE', 'path lease handle is invalid')
    const record = this.#leases.get(handle.leaseId)
    if (record === undefined || record.handle !== handle) fail('INVALID_LEASE', 'path lease handle is stale or forged')
    return record
  }
}

/** Return a deterministic lexical topological order, rejecting malformed DAGs. */
export function stableTopologicalOrder(rawNodes) {
  if (!Array.isArray(rawNodes) || rawNodes.length === 0 || rawNodes.length > 256) {
    fail('INVALID_DAG', 'DAG must contain 1-256 nodes')
  }
  const nodes = new Map()
  for (let index = 0; index < rawNodes.length; index += 1) {
    const raw = exactObject(rawNodes[index], ['id', 'dependsOn'], `nodes[${index}]`)
    const id = identifier(raw.id, `nodes[${index}].id`)
    if (nodes.has(id)) fail('DUPLICATE_DAG_NODE', `DAG contains duplicate node ${JSON.stringify(id)}`)
    if (!Array.isArray(raw.dependsOn)) fail('INVALID_DAG', `nodes[${index}].dependsOn must be an array`)
    const dependencies = raw.dependsOn.map((dependency, dependencyIndex) => identifier(
      dependency,
      `nodes[${index}].dependsOn[${dependencyIndex}]`,
    ))
    if (new Set(dependencies).size !== dependencies.length) fail('INVALID_DAG', `node ${id} contains duplicate dependencies`)
    if (dependencies.includes(id)) fail('INVALID_DAG', `node ${id} depends on itself`)
    nodes.set(id, { id, dependencies })
  }
  for (const node of nodes.values()) {
    const unknown = node.dependencies.find(dependency => !nodes.has(dependency))
    if (unknown !== undefined) fail('UNKNOWN_DAG_DEPENDENCY', `node ${node.id} depends on unknown node ${unknown}`)
  }
  const remaining = new Map([...nodes].map(([id, node]) => [id, new Set(node.dependencies)]))
  const order = []
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([id]) => id)
      .sort()
    if (ready.length === 0) fail('DAG_CYCLE', 'DAG contains a dependency cycle')
    for (const id of ready) {
      order.push(id)
      remaining.delete(id)
      for (const dependencies of remaining.values()) dependencies.delete(id)
    }
  }
  return immutable(order)
}

function candidateTransaction(base, state, detail = {}) {
  if (!CANDIDATE_STATES.has(state)) fail('INVALID_CANDIDATE_STATE', `candidate state ${JSON.stringify(state)} is invalid`)
  const event = {
    state,
    ...(detail.reason === undefined ? {} : { reason: boundedString(detail.reason, 'candidate reason', 2_000) }),
    ...(detail.headOid === undefined ? {} : { headOid: gitOid(detail.headOid, 'candidate headOid') }),
  }
  return immutable({
    ...base,
    state,
    ...(detail.reason === undefined ? {} : { reason: detail.reason }),
    ...(detail.headOid === undefined ? {} : { headOid: detail.headOid }),
    history: [...base.history, event],
  })
}

/** Pure, immutable candidate state transition helper. */
export function transitionCandidateTransaction(transaction, state, detail = {}) {
  exactObject(detail, ['reason', 'headOid'], 'candidate transition detail')
  if (!isRecord(transaction) || transaction.kind !== 'git-candidate-transaction' || !CANDIDATE_STATES.has(transaction.state)) {
    fail('INVALID_CANDIDATE', 'candidate transaction is invalid')
  }
  if (!Array.isArray(transaction.history)
    || !Array.isArray(transaction.integrationOrder)
    || !Array.isArray(transaction.commands)
    || !Array.isArray(transaction.cleanupCommands)) {
    fail('INVALID_CANDIDATE', 'candidate transaction collections are invalid')
  }
  const allowed = {
    planned: new Set(['applying', 'aborted', 'quarantined']),
    applying: new Set(['committed', 'aborted', 'quarantined']),
    committed: new Set(),
    aborted: new Set(),
    quarantined: new Set(),
  }
  if (!allowed[transaction.state].has(state)) {
    fail('INVALID_CANDIDATE_TRANSITION', `candidate cannot transition from ${transaction.state} to ${state}`)
  }
  if (state === 'committed' && detail.headOid === undefined) fail('INVALID_CANDIDATE_TRANSITION', 'committed candidate requires headOid')
  if (['aborted', 'quarantined'].includes(state) && detail.reason === undefined) {
    fail('INVALID_CANDIDATE_TRANSITION', `${state} candidate requires a reason`)
  }
  return candidateTransaction(transaction, state, detail)
}

/**
 * Host-only Git command planner. Without an injected exec function it cannot
 * create, seal, or integrate a real workspace.
 */
export class GitWorkspaceProvider {
  #canonicalize
  #createId
  #exec
  #isolationRoot
  #liveRoot
  #maxChangedBytes
  #maxChangedPaths
  #allocatedCandidatePaths = new Set()
  #allocatedTaskRoots = new Set()
  #plans = new WeakSet()
  #provisions = new WeakSet()
  #seals = new WeakSet()
  #nextId = 0

  constructor(options) {
    const value = exactObject(options, [
      'isolationRoot', 'liveRoot', 'canonicalize', 'createId', 'exec', 'maxChangedPaths', 'maxChangedBytes',
    ], 'GitWorkspaceProvider options')
    this.#canonicalize = value.canonicalize ?? (path => realpathSync.native(path))
    if (typeof this.#canonicalize !== 'function') fail('INVALID_INPUT', 'canonicalize must be a function')
    this.#createId = value.createId
    if (this.#createId !== undefined && typeof this.#createId !== 'function') fail('INVALID_INPUT', 'createId must be a function')
    this.#exec = value.exec
    if (this.#exec !== undefined && typeof this.#exec !== 'function') fail('INVALID_INPUT', 'exec must be a function')
    this.#isolationRoot = normalizeRoot(value.isolationRoot, 'isolationRoot', this.#canonicalize)
    this.#liveRoot = value.liveRoot === undefined || value.liveRoot === ''
      ? ''
      : normalizeRoot(value.liveRoot, 'liveRoot', this.#canonicalize)
    this.#maxChangedPaths = value.maxChangedPaths === undefined
      ? DEFAULT_MAX_CHANGED_PATHS
      : safeInteger(value.maxChangedPaths, 'maxChangedPaths', 1, 10_000)
    this.#maxChangedBytes = value.maxChangedBytes === undefined
      ? DEFAULT_MAX_CHANGED_BYTES
      : safeInteger(value.maxChangedBytes, 'maxChangedBytes', 0, Number.MAX_SAFE_INTEGER)
    if (this.#liveRoot !== '' && rootsOverlap(this.#isolationRoot, this.#liveRoot)) {
      fail('ROOT_OVERLAP', 'isolationRoot overlaps liveRoot')
    }
  }

  plan(raw) {
    const value = exactObject(raw, ['taskId', 'repositoryRoot', 'baseOid', 'steps'], 'workspace plan')
    const taskId = identifier(value.taskId, 'workspace plan taskId')
    const repositoryRoot = normalizeRoot(value.repositoryRoot, 'repositoryRoot', this.#canonicalize)
    if (rootsOverlap(repositoryRoot, this.#isolationRoot)) fail('ROOT_OVERLAP', 'repositoryRoot overlaps isolationRoot')
    if (this.#liveRoot !== '' && rootsOverlap(repositoryRoot, this.#liveRoot)) fail('ROOT_OVERLAP', 'repositoryRoot overlaps liveRoot')
    const baseOid = gitOid(value.baseOid, 'workspace plan baseOid')
    if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > 32) {
      fail('INVALID_PLAN', 'workspace plan must contain 1-32 steps')
    }
    const steps = value.steps.map((rawStep, index) => {
      const step = exactObject(rawStep, ['id', 'dependsOn', 'writeScopes'], `workspace plan steps[${index}]`)
      return {
        id: identifier(step.id, `workspace plan steps[${index}].id`),
        dependsOn: Array.isArray(step.dependsOn) ? [...step.dependsOn] : step.dependsOn,
        writeScopes: normalizeWriteScopes(step.writeScopes),
      }
    })
    const order = stableTopologicalOrder(steps.map(step => ({ id: step.id, dependsOn: step.dependsOn })))
    const byId = new Map(steps.map(step => [step.id, step]))
    const orderedSteps = order.map(id => byId.get(id))
    this.#nextId += 1
    const generated = this.#createId?.() ?? `workspace-${this.#nextId}`
    const planId = identifier(generated, 'workspace plan generated id')
    const taskRoot = join(this.#isolationRoot, `${taskId}-${planId}`)
    if (this.#allocatedTaskRoots.has(caseKey(taskRoot))) {
      fail('WORKSPACE_PATH_COLLISION', `workspace task root ${JSON.stringify(taskRoot)} was already allocated`)
    }
    this.#allocatedTaskRoots.add(caseKey(taskRoot))
    const repositoryPath = join(taskRoot, 'repository')
    const worktrees = orderedSteps.map(step => ({
      stepId: step.id,
      path: join(taskRoot, 'worktrees', step.id),
      writeScopes: step.writeScopes,
    }))
    const provisionCommands = [
      command(['clone', '--no-hardlinks', '--no-checkout', repositoryRoot, repositoryPath], 'clone task-local repository'),
      ...worktrees.map(worktree => command(
        ['-C', repositoryPath, 'worktree', 'add', '--detach', worktree.path, baseOid],
        `provision isolated worktree for ${worktree.stepId}`,
      )),
    ]
    const plan = immutable({
      kind: 'git-workspace-plan',
      state: 'planned',
      planId,
      taskId,
      repositoryRoot,
      isolationRoot: this.#isolationRoot,
      taskRoot,
      repositoryPath,
      baseOid,
      topologicalOrder: order,
      steps: orderedSteps,
      worktrees,
      provisionCommands,
    })
    this.#plans.add(plan)
    return plan
  }

  async provision(plan, options = {}) {
    exactObject(options, ['signal'], 'workspace provision options')
    this.#assertPlan(plan)
    assertNotAborted(options.signal, 'workspace provision')
    if (this.#exec === undefined) {
      const dry = immutable({
        kind: 'git-workspace-provision',
        state: 'planned',
        executed: false,
        plan,
        commands: plan.provisionCommands,
      })
      this.#provisions.add(dry)
      return dry
    }
    let started = 0
    try {
      await this.#executeCommands(plan.provisionCommands, options.signal, () => { started += 1 })
    } catch (error) {
      const cancelled = options.signal?.aborted === true && started === 0
      const code = cancelled ? 'CANCELLED' : 'WORKSPACE_PROVISION_QUARANTINED'
      throw new WorkspaceIsolationError(code, `workspace provision failed: ${errorText(error)}`, { startedCommands: started })
    }
    const provisioned = immutable({
      kind: 'git-workspace-provision',
      state: 'provisioned',
      executed: true,
      plan,
      commands: plan.provisionCommands,
    })
    this.#provisions.add(provisioned)
    return provisioned
  }

  async seal(provision, raw, options = {}) {
    exactObject(options, ['signal'], 'workspace seal options')
    const value = exactObject(raw, ['stepId', 'changes'], 'workspace seal')
    this.#assertProvision(provision, 'provisioned')
    assertNotAborted(options.signal, 'workspace seal')
    const stepId = identifier(value.stepId, 'workspace seal stepId')
    const step = provision.plan.steps.find(item => item.id === stepId)
    const worktree = provision.plan.worktrees.find(item => item.stepId === stepId)
    if (step === undefined || worktree === undefined) fail('UNKNOWN_STEP', `workspace seal references unknown step ${stepId}`)
    const manifest = validateChangedPaths(value.changes, step.writeScopes, {
      maxPaths: this.#maxChangedPaths,
      maxBytes: this.#maxChangedBytes,
    })
    if (manifest.changes.length === 0) fail('EMPTY_CHANGESET', `workspace step ${stepId} produced no changes`)
    const paths = manifest.changes.map(change => change.path)
    const commands = [
      command(['-C', worktree.path, 'add', '-A', '--', ...paths], `stage Host-observed changes for ${stepId}`),
      command(['-C', worktree.path, 'diff', '--cached', '--check'], `check staged changes for ${stepId}`),
      command([
        '-C', worktree.path, '-c', 'commit.gpgSign=false', 'commit', '--no-verify',
        '-m', `dsh task ${provision.plan.taskId}: ${stepId}`,
      ], `seal isolated changes for ${stepId}`),
      command(['-C', worktree.path, 'rev-parse', 'HEAD'], `read sealed commit for ${stepId}`),
    ]
    if (this.#exec === undefined) fail('EXECUTOR_REQUIRED', 'workspace seal requires an injected Host executor')
    let started = 0
    let commitOid
    try {
      const outputs = await this.#executeCommands(commands, options.signal, () => { started += 1 })
      commitOid = gitOid(execResultStdout(outputs.at(-1)), 'sealed commitOid')
    } catch (error) {
      throw new WorkspaceIsolationError(
        started === 0 && options.signal?.aborted ? 'CANCELLED' : 'WORKSPACE_SEAL_QUARANTINED',
        `workspace seal failed: ${errorText(error)}`,
        { stepId, startedCommands: started },
      )
    }
    const sealed = immutable({
      kind: 'git-sealed-step',
      state: 'sealed',
      planId: provision.plan.planId,
      taskId: provision.plan.taskId,
      stepId,
      baseOid: provision.plan.baseOid,
      commitOid,
      worktreePath: worktree.path,
      changedPaths: manifest.changes,
      totalBytes: manifest.totalBytes,
      commands,
    })
    this.#seals.add(sealed)
    return sealed
  }

  async integrate(provision, rawSeals, options = {}) {
    exactObject(options, ['signal'], 'workspace integration options')
    this.#assertProvision(provision, 'provisioned')
    if (!Array.isArray(rawSeals)) fail('INVALID_SEALS', 'workspace integration seals must be an array')
    const seals = new Map()
    for (const seal of rawSeals) {
      if (!this.#seals.has(seal) || seal.state !== 'sealed' || seal.planId !== provision.plan.planId) {
        fail('INVALID_SEAL', 'workspace integration received a stale, foreign, or unsealed artifact')
      }
      if (seals.has(seal.stepId)) fail('DUPLICATE_SEAL', `workspace integration contains duplicate step ${seal.stepId}`)
      seals.set(seal.stepId, seal)
    }
    const missing = provision.plan.topologicalOrder.find(stepId => !seals.has(stepId))
    if (missing !== undefined || seals.size !== provision.plan.steps.length) {
      fail('INCOMPLETE_INTEGRATION', `workspace integration is missing sealed step ${missing ?? 'unknown'}`)
    }
    this.#nextId += 1
    const generated = this.#createId?.() ?? `candidate-${this.#nextId}`
    const transactionId = identifier(generated, 'candidate transaction id')
    const candidatePath = join(provision.plan.taskRoot, 'candidates', transactionId)
    if (this.#allocatedCandidatePaths.has(caseKey(candidatePath))) {
      fail('WORKSPACE_PATH_COLLISION', `candidate path ${JSON.stringify(candidatePath)} was already allocated`)
    }
    this.#allocatedCandidatePaths.add(caseKey(candidatePath))
    const integrationOrder = [...provision.plan.topologicalOrder]
    const commands = [
      command([
        '-C', provision.plan.repositoryPath, 'worktree', 'add', '--detach', candidatePath, provision.plan.baseOid,
      ], 'provision candidate integration worktree'),
      ...integrationOrder.map(stepId => command(
        ['-C', candidatePath, 'cherry-pick', seals.get(stepId).commitOid],
        `integrate sealed step ${stepId}`,
      )),
      command(['-C', candidatePath, 'rev-parse', 'HEAD'], 'read integrated candidate head'),
    ]
    const cleanupCommands = [command([
      '-C', provision.plan.repositoryPath, 'worktree', 'remove', '--force', candidatePath,
    ], 'remove failed candidate worktree')]
    let transaction = immutable({
      kind: 'git-candidate-transaction',
      transactionId,
      planId: provision.plan.planId,
      taskId: provision.plan.taskId,
      baseOid: provision.plan.baseOid,
      candidatePath,
      integrationOrder,
      commands,
      cleanupCommands,
      state: 'planned',
      history: [{ state: 'planned' }],
    })
    if (options.signal?.aborted) {
      return transitionCandidateTransaction(transaction, 'aborted', {
        reason: `integration cancelled before start: ${errorText(options.signal.reason ?? 'cancelled')}`,
      })
    }
    if (this.#exec === undefined) return transaction
    transaction = transitionCandidateTransaction(transaction, 'applying')
    let started = 0
    try {
      const outputs = await this.#executeCommands(commands, options.signal, () => { started += 1 })
      const headOid = gitOid(execResultStdout(outputs.at(-1)), 'candidate headOid')
      return transitionCandidateTransaction(transaction, 'committed', { headOid })
    } catch (error) {
      let cleanupSafe = started === 0
      if (started > 0) {
        try {
          await this.#executeCommands(cleanupCommands, undefined)
          cleanupSafe = error?.cleanupUncertain !== true
        } catch {
          cleanupSafe = false
        }
      }
      const reason = `${options.signal?.aborted ? 'integration cancelled' : 'integration failed'}: ${errorText(error)}`
      return transitionCandidateTransaction(transaction, cleanupSafe ? 'aborted' : 'quarantined', { reason })
    }
  }

  #assertPlan(plan) {
    if (!this.#plans.has(plan) || plan.kind !== 'git-workspace-plan' || plan.state !== 'planned') {
      fail('INVALID_PLAN', 'workspace plan is stale or foreign')
    }
  }

  #assertProvision(provision, requiredState) {
    if (!this.#provisions.has(provision) || provision.kind !== 'git-workspace-provision' || provision.state !== requiredState) {
      fail('INVALID_PROVISION', `workspace provision must be ${requiredState}`)
    }
  }

  async #executeCommands(commands, signal, onStart = () => {}) {
    if (this.#exec === undefined) fail('EXECUTOR_REQUIRED', 'Host command execution is not configured')
    const outputs = []
    for (let index = 0; index < commands.length; index += 1) {
      assertNotAborted(signal, commands[index].purpose)
      onStart(commands[index], index)
      const result = await this.#exec(commands[index], Object.freeze({ signal, index }))
      outputs.push(result)
      assertNotAborted(signal, commands[index].purpose)
    }
    return outputs
  }
}
