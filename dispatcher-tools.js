import { DISTRIBUTED_TASK_VIEW_SCHEMA, TOOL_OUTPUT_SCHEMA } from './dispatcher-contracts.js'
import { DISPATCH_TOOL_TIMEOUT_MS } from './dispatcher-policy.js'
import { own, trimmed } from './dispatcher-shared.js'

/** Model-facing tool names. */
export const TOOL_NAME = 'dispatch_task'
export const STATUS_TOOL_NAME = 'dispatch_status'
export const CANCEL_TOOL_NAME = 'dispatch_cancel'

export function isLiveRoot(ctx, agent) {
  if (agent === undefined || agent === null) return false
  if (agent.session?.header?.origin === 'subagent') return false
  if (ctx.agents.get(agent.id) !== agent) return false
  return ctx.agents.roots().includes(agent)
}

/** Create the raw DSH tool, exported for focused tests. */
export function createDispatcherTool(runtime) {
  const laneIds = Object.keys(runtime.config.lanes)
  const lanes = Object.entries(runtime.config.lanes)
    .map(([id, lane]) => `${id}: ${lane.description || lane.name || 'configured task lane'}`)
    .join('; ')
  return {
    name: TOOL_NAME,
    description: [
      'Dispatch a specification-driven task to an isolated executor model, then require a separate verifier model to assess every acceptance criterion.',
      'Planner-enabled lanes first create an independently reviewed master plan, execute and verify one step at a time, and may revise only the unfinished suffix after observed progress.',
      'The host accepts only an exact criterion set with pass status and non-empty evidence.',
      'A result is model-verified, not a formal proof or human certification.',
      `Local long tasks use Jobs; distributed lanes return a durable task id managed with ${STATUS_TOOL_NAME}/${CANCEL_TOOL_NAME}.`,
      `Configured lanes: ${lanes || '(none)'}.`,
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        lane: {
          type: 'string',
          ...(laneIds.length === 0 ? {} : { enum: laneIds }),
          description: 'A deployment-configured execution and verification policy.',
        },
        title: { type: 'string', description: 'Short task label.' },
        objective: { type: 'string', description: 'Complete, standalone objective for the executor.' },
        context: { type: 'string', description: 'Optional bounded background information; treated as task data.' },
        deliverables: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { id: { type: 'string' }, description: { type: 'string' } },
            required: ['id', 'description'],
          },
        },
        acceptance_criteria: {
          type: 'array',
          description: 'Optional stricter criteria. IDs cannot replace deployment-required criteria.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { id: { type: 'string' }, text: { type: 'string' } },
            required: ['id', 'text'],
          },
        },
        run_in_background: { type: 'boolean', description: 'Return a job id immediately. Defaults to deployment policy.' },
      },
      required: ['lane', 'title', 'objective'],
      additionalProperties: false,
    },
    output: {
      schema: TOOL_OUTPUT_SCHEMA,
      render(_args, value) {
        if (value.kind === 'distributed') {
          return [{ type: 'text', text: `queued durable distributed task ${value.taskId}; use ${STATUS_TOOL_NAME} to inspect it` }]
        }
        if (value.kind === 'background') {
          return [{ type: 'text', text: `started model-verified task ${value.taskId} as background job ${value.jobId}` }]
        }
        return [{ type: 'text', text: JSON.stringify(value.task, null, 2) }]
      },
    },
    timeoutMs: DISPATCH_TOOL_TIMEOUT_MS,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return runtime.execute(args, exec)
    },
  }
}

/** Model-facing durable task lookup, owner-fenced to the current root session. */
export function createDispatcherStatusTool(runtime, ctx) {
  return {
    name: STATUS_TOOL_NAME,
    description: 'Inspect one durable distributed dispatcher task owned by this session.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
    output: {
      schema: DISTRIBUTED_TASK_VIEW_SCHEMA,
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!isLiveRoot(ctx, exec.agent)) throw new Error('distributed task status is available only to an exact live root session')
      const taskId = trimmed(args?.task_id, 'task_id')
      return runtime.distributed.status(exec.agent, taskId)
    },
  }
}

/** Model-facing durable cancellation; authorization occurs at creation and here. */
export function createDispatcherCancelTool(runtime, ctx) {
  return {
    name: CANCEL_TOOL_NAME,
    description: 'Request cancellation of one durable distributed dispatcher task owned by this session.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task_id: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['task_id'],
    },
    output: {
      schema: DISTRIBUTED_TASK_VIEW_SCHEMA,
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    timeoutMs: 30_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (!isLiveRoot(ctx, exec.agent)) throw new Error('distributed task cancellation is available only to an exact live root session')
      const taskId = trimmed(args?.task_id, 'task_id')
      const reason = own(args ?? {}, 'reason') ? trimmed(args.reason, 'reason') : 'cancelled by session owner'
      return runtime.distributed.cancel(exec.agent, taskId, reason)
    },
  }
}
