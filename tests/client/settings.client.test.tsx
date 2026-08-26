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

function overrideLabel(role: 'planReviewer' | 'replanner' | 'finalVerifier'): string {
  return t('settings.route.override', { role: t(`settings.route.${role}`) })
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

  it('shows all six role models, their fallbacks, and the parent-to-child lane boundary', () => {
    const state = readyState()
    state.draft!.lanes.analysis!.orchestration.enabled = true
    state.draft!.lanes.analysis!.orchestration.childLane = 'leaf'
    renderState(state)
    fireEvent.click(screen.getByText('Analysis · analysis'))

    for (const key of ['planner', 'planReviewer', 'replanner', 'executor', 'verifier', 'finalVerifier'] as const) {
      expect(screen.getByRole('group', { name: t(`settings.route.${key}`) })).toBeTruthy()
    }
    const planReview = screen.getByRole('group', { name: t('settings.route.planReviewer') })
    expect(within(planReview).getByText('deepseek/verifier')).toBeTruthy()
    expect(within(planReview).getByText(t('settings.route.inherits', { role: t('settings.route.verifier') }))).toBeTruthy()
    const replan = screen.getByRole('group', { name: t('settings.route.replanner') })
    expect(within(replan).getByText('deepseek/planner')).toBeTruthy()
    const executor = screen.getByRole('group', { name: t('settings.route.executor') })
    expect(within(executor).getByText(t('settings.route.orchestrationExecutorDescription'))).toBeTruthy()
    const verifier = screen.getByRole('group', { name: t('settings.route.verifier') })
    expect(within(verifier).getByText(t('settings.route.orchestrationVerifierDescription'))).toBeTruthy()
    expect(screen.getByText(t('settings.lane.parentModels', { lane: 'analysis' }))).toBeTruthy()
    expect(screen.getByText(t('settings.lane.childModels', { lane: 'leaf' }))).toBeTruthy()
  })

  it('stages each role override from its documented fallback without changing sibling routes', () => {
    const controller = renderState(readyState())
    fireEvent.click(screen.getByText('Analysis · analysis'))

    for (const role of ['planReviewer', 'replanner', 'finalVerifier'] as const) {
      const card = screen.getByRole('group', { name: t(`settings.route.${role}`) })
      fireEvent.click(within(card).getByLabelText(overrideLabel(role)))
    }
    expect(controller.edit).toHaveBeenCalledTimes(3)

    const expected = {
      planReviewer: 'verifier',
      replanner: 'planner',
      finalVerifier: 'verifier',
    } as const
    for (const [index, role] of (['planReviewer', 'replanner', 'finalVerifier'] as const).entries()) {
      const candidate = configFixture()
      const update = controller.edit.mock.calls[index]?.[0] as (draft: typeof candidate) => void
      update(candidate)
      expect(candidate.lanes.analysis?.[role]?.model).toBe(expected[role])
      for (const sibling of ['planReviewer', 'replanner', 'finalVerifier'] as const) {
        if (sibling !== role) expect(candidate.lanes.analysis?.[sibling]).toBeUndefined()
      }
    }
  })

  it('writes each of the six model fields to its own route', () => {
    const state = readyState()
    const lane = state.draft!.lanes.analysis!
    lane.planReviewer = { provider: 'deepseek', model: 'plan-review', maxTokens: 8_000 }
    lane.replanner = { provider: 'deepseek', model: 'replan', maxTokens: 9_000 }
    lane.finalVerifier = { provider: 'deepseek', model: 'final-review', maxTokens: 10_000 }
    const controller = renderState(state)
    fireEvent.click(screen.getByText('Analysis · analysis'))
    const roles = ['planner', 'planReviewer', 'replanner', 'executor', 'verifier', 'finalVerifier'] as const

    for (const role of roles) {
      const card = screen.getByRole('group', { name: t(`settings.route.${role}`) })
      fireEvent.change(within(card).getByLabelText(t('settings.route.model')), {
        target: { value: `${role}-next` },
      })
    }
    expect(controller.edit).toHaveBeenCalledTimes(roles.length)

    for (const [index, role] of roles.entries()) {
      const candidate = configFixture()
      candidate.lanes.analysis!.planReviewer = { provider: 'deepseek', model: 'plan-review', maxTokens: 8_000 }
      candidate.lanes.analysis!.replanner = { provider: 'deepseek', model: 'replan', maxTokens: 9_000 }
      candidate.lanes.analysis!.finalVerifier = { provider: 'deepseek', model: 'final-review', maxTokens: 10_000 }
      const before = Object.fromEntries(roles.map(key => [key, candidate.lanes.analysis?.[key]?.model]))
      const update = controller.edit.mock.calls[index]?.[0] as (draft: typeof candidate) => void
      update(candidate)
      expect(candidate.lanes.analysis?.[role]?.model).toBe(`${role}-next`)
      for (const sibling of roles) {
        if (sibling !== role) expect(candidate.lanes.analysis?.[sibling]?.model).toBe(before[sibling])
      }
    }
  })

  it('lets built-in role overrides be edited but not returned to inheritance', () => {
    const state = readyState()
    const routes = {
      planReviewer: { provider: 'review', model: 'plan-review', maxTokens: 8_000 },
      replanner: { provider: 'planning', model: 'replan', maxTokens: 9_000 },
      finalVerifier: { provider: 'review', model: 'final-review', maxTokens: 10_000 },
    }
    for (const [role, route] of Object.entries(routes) as Array<[keyof typeof routes, typeof routes.planReviewer]>) {
      state.snapshot!.base.lanes.analysis![role] = structuredClone(route)
      state.snapshot!.value.lanes.analysis![role] = structuredClone(route)
      state.draft!.lanes.analysis![role] = structuredClone(route)
    }
    renderState(state)
    fireEvent.click(screen.getByText('Analysis · analysis'))

    for (const role of ['planReviewer', 'replanner', 'finalVerifier'] as const) {
      const card = screen.getByRole('group', { name: t(`settings.route.${role}`) })
      expect((within(card).getByLabelText(overrideLabel(role)) as HTMLInputElement).disabled).toBe(true)
      expect((within(card).getByLabelText(t('settings.route.model')) as HTMLInputElement).disabled).toBe(false)
    }
  })

  it('returns an optional role to inheritance without removing the master plan', () => {
    const state = readyState()
    state.draft!.lanes.analysis!.planReviewer = {
      provider: 'review', model: 'plan-review', maxTokens: 8_000,
    }
    const controller = renderState(state)
    fireEvent.click(screen.getByText('Analysis · analysis'))
    const card = screen.getByRole('group', { name: t('settings.route.planReviewer') })
    fireEvent.click(within(card).getByLabelText(overrideLabel('planReviewer')))

    const candidate = configFixture()
    candidate.lanes.analysis!.planReviewer = {
      provider: 'review', model: 'plan-review', maxTokens: 8_000,
    }
    const update = controller.edit.mock.calls[0]?.[0] as (draft: typeof candidate) => void
    update(candidate)
    expect(candidate.lanes.analysis?.planner?.model).toBe('planner')
    expect(candidate.lanes.analysis?.planReviewer).toBeUndefined()
  })

  it('turning off a custom planner atomically removes every planning-role override', () => {
    const state = readyState()
    const custom = structuredClone(state.draft!.lanes.analysis!)
    custom.planReviewer = { provider: 'review', model: 'plan-review', maxTokens: 8_000 }
    custom.replanner = { provider: 'planning', model: 'replan', maxTokens: 9_000 }
    custom.finalVerifier = { provider: 'review', model: 'final-review', maxTokens: 10_000 }
    state.draft!.lanes.custom = custom
    state.snapshot!.value.lanes.custom = structuredClone(custom)
    const controller = renderState(state)
    const summary = screen.getByText('Analysis · custom')
    fireEvent.click(summary)
    const customCard = summary.closest('details')!
    fireEvent.click(within(customCard).getByLabelText(t('settings.route.plannerEnabled')))

    const candidate = configFixture()
    candidate.lanes.custom = structuredClone(custom)
    const update = controller.edit.mock.calls[0]?.[0] as (draft: typeof candidate) => void
    update(candidate)
    expect(candidate.lanes.custom).toMatchObject({ executor: { model: 'executor' }, verifier: { model: 'verifier' } })
    expect(candidate.lanes.custom?.planner).toBeUndefined()
    expect(candidate.lanes.custom?.planReviewer).toBeUndefined()
    expect(candidate.lanes.custom?.replanner).toBeUndefined()
    expect(candidate.lanes.custom?.finalVerifier).toBeUndefined()
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
