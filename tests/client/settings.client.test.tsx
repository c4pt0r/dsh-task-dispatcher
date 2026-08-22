// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TaskDispatcherSettingsTab,
  type TaskDispatcherSettingsTabProps,
} from '../../src/client/TaskDispatcherSettingsTab.tsx'
import type { DispatcherConfigViewState } from '../../src/client/config-types.ts'
import { zh } from '../../src/client/locales.ts'
import { configFixture, configSnapshot } from './config-fixture.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, ...props }: { children?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
  Pill: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  StateDot: ({ state }: { state: string }) => <span data-state={state} />,
}))

afterEach(cleanup)

const t: TaskDispatcherSettingsTabProps['t'] = (key, params = {}) => {
  let value: string = zh[key as keyof typeof zh]
  for (const [name, replacement] of Object.entries(params)) value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}

function readyState(): DispatcherConfigViewState {
  const snapshot = configSnapshot()
  return {
    phase: 'ready',
    snapshot,
    draft: structuredClone(snapshot.value),
    dirty: false,
    saving: false,
    conflicted: false,
    resetToBase: false,
    errors: {},
  }
}

function renderState(state: DispatcherConfigViewState) {
  const controller = {
    load: vi.fn(), edit: vi.fn(), addLane: vi.fn(), removeLane: vi.fn(),
    discard: vi.fn(), reset: vi.fn(), save: vi.fn(),
  }
  const useTaskDispatcherConfig = <Selected,>(selector: (value: DispatcherConfigViewState) => Selected) => selector(state)
  render(<TaskDispatcherSettingsTab {...({ t, controller, useTaskDispatcherConfig } as unknown as TaskDispatcherSettingsTabProps)} />)
  return controller
}

describe('TaskDispatcherSettingsTab', () => {
  it('renders a labelled loading state before configuration arrives', () => {
    renderState({
      phase: 'loading', dirty: false, saving: false, conflicted: false, resetToBase: false, errors: {},
    })
    expect(screen.getByRole('heading', { name: 'Task Dispatcher' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('正在读取')
  })

  it('shows complete global, lane, distribution, mapping, and restart controls without exposing a database URL', () => {
    renderState(readyState())
    expect(screen.getByText(zh['settings.restart.title'])).toBeTruthy()
    expect(screen.getByRole('group', { name: zh['settings.global.title'] })).toBeTruthy()
    expect(screen.getByRole('group', { name: zh['settings.lanes.title'] })).toBeTruthy()
    expect(screen.getByRole('group', { name: zh['settings.distribution.title'] })).toBeTruthy()
    const env = screen.getByLabelText(zh['settings.distribution.databaseUrlEnv']) as HTMLInputElement
    expect(env.type).toBe('text')
    expect(env.value).toBe('DSH_DISPATCHER_DATABASE_URL')
    expect(document.body.textContent).not.toContain('postgres://')
  })

  it('locks composition-owned planners and mapping identities before Host validation', () => {
    renderState(readyState())
    fireEvent.click(screen.getByText('Analysis · analysis'))
    const planner = screen.getByLabelText(zh['settings.route.plannerEnabled']) as HTMLInputElement
    expect(planner.disabled).toBe(true)
    const removeMapping = screen.getByRole('button', { name: '移除工作区映射 project' }) as HTMLButtonElement
    const mappingRef = within(removeMapping.parentElement!).getByLabelText(zh['settings.mapping.ref']) as HTMLInputElement
    expect(mappingRef.disabled).toBe(true)
    expect(removeMapping.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: zh['settings.lane.remove'] })).toBeNull()
  })

  it('routes an ordinary preference gesture into the staged controller, never directly to RPC', () => {
    const controller = renderState(readyState())
    fireEvent.click(screen.getByLabelText(zh['settings.global.background']))
    expect(controller.edit).toHaveBeenCalledTimes(1)
    const candidate = configFixture()
    const update = controller.edit.mock.calls[0]?.[0] as (draft: typeof candidate) => void
    update(candidate)
    expect(candidate.defaultRunInBackground).toBe(false)
    expect(controller.save).not.toHaveBeenCalled()
  })

  it('allows deletion only for a user-created lane', () => {
    const state = readyState()
    state.draft!.lanes['custom'] = structuredClone(state.draft!.lanes['analysis']!)
    state.snapshot!.userLaneIds = ['custom']
    const controller = renderState(state)
    fireEvent.click(screen.getByText('Analysis · custom'))
    fireEvent.click(screen.getByRole('button', { name: zh['settings.lane.remove'] }))
    expect(controller.removeLane).toHaveBeenCalledWith('custom')
  })

  it('announces conflicts and field validation without discarding the form', () => {
    const state = readyState()
    state.conflicted = true
    state.dirty = true
    state.errors = { 'distribution.databaseUrlEnv': 'invalid-env' }
    state.draft!.distribution.databaseUrlEnv = 'postgres://secret'
    renderState(state)
    expect(screen.getByRole('alert').textContent).toContain(zh['settings.conflict'])
    const env = screen.getByLabelText(zh['settings.distribution.databaseUrlEnv'])
    expect(env.getAttribute('aria-invalid')).toBe('true')
    expect(within(env.parentElement!).getByText(zh['settings.validation.invalid-env'])).toBeTruthy()
    expect((screen.getByRole('button', { name: zh['settings.save'] }) as HTMLButtonElement).disabled).toBe(true)
  })
})
