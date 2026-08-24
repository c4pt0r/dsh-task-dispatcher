/** Non-technical settings page for the complete Task Dispatcher policy. */

import { useId, useState } from 'react'
import { Button, Pill, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DispatcherConfigController } from './config-controller.ts'
import type {
  DispatcherConfigObservable,
  DispatcherCriterionConfig,
  DispatcherLaneConfig,
  DispatcherPolicyConfig,
  DispatcherRouteConfig,
} from './config-types.ts'
import { NS, type TaskDispatcherKey } from './locales.ts'
import css from './TaskDispatcherSettingsTab.module.css'

export interface TaskDispatcherSettingsInjected {
  controller: DispatcherConfigController
  hooks: { taskDispatcherConfig: DispatcherConfigObservable }
}

export type TaskDispatcherSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<typeof NS>
  & InjectFace<TaskDispatcherSettingsInjected>

type Translate = TaskDispatcherSettingsTabProps['t']

function validationText(t: Translate, code: string | undefined): string | undefined {
  if (code === undefined) return undefined
  const key = `settings.validation.${code}` as TaskDispatcherKey
  return t(key)
}

function Field(props: {
  id: string
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  const descriptionId = `${props.id}-description`
  return (
    <div className={css.field} data-invalid={props.error === undefined ? undefined : 'true'}>
      <label className={css.label} htmlFor={props.id}>{props.label}</label>
      {props.children}
      <p id={descriptionId} className={props.error === undefined ? css.hint : css.validation}>
        {props.error ?? props.hint}
      </p>
    </div>
  )
}

function TextField(props: {
  id: string
  label: string
  value: string
  hint?: string
  error?: string
  disabled: boolean
  placeholder?: string
  multiline?: boolean
  onChange: (value: string) => void
}) {
  const shared = {
    id: props.id,
    className: css.input,
    value: props.value,
    disabled: props.disabled,
    placeholder: props.placeholder,
    'aria-invalid': props.error === undefined ? undefined : true,
    'aria-describedby': `${props.id}-description`,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      props.onChange(event.target.value)
    },
  }
  return (
    <Field id={props.id} label={props.label} hint={props.hint} error={props.error}>
      {props.multiline ? <textarea {...shared} rows={3} /> : <input {...shared} type="text" />}
    </Field>
  )
}

function NumberField(props: {
  id: string
  label: string
  value: number
  hint?: string
  error?: string
  disabled: boolean
  min?: number
  max?: number
  onChange: (value: number) => void
}) {
  return (
    <Field id={props.id} label={props.label} hint={props.hint} error={props.error}>
      <input
        id={props.id}
        className={css.input}
        type="number"
        inputMode="numeric"
        value={Number.isFinite(props.value) ? props.value : ''}
        disabled={props.disabled}
        min={props.min}
        max={props.max}
        aria-invalid={props.error === undefined ? undefined : true}
        aria-describedby={`${props.id}-description`}
        onChange={(event) => { props.onChange(event.target.value === '' ? Number.NaN : Number(event.target.value)) }}
      />
    </Field>
  )
}

function SelectField(props: {
  id: string
  label: string
  value: string
  hint?: string
  error?: string
  disabled: boolean
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <Field id={props.id} label={props.label} hint={props.hint} error={props.error}>
      <select
        id={props.id}
        className={css.input}
        value={props.value}
        disabled={props.disabled}
        aria-invalid={props.error === undefined ? undefined : true}
        aria-describedby={`${props.id}-description`}
        onChange={(event) => { props.onChange(event.target.value) }}
      >
        {props.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </Field>
  )
}

function CheckField(props: {
  id: string
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className={css.check} htmlFor={props.id}>
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        aria-labelledby={`${props.id}-label`}
        aria-describedby={`${props.id}-hint`}
        onChange={(event) => { props.onChange(event.target.checked) }}
      />
      <span>
        <strong id={`${props.id}-label`}>{props.label}</strong>
        <small id={`${props.id}-hint`}>{props.hint}</small>
      </span>
    </label>
  )
}

function listText(values: readonly string[] | undefined): string {
  return (values ?? []).join(', ')
}

function parseList(value: string): string[] {
  return value.split(/[\s,]+/u).map(item => item.trim()).filter(Boolean)
}

function RouteEditor(props: {
  id: string
  title: string
  route: DispatcherRouteConfig
  path: string
  disabled: boolean
  t: Translate
  error: (path: string) => string | undefined
  onChange: (update: (route: DispatcherRouteConfig) => void) => void
}) {
  return (
    <fieldset className={css.route}>
      <legend>{props.title}</legend>
      <div className={css.grid3}>
        <TextField
          id={`${props.id}-provider`}
          label={props.t('settings.route.provider')}
          hint={props.t('settings.route.providerHint')}
          value={props.route.provider}
          disabled={props.disabled}
          error={props.error(`${props.path}.provider`)}
          onChange={value => { props.onChange(route => { route.provider = value }) }}
        />
        <TextField
          id={`${props.id}-model`}
          label={props.t('settings.route.model')}
          hint={props.t('settings.route.modelHint')}
          value={props.route.model}
          disabled={props.disabled}
          error={props.error(`${props.path}.model`)}
          onChange={value => { props.onChange(route => { route.model = value }) }}
        />
        <NumberField
          id={`${props.id}-tokens`}
          label={props.t('settings.route.maxTokens')}
          hint={props.t('settings.route.maxTokensHint')}
          value={props.route.maxTokens}
          min={1}
          max={1_000_000}
          disabled={props.disabled}
          error={props.error(`${props.path}.maxTokens`)}
          onChange={value => { props.onChange(route => { route.maxTokens = value }) }}
        />
      </div>
    </fieldset>
  )
}

function laneTitle(lane: DispatcherLaneConfig, id: string): string {
  return lane.name.trim() === '' ? id : `${lane.name} · ${id}`
}

function LaneEditor(props: {
  id: string
  lane: DispatcherLaneConfig
  baseLane?: DispatcherLaneConfig
  compositionOwned: boolean
  disabled: boolean
  t: Translate
  errors: Readonly<Record<string, string>>
  edit: (update: (lane: DispatcherLaneConfig) => void) => void
  remove: () => void
}) {
  const uid = useId()
  const root = `lanes.${props.id}`
  const error = (path: string) => validationText(props.t, props.errors[path])
  const setRoute = (key: 'executor' | 'verifier' | 'planner', update: (route: DispatcherRouteConfig) => void) => {
    props.edit((lane) => {
      const target = lane[key]
      if (target !== undefined) update(target)
    })
  }
  const editCriterion = (index: number, update: (criterion: DispatcherCriterionConfig) => void) => {
    props.edit(lane => { const target = lane.requiredCriteria[index]; if (target !== undefined) update(target) })
  }
  return (
    <details className={css.laneCard}>
      <summary className={css.laneSummary}>
        <span>{laneTitle(props.lane, props.id)}</span>
        <Pill>{props.t(props.compositionOwned ? 'settings.lane.builtIn' : 'settings.lane.user')}</Pill>
      </summary>
      <div className={css.laneBody}>
        <div className={css.grid2}>
          <TextField
            id={`${uid}-name`}
            label={props.t('settings.lane.name')}
            value={props.lane.name}
            disabled={props.disabled}
            error={error(`${root}.name`)}
            onChange={value => { props.edit(lane => { lane.name = value }) }}
          />
          <TextField
            id={`${uid}-description`}
            label={props.t('settings.lane.description')}
            value={props.lane.description}
            disabled={props.disabled}
            onChange={value => { props.edit(lane => { lane.description = value }) }}
          />
          <SelectField
            id={`${uid}-kind`}
            label={props.t('settings.lane.kind')}
            value={props.lane.kind}
            disabled={props.disabled}
            error={error(`${root}.kind`)}
            options={[
              { value: 'general', label: props.t('settings.lane.kind.general') },
              { value: 'self-improvement', label: props.t('settings.lane.kind.selfImprovement') },
            ]}
            onChange={value => { props.edit(lane => { lane.kind = value as DispatcherLaneConfig['kind'] }) }}
          />
          <SelectField
            id={`${uid}-transport`}
            label={props.t('settings.lane.transport')}
            value={props.lane.transport}
            disabled={props.disabled}
            options={[
              { value: 'spawn', label: props.t('settings.lane.transport.spawn') },
              { value: 'fork', label: props.t('settings.lane.transport.fork') },
            ]}
            onChange={value => { props.edit(lane => { lane.transport = value as DispatcherLaneConfig['transport'] }) }}
          />
        </div>

        <h4>{props.t('settings.lane.models')}</h4>
        <RouteEditor
          id={`${uid}-executor`}
          title={props.t('settings.route.executor')}
          route={props.lane.executor}
          path={`${root}.executor`}
          disabled={props.disabled}
          t={props.t}
          error={error}
          onChange={update => { setRoute('executor', update) }}
        />
        <RouteEditor
          id={`${uid}-verifier`}
          title={props.t('settings.route.verifier')}
          route={props.lane.verifier}
          path={`${root}.verifier`}
          disabled={props.disabled}
          t={props.t}
          error={error}
          onChange={update => { setRoute('verifier', update) }}
        />
        <CheckField
          id={`${uid}-planner-enabled`}
          label={props.t('settings.route.plannerEnabled')}
          hint={props.t(props.baseLane?.planner === undefined
            ? 'settings.route.plannerEnabledHint'
            : 'settings.route.plannerRequiredHint')}
          checked={props.lane.planner !== undefined}
          disabled={props.disabled || props.baseLane?.planner !== undefined}
          onChange={(checked) => {
            props.edit((lane) => {
              if (checked) lane.planner = { provider: lane.verifier.provider, model: lane.verifier.model, maxTokens: lane.verifier.maxTokens }
              else delete lane.planner
            })
          }}
        />
        {props.lane.planner === undefined ? null : (
          <RouteEditor
            id={`${uid}-planner`}
            title={props.t('settings.route.planner')}
            route={props.lane.planner}
            path={`${root}.planner`}
            disabled={props.disabled}
            t={props.t}
            error={error}
            onChange={update => { setRoute('planner', update) }}
          />
        )}

        <h4>{props.t('settings.lane.execution')}</h4>
        <div className={css.grid3}>
          <SelectField
            id={`${uid}-execution-mode`}
            label={props.t('settings.lane.executionMode')}
            value={props.lane.execution.mode}
            disabled={props.disabled}
            error={error(`${root}.execution.mode`)}
            options={[
              { value: 'local', label: props.t('settings.lane.execution.local') },
              { value: 'distributed', label: props.t('settings.lane.execution.distributed') },
            ]}
            onChange={value => { props.edit(lane => { lane.execution.mode = value as DispatcherLaneConfig['execution']['mode'] }) }}
          />
          <TextField
            id={`${uid}-pool`}
            label={props.t('settings.distribution.pool')}
            value={props.lane.execution.pool}
            disabled={props.disabled || props.lane.execution.mode === 'local'}
            error={error(`${root}.execution.pool`)}
            onChange={value => { props.edit(lane => { lane.execution.pool = value }) }}
          />
          <TextField
            id={`${uid}-workspace-ref`}
            label={props.t('settings.distribution.workspaceRef')}
            value={props.lane.execution.workspaceRef}
            disabled={props.disabled || props.lane.execution.mode === 'local'}
            error={error(`${root}.execution.workspaceRef`)}
            onChange={value => { props.edit(lane => { lane.execution.workspaceRef = value }) }}
          />
        </div>

        <h4>{props.t('settings.orchestration.title')}</h4>
        <CheckField
          id={`${uid}-orchestration-enabled`}
          label={props.t('settings.orchestration.enabled')}
          hint={props.t('settings.orchestration.enabledHint')}
          checked={props.lane.orchestration.enabled}
          disabled={props.disabled}
          onChange={checked => { props.edit(lane => { lane.orchestration.enabled = checked }) }}
        />
        <div className={css.grid3}>
          <TextField
            id={`${uid}-orchestration-child-lane`}
            label={props.t('settings.orchestration.childLane')}
            value={props.lane.orchestration.childLane}
            disabled={props.disabled || !props.lane.orchestration.enabled}
            error={error(`${root}.orchestration.childLane`)}
            onChange={value => { props.edit(lane => { lane.orchestration.childLane = value }) }}
          />
          <SelectField
            id={`${uid}-orchestration-workspace-mode`}
            label={props.t('settings.orchestration.workspaceMode')}
            value={props.lane.orchestration.workspaceMode}
            disabled={props.disabled || !props.lane.orchestration.enabled}
            error={error(`${root}.orchestration.enabled`)}
            options={[
              { value: 'read-shared', label: props.t('settings.orchestration.readShared') },
            ]}
            onChange={value => {
              props.edit(lane => {
                lane.orchestration.workspaceMode = value as DispatcherLaneConfig['orchestration']['workspaceMode']
              })
            }}
          />
          <SelectField
            id={`${uid}-orchestration-failure-mode`}
            label={props.t('settings.orchestration.failureMode')}
            value={props.lane.orchestration.failureMode}
            disabled={props.disabled || !props.lane.orchestration.enabled}
            options={[
              { value: 'fail-fast', label: props.t('settings.orchestration.failFast') },
              { value: 'collect', label: props.t('settings.orchestration.collect') },
            ]}
            onChange={value => {
              props.edit(lane => {
                lane.orchestration.failureMode = value as DispatcherLaneConfig['orchestration']['failureMode']
              })
            }}
          />
          {([
            ['maxDepth', 'settings.orchestration.maxDepth', 1, 4],
            ['maxTaskNodes', 'settings.orchestration.maxTaskNodes', 1, 32],
            ['maxChildrenPerNode', 'settings.orchestration.maxChildrenPerNode', 1, 8],
            ['maxConcurrentNodes', 'settings.orchestration.maxConcurrentNodes', 1, 8],
            ['maxTotalModelRuns', 'settings.orchestration.maxTotalModelRuns', 1, 128],
            ['maxResultBytes', 'settings.orchestration.maxResultBytes', 4_096, 1_048_576],
          ] as const).map(([key, label, min, max]) => (
            <NumberField
              key={key}
              id={`${uid}-orchestration-${key}`}
              label={props.t(label)}
              value={props.lane.orchestration[key]}
              min={min}
              max={max}
              disabled={props.disabled || !props.lane.orchestration.enabled}
              error={error(`${root}.orchestration.${key}`)}
              onChange={value => { props.edit(lane => { lane.orchestration[key] = value }) }}
            />
          ))}
        </div>
        <p className={css.hint}>{props.t('settings.orchestration.safetyHint')}</p>

        <h4>{props.t('settings.lane.tools')}</h4>
        <div className={css.grid3}>
          {(['executorTools', 'plannerTools', 'verifierTools'] as const).map((key) => (
            <TextField
              key={key}
              id={`${uid}-${key}`}
              label={props.t(`settings.lane.${key}` as TaskDispatcherKey)}
              hint={props.t('settings.lane.toolsHint')}
              value={listText(props.lane[key])}
              disabled={props.disabled || (key === 'plannerTools' && props.lane.planner === undefined)}
              error={error(`${root}.${key}`)}
              onChange={value => { props.edit(lane => { lane[key] = parseList(value) }) }}
            />
          ))}
        </div>

        <h4>{props.t('settings.lane.budgets')}</h4>
        <div className={css.grid3}>
          {([
            ['maxPlanSteps', 'settings.lane.maxPlanSteps', 1, 8],
            ['maxPlanPatches', 'settings.lane.maxPlanPatches', 0, 8],
            ['maxTotalChildRuns', 'settings.lane.maxTotalChildRuns', 5, 32],
            ['taskTimeoutMs', 'settings.lane.taskTimeoutMs', 1_000, 21_600_000],
            ['maxAttempts', 'settings.lane.maxAttempts', 1, 3],
            ['childTimeoutMs', 'settings.lane.childTimeoutMs', 1_000, 3_600_000],
          ] as const).map(([key, label, min, max]) => (
            <NumberField
              key={key}
              id={`${uid}-${key}`}
              label={props.t(label)}
              value={props.lane[key]}
              min={min}
              max={max}
              disabled={props.disabled}
              error={error(`${root}.${key}`)}
              onChange={value => { props.edit(lane => { lane[key] = value }) }}
            />
          ))}
        </div>
        <CheckField
          id={`${uid}-retry`}
          label={props.t('settings.lane.retryOnRevise')}
          hint={props.t('settings.lane.retryOnReviseHint')}
          checked={props.lane.retryOnRevise}
          disabled={props.disabled}
          onChange={checked => { props.edit(lane => { lane.retryOnRevise = checked }) }}
        />

        <div className={css.subhead}>
          <h4>{props.t('settings.criteria.title')}</h4>
          <Button
            size="sm"
            variant="outline"
            disabled={props.disabled || props.lane.requiredCriteria.length >= 24}
            onClick={() => {
              props.edit(lane => { lane.requiredCriteria.push({ id: `criterion-${lane.requiredCriteria.length + 1}`, text: '' }) })
            }}
          >{props.t('settings.criteria.add')}</Button>
        </div>
        {props.lane.requiredCriteria.length === 0
          ? <p className={css.validation} role="alert">{error(`${root}.requiredCriteria`)}</p>
          : (
            <div className={css.criteria}>
              {props.lane.requiredCriteria.map((criterion, index) => (
                <fieldset className={css.criterion} key={index}>
                  <legend>{props.t('settings.criteria.item', { index: index + 1 })}</legend>
                  <div className={css.grid2}>
                    <TextField
                      id={`${uid}-criterion-${index}-id`}
                      label={props.t('settings.criteria.id')}
                      value={criterion.id}
                      disabled={props.disabled}
                      error={error(`${root}.requiredCriteria.${index}.id`)}
                      onChange={value => { editCriterion(index, item => { item.id = value }) }}
                    />
                    <TextField
                      id={`${uid}-criterion-${index}-text`}
                      label={props.t('settings.criteria.text')}
                      value={criterion.text}
                      disabled={props.disabled}
                      error={error(`${root}.requiredCriteria.${index}.text`)}
                      onChange={value => { editCriterion(index, item => { item.text = value }) }}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={props.disabled}
                    aria-label={props.t('settings.criteria.removeAria', { id: criterion.id || index + 1 })}
                    onClick={() => { props.edit(lane => { lane.requiredCriteria.splice(index, 1) }) }}
                  >{props.t('settings.remove')}</Button>
                </fieldset>
              ))}
            </div>
          )}
        {!props.compositionOwned && (
          <div className={css.dangerRow}>
            <Button variant="outline" disabled={props.disabled} onClick={props.remove}>
              {props.t('settings.lane.remove')}
            </Button>
          </div>
        )}
      </div>
    </details>
  )
}

function DistributionEditor(props: {
  config: DispatcherPolicyConfig
  base: DispatcherPolicyConfig
  disabled: boolean
  t: Translate
  errors: Readonly<Record<string, string>>
  edit: (update: (config: DispatcherPolicyConfig) => void) => void
}) {
  const uid = useId()
  const distribution = props.config.distribution
  const error = (path: string) => validationText(props.t, props.errors[path])
  const [mappingRef, setMappingRef] = useState('')
  const mappingEntries = Object.entries(distribution.workspaceMappings)
  return (
    <fieldset className={css.sectionCard}>
      <legend>{props.t('settings.distribution.title')}</legend>
      <p className={css.sectionIntro}>{props.t('settings.distribution.intro')}</p>
      <div className={css.grid2}>
        <SelectField
          id={`${uid}-role`}
          label={props.t('settings.distribution.role')}
          value={distribution.role}
          disabled={props.disabled}
          options={[
            { value: 'disabled', label: props.t('settings.distribution.role.disabled') },
            { value: 'coordinator', label: props.t('settings.distribution.role.coordinator') },
            { value: 'worker', label: props.t('settings.distribution.role.worker') },
            { value: 'hybrid', label: props.t('settings.distribution.role.hybrid') },
          ]}
          onChange={value => { props.edit(config => { config.distribution.role = value as typeof distribution.role }) }}
        />
        <TextField
          id={`${uid}-database-env`}
          label={props.t('settings.distribution.databaseUrlEnv')}
          hint={props.t('settings.distribution.databaseUrlEnvHint')}
          value={distribution.databaseUrlEnv}
          disabled={props.disabled || distribution.role === 'disabled'}
          error={error('distribution.databaseUrlEnv')}
          placeholder="DSH_DISPATCHER_DATABASE_URL"
          onChange={value => { props.edit(config => { config.distribution.databaseUrlEnv = value }) }}
        />
        <TextField
          id={`${uid}-scope`}
          label={props.t('settings.distribution.scopeId')}
          hint={props.t('settings.distribution.scopeIdHint')}
          value={distribution.scopeId}
          disabled={props.disabled || distribution.role === 'disabled'}
          error={error('distribution.scopeId')}
          onChange={value => { props.edit(config => { config.distribution.scopeId = value }) }}
        />
        <TextField
          id={`${uid}-pools`}
          label={props.t('settings.distribution.pools')}
          hint={props.t('settings.listHint')}
          value={listText(distribution.pools)}
          disabled={props.disabled || distribution.role === 'disabled'}
          error={error('distribution.pools')}
          onChange={value => { props.edit(config => { config.distribution.pools = parseList(value) }) }}
        />
        <TextField
          id={`${uid}-worker-id`}
          label={props.t('settings.distribution.workerId')}
          hint={props.t('settings.distribution.workerIdHint')}
          value={distribution.workerId}
          disabled={props.disabled || !['worker', 'hybrid'].includes(distribution.role)}
          error={error('distribution.workerId')}
          onChange={value => { props.edit(config => { config.distribution.workerId = value }) }}
        />
        <TextField
          id={`${uid}-worker-preset`}
          label={props.t('settings.distribution.workerAgentPreset')}
          hint={props.t('settings.distribution.workerAgentPresetHint')}
          value={distribution.workerAgentPreset}
          disabled={props.disabled || !['worker', 'hybrid'].includes(distribution.role)}
          error={error('distribution.workerAgentPreset')}
          onChange={value => { props.edit(config => { config.distribution.workerAgentPreset = value }) }}
        />
      </div>

      <details className={css.advanced}>
        <summary>{props.t('settings.distribution.advanced')}</summary>
        <div className={css.grid3}>
          {([
            ['concurrency', 'settings.distribution.concurrency', 1, 16],
            ['leaseMs', 'settings.distribution.leaseMs', 15_000, 300_000],
            ['heartbeatMs', 'settings.distribution.heartbeatMs', 1_000, 60_000],
            ['pollMs', 'settings.distribution.pollMs', 100, 30_000],
            ['maxDeliveryAttempts', 'settings.distribution.maxDeliveryAttempts', 1, 10],
          ] as const).map(([key, label, min, max]) => (
            <NumberField
              key={key}
              id={`${uid}-${key}`}
              label={props.t(label)}
              value={distribution[key]}
              min={min}
              max={max}
              disabled={props.disabled || distribution.role === 'disabled'}
              error={error(`distribution.${key}`)}
              onChange={value => { props.edit(config => { config.distribution[key] = value }) }}
            />
          ))}
        </div>
      </details>

      <div className={css.subhead}>
        <div>
          <h4>{props.t('settings.mapping.title')}</h4>
          <p className={css.hint}>{props.t('settings.mapping.intro')}</p>
        </div>
      </div>
      {mappingEntries.length === 0
        ? <p className={css.empty}>{props.t('settings.mapping.empty')}</p>
        : (
          <div className={css.mappings}>
            {mappingEntries.map(([ref, pathValue], index) => (
              <div className={css.mapping} key={index}>
                <TextField
                  id={`${uid}-mapping-${index}-ref`}
                  label={props.t('settings.mapping.ref')}
                  value={ref}
                  disabled={props.disabled || Object.hasOwn(props.base.distribution.workspaceMappings, ref)}
                  error={error(`distribution.workspaceMappings.${ref}.ref`)}
                  onChange={(value) => {
                    props.edit((config) => {
                      const mappings = config.distribution.workspaceMappings
                      if (value !== ref && Object.hasOwn(mappings, value)) return
                      config.distribution.workspaceMappings = Object.fromEntries(
                        Object.entries(mappings).map(([key, path]) => key === ref ? [value, path] : [key, path]),
                      )
                    })
                  }}
                />
                <TextField
                  id={`${uid}-mapping-${index}-path`}
                  label={props.t('settings.mapping.path')}
                  hint={props.t('settings.mapping.pathHint')}
                  value={pathValue}
                  disabled={props.disabled}
                  error={error(`distribution.workspaceMappings.${ref}.path`)}
                  onChange={value => {
                    props.edit(config => { config.distribution.workspaceMappings[ref] = value })
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={props.disabled || Object.hasOwn(props.base.distribution.workspaceMappings, ref)}
                  aria-label={props.t('settings.mapping.removeAria', { ref })}
                  onClick={() => { props.edit(config => { delete config.distribution.workspaceMappings[ref] }) }}
                >{props.t('settings.remove')}</Button>
              </div>
            ))}
          </div>
        )}
      <div className={css.addRow}>
        <label htmlFor={`${uid}-new-mapping`}>{props.t('settings.mapping.newRef')}</label>
        <input
          id={`${uid}-new-mapping`}
          className={css.input}
          value={mappingRef}
          disabled={props.disabled}
          onChange={event => { setMappingRef(event.target.value) }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={props.disabled || mappingRef.trim() === '' || distribution.workspaceMappings[mappingRef.trim()] !== undefined}
          onClick={() => {
            const ref = mappingRef.trim()
            props.edit(config => { config.distribution.workspaceMappings[ref] = '' })
            setMappingRef('')
          }}
        >{props.t('settings.mapping.add')}</Button>
      </div>
    </fieldset>
  )
}

function GlobalEditor(props: {
  config: DispatcherPolicyConfig
  disabled: boolean
  t: Translate
  errors: Readonly<Record<string, string>>
  edit: (update: (config: DispatcherPolicyConfig) => void) => void
}) {
  const uid = useId()
  const error = (path: string) => validationText(props.t, props.errors[path])
  return (
    <fieldset className={css.sectionCard}>
      <legend>{props.t('settings.global.title')}</legend>
      <CheckField
        id={`${uid}-background`}
        label={props.t('settings.global.background')}
        hint={props.t('settings.global.backgroundHint')}
        checked={props.config.defaultRunInBackground}
        disabled={props.disabled}
        onChange={checked => { props.edit(config => { config.defaultRunInBackground = checked }) }}
      />
      <div className={css.grid3}>
        <NumberField
          id={`${uid}-failures`}
          label={props.t('settings.global.failures')}
          value={props.config.maxConsecutiveFailures}
          min={1}
          max={20}
          disabled={props.disabled}
          error={error('maxConsecutiveFailures')}
          onChange={value => { props.edit(config => { config.maxConsecutiveFailures = value }) }}
        />
        <NumberField
          id={`${uid}-cooldown`}
          label={props.t('settings.global.cooldown')}
          value={props.config.circuitCooldownMs}
          min={1_000}
          max={86_400_000}
          disabled={props.disabled}
          error={error('circuitCooldownMs')}
          onChange={value => { props.edit(config => { config.circuitCooldownMs = value }) }}
        />
        <NumberField
          id={`${uid}-output`}
          label={props.t('settings.global.outputLimit')}
          value={props.config.jobOutputLimitBytes}
          min={4_096}
          max={1_048_576}
          disabled={props.disabled}
          error={error('jobOutputLimitBytes')}
          onChange={value => { props.edit(config => { config.jobOutputLimitBytes = value }) }}
        />
      </div>
      <div className={css.grid2}>
        <TextField
          id={`${uid}-live-root`}
          label={props.t('settings.global.liveRoot')}
          hint={props.t('settings.global.liveRootHint')}
          value={props.config.liveRoot}
          disabled={props.disabled}
          error={error('liveRoot')}
          onChange={value => { props.edit(config => { config.liveRoot = value }) }}
        />
        <TextField
          id={`${uid}-staging-root`}
          label={props.t('settings.global.stagingRoot')}
          hint={props.t('settings.global.stagingRootHint')}
          value={props.config.stagingRoot}
          disabled={props.disabled}
          error={error('stagingRoot')}
          onChange={value => { props.edit(config => { config.stagingRoot = value }) }}
        />
      </div>
    </fieldset>
  )
}

/** Render the Task Dispatcher page inside the shared Plugins settings section. */
export function TaskDispatcherSettingsTab(props: TaskDispatcherSettingsTabProps) {
  const { t, controller } = props
  const state = props.useTaskDispatcherConfig(value => value)
  const [newLaneId, setNewLaneId] = useState('')
  const laneIdValid = /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(newLaneId)

  if (state.phase === 'loading') {
    return (
      <section className={css.page} aria-labelledby="task-dispatcher-settings-title">
        <h2 id="task-dispatcher-settings-title">{t('settings.title')}</h2>
        <p className={css.status} role="status">{t('settings.loading')}</p>
      </section>
    )
  }

  if (state.snapshot === undefined || state.draft === undefined || state.phase === 'error') {
    return (
      <section className={css.page} aria-labelledby="task-dispatcher-settings-title">
        <h2 id="task-dispatcher-settings-title">{t('settings.title')}</h2>
        <div className={css.notice} data-tone="error" role="alert">
          <StateDot state="error" />
          <div><strong>{t('settings.error')}</strong><p>{state.error}</p></div>
        </div>
        <Button variant="outline" onClick={() => { void controller.load() }}>{t('settings.retry')}</Button>
      </section>
    )
  }

  const snapshot = state.snapshot
  const disabled = state.saving || !snapshot.available || !snapshot.writable
  const validationCount = Object.keys(state.errors).length
  return (
    <section className={css.page} aria-labelledby="task-dispatcher-settings-title">
      <div className={css.pageHead}>
        <div>
          <h2 id="task-dispatcher-settings-title">{t('settings.title')}</h2>
          <p>{t('settings.intro')}</p>
        </div>
        <Pill active={snapshot.available}>{t(snapshot.available ? 'settings.available' : 'settings.unavailable')}</Pill>
      </div>

      <div className={css.notice} data-tone="restart" role="status">
        <StateDot state="warning" />
        <div><strong>{t('settings.restart.title')}</strong><p>{t('settings.restart.body')}</p></div>
      </div>
      {!snapshot.available && (
        <div className={css.notice} data-tone="error" role="alert">
          <StateDot state="error" />
          <div><strong>{t('settings.unavailable')}</strong><p>{t('settings.unavailableHint')}</p></div>
        </div>
      )}
      {!snapshot.writable && snapshot.available && (
        <div className={css.notice} role="status">
          <StateDot state="warning" />
          <div><strong>{t('settings.readOnly')}</strong><p>{t('settings.readOnlyHint')}</p></div>
        </div>
      )}
      {snapshot.invalid !== undefined && !state.resetToBase && (
        <div className={css.notice} data-tone="error" role="alert">
          <StateDot state="error" />
          <div><strong>{t('settings.invalidStored')}</strong><p>{snapshot.invalid}</p></div>
        </div>
      )}
      {state.conflicted && (
        <div className={css.notice} data-tone="error" role="alert">
          <StateDot state="warning" />
          <div><strong>{t('settings.conflict')}</strong><p>{t('settings.conflictHint')}</p></div>
        </div>
      )}
      {state.error !== undefined && snapshot.invalid === undefined && !state.conflicted && (
        <p className={css.validation} role="alert">{state.error}</p>
      )}

      <form
        className={css.form}
        onSubmit={(event) => { event.preventDefault(); void controller.save() }}
      >
        <GlobalEditor
          config={state.draft}
          disabled={disabled}
          t={t}
          errors={state.errors}
          edit={update => { controller.edit(update) }}
        />

        <fieldset className={css.sectionCard}>
          <legend>{t('settings.lanes.title')}</legend>
          <p className={css.sectionIntro}>{t('settings.lanes.intro')}</p>
          <div className={css.lanes}>
            {Object.entries(state.draft.lanes).map(([id, lane]) => (
              <LaneEditor
                key={id}
                id={id}
                lane={lane}
                baseLane={snapshot.base.lanes[id]}
                compositionOwned={id in snapshot.base.lanes}
                disabled={disabled}
                t={t}
                errors={state.errors}
                edit={update => { controller.edit(config => { const target = config.lanes[id]; if (target !== undefined) update(target) }) }}
                remove={() => { controller.removeLane(id) }}
              />
            ))}
          </div>
          <div className={css.addLane}>
            <label htmlFor="task-dispatcher-new-lane">{t('settings.lane.newId')}</label>
            <input
              id="task-dispatcher-new-lane"
              className={css.input}
              value={newLaneId}
              disabled={disabled}
              aria-invalid={newLaneId !== '' && (!laneIdValid || state.draft.lanes[newLaneId] !== undefined) || undefined}
              aria-describedby="task-dispatcher-new-lane-hint"
              onChange={event => { setNewLaneId(event.target.value) }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || !laneIdValid || state.draft.lanes[newLaneId] !== undefined || Object.keys(state.draft.lanes).length >= 16}
              onClick={() => { if (controller.addLane(newLaneId) !== undefined) setNewLaneId('') }}
            >{t('settings.lane.add')}</Button>
            <p id="task-dispatcher-new-lane-hint" className={css.hint}>{t('settings.lane.idHint')}</p>
          </div>
        </fieldset>

        <DistributionEditor
          config={state.draft}
          base={snapshot.base}
          disabled={disabled}
          t={t}
          errors={state.errors}
          edit={update => { controller.edit(update) }}
        />

        <details className={css.yaml}>
          <summary>{t('settings.yaml.title')}</summary>
          <p>{t('settings.yaml.body')}</p>
          <code>dsh-task-dispatcher:</code>
        </details>

        <div className={css.footer}>
          <div className={css.footerStatus} aria-live="polite">
            {validationCount > 0
              ? t('settings.validationSummary', { count: validationCount })
              : state.dirty ? t('settings.unsaved') : t('settings.saved')}
          </div>
          <Button
            variant="ghost"
            disabled={disabled || state.saving}
            onClick={() => { controller.reset() }}
          >{t('settings.reset')}</Button>
          <Button
            variant="outline"
            disabled={disabled || !state.dirty}
            onClick={() => { controller.discard() }}
          >{t('settings.discard')}</Button>
          <Button
            variant="primary"
            disabled={disabled || !state.dirty || validationCount > 0}
            aria-busy={state.saving}
            type="submit"
          >{t(state.saving ? 'settings.saving' : 'settings.save')}</Button>
        </div>
      </form>
    </section>
  )
}
