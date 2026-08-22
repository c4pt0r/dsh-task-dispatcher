// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../../src/client/index.ts'
import { TaskDispatcherSettingsTab } from '../../src/client/TaskDispatcherSettingsTab.tsx'
import type { TaskDispatcherSettingsInjected } from '../../src/client/TaskDispatcherSettingsTab.tsx'
import { configSnapshot } from './config-fixture.ts'

// The published primitives entry also owns the global Markdown/KaTeX CSS.
// This registration spec never renders chrome, so keep the slot seam local.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: () => null,
  DisclosureRow: () => null,
  Modal: () => null,
  Pill: () => null,
  StateDot: () => null,
}))

interface TestSlotEntry {
  component: unknown
  options: Record<string, unknown>
  inject?: unknown
}

class TestSlots {
  private readonly declared = new Set<string>()
  private readonly values = new Map<string, TestSlotEntry[]>()
  private readonly bindings = new Map<string, Set<{ activate: () => void; dispose?: () => void }>>()

  constructor(private readonly cleanup: (dispose: () => void) => void) {}

  inject(name: string, register: () => (() => void)): void {
    const binding = {
      activate: () => { binding.dispose = register() },
      dispose: undefined as (() => void) | undefined,
    }
    const bindings = this.bindings.get(name) ?? new Set()
    bindings.add(binding)
    this.bindings.set(name, bindings)
    if (this.declared.has(name)) binding.activate()
    this.cleanup(() => {
      binding.dispose?.()
      bindings.delete(binding)
    })
  }

  register(options: Record<string, unknown>, component: unknown): () => void {
    if (options['name'] === 'root') {
      const children = options['children'] as Record<string, unknown> | undefined
      const names = Object.keys(children ?? {})
      for (const name of names) this.declare(name)
      return () => { for (const name of names) this.undeclare(name) }
    }
    const name = String(options['name'])
    const entry = { options, component, inject: options['inject'] }
    const entries = this.values.get(name) ?? []
    entries.push(entry)
    this.values.set(name, entries)
    return () => {
      const index = entries.indexOf(entry)
      if (index >= 0) entries.splice(index, 1)
    }
  }

  entries(name: string): readonly TestSlotEntry[] {
    return this.values.get(name) ?? []
  }

  private declare(name: string): void {
    if (this.declared.has(name)) return
    this.declared.add(name)
    for (const binding of this.bindings.get(name) ?? []) binding.activate()
  }

  private undeclare(name: string): void {
    if (!this.declared.delete(name)) return
    for (const binding of this.bindings.get(name) ?? []) {
      binding.dispose?.()
      binding.dispose = undefined
    }
  }
}

function testLocale() {
  let current: 'zh' | 'en' = 'zh'
  const dictionaries = new Map<string, Record<'zh' | 'en', Record<string, string>>>()
  return {
    setLocale(locale: 'zh' | 'en') { current = locale },
    register(namespace: string, dictionary: Record<'zh' | 'en', Record<string, string>>) {
      dictionaries.set(namespace, dictionary)
      return () => { dictionaries.delete(namespace) }
    },
    bind(namespace: string) {
      return (key: string) => dictionaries.get(namespace)?.[current][key] ?? key
    },
  }
}

class TestContext {
  readonly locale = testLocale()
  readonly slots: TestSlots
  private readonly cleanups: Array<() => void> = []
  private readonly events = new Map<string, Set<() => void>>()

  constructor(readonly call = vi.fn()) {
    this.slots = new TestSlots(dispose => { this.cleanups.push(dispose) })
  }

  get(name: string): unknown {
    if (name === 'connection') return { rpc: { call: this.call } }
    throw new Error(`unknown test service ${name}`)
  }

  effect(factory: () => void | (() => void)): void {
    const dispose = factory()
    if (typeof dispose === 'function') this.cleanups.push(dispose)
  }

  on(name: string, listener: () => void): () => void {
    const listeners = this.events.get(name) ?? new Set()
    listeners.add(listener)
    this.events.set(name, listeners)
    return () => { listeners.delete(listener) }
  }

  emit(name: string): void {
    for (const listener of this.events.get(name) ?? []) listener()
  }

  dispose(): void {
    for (const cleanup of this.cleanups.reverse()) cleanup()
    this.cleanups.length = 0
  }
}

function bench(call = vi.fn()) {
  const ctx = new TestContext(call)
  apply(ctx as never)
  return { call, ctx, locale: ctx.locale, slots: ctx.slots }
}

function declareSettingsTabs(slots: TestSlots): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  }, () => null)
}

function slotLabel(value: unknown): string | undefined {
  const resolved = typeof value === 'function' ? (value as () => unknown)() : value
  return typeof resolved === 'string' ? resolved : undefined
}

describe('Task Dispatcher settings slot', () => {
  it('keeps runtime service dependencies minimal and declares UI package parents in the manifest', () => {
    expect(inject).toEqual(['connection', 'slots', 'locale'])
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      dsh: { client: { inject: string[] } }
      peerDependencies: Record<string, string>
    }
    expect(manifest.dsh.client.inject).toEqual(expect.arrayContaining([
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-settings-plugins',
    ]))
    expect(manifest.peerDependencies['@deepseek-ai/dsh-client-ui-settings']).toBe('^0.1.0-rc.5')
    expect(manifest.peerDependencies['@deepseek-ai/dsh-client-ui-settings-plugins']).toBe('^0.1.0-rc.5')
  })

  it('registers an independently localized Plugins tab at order 20 and disposes it with the fiber', () => {
    const ctx = new TestContext()
    declareSettingsTabs(ctx.slots)
    apply(ctx as never)
    const entry = ctx.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(TaskDispatcherSettingsTab)
    expect(entry.options).toMatchObject({ id: 'task-dispatcher', order: 20 })
    expect(slotLabel(entry.options['label'])).toBe('Task Dispatcher')
    const face = (entry.inject as () => TaskDispatcherSettingsInjected)()
    expect(face.hooks.taskDispatcherConfig).toBe(face.controller)
    ctx.locale.setLocale('en')
    expect(slotLabel(entry.options['label'])).toBe('Task Dispatcher')
    ctx.dispose()
    expect(ctx.slots.entries('settings.plugins.tab')).toHaveLength(0)
  })

  it('registers after a late parent declaration and re-registers after an HMR-style collapse', () => {
    const { slots } = bench()
    expect(slots.entries('settings.plugins.tab')).toHaveLength(0)
    const collapse = declareSettingsTabs(slots)
    expect(slots.entries('settings.plugins.tab')).toHaveLength(1)
    collapse()
    expect(slots.entries('settings.plugins.tab')).toHaveLength(0)
    declareSettingsTabs(slots)
    expect(slots.entries('settings.plugins.tab')).toHaveLength(1)
  })

  it('reloads an authoritative baseline after a Host generation reset while preserving a dirty draft', async () => {
    const original = configSnapshot(0)
    const restarted = configSnapshot(0)
    restarted.base.maxConsecutiveFailures = 8
    restarted.value.maxConsecutiveFailures = 8
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: original })
      .mockResolvedValueOnce({ ok: true, value: restarted })
    const { ctx, slots } = bench(call)
    declareSettingsTabs(slots)
    const entry = slots.entries('settings.plugins.tab')[0]!
    const face = (entry.inject as () => TaskDispatcherSettingsInjected)()
    await face.controller.load()
    face.controller.edit(draft => { draft.defaultRunInBackground = false })

    ctx.emit('connection/reset')
    await vi.waitFor(() => {
      expect(face.controller.getSnapshot()).toMatchObject({
        phase: 'ready',
        dirty: true,
        conflicted: true,
        snapshot: { revision: 0, base: { maxConsecutiveFailures: 8 } },
        draft: { defaultRunInBackground: false },
      })
    })
    expect(call.mock.calls.map(args => args.slice(0, 3))).toEqual([
      ['/task-dispatcher-config', 'snapshot', {}],
      ['/task-dispatcher-config', 'snapshot', {}],
    ])
  })
})
