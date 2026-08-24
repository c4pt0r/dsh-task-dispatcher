import { createHash, randomUUID } from 'node:crypto'

const VERSION = 1
const HEX_256 = /^[a-f0-9]{64}$/u
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/u
const RESOURCES = new Set(['prompt-rewrite', 'trigger'])
const SCOPES = new Set(['task-ephemeral', 'persistent'])
const OPERATION_KINDS = new Set(['add', 'set_enabled', 'remove'])
const PROMPT_MODES = new Set(['prepend', 'append', 'replace', 'replace-matches', 'template'])
const TEMPLATE_TOKEN = '{{prompt}}'

const MAX_PROPOSAL_BYTES = 32_768
const MAX_OPERATION_BYTES = 16_384
const MAX_RULE_TEXT = 4_096
const MAX_TRIGGER_PROMPT = 4_096
const MAX_OVERLAY_OBJECTS = 8
const MAX_OVERLAY_BYTES = 16_384
const MAX_PATH_OPS = 16
const DEFAULT_PROPOSAL_TTL_MS = 5 * 60_000
const DEFAULT_EPHEMERAL_TTL_MS = 15 * 60_000
const MAX_TTL_MS = 60 * 60_000

const RESOURCE_NAMESPACE = Object.freeze({
  'prompt-rewrite': 'dsh-prompt-rewrite',
  trigger: 'dsh-trigger',
})

const RESOURCE_COLLECTION = Object.freeze({
  'prompt-rewrite': 'rules',
  trigger: 'triggers',
})

const SENSITIVE_AUDIT_FIELDS = new Set(['text', 'prompt', 'contains', 'separator'])
const TOP_LEVEL_PROTECTED_FIELDS = new Set([
  'namespace', 'settingsNamespace', 'path', 'paths', 'ops', 'grantId', 'grant_id',
  'mutationId', 'mutation_id', 'proposalId', 'proposal_id', 'expiresAt', 'expires_at',
  'targetAgentId', 'target_agent_id', 'createdAt', 'created_at', 'owner', 'token',
])
const ADD_PROTECTED_FIELDS = new Set([
  'id', 'objectId', 'object_id', 'namespace', 'settingsNamespace', 'path', 'paths',
  'ops', 'grantId', 'grant_id', 'mutationId', 'mutation_id', 'proposalId',
  'proposal_id', 'expiresAt', 'expires_at', 'targetAgentId', 'target_agent_id',
  'createdAt', 'created_at', 'owner', 'token',
])

/** Error with a stable code for Host/controller mapping. */
export class ConfigProposalError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ConfigProposalError'
    this.code = code
    this.details = immutable(details, 'error details')
  }
}

function fail(code, message, details) {
  throw new ConfigProposalError(code, message, details)
}

function isPlainRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function record(value, label) {
  if (!isPlainRecord(value)) fail('INVALID_ARGUMENT', `${label} must be a plain object`)
  return value
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue
    if (key === 'namespace' || key === 'settingsNamespace') {
      fail('PROTECTED_NAMESPACE', `${label} cannot select a settings namespace`)
    }
    if (TOP_LEVEL_PROTECTED_FIELDS.has(key) || ADD_PROTECTED_FIELDS.has(key)) {
      fail('PROTECTED_FIELD', `${label} cannot set protected field ${JSON.stringify(key)}`)
    }
    fail('UNKNOWN_KEY', `${label} contains unknown field ${JSON.stringify(key)}`)
  }
}

function rejectProtected(value, protectedFields, label) {
  for (const key of Object.keys(value)) {
    if (!protectedFields.has(key)) continue
    if (key === 'namespace' || key === 'settingsNamespace') {
      fail('PROTECTED_NAMESPACE', `${label} cannot select a settings namespace`)
    }
    fail('PROTECTED_FIELD', `${label} cannot set protected field ${JSON.stringify(key)}`)
  }
}

function requiredText(value, label, maximum) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('INVALID_ARGUMENT', `${label} must be a non-empty string`)
  }
  if (value.length > maximum) fail('OVERSIZE', `${label} exceeds ${maximum} characters`)
  return value
}

function optionalText(value, label, maximum, fallback = '') {
  if (value === undefined) return fallback
  if (typeof value !== 'string') fail('INVALID_ARGUMENT', `${label} must be a string`)
  if (value.length > maximum) fail('OVERSIZE', `${label} exceeds ${maximum} characters`)
  return value
}

function optionalBoolean(value, label, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') fail('INVALID_ARGUMENT', `${label} must be a boolean`)
  return value
}

function safeInteger(value, label, fallback) {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || Math.abs(resolved) > 1_000_000) {
    fail('INVALID_ARGUMENT', `${label} must be a safe integer from -1000000 through 1000000`)
  }
  return resolved
}

function safeId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    fail('INVALID_ARGUMENT', `${label} must match ${String(SAFE_ID)}`)
  }
  return value
}

function digest(value, label) {
  if (typeof value !== 'string' || !HEX_256.test(value)) {
    fail('INVALID_ARGUMENT', `${label} must be a lowercase SHA-256 digest`)
  }
  return value
}

function normalizeJson(value, label = 'value', ancestors = new Set(), depth = 0) {
  if (depth > 64) fail('OVERSIZE', `${label} exceeds the maximum JSON nesting depth`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_ARGUMENT', `${label} must contain only finite JSON numbers`)
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value !== 'object') fail('INVALID_ARGUMENT', `${label} must be JSON-compatible`)
  if (ancestors.has(value)) fail('INVALID_ARGUMENT', `${label} must not contain a cycle`)
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const result = []
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) fail('INVALID_ARGUMENT', `${label} must not contain sparse arrays`)
        result.push(normalizeJson(value[index], `${label}[${index}]`, ancestors, depth + 1))
      }
      return result
    }
    if (!isPlainRecord(value)) fail('INVALID_ARGUMENT', `${label} must contain only plain objects`)
    const result = {}
    for (const key of Object.keys(value)) {
      result[key] = normalizeJson(value[key], `${label}.${key}`, ancestors, depth + 1)
    }
    return result
  } finally {
    ancestors.delete(value)
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Deterministic JSON with recursive key ordering and strict JSON input. */
export function canonicalProposalJson(value) {
  return canonicalValue(normalizeJson(value))
}

/** SHA-256 of {@link canonicalProposalJson}. */
export function proposalDigest(value) {
  return createHash('sha256').update(canonicalProposalJson(value), 'utf8').digest('hex')
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function immutable(value, label = 'value') {
  return deepFreeze(normalizeJson(value, label))
}

function encodedBytes(value) {
  return Buffer.byteLength(canonicalProposalJson(value), 'utf8')
}

function assertBounded(value, maximum, label) {
  const size = encodedBytes(value)
  if (size > maximum) fail('OVERSIZE', `${label} exceeds ${maximum} bytes`, { size, maximum })
}

function canonicalInstant(value, label) {
  if (typeof value !== 'string') fail('INVALID_ARGUMENT', `${label} must be a canonical UTC instant`)
  const millis = Date.parse(value)
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== value) {
    fail('INVALID_ARGUMENT', `${label} must be a canonical UTC instant`)
  }
  return { value, millis }
}

function normalizeSubject(raw) {
  const value = record(raw, 'subject')
  exactKeys(value, new Set([
    'taskId', 'runId', 'childSessionId', 'parentSessionId', 'laneId', 'policyDigest',
    'workerId', 'leaseGeneration',
  ]), 'subject')
  const subject = {
    taskId: requiredText(value.taskId, 'subject.taskId', 256),
    runId: requiredText(value.runId, 'subject.runId', 256),
    childSessionId: requiredText(value.childSessionId, 'subject.childSessionId', 512),
    parentSessionId: requiredText(value.parentSessionId, 'subject.parentSessionId', 512),
    laneId: requiredText(value.laneId, 'subject.laneId', 128),
    policyDigest: requiredText(value.policyDigest, 'subject.policyDigest', 256),
  }
  if (value.workerId !== undefined) subject.workerId = requiredText(value.workerId, 'subject.workerId', 256)
  if (value.leaseGeneration !== undefined) {
    if (!Number.isSafeInteger(value.leaseGeneration) || value.leaseGeneration < 0) {
      fail('INVALID_ARGUMENT', 'subject.leaseGeneration must be a non-negative safe integer')
    }
    subject.leaseGeneration = value.leaseGeneration
  }
  return subject
}

function normalizePromptRule(raw) {
  const value = record(raw, 'operation.rule')
  rejectProtected(value, ADD_PROTECTED_FIELDS, 'operation.rule')
  exactKeys(value, new Set([
    'name', 'enabled', 'mode', 'text', 'separator', 'contains', 'caseSensitive',
    'firstTurnOnly', 'priority',
  ]), 'operation.rule')
  const mode = value.mode ?? 'prepend'
  if (typeof mode !== 'string' || !PROMPT_MODES.has(mode)) {
    fail('INVALID_ARGUMENT', 'operation.rule.mode is unsupported')
  }
  const enabled = optionalBoolean(value.enabled, 'operation.rule.enabled', false)
  if (enabled) fail('UNSAFE_INITIAL_STATE', 'new prompt rewrite proposals must start disabled')
  const text = optionalText(value.text, 'operation.rule.text', MAX_RULE_TEXT)
  if (value.text === undefined) fail('INVALID_ARGUMENT', 'operation.rule.text is required')
  const contains = optionalText(value.contains, 'operation.rule.contains', 1_024)
  if (mode === 'replace-matches' && contains === '') {
    fail('INVALID_ARGUMENT', 'replace-matches mode requires non-empty contains')
  }
  if (mode === 'template' && text.split(TEMPLATE_TOKEN).length - 1 !== 1) {
    fail('INVALID_ARGUMENT', `template mode requires exactly one literal ${TEMPLATE_TOKEN} token`)
  }
  if (!['replace-matches', 'template'].includes(mode) && text.trim() === '') {
    fail('INVALID_ARGUMENT', `${mode} mode requires non-empty text`)
  }
  return {
    name: optionalText(value.name, 'operation.rule.name', 120),
    enabled,
    mode,
    text,
    separator: optionalText(value.separator, 'operation.rule.separator', 64, '\n\n'),
    contains,
    caseSensitive: optionalBoolean(value.caseSensitive, 'operation.rule.caseSensitive', false),
    firstTurnOnly: optionalBoolean(value.firstTurnOnly, 'operation.rule.firstTurnOnly', false),
    priority: safeInteger(value.priority, 'operation.rule.priority', 100),
  }
}

function normalizeTrigger(raw) {
  const value = record(raw, 'operation.trigger')
  rejectProtected(value, ADD_PROTECTED_FIELDS, 'operation.trigger')
  exactKeys(value, new Set(['name', 'enabled', 'cron', 'timeZone', 'prompt']), 'operation.trigger')
  const enabled = optionalBoolean(value.enabled, 'operation.trigger.enabled', false)
  if (enabled) fail('UNSAFE_INITIAL_STATE', 'new trigger proposals must start disabled')
  const cron = requiredText(value.cron, 'operation.trigger.cron', 256)
  if (cron !== cron.trim() || /[\r\n]/u.test(cron) || cron.split(/\s+/u).length !== 5 || cron.startsWith('@')) {
    fail('INVALID_ARGUMENT', 'operation.trigger.cron must be a trimmed five-field cron expression')
  }
  const timeZone = optionalText(value.timeZone, 'operation.trigger.timeZone', 128, 'UTC')
  if (timeZone.trim() === '' || timeZone !== timeZone.trim()) {
    fail('INVALID_ARGUMENT', 'operation.trigger.timeZone must be non-empty and trimmed')
  }
  return {
    name: optionalText(value.name, 'operation.trigger.name', 120),
    enabled,
    cron,
    timeZone,
    prompt: requiredText(value.prompt, 'operation.trigger.prompt', MAX_TRIGGER_PROMPT),
  }
}

function normalizeOperation(resource, raw) {
  const value = record(raw, 'operation')
  rejectProtected(value, new Set([...TOP_LEVEL_PROTECTED_FIELDS].filter(key => key !== 'objectId')), 'operation')
  if (typeof value.kind !== 'string' || !OPERATION_KINDS.has(value.kind)) {
    fail('INVALID_ARGUMENT', 'operation.kind must be add, set_enabled, or remove')
  }
  if (value.kind === 'add') {
    const payloadKey = resource === 'prompt-rewrite' ? 'rule' : 'trigger'
    exactKeys(value, new Set(['kind', payloadKey]), 'operation')
    if (!Object.hasOwn(value, payloadKey)) fail('INVALID_ARGUMENT', `operation.${payloadKey} is required`)
    const payload = resource === 'prompt-rewrite'
      ? normalizePromptRule(value.rule)
      : normalizeTrigger(value.trigger)
    const operation = { kind: 'add', [payloadKey]: payload }
    assertBounded(operation, MAX_OPERATION_BYTES, 'operation')
    return operation
  }
  exactKeys(value, new Set(value.kind === 'set_enabled'
    ? ['kind', 'objectId', 'enabled']
    : ['kind', 'objectId']), 'operation')
  const objectId = safeId(value.objectId, 'operation.objectId')
  if (value.kind === 'set_enabled') {
    if (typeof value.enabled !== 'boolean') fail('INVALID_ARGUMENT', 'operation.enabled must be a boolean')
    return { kind: value.kind, objectId, enabled: value.enabled }
  }
  return { kind: value.kind, objectId }
}

function normalizeRequest(raw) {
  const value = record(raw, 'proposal request')
  rejectProtected(value, TOP_LEVEL_PROTECTED_FIELDS, 'proposal request')
  exactKeys(value, new Set(['scope', 'resource', 'operation', 'expectedRawDigest']), 'proposal request')
  if (typeof value.scope !== 'string' || !SCOPES.has(value.scope)) {
    fail('INVALID_ARGUMENT', 'proposal request.scope must be task-ephemeral or persistent')
  }
  if (typeof value.resource !== 'string' || !RESOURCES.has(value.resource)) {
    fail('INVALID_ARGUMENT', 'proposal request.resource must be prompt-rewrite or trigger')
  }
  const normalized = {
    scope: value.scope,
    resource: value.resource,
    operation: normalizeOperation(value.resource, value.operation),
  }
  if (value.scope === 'persistent') {
    normalized.expectedRawDigest = digest(value.expectedRawDigest, 'proposal request.expectedRawDigest')
  } else if (value.expectedRawDigest !== undefined) {
    fail('PROTECTED_FIELD', 'task-ephemeral proposals cannot name a durable expectedRawDigest')
  }
  assertBounded(normalized, MAX_PROPOSAL_BYTES, 'proposal request')
  return normalized
}

function riskOf(request) {
  if (request.resource === 'trigger') {
    if (request.operation.kind === 'set_enabled' && request.operation.enabled) return 'high'
    return request.operation.kind === 'remove' ? 'medium' : 'high'
  }
  if (request.operation.kind === 'set_enabled' && request.operation.enabled) return 'high'
  if (request.operation.kind !== 'add') return 'medium'
  const rule = request.operation.rule
  return rule.mode === 'replace' || rule.mode === 'template' || rule.contains === '' ? 'high' : 'medium'
}

function diffOf(resource, operation) {
  if (operation.kind === 'add') {
    return {
      action: 'add',
      collection: RESOURCE_COLLECTION[resource],
      objectId: operation.objectId ?? '(host-allocated-on-create)',
      after: resource === 'prompt-rewrite' ? operation.rule : operation.trigger,
    }
  }
  if (operation.kind === 'set_enabled') {
    return {
      action: 'set_enabled',
      collection: RESOURCE_COLLECTION[resource],
      objectId: operation.objectId,
      after: { enabled: operation.enabled },
    }
  }
  return {
    action: 'remove',
    collection: RESOURCE_COLLECTION[resource],
    objectId: operation.objectId,
  }
}

function pathOps(resource, operation) {
  const collection = RESOURCE_COLLECTION[resource]
  if (operation.kind === 'add') {
    return [{
      op: 'set',
      path: [collection, operation.objectId],
      value: resource === 'prompt-rewrite' ? operation.rule : operation.trigger,
    }]
  }
  if (operation.kind === 'set_enabled') {
    return [{ op: 'set', path: [collection, operation.objectId, 'enabled'], value: operation.enabled }]
  }
  return [{ op: 'unset', path: [collection, operation.objectId] }]
}

function normalizePathOps(raw, label, proposal) {
  if (!Array.isArray(raw) || raw.length > MAX_PATH_OPS) {
    fail('INVALID_TRANSACTION_RESULT', `${label} must contain at most ${MAX_PATH_OPS} path operations`)
  }
  const collection = RESOURCE_COLLECTION[proposal.resource]
  const objectId = proposal.operation.objectId
  return raw.map((entry, index) => {
    const value = record(entry, `${label}[${index}]`)
    exactKeys(value, new Set(value.op === 'set' ? ['op', 'path', 'value'] : ['op', 'path']), `${label}[${index}]`)
    if (!['set', 'unset'].includes(value.op) || !Array.isArray(value.path)) {
      fail('INVALID_TRANSACTION_RESULT', `${label}[${index}] is not a supported path operation`)
    }
    const path = value.path.map((part, partIndex) => {
      if (typeof part !== 'string') fail('INVALID_TRANSACTION_RESULT', `${label}[${index}].path[${partIndex}] must be a string`)
      return part
    })
    const allowedRoot = path.length === 2 && path[0] === collection && path[1] === objectId
    const allowedEnabled = path.length === 3 && path[0] === collection
      && path[1] === objectId && path[2] === 'enabled'
    if (!allowedRoot && !allowedEnabled) {
      fail('INVALID_TRANSACTION_RESULT', `${label}[${index}] escapes the proposal object`)
    }
    const normalized = { op: value.op, path }
    if (value.op === 'set') normalized.value = normalizeJson(value.value, `${label}[${index}].value`)
    return normalized
  })
}

function normalizeTransactResult(raw, proposal) {
  const value = record(raw, 'transact result')
  if (value.status === 'conflict') {
    exactKeys(value, new Set(['status', 'actualRawDigest']), 'transact result')
    return { status: 'conflict', actualRawDigest: digest(value.actualRawDigest, 'transact result.actualRawDigest') }
  }
  if (value.status !== 'committed') {
    fail('INVALID_TRANSACTION_RESULT', 'transact result.status must be committed or conflict')
  }
  exactKeys(value, new Set([
    'status', 'beforeRawDigest', 'afterRawDigest', 'inverseOps', 'revision', 'idempotent',
  ]), 'transact result')
  const result = {
    status: 'committed',
    beforeRawDigest: digest(value.beforeRawDigest, 'transact result.beforeRawDigest'),
    afterRawDigest: digest(value.afterRawDigest, 'transact result.afterRawDigest'),
    inverseOps: normalizePathOps(value.inverseOps, 'transact result.inverseOps', proposal),
    idempotent: optionalBoolean(value.idempotent, 'transact result.idempotent', false),
  }
  if (value.revision !== undefined) {
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
      fail('INVALID_TRANSACTION_RESULT', 'transact result.revision must be a non-negative safe integer')
    }
    result.revision = value.revision
  }
  return result
}

function redactAudit(value, key = '') {
  if (typeof value === 'string' && SENSITIVE_AUDIT_FIELDS.has(key)) {
    return {
      redacted: true,
      length: value.length,
      sha256: createHash('sha256').update(value, 'utf8').digest('hex'),
    }
  }
  if (Array.isArray(value)) return value.map(entry => redactAudit(entry))
  if (value !== null && typeof value === 'object') {
    const result = {}
    for (const [childKey, child] of Object.entries(value)) result[childKey] = redactAudit(child, childKey)
    return result
  }
  return value
}

function publicProposal(proposal) {
  return immutable({
    version: VERSION,
    proposalId: proposal.proposalId,
    state: proposal.state,
    scope: 'persistent',
    resource: proposal.resource,
    namespace: proposal.namespace,
    subject: proposal.subject,
    digest: proposal.digest,
    expectedRawDigest: proposal.expectedRawDigest,
    expiresAt: proposal.expiresAt,
    risk: proposal.risk,
    operation: proposal.operation,
    diff: proposal.diff,
    ...(proposal.approval === undefined ? {} : {
      approval: {
        approvedBy: proposal.approval.approvedBy,
        approvedAt: proposal.approval.approvedAt,
        expiresAt: proposal.approval.expiresAt,
      },
    }),
    ...(proposal.receipt === undefined ? {} : { receipt: proposal.receipt }),
    ...(proposal.rollbackReceipt === undefined ? {} : { rollbackReceipt: proposal.rollbackReceipt }),
  }, 'public proposal')
}

/**
 * Independent Host-owned proposal authority. Subjects are supplied by trusted
 * dispatcher code and are never represented by a model-visible bearer token.
 */
export class ConfigProposalAuthority {
  constructor(options = {}) {
    const value = record(options, 'authority options')
    exactKeys(value, new Set([
      'now', 'createId', 'transact', 'appendAudit', 'proposalTtlMs', 'ephemeralTtlMs',
    ]), 'authority options')
    this.now = value.now ?? Date.now
    this.createId = value.createId ?? randomUUID
    this.transact = value.transact ?? (() => Promise.reject(new ConfigProposalError(
      'TRANSACT_UNAVAILABLE',
      'no configuration transaction provider is installed',
    )))
    this.appendAudit = value.appendAudit ?? (() => Promise.resolve())
    if (typeof this.now !== 'function' || typeof this.createId !== 'function'
      || typeof this.transact !== 'function' || typeof this.appendAudit !== 'function') {
      fail('INVALID_ARGUMENT', 'authority callbacks must be functions')
    }
    this.proposalTtlMs = this.#ttl(value.proposalTtlMs ?? DEFAULT_PROPOSAL_TTL_MS, 'proposalTtlMs')
    this.ephemeralTtlMs = this.#ttl(value.ephemeralTtlMs ?? DEFAULT_EPHEMERAL_TTL_MS, 'ephemeralTtlMs')
    this.proposals = new Map()
    this.overlays = new Map()
    this.audit = []
    this.applyFlights = new Map()
    this.rollbackFlights = new Map()
    this.auditSequence = 0
  }

  #ttl(value, label) {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TTL_MS) {
      fail('INVALID_ARGUMENT', `${label} must be an integer from 1 through ${MAX_TTL_MS}`)
    }
    return value
  }

  #time() {
    const value = this.now()
    if (!Number.isFinite(value)) fail('INVALID_HOST_STATE', 'authority clock returned an invalid time')
    return value
  }

  #newId(prefix, occupied = () => false) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const raw = String(this.createId()).toLowerCase()
      let suffix = raw.replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '')
      if (suffix === '') suffix = proposalDigest(raw).slice(0, 32)
      const candidate = `${prefix}-${suffix}`.slice(0, 128).replace(/-+$/u, '')
      if (SAFE_ID.test(candidate) && !occupied(candidate)) return candidate
    }
    fail('ID_EXHAUSTED', `could not allocate a unique ${prefix} id`)
  }

  #expiry(options, ttl, label) {
    const value = record(options ?? {}, `${label} options`)
    exactKeys(value, new Set(['expiresAt']), `${label} options`)
    const now = this.#time()
    const expires = value.expiresAt === undefined
      ? { millis: now + ttl, value: new Date(now + ttl).toISOString() }
      : canonicalInstant(value.expiresAt, `${label}.expiresAt`)
    if (expires.millis <= now || expires.millis - now > MAX_TTL_MS) {
      fail('INVALID_EXPIRY', `${label}.expiresAt must be in the next ${MAX_TTL_MS}ms`)
    }
    return expires
  }

  #auditEvent(kind, data) {
    const entry = immutable({
      version: VERSION,
      eventId: `audit-${++this.auditSequence}`,
      kind,
      at: new Date(this.#time()).toISOString(),
      data: redactAudit(data),
    }, 'audit event')
    return entry
  }

  async #auditBefore(kind, data) {
    const entry = this.#auditEvent(kind, data)
    try {
      await this.appendAudit(entry)
    } catch (error) {
      fail('AUDIT_UNAVAILABLE', `audit append failed before ${kind}: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.audit.push(entry)
    return entry
  }

  #auditAfter(kind, data) {
    const entry = this.#auditEvent(kind, data)
    // The pre-side-effect intent is the fail-closed durable boundary. This
    // completion projection is an infallible append to the authority ledger.
    this.audit.push(entry)
    return entry
  }

  /** Compute a deterministic, frozen preview without allocating ids or state. */
  preview(rawSubject, rawRequest) {
    const subject = normalizeSubject(rawSubject)
    const request = normalizeRequest(rawRequest)
    const preview = {
      version: VERSION,
      scope: request.scope,
      resource: request.resource,
      namespace: RESOURCE_NAMESPACE[request.resource],
      subject,
      operation: request.operation,
      ...(request.expectedRawDigest === undefined ? {} : { expectedRawDigest: request.expectedRawDigest }),
      risk: riskOf(request),
      diff: diffOf(request.resource, request.operation),
    }
    return immutable({ ...preview, digest: proposalDigest(preview) }, 'proposal preview')
  }

  /** Snapshot only counts, useful for proving preview has no side effects. */
  stats() {
    return immutable({
      proposals: this.proposals.size,
      overlays: this.overlays.size,
      auditEvents: this.audit.length,
    }, 'authority stats')
  }

  #overlayKey(subject) {
    return proposalDigest(subject)
  }

  #overlayObjects(overlay) {
    const result = { 'prompt-rewrite': {}, trigger: {} }
    for (const resource of RESOURCES) {
      for (const [id, value] of overlay.objects[resource]) result[resource][id] = value
    }
    return result
  }

  #publicOverlay(overlay) {
    return immutable({
      version: VERSION,
      scope: 'task-ephemeral',
      subject: overlay.subject,
      expiresAt: overlay.expiresAt,
      revision: overlay.revision,
      objects: this.#overlayObjects(overlay),
    }, 'ephemeral overlay')
  }

  async #expireOverlay(key, overlay, reason) {
    await this.#auditBefore('ephemeral.disposed', {
      subject: overlay.subject,
      expiresAt: overlay.expiresAt,
      revision: overlay.revision,
      reason,
    })
    this.overlays.delete(key)
  }

  /** Apply one typed operation to a task/run-owned, non-durable overlay. */
  async stageEphemeral(rawSubject, rawRequest, options = {}) {
    const subject = normalizeSubject(rawSubject)
    const request = normalizeRequest(rawRequest)
    if (request.scope !== 'task-ephemeral') {
      fail('INVALID_SCOPE', 'stageEphemeral accepts only task-ephemeral proposals')
    }
    const expiry = this.#expiry(options, this.ephemeralTtlMs, 'ephemeral')
    const key = this.#overlayKey(subject)
    let current = this.overlays.get(key)
    if (current !== undefined && Date.parse(current.expiresAt) <= this.#time()) {
      await this.#expireOverlay(key, current, 'expired')
      current = undefined
    }
    const effectiveExpiry = current === undefined
      ? expiry
      : Date.parse(current.expiresAt) <= expiry.millis
        ? { millis: Date.parse(current.expiresAt), value: current.expiresAt }
        : expiry
    const objects = {
      'prompt-rewrite': new Map(current?.objects['prompt-rewrite'] ?? []),
      trigger: new Map(current?.objects.trigger ?? []),
    }
    let operation = request.operation
    if (operation.kind === 'add') {
      const prefix = request.resource === 'prompt-rewrite' ? 'rule' : 'trigger'
      const objectId = this.#newId(prefix, id => objects[request.resource].has(id))
      operation = { ...operation, objectId }
      objects[request.resource].set(
        objectId,
        request.resource === 'prompt-rewrite' ? operation.rule : operation.trigger,
      )
    } else {
      const existing = objects[request.resource].get(operation.objectId)
      if (existing === undefined) fail('OVERLAY_OBJECT_NOT_FOUND', `ephemeral object ${operation.objectId} does not exist`)
      if (operation.kind === 'remove') objects[request.resource].delete(operation.objectId)
      else objects[request.resource].set(operation.objectId, { ...existing, enabled: operation.enabled })
    }
    const objectCount = [...RESOURCES].reduce((sum, resource) => sum + objects[resource].size, 0)
    if (objectCount > MAX_OVERLAY_OBJECTS) {
      fail('OVERLAY_LIMIT', `task overlay may contain at most ${MAX_OVERLAY_OBJECTS} objects`)
    }
    const candidate = {
      subject,
      expiresAt: effectiveExpiry.value,
      revision: (current?.revision ?? 0) + 1,
      objects,
    }
    const publicCandidate = this.#publicOverlay(candidate)
    if (encodedBytes(publicCandidate.objects) > MAX_OVERLAY_BYTES) {
      fail('OVERSIZE', `task overlay exceeds ${MAX_OVERLAY_BYTES} bytes`)
    }
    const operationDigest = proposalDigest({
      version: VERSION,
      scope: 'task-ephemeral',
      subject,
      resource: request.resource,
      operation,
      expiresAt: effectiveExpiry.value,
      revision: candidate.revision,
    })
    await this.#auditBefore('ephemeral.staged', {
      subject,
      resource: request.resource,
      operation,
      digest: operationDigest,
      expiresAt: effectiveExpiry.value,
      revision: candidate.revision,
    })
    this.overlays.set(key, candidate)
    return immutable({ ...publicCandidate, digest: operationDigest }, 'ephemeral stage result')
  }

  /** Read the exact subject's overlay, expiring it before returning. */
  async ephemeralSnapshot(rawSubject) {
    const subject = normalizeSubject(rawSubject)
    const key = this.#overlayKey(subject)
    const overlay = this.overlays.get(key)
    if (overlay === undefined) {
      return immutable({
        version: VERSION,
        scope: 'task-ephemeral',
        subject,
        expiresAt: null,
        revision: 0,
        objects: { 'prompt-rewrite': {}, trigger: {} },
      }, 'empty ephemeral overlay')
    }
    if (Date.parse(overlay.expiresAt) <= this.#time()) {
      await this.#expireOverlay(key, overlay, 'expired')
      return this.ephemeralSnapshot(subject)
    }
    return this.#publicOverlay(overlay)
  }

  /** Dispose one exact child/run overlay; disposal is idempotent. */
  async disposeEphemeral(rawSubject, reason = 'child-disposed') {
    const subject = normalizeSubject(rawSubject)
    if (typeof reason !== 'string' || reason.trim() === '' || reason.length > 256) {
      fail('INVALID_ARGUMENT', 'dispose reason must be a short non-empty string')
    }
    const key = this.#overlayKey(subject)
    const overlay = this.overlays.get(key)
    if (overlay === undefined) return immutable({ disposed: false }, 'ephemeral dispose result')
    await this.#expireOverlay(key, overlay, reason)
    return immutable({ disposed: true }, 'ephemeral dispose result')
  }

  /** Create a stored persistent proposal without touching a settings provider. */
  async createPersistent(rawSubject, rawRequest, options = {}) {
    const subject = normalizeSubject(rawSubject)
    const request = normalizeRequest(rawRequest)
    if (request.scope !== 'persistent') fail('INVALID_SCOPE', 'createPersistent accepts only persistent proposals')
    const expiry = this.#expiry(options, this.proposalTtlMs, 'proposal')
    const proposalId = this.#newId('proposal', id => this.proposals.has(id))
    const mutationId = `mutation-${proposalId}`
    let operation = request.operation
    if (operation.kind === 'add') {
      const prefix = request.resource === 'prompt-rewrite' ? 'rule' : 'trigger'
      operation = { ...operation, objectId: this.#newId(prefix) }
    }
    const proposal = {
      version: VERSION,
      proposalId,
      mutationId,
      state: 'pending',
      subject,
      resource: request.resource,
      namespace: RESOURCE_NAMESPACE[request.resource],
      expectedRawDigest: request.expectedRawDigest,
      expiresAt: expiry.value,
      operation,
      ops: pathOps(request.resource, operation),
      risk: riskOf({ ...request, operation }),
      diff: diffOf(request.resource, operation),
    }
    const material = {
      version: VERSION,
      proposalId,
      mutationId,
      subject,
      scope: 'persistent',
      resource: proposal.resource,
      namespace: proposal.namespace,
      expectedRawDigest: proposal.expectedRawDigest,
      expiresAt: proposal.expiresAt,
      operation: proposal.operation,
      ops: proposal.ops,
    }
    proposal.digest = proposalDigest(material)
    assertBounded(material, MAX_PROPOSAL_BYTES, 'persistent proposal')
    await this.#auditBefore('persistent.proposed', {
      proposalId,
      mutationId,
      digest: proposal.digest,
      subject,
      resource: proposal.resource,
      namespace: proposal.namespace,
      expectedRawDigest: proposal.expectedRawDigest,
      expiresAt: proposal.expiresAt,
      operation: proposal.operation,
      state: proposal.state,
    })
    this.proposals.set(proposalId, proposal)
    return publicProposal(proposal)
  }

  #proposal(proposalId) {
    if (typeof proposalId !== 'string') fail('INVALID_ARGUMENT', 'proposalId must be a string')
    const proposal = this.proposals.get(proposalId)
    if (proposal === undefined) fail('PROPOSAL_NOT_FOUND', `proposal ${JSON.stringify(proposalId)} does not exist`)
    return proposal
  }

  async #expireProposal(proposal) {
    if (!['pending', 'approved'].includes(proposal.state)) return false
    if (Date.parse(proposal.expiresAt) > this.#time()) return false
    await this.#auditBefore('persistent.expired', {
      proposalId: proposal.proposalId,
      digest: proposal.digest,
      previousState: proposal.state,
      expiresAt: proposal.expiresAt,
    })
    proposal.state = 'expired'
    return true
  }

  /** Host-only approval; no grant/token is returned or accepted. */
  async approvePersistent(raw) {
    const value = record(raw, 'approval')
    exactKeys(value, new Set([
      'proposalId', 'digest', 'expectedRawDigest', 'expiresAt', 'approvedBy',
    ]), 'approval')
    const proposal = this.#proposal(value.proposalId)
    if (await this.#expireProposal(proposal)) fail('PROPOSAL_EXPIRED', `proposal ${proposal.proposalId} expired`)
    if (proposal.state !== 'pending') fail('INVALID_STATE', `proposal is ${proposal.state}, not pending`)
    if (value.digest !== proposal.digest) fail('PROPOSAL_TAMPERED', 'approval digest does not match the stored proposal')
    if (value.expectedRawDigest !== proposal.expectedRawDigest) {
      fail('APPROVAL_MISMATCH', 'approval expectedRawDigest does not match the stored proposal')
    }
    if (value.expiresAt !== proposal.expiresAt) {
      fail('APPROVAL_MISMATCH', 'approval expiry does not match the stored proposal')
    }
    const approvedBy = requiredText(value.approvedBy, 'approval.approvedBy', 256)
    const approval = {
      digest: proposal.digest,
      expectedRawDigest: proposal.expectedRawDigest,
      expiresAt: proposal.expiresAt,
      approvedBy,
      approvedAt: new Date(this.#time()).toISOString(),
    }
    await this.#auditBefore('persistent.approved', {
      proposalId: proposal.proposalId,
      digest: proposal.digest,
      expectedRawDigest: proposal.expectedRawDigest,
      expiresAt: proposal.expiresAt,
      approvedBy,
      previousState: proposal.state,
    })
    proposal.approval = approval
    proposal.state = 'approved'
    return publicProposal(proposal)
  }

  #applyArguments(raw, label) {
    const value = record(raw, label)
    exactKeys(value, new Set(['proposalId', 'digest', 'expectedRawDigest', 'expiresAt']), label)
    return {
      proposalId: requiredText(value.proposalId, `${label}.proposalId`, 256),
      digest: digest(value.digest, `${label}.digest`),
      expectedRawDigest: digest(value.expectedRawDigest, `${label}.expectedRawDigest`),
      expiresAt: canonicalInstant(value.expiresAt, `${label}.expiresAt`).value,
    }
  }

  #assertApplyBinding(proposal, input) {
    if (input.digest !== proposal.digest) fail('PROPOSAL_TAMPERED', 'apply digest does not match the stored proposal')
    if (input.expectedRawDigest !== proposal.expectedRawDigest || input.expiresAt !== proposal.expiresAt) {
      fail('APPROVAL_MISMATCH', 'apply arguments do not match the approved CAS/expiry binding')
    }
    const approval = proposal.approval
    if (approval === undefined) fail('APPROVAL_REQUIRED', 'proposal has no Host approval')
    if (approval.digest !== input.digest || approval.expectedRawDigest !== input.expectedRawDigest
      || approval.expiresAt !== input.expiresAt) {
      fail('APPROVAL_MISMATCH', 'stored approval does not match the apply request')
    }
  }

  async #transact(proposal, request) {
    let raw
    try {
      raw = await this.transact(immutable(request, 'transaction request'))
    } catch (error) {
      if (['CAS_CONFLICT', 'SETTINGS_CONFLICT'].includes(error?.code)
        && typeof error.actualRawDigest === 'string') {
        return { status: 'conflict', actualRawDigest: digest(error.actualRawDigest, 'transaction conflict digest') }
      }
      throw error
    }
    return normalizeTransactResult(raw, proposal)
  }

  /** Apply an approved proposal once; exact retries return the cached receipt. */
  async applyPersistent(raw) {
    const input = this.#applyArguments(raw, 'apply')
    const proposal = this.#proposal(input.proposalId)
    this.#assertApplyBinding(proposal, input)
    if (proposal.state === 'committed' || proposal.state === 'conflict') {
      return immutable({ ...proposal.receipt, idempotentReplay: true }, 'apply replay receipt')
    }
    if (proposal.state !== 'approved') fail('INVALID_STATE', `proposal is ${proposal.state}, not approved`)
    if (await this.#expireProposal(proposal)) fail('PROPOSAL_EXPIRED', `proposal ${proposal.proposalId} expired`)
    const flight = this.applyFlights.get(proposal.proposalId)
    if (flight !== undefined) return flight
    const run = this.#applyOnce(proposal)
    this.applyFlights.set(proposal.proposalId, run)
    try {
      return await run
    } finally {
      this.applyFlights.delete(proposal.proposalId)
    }
  }

  async #applyOnce(proposal) {
    const intent = await this.#auditBefore('persistent.apply.requested', {
      proposalId: proposal.proposalId,
      mutationId: proposal.mutationId,
      digest: proposal.digest,
      expectedRawDigest: proposal.expectedRawDigest,
      expiresAt: proposal.expiresAt,
      namespace: proposal.namespace,
      ops: proposal.ops,
    })
    const result = await this.#transact(proposal, {
      namespace: proposal.namespace,
      mutationId: proposal.mutationId,
      expectedRawDigest: proposal.expectedRawDigest,
      ops: proposal.ops,
      audit: {
        eventId: intent.eventId,
        proposalId: proposal.proposalId,
        digest: proposal.digest,
      },
    })
    if (result.status === 'conflict') {
      proposal.state = 'conflict'
      proposal.receipt = immutable({
        proposalId: proposal.proposalId,
        digest: proposal.digest,
        status: 'conflict',
        state: proposal.state,
        expectedRawDigest: proposal.expectedRawDigest,
        actualRawDigest: result.actualRawDigest,
        idempotentReplay: false,
      }, 'apply conflict receipt')
      this.#auditAfter('persistent.apply.conflict', proposal.receipt)
      return proposal.receipt
    }
    if (result.beforeRawDigest !== proposal.expectedRawDigest) {
      fail('INVALID_TRANSACTION_RESULT', 'committed transaction did not begin at expectedRawDigest')
    }
    proposal.commit = {
      beforeRawDigest: result.beforeRawDigest,
      afterRawDigest: result.afterRawDigest,
      inverseOps: result.inverseOps,
      ...(result.revision === undefined ? {} : { revision: result.revision }),
    }
    proposal.state = 'committed'
    proposal.receipt = immutable({
      proposalId: proposal.proposalId,
      digest: proposal.digest,
      status: 'committed',
      state: proposal.state,
      beforeRawDigest: result.beforeRawDigest,
      afterRawDigest: result.afterRawDigest,
      ...(result.revision === undefined ? {} : { revision: result.revision }),
      transactionIdempotent: result.idempotent,
      idempotentReplay: false,
    }, 'apply receipt')
    this.#auditAfter('persistent.apply.committed', proposal.receipt)
    return proposal.receipt
  }

  /** Conditional rollback; CAS is fixed to the committed after digest. */
  async rollbackPersistent(raw) {
    const value = record(raw, 'rollback')
    exactKeys(value, new Set(['proposalId', 'digest', 'expectedRawDigest']), 'rollback')
    const input = {
      proposalId: requiredText(value.proposalId, 'rollback.proposalId', 256),
      digest: digest(value.digest, 'rollback.digest'),
      expectedRawDigest: digest(value.expectedRawDigest, 'rollback.expectedRawDigest'),
    }
    const proposal = this.#proposal(input.proposalId)
    if (input.digest !== proposal.digest) fail('PROPOSAL_TAMPERED', 'rollback digest does not match the stored proposal')
    if (proposal.state === 'rolled-back' || proposal.state === 'rollback-conflict') {
      return immutable({ ...proposal.rollbackReceipt, idempotentReplay: true }, 'rollback replay receipt')
    }
    if (proposal.state !== 'committed' || proposal.commit === undefined) {
      fail('INVALID_STATE', `proposal is ${proposal.state}, not committed`)
    }
    if (input.expectedRawDigest !== proposal.commit.afterRawDigest) {
      fail('ROLLBACK_MISMATCH', 'rollback must be conditioned on the committed afterRawDigest')
    }
    const flight = this.rollbackFlights.get(proposal.proposalId)
    if (flight !== undefined) return flight
    const run = this.#rollbackOnce(proposal)
    this.rollbackFlights.set(proposal.proposalId, run)
    try {
      return await run
    } finally {
      this.rollbackFlights.delete(proposal.proposalId)
    }
  }

  async #rollbackOnce(proposal) {
    const mutationId = `${proposal.mutationId}-rollback`
    const intent = await this.#auditBefore('persistent.rollback.requested', {
      proposalId: proposal.proposalId,
      mutationId,
      digest: proposal.digest,
      namespace: proposal.namespace,
      expectedRawDigest: proposal.commit.afterRawDigest,
      inverseOps: proposal.commit.inverseOps,
    })
    const result = await this.#transact(proposal, {
      namespace: proposal.namespace,
      mutationId,
      expectedRawDigest: proposal.commit.afterRawDigest,
      ops: proposal.commit.inverseOps,
      audit: {
        eventId: intent.eventId,
        proposalId: proposal.proposalId,
        digest: proposal.digest,
        rollback: true,
      },
    })
    if (result.status === 'conflict') {
      proposal.state = 'rollback-conflict'
      proposal.rollbackReceipt = immutable({
        proposalId: proposal.proposalId,
        digest: proposal.digest,
        status: 'conflict',
        state: proposal.state,
        expectedRawDigest: proposal.commit.afterRawDigest,
        actualRawDigest: result.actualRawDigest,
        idempotentReplay: false,
      }, 'rollback conflict receipt')
      this.#auditAfter('persistent.rollback.conflict', proposal.rollbackReceipt)
      return proposal.rollbackReceipt
    }
    if (result.beforeRawDigest !== proposal.commit.afterRawDigest) {
      fail('INVALID_TRANSACTION_RESULT', 'rollback transaction did not begin at the committed afterRawDigest')
    }
    proposal.state = 'rolled-back'
    proposal.rollbackReceipt = immutable({
      proposalId: proposal.proposalId,
      digest: proposal.digest,
      status: 'committed',
      state: proposal.state,
      beforeRawDigest: result.beforeRawDigest,
      afterRawDigest: result.afterRawDigest,
      ...(result.revision === undefined ? {} : { revision: result.revision }),
      transactionIdempotent: result.idempotent,
      idempotentReplay: false,
    }, 'rollback receipt')
    this.#auditAfter('persistent.rollback.committed', proposal.rollbackReceipt)
    return proposal.rollbackReceipt
  }

  /** Frozen inspection for a trusted controller. */
  inspectPersistent(proposalId) {
    return publicProposal(this.#proposal(proposalId))
  }

  /** Frozen, append-only, redacted audit projection. */
  auditLog() {
    return immutable(this.audit, 'audit log')
  }
}
