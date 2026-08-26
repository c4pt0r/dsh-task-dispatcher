import { DISPOSE_TIMEOUT_MS } from './dispatcher-policy.js'
import { errorText, isRecord, telemetryWarn } from './dispatcher-shared.js'

function contentText(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter(block => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

function stopReasonMessage(reason) {
  switch (reason) {
    case 'aborted': return 'child run was cancelled'
    case 'error': return 'child run failed'
    case 'max-tokens': return 'child run reached its token limit'
    case 'refusal': return 'child model refused the task'
    default: return `child run ended abnormally (${String(reason)})`
  }
}

export function linkedDeadline(parentSignal, timeoutMs, label) {
  const controller = new AbortController()
  let timedOut = false
  const onParentAbort = () => controller.abort(parentSignal?.reason ?? new Error(`${label} cancelled`))
  if (parentSignal?.aborted) onParentAbort()
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', onParentAbort)
    },
  }
}

function waitForSignal(promise, signal, label) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error(`${label} cancelled`))
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback(value)
    }
    const onAbort = () => finish(rejectPromise, signal.reason ?? new Error(`${label} cancelled`))
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise).then(
      value => finish(resolvePromise, value),
      error => finish(rejectPromise, error),
    )
  })
}

export async function boundedSettlement(promise, timeoutMs) {
  let timer
  const timeout = new Promise((resolvePromise) => {
    timer = setTimeout(() => resolvePromise({ ok: false, error: `cleanup timed out after ${timeoutMs}ms` }), timeoutMs)
  })
  const settlement = Promise.resolve(promise).then(
    () => ({ ok: true }),
    error => ({ ok: false, error: errorText(error) }),
  )
  const result = await Promise.race([settlement, timeout])
  clearTimeout(timer)
  return result
}

/**
 * Tool names this deployment actually registered, or undefined when the
 * registry cannot be read (never let a diagnostic break a dispatch).
 * @param ctx - the dispatcher's own context.
 * @returns the registered names, or undefined.
 */
export function registeredToolNames(ctx, scope) {
  // Union of the agent-scoped and global views on purpose. A deployment may
  // register a tool globally (headless) or scope it to the agent (the web app
  // scopes the fs tools to a session's workspace), and a child inherits from
  // BOTH chains. Consulting only the plugin's own unscoped view reports every
  // agent-scoped tool as missing and silently strips read/glob/grep. Dropping
  // a tool is only safe when neither view has heard of it.
  const names = new Set()
  let answered = false
  for (const key of [scope, undefined]) {
    let schemas
    try {
      schemas = ctx?.tools?.schemas?.(key)
    } catch {
      continue
    }
    if (!Array.isArray(schemas)) continue
    answered = true
    for (const schema of schemas) {
      if (typeof schema?.name === 'string') names.add(schema.name)
    }
  }
  return answered ? names : undefined
}

/**
 * A lane names the tools its roles SHOULD have; a deployment decides which
 * plugins are mounted. `tools.restrict()` throws on a name the registry does
 * not know, so an unmounted optional tool would abort every child instead of
 * degrading. Drop what is absent, and let the caller tell the model.
 * @param ctx - the dispatcher's own context.
 * @param toolNames - the lane's configured names for this role.
 * @param label - the child label used in the diagnostic.
 * @param logger - telemetry sink for the dropped-tool warning.
 * @returns the child tool filter, restricted to names that exist here.
 */
function childToolFilter(ctx, toolNames, label, logger, scope) {
  // An explicit empty allow-list is intentional for a model-only verifier.
  const requested = toolNames ?? []
  const available = registeredToolNames(ctx, scope)
  if (available === undefined) return { allow: requested }
  const missing = requested.filter(name => !available.has(name))
  if (missing.length > 0) {
    telemetryWarn(logger, `${label}: this deployment does not provide ${missing.join(', ')}; the child runs without them`)
  }
  return { allow: requested.filter(name => available.has(name)) }
}

function reportChildProgress(options, progress) {
  try {
    options.onProgress?.(progress)
  } catch (error) {
    telemetryWarn(options.logger, error)
  }
}

/** Run one child with bounded startup/result/disposal and no leaking rejection. */
export async function runStructuredChild(ctx, options) {
  const deadline = linkedDeadline(options.signal, options.timeoutMs, options.label)
  let run
  let startSettled = false
  let phase = 'starting'
  let disposePromise
  const disposeOnce = () => {
    if (run === undefined) return Promise.resolve()
    disposePromise ??= Promise.resolve().then(() => run.dispose())
    return disposePromise
  }
  try {
    const start = Promise.resolve().then(() => ctx.subagents.start(options.transport, {
      label: options.label,
      prompt: [{ type: 'text', text: options.prompt }],
      parent: options.parent,
      signal: deadline.signal,
      agentOptions: options.route,
      outputSchema: options.outputSchema,
      maxDepth: 1,
      toolFilter: childToolFilter(ctx, options.tools, options.label, options.logger, options.parent),
      persona: options.persona,
    }))
    // If startup publishes after our deadline, immediately own and release it.
    start.then((published) => {
      startSettled = true
      run = published
      if (deadline.signal.aborted) {
        reportChildProgress(options, { status: 'cleanup', runId: published.id })
        void boundedSettlement(disposeOnce(), DISPOSE_TIMEOUT_MS).then((settled) => {
          if (!settled.ok) telemetryWarn(options.logger, `${options.label}: late child cleanup failed: ${settled.error}`)
          reportChildProgress(options, {
            status: settled.ok && !deadline.timedOut() ? 'cancelled' : 'error',
            runId: published.id,
            ...(settled.ok ? {} : { error: settled.error }),
          })
        }).catch(() => {})
      }
    }, () => {
      startSettled = true
    })
    run = await waitForSignal(start, deadline.signal, options.label)
    phase = 'running'
    reportChildProgress(options, { status: 'running', runId: run.id })
    const result = await waitForSignal(run.result, deadline.signal, options.label)
    phase = 'cleanup'
    reportChildProgress(options, { status: 'cleanup', runId: run.id })
    const cleanup = await boundedSettlement(disposeOnce(), DISPOSE_TIMEOUT_MS)
    if (!cleanup.ok) {
      return {
        ok: false,
        kind: 'error',
        runId: run.id,
        error: `child cleanup failed: ${cleanup.error}`,
        quarantine: true,
        infrastructureFailure: true,
      }
    }
    // Result settlement does not make the phase terminal until cleanup has
    // quiesced. A parent cancellation or deadline may arrive while dispose()
    // is in flight, so recheck both before accepting any structured output.
    if (deadline.timedOut()) {
      return {
        ok: false,
        kind: 'error',
        runId: run.id,
        error: `${options.label} timed out after ${options.timeoutMs}ms`,
      }
    }
    if (options.signal?.aborted) {
      return {
        ok: false,
        kind: 'cancelled',
        runId: run.id,
        error: `${options.label} was cancelled`,
      }
    }
    if (result.stopReason !== 'completed') {
      const partial = contentText(result.output)
      // A child that finishes its turn without calling structured_output is
      // reported as stopReason 'error' with no structured value (see
      // dsh-subagent-in-process-driver). That is a safe retry boundary whether
      // or not the model left any prose behind: an empty final answer is the
      // same protocol miss as a prose one, and used to fall through to the
      // generic 'child run failed' with no retry.
      const structuredProtocolFailure = result.stopReason === 'error'
        && result.structured === undefined
      return {
        ok: false,
        kind: result.stopReason === 'aborted' ? 'cancelled' : 'error',
        runId: run.id,
        error: structuredProtocolFailure
          ? partial === ''
            // No structured result AND no text: could be a protocol miss or a
            // provider error the subagent seam cannot distinguish. Say what is
            // observable rather than asserting the cause.
            ? 'child produced neither the required structured result nor any text'
            : `child ended without the required structured result; untrusted plain-text output: ${partial.slice(0, 2_000)}`
          : `${stopReasonMessage(result.stopReason)}${partial === '' ? '' : `; partial output: ${partial.slice(0, 2_000)}`}`,
        ...(structuredProtocolFailure ? { structuredProtocolFailure: true } : {}),
      }
    }
    const structured = options.validate(result.structured)
    if (structured === undefined) {
      return { ok: false, kind: 'error', runId: run.id, error: 'child returned missing or invalid structured output' }
    }
    return { ok: true, runId: run.id, report: structured }
  } catch (error) {
    if (run !== undefined && phase !== 'cleanup') {
      reportChildProgress(options, { status: 'cleanup', runId: run.id })
    }
    const cleanup = await boundedSettlement(disposeOnce(), DISPOSE_TIMEOUT_MS)
    // A start request can publish a mutable child after cancellation wins the
    // race. Until that promise settles, the workspace must remain fenced even
    // though the late-publish handler will make a best-effort disposal.
    const unresolvedStart = run === undefined && !startSettled
    const cancelled = options.signal?.aborted && !deadline.timedOut()
    const reason = deadline.timedOut()
      ? `${options.label} timed out after ${options.timeoutMs}ms`
      : cancelled ? `${options.label} was cancelled` : errorText(error)
    return {
      ok: false,
      kind: cancelled ? 'cancelled' : 'error',
      ...(run === undefined ? {} : { runId: run.id }),
      error: cleanup.ok ? reason : `${reason}; child cleanup failed: ${cleanup.error}`,
      ...(cleanup.ok && !unresolvedStart ? {} : { quarantine: true }),
      ...(
        unresolvedStart
        || !cleanup.ok
        || (!cancelled && !deadline.timedOut() && (phase === 'starting' || phase === 'running'))
          ? { infrastructureFailure: true }
          : {}
      ),
    }
  } finally {
    deadline.dispose()
  }
}

export async function runTelemetryChild(ctx, spec, telemetry, metadata, options) {
  const orchestrationContext = spec.orchestrationContext
  if (orchestrationContext !== undefined) {
    orchestrationContext.ledger.consumeModelRuns(orchestrationContext.grantToken, {
      taskId: orchestrationContext.rootTaskId,
      count: 1,
    })
  }
  let workerId
  try {
    workerId = telemetry?.startWorker(spec.taskId, metadata, options)
  } catch (error) {
    telemetryWarn(options.logger, error)
  }
  let result
  try {
    result = await runStructuredChild(ctx, {
      ...options,
      onProgress: (progress) => {
        try {
          telemetry?.updateWorker(spec.taskId, workerId, progress)
        } catch (error) {
          telemetryWarn(options.logger, error)
        }
      },
    })
    try {
      telemetry?.finishWorker(spec.taskId, workerId, result)
    } catch (error) {
      telemetryWarn(options.logger, error)
    }
    return result
  } catch (error) {
    try {
      telemetry?.updateWorker(spec.taskId, workerId, {
        status: 'error',
        error: errorText(error),
      })
    } catch (telemetryError) {
      telemetryWarn(options.logger, telemetryError)
    }
    throw error
  }
}
