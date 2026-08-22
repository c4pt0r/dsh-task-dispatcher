// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskDispatcherAction, planProgress, type TaskDispatcherActionProps } from '../../src/client/TaskDispatcherAction.tsx'
import { en, zh } from '../../src/client/locales.ts'
import type { DispatcherSnapshot, DispatcherTask, DispatcherViewState } from '../../src/client/types.ts'

// The published primitives bundle includes Markdown's global KaTeX stylesheet,
// which Node cannot import. This component spec keeps the contract boundary
// realistic while substituting only the already-tested primitive chrome.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  StateDot: ({ state }: { state: string }) => <span data-state={state} />,
  DisclosureRow: ({
    icon, title, open, onToggle, collapsedContent, children,
  }: {
    icon: ReactNode
    title: string
    open: boolean
    onToggle: () => void
    collapsedContent?: ReactNode
    children?: ReactNode
  }) => (
    <div>
      <button type="button" aria-expanded={open} onClick={onToggle}>{icon}{title}{collapsedContent}</button>
      {open ? children : null}
    </div>
  ),
  Modal: ({ open, onClose, title, closeLabel, children }: {
    open: boolean
    onClose: () => void
    title: string
    closeLabel: string
    children?: ReactNode
  }) => open ? (
    <div role="dialog" aria-label={title}>
      <button type="button" aria-label={closeLabel} onClick={onClose} />
      {children}
    </div>
  ) : null,
}))

afterEach(cleanup)

const t: TaskDispatcherActionProps['t'] = (key, params = {}) => {
  let result: string = zh[key as keyof typeof zh]
  for (const [name, value] of Object.entries(params)) result = result.replaceAll(`{${name}}`, String(value))
  return result
}

const enT: TaskDispatcherActionProps['t'] = (key, params = {}) => {
  let result: string = en[key as keyof typeof en]
  for (const [name, value] of Object.entries(params)) result = result.replaceAll(`{${name}}`, String(value))
  return result
}

function task(rest: Partial<DispatcherTask> = {}): DispatcherTask {
  return {
    taskId: 'task-1',
    lane: 'self-improvement',
    title: '改进 Task Dispatcher',
    status: 'running',
    phase: 'step-executor',
    startedAt: 1,
    updatedAt: 2,
    masterPlan: {
      planId: 'plan-1', revision: 3, patchCount: 1, status: 'active', summary: '先实现，再验收。',
      steps: [
        { id: 's1', title: '实现可视化', objective: '展示依赖和模型。', status: 'completed', attempts: 1, dependsOn: [] },
        { id: 's2', title: '运行验收', objective: '验证交互和可访问性。', status: 'working', attempts: 2, dependsOn: ['s1'] },
      ],
    },
    workers: [
      {
        workerId: 'telemetry-planner', agentId: 'agent-plan', role: 'planner', phase: 'initial-plan',
        attempt: 1, transport: 'spawn', provider: 'local', model: 'deepseek-planner', maxTokens: 32_000,
        status: 'completed', startedAt: 1, updatedAt: 2, finishedAt: 2,
      },
      {
        workerId: 'telemetry-executor', agentId: 'agent-exec', role: 'executor', phase: 'step-executor',
        stepId: 's2', planRevision: 3, attempt: 2, transport: 'spawn', provider: 'local',
        model: 'deepseek-executor', maxTokens: 32_000, status: 'running', startedAt: 2, updatedAt: 3,
      },
    ],
    ...rest,
  }
}

function state(view: Partial<DispatcherViewState> = {}): DispatcherViewState {
  return stateWithTasks([task()], view)
}

function stateWithTasks(
  tasks: readonly DispatcherTask[],
  view: Partial<DispatcherViewState> = {},
): DispatcherViewState {
  const snapshot: DispatcherSnapshot = {
    protocolVersion: 1,
    revision: 3,
    sessionId: 'session-1',
    generatedAt: 3,
    tasks,
  }
  return { phase: 'ready', snapshot, ...view }
}

function props(
  view: DispatcherViewState,
  translate: TaskDispatcherActionProps['t'] = t,
): TaskDispatcherActionProps {
  const useTaskDispatcher = <Selected,>(selector: (value: DispatcherViewState) => Selected): Selected => selector(view)
  return {
    t: translate,
    useTaskDispatcher,
  } as unknown as TaskDispatcherActionProps
}

describe('TaskDispatcherAction', () => {
  it('summarizes active plan progress and running Agents in the session header', () => {
    render(<TaskDispatcherAction {...props(state())} />)
    const trigger = screen.getByRole('button', {
      name: '打开任务执行计划：1 个任务进行中：计划 1/2 · 1 个 Agent 运行',
    })
    expect(trigger.textContent).toContain('计划 1/2 · 1 个 Agent 运行')
    expect(trigger.querySelector('[data-state="ongoing"]')).toBeTruthy()
  })

  it('shows the current phase instead of Plan 0/0 while an unplanned task is starting', () => {
    render(<TaskDispatcherAction {...props(stateWithTasks([task({
      phase: 'initial-plan',
      masterPlan: undefined,
      workers: [],
    })]))} />)

    const trigger = screen.getByRole('button', {
      name: '打开任务执行计划：1 个任务进行中：生成初始计划 · 0 个 Agent 运行',
    })
    expect(trigger.textContent).toContain('生成初始计划 · 0 个 Agent 运行')
    expect(trigger.textContent).not.toContain('0/0')
    expect(trigger.querySelector('[data-state="ongoing"]')).toBeTruthy()
  })

  it('counts active child Agents rather than distinct provider/model routes', () => {
    const baseWorker = task().workers[1]!
    render(<TaskDispatcherAction {...props(stateWithTasks([task({
      phase: 'initial-plan',
      masterPlan: undefined,
      workers: [
        { ...baseWorker, workerId: 'planner-a', role: 'planner', phase: 'initial-plan' },
        { ...baseWorker, workerId: 'planner-b', role: 'planner', phase: 'initial-plan' },
      ],
    })]))} />)

    expect(screen.getByRole('button').textContent).toContain('生成初始计划 · 2 个 Agent 运行')
  })

  it('keeps completed history out of an active no-plan task summary', () => {
    const completed = task({
      taskId: 'task-completed',
      title: '已完成的历史任务',
      status: 'accepted',
      phase: 'finished',
      updatedAt: 8,
      masterPlan: {
        planId: 'old-plan', revision: 1, patchCount: 0, status: 'accepted', summary: '',
        steps: [{ id: 'old', title: '旧步骤', objective: '', status: 'completed', attempts: 1, dependsOn: [] }],
      },
      workers: [],
    })
    const active = task({
      taskId: 'task-active',
      phase: 'preparing',
      updatedAt: 9,
      masterPlan: undefined,
      workers: [],
    })
    render(<TaskDispatcherAction {...props(stateWithTasks([completed, active]))} />)

    const trigger = screen.getByRole('button')
    expect(trigger.textContent).toContain('准备中 · 0 个 Agent 运行')
    expect(trigger.textContent).not.toContain('计划 1/1')
  })

  it('aggregates only simultaneous running tasks and keeps their count visible', () => {
    const second = task({ taskId: 'task-2', title: '并行任务', updatedAt: 4 })
    render(<TaskDispatcherAction {...props(stateWithTasks([task(), second]))} />)

    const trigger = screen.getByRole('button', {
      name: '打开任务执行计划：2 个任务进行中：计划 2/4 · 2 个 Agent 运行',
    })
    expect(trigger.textContent).toContain('2 个任务 · 计划 2/4 · 2 个 Agent 运行')
  })

  it('keeps an unplanned active phase visible beside other active plan progress', () => {
    const unplanned = task({
      taskId: 'task-planning',
      title: '正在规划的并行任务',
      phase: 'initial-plan',
      updatedAt: 4,
      masterPlan: undefined,
      workers: [],
    })
    render(<TaskDispatcherAction {...props(stateWithTasks([task(), unplanned]))} />)

    const trigger = screen.getByRole('button', {
      name: '打开任务执行计划：2 个任务进行中：生成初始计划 · 计划 1/2 · 1 个 Agent 运行',
    })
    expect(trigger.textContent).toContain('2 个任务 · 生成初始计划 · 计划 1/2 · 1 个 Agent 运行')
    expect(trigger.textContent).not.toContain('0/0')
  })

  it('shows only the latest terminal task status and plan progress when none are running', () => {
    const older = task({
      taskId: 'task-old',
      title: '旧任务',
      status: 'accepted',
      phase: 'finished',
      updatedAt: 8,
      workers: [],
    })
    const latest = task({
      taskId: 'task-latest',
      title: '最近任务',
      status: 'rejected',
      phase: 'finished',
      updatedAt: 9,
      workers: [],
    })
    render(<TaskDispatcherAction {...props(stateWithTasks([older, latest]))} />)

    const trigger = screen.getByRole('button', {
      name: '打开任务执行计划：最近任务“最近任务”：未通过；计划 1/2',
    })
    expect(trigger.textContent).toContain('未通过 · 计划 1/2')
    expect(trigger.textContent).not.toContain('2/4')
    expect(trigger.querySelector('[data-state="error"]')).toBeTruthy()
  })

  it('opens an expanded task with an accessible vertical dependency chain and worker facts', () => {
    render(<TaskDispatcherAction {...props(state())} />)
    fireEvent.click(screen.getByRole('button'))

    const dialog = screen.getByRole('dialog', { name: zh['modal.title'] })
    expect(within(dialog).getByRole('list', { name: zh['tasks.aria'] })).toBeTruthy()
    expect(within(dialog).getByRole('list', { name: '“改进 Task Dispatcher”的纵向依赖链' })).toBeTruthy()
    expect(within(dialog).getByLabelText('步骤 s1 没有前置依赖').textContent).toContain('依赖：无（起始步骤）')
    expect(within(dialog).getByLabelText('步骤 s2 依赖 实现可视化 (s1)').textContent)
      .toContain('依赖：实现可视化 (s1)')
    expect(within(dialog).getByText('agent-exec')).toBeTruthy()
    expect(within(dialog).getByText('local/deepseek-executor')).toBeTruthy()
    expect(within(dialog).getByText('telemetry-executor')).toBeTruthy()
    expect(within(dialog).getByText('agent-plan')).toBeTruthy()
  })

  it('leaves the local task card unchanged when distributed telemetry is absent', () => {
    render(<TaskDispatcherAction {...props(state())} />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.queryByText(zh['distribution.title'])).toBeNull()
    expect(document.querySelector('[data-distribution-state]')).toBeNull()
  })

  it('shows a queued task waiting for a remote node and first lease', () => {
    render(<TaskDispatcherAction {...props(stateWithTasks([task({
      masterPlan: undefined,
      workers: [],
      distribution: {
        pool: 'gpu-default',
        state: 'queued',
        claimCount: 0,
        cancelRequested: false,
      },
    })]))} />)
    fireEvent.click(screen.getByRole('button'))

    const summary = screen.getByRole('region', {
      name: '分布式执行：排队中；队列 gpu-default；远端节点 等待领取；投递 0 次；租约 无有效租约；未请求取消；分布式 v1 不持久上报当前子阶段、Agent 或模型；此处仅展示可验证的节点与租约。',
    })
    expect(summary.getAttribute('data-distribution-state')).toBe('queued')
    expect(within(summary).getByText('gpu-default')).toBeTruthy()
    expect(within(summary).getByText('等待领取')).toBeTruthy()
    expect(within(summary).getByText('0 次')).toBeTruthy()
    expect(within(summary).getByText('无有效租约')).toBeTruthy()
    expect(within(summary).getByText('未请求取消')).toBeTruthy()
    expect(within(summary).getByText(/不持久上报当前子阶段/u)).toBeTruthy()
  })

  it('shows a running remote node, delivery attempts, lease, and cancellation request in English', () => {
    render(<TaskDispatcherAction {...props(stateWithTasks([task({
      masterPlan: undefined,
      workers: [],
      distribution: {
        pool: 'gpu-west',
        state: 'running',
        nodeId: 'node-7',
        leaseGeneration: '12',
        leaseUntil: '2026-08-22T20:15:30.000Z',
        claimCount: 2,
        cancelRequested: true,
      },
    })]), enT)} />)
    fireEvent.click(screen.getByRole('button'))

    const summary = screen.getByRole('region', {
      name: 'Distributed execution: Running remotely; pool gpu-west; remote node node-7; delivered 2 attempts; lease Generation 12 · until 2026-08-22T20:15:30.000Z; Cancellation requested; Distributed v1 does not persist the current child phase, Agent, or model; this view shows only verified node and lease data.',
    })
    expect(summary.getAttribute('data-distribution-state')).toBe('running')
    expect(within(summary).getByText('gpu-west')).toBeTruthy()
    expect(within(summary).getByText('node-7')).toBeTruthy()
    expect(within(summary).getByText('2 attempts')).toBeTruthy()
    expect(within(summary).getByText('Generation 12 · until 2026-08-22T20:15:30.000Z')).toBeTruthy()
    expect(within(summary).getByText('Cancellation requested')).toBeTruthy()
    expect(within(summary).getByText(/does not persist the current child phase/u)).toBeTruthy()
    expect(screen.getAllByText(/Running remotely \(phase unreported\)/u)).toHaveLength(2)
  })

  it('shows terminal distributed placement after expanding completed task history', () => {
    render(<TaskDispatcherAction {...props(stateWithTasks([task({
      title: '远端任务已完成',
      status: 'accepted',
      phase: 'finished',
      masterPlan: undefined,
      workers: [],
      distribution: {
        pool: 'gpu-east',
        state: 'terminal',
        nodeId: 'node-3',
        leaseGeneration: '4',
        claimCount: 4,
        cancelRequested: false,
      },
    })]))} />)
    fireEvent.click(screen.getByRole('button'))
    const dialog = screen.getByRole('dialog', { name: zh['modal.title'] })
    fireEvent.click(within(dialog).getByRole('button', { name: /远端任务已完成/ }))

    const summary = within(dialog).getByRole('region', { name: /分布式执行：远端已结束/ })
    expect(summary.getAttribute('data-distribution-state')).toBe('terminal')
    expect(within(summary).getByText('node-3')).toBeTruthy()
    expect(within(summary).getByText('4 次')).toBeTruthy()
    expect(within(summary).getByText('第 4 代')).toBeTruthy()
    expect(within(summary).getByText('未请求取消')).toBeTruthy()
  })

  it('retains plan content behind a reconnecting notice and closes from the modal control', () => {
    render(<TaskDispatcherAction {...props(state({ phase: 'reconnecting', error: 'offline' }))} />)
    const trigger = screen.getByRole('button', { name: /连接中断，正在重连/ })
    expect(trigger.textContent).toContain('计划 1/2 · 1 个 Agent 运行')
    fireEvent.click(trigger)
    expect(screen.getByRole('status').textContent).toContain(zh['connection.reconnecting'])
    expect(screen.getByText('改进 Task Dispatcher')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['modal.close'] }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows loading, unavailable, and ready-empty states without hiding the affordance', () => {
    const { rerender } = render(<TaskDispatcherAction {...props({ phase: 'loading' })} />)
    expect(screen.getByRole('button').textContent).toContain(zh['header.loading'])
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(zh['connection.loading'])).toBeTruthy()
    expect(screen.getByText(zh['empty.title'])).toBeTruthy()

    rerender(<TaskDispatcherAction {...props({ phase: 'error', error: 'bad wire' })} />)
    expect(screen.getByRole('button', { name: /打开任务执行计划/ }).textContent).toContain(zh['header.unavailable'])
    expect(screen.getByRole('alert').textContent).toContain('bad wire')

    const emptySnapshot: DispatcherSnapshot = {
      protocolVersion: 1, revision: 1, sessionId: 'session-1', generatedAt: 1, tasks: [],
    }
    rerender(<TaskDispatcherAction {...props({ phase: 'ready', snapshot: emptySnapshot })} />)
    expect(screen.getByRole('button', { name: /打开任务执行计划/ }).textContent).toContain(zh['header.empty'])
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('planProgress', () => {
  it('aggregates multiple task plans and counts only starting/running Agents', () => {
    const first = task()
    const second = task({
      taskId: 'task-2',
      masterPlan: {
        planId: 'plan-2', revision: 1, patchCount: 0, status: 'accepted', summary: '',
        steps: [{ id: 'x', title: 'Done', objective: '', status: 'completed', attempts: 1, dependsOn: [] }],
      },
      workers: [{ ...first.workers[1]!, workerId: 'cleanup', status: 'cleanup' }],
    })
    expect(planProgress([first, second])).toEqual({ done: 2, total: 3, agents: 1 })
  })
})
