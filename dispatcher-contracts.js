/** Structured report required from every executor child. */
export const EXECUTOR_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['completed', 'blocked'] },
    summary: { type: 'string' },
    artifacts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['path', 'description'],
      },
    },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'fail', 'unknown'] },
          evidence: { type: 'string' },
        },
        required: ['id', 'status', 'evidence'],
      },
    },
    blocker: { type: 'string' },
  },
  required: ['status', 'summary', 'artifacts', 'criteria'],
})

/** Structured decision required from every independent verifier child. */
export const VERIFIER_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['accept', 'revise', 'reject', 'blocked'] },
    summary: { type: 'string' },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'fail', 'unknown'] },
          evidence: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['id', 'status', 'evidence'],
      },
    },
    feedback: { type: 'string' },
  },
  required: ['decision', 'summary', 'criteria', 'feedback'],
})

const PLAN_STEP_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    objective: { type: 'string' },
    acceptanceCriteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['id', 'text'],
      },
    },
    covers: { type: 'array', items: { type: 'string' } },
    deliverableIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'title', 'objective', 'acceptanceCriteria', 'covers', 'deliverableIds'],
})

/** Structured initial master-plan proposal. The Host supplies identity and revision. */
export const INITIAL_PLAN_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    steps: { type: 'array', items: PLAN_STEP_OUTPUT_SCHEMA },
  },
  required: ['summary', 'steps'],
})

/** Typed replacement of only the unfinished suffix of a master plan. */
export const PLAN_PATCH_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    baseRevision: { type: 'integer' },
    action: { type: 'string', enum: ['keep', 'replace_pending', 'blocked'] },
    rationale: { type: 'string' },
    steps: { type: 'array', items: PLAN_STEP_OUTPUT_SCHEMA },
  },
  required: ['baseRevision', 'action', 'rationale', 'steps'],
})

/** Independent semantic review for an initial or revised plan. */
export const PLAN_REVIEW_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['accept', 'reject', 'blocked'] },
    summary: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['decision', 'summary', 'issues'],
})

const SUBTASK_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    objective: { type: 'string' },
    dependsOn: { type: 'array', items: { type: 'string' } },
    inputContracts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          fromNodeId: { type: 'string' },
          outputContractId: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['id', 'fromNodeId', 'outputContractId', 'description'],
      },
    },
    outputContracts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string' }, description: { type: 'string' } },
        required: ['id', 'description'],
      },
    },
    resourceClass: {
      type: 'string',
      enum: ['analysis', 'code', 'test', 'integration', 'review', 'operations'],
    },
    estimatedCost: { type: 'string', enum: ['small', 'medium', 'large'] },
    scope: { type: 'array', items: { type: 'string' } },
    acceptanceCriteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'text'],
      },
    },
    covers: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'id', 'title', 'objective', 'dependsOn', 'inputContracts', 'outputContracts',
    'resourceClass', 'estimatedCost', 'scope', 'acceptanceCriteria', 'covers',
  ],
})

/** Structured, Host-reviewed DAG proposal for a bounded recursive task node. */
export const SUBTASK_PLAN_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    tasks: { type: 'array', items: SUBTASK_OUTPUT_SCHEMA },
  },
  required: ['summary', 'tasks'],
})

/** Typed replacement of only the not-yet-started portion of an orchestration DAG. */
export const SUBTASK_PLAN_PATCH_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    baseRevision: { type: 'integer' },
    action: { type: 'string', enum: ['keep', 'replace_pending', 'blocked'] },
    rationale: { type: 'string' },
    tasks: { type: 'array', items: SUBTASK_OUTPUT_SCHEMA },
  },
  required: ['baseRevision', 'action', 'rationale', 'tasks'],
})

const CRITERION_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['pass', 'fail', 'unknown'] },
    evidence: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['id', 'status', 'evidence'],
}

const CHILD_RUN_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attempt: { type: 'integer' },
    phase: { type: 'string' },
    stepId: { type: 'string' },
    planRevision: { type: 'integer' },
    runId: { type: 'string' },
    status: { type: 'string' },
    report: { type: 'object' },
    error: { type: 'string' },
  },
  required: ['attempt', 'status'],
}

/** Structured master-plan result embedded in a foreground dispatch_task output. */
export const MASTER_PLAN_RESULT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    planId: { type: 'string' },
    taskId: { type: 'string' },
    revision: { type: 'integer' },
    patchCount: { type: 'integer' },
    status: { type: 'string', enum: ['active', 'accepted', 'rejected', 'blocked', 'cancelled', 'error'] },
    summary: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          objective: { type: 'string' },
          acceptanceCriteria: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
              },
              required: ['id', 'text'],
            },
          },
          covers: { type: 'array', items: { type: 'string' } },
          deliverableIds: { type: 'array', items: { type: 'string' } },
          dependsOn: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: ['pending', 'completed'] },
          attempts: { type: 'integer' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                status: { type: 'string', enum: ['pass', 'fail', 'unknown'] },
                evidence: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['id', 'status', 'evidence'],
            },
          },
        },
        required: ['id', 'title', 'objective', 'acceptanceCriteria', 'covers', 'deliverableIds', 'status', 'attempts', 'evidence'],
      },
    },
    history: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              revision: { type: 'integer' },
              kind: { type: 'string', const: 'created' },
              summary: { type: 'string' },
              stepIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['revision', 'kind', 'summary', 'stepIds'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              revision: { type: 'integer' },
              kind: { type: 'string', const: 'revised' },
              rationale: { type: 'string' },
              added: { type: 'array', items: { type: 'string' } },
              removed: { type: 'array', items: { type: 'string' } },
              order: { type: 'array', items: { type: 'string' } },
            },
            required: ['revision', 'kind', 'rationale', 'added', 'removed', 'order'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              revision: { type: 'integer' },
              kind: { type: 'string', const: 'step_started' },
              stepId: { type: 'string' },
              attempt: { type: 'integer' },
            },
            required: ['revision', 'kind', 'stepId', 'attempt'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              revision: { type: 'integer' },
              kind: { type: 'string', const: 'step_completed' },
              stepId: { type: 'string' },
              attempt: { type: 'integer' },
              passedCriterionIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['revision', 'kind', 'stepId', 'attempt', 'passedCriterionIds'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              revision: { type: 'integer' },
              kind: { type: 'string', const: 'finished' },
              status: { type: 'string', enum: ['accepted', 'rejected', 'blocked', 'cancelled', 'error'] },
              message: { type: 'string' },
            },
            required: ['revision', 'kind', 'status', 'message'],
          },
        ],
      },
    },
  },
  required: ['planId', 'taskId', 'revision', 'patchCount', 'status', 'summary', 'steps', 'history'],
})

export const TASK_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    taskId: { type: 'string' },
    lane: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'string', enum: ['accepted', 'rejected', 'blocked', 'cancelled', 'error'] },
    modelVerified: { type: 'boolean' },
    attempts: { type: 'integer' },
    message: { type: 'string' },
    workspaceQuarantined: { type: 'boolean' },
    failureClass: { type: 'string', enum: ['none', 'task', 'infrastructure'] },
    criteria: { type: 'array', items: CRITERION_RESULT_SCHEMA },
    executorRuns: { type: 'array', items: CHILD_RUN_RESULT_SCHEMA },
    verifierRuns: { type: 'array', items: CHILD_RUN_RESULT_SCHEMA },
    plannerRuns: { type: 'array', items: CHILD_RUN_RESULT_SCHEMA },
    planReviewRuns: { type: 'array', items: CHILD_RUN_RESULT_SCHEMA },
    masterPlan: MASTER_PLAN_RESULT_SCHEMA,
  },
  required: [
    'taskId', 'lane', 'title', 'status', 'modelVerified', 'attempts',
    'message', 'workspaceQuarantined', 'failureClass', 'criteria', 'executorRuns', 'verifierRuns',
  ],
}

export const TOOL_OUTPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'distributed' },
        taskId: { type: 'string' },
        state: { type: 'string', enum: ['queued', 'running', 'terminal'] },
      },
      required: ['kind', 'taskId', 'state'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'background' },
        taskId: { type: 'string' },
        jobId: { type: 'string' },
      },
      required: ['kind', 'taskId', 'jobId'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'foreground' },
        task: TASK_RESULT_SCHEMA,
      },
      required: ['kind', 'task'],
    },
  ],
}

export const DISTRIBUTED_TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    taskId: { type: 'string' },
    lane: { type: 'string' },
    state: { type: 'string', enum: ['queued', 'running', 'terminal'] },
    outcome: { type: 'string', enum: ['accepted', 'rejected', 'blocked', 'cancelled', 'error'] },
    pool: { type: 'string' },
    deliveryAttempts: { type: 'integer' },
    workerId: { type: 'string' },
    leaseGeneration: { type: 'string' },
    leaseUntil: { type: 'string' },
    cancelRequested: { type: 'boolean' },
    result: TASK_RESULT_SCHEMA,
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    finishedAt: { type: 'string' },
  },
  required: ['taskId', 'lane', 'state', 'pool', 'deliveryAttempts', 'cancelRequested', 'createdAt', 'updatedAt'],
}
