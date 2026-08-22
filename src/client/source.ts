import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { decodeDispatcherSnapshot } from './decode.ts'
import type {
  DispatcherObservable,
  DispatcherSnapshot,
  DispatcherViewState,
} from './types.ts'

const DEFAULT_RETRY_DELAY_MS = 1_000
const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1_000
const DEFAULT_MAX_IDLE_SOURCES = 64

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function rpcFailure(endpoint: string, error: { readonly code: string; readonly message: string }): Error {
  return new Error(`${endpoint} failed: ${error.code}: ${error.message}`)
}

/** One stable, ref-counted observable for a single conversation session. */
export class DispatcherSessionSource implements DispatcherObservable {
  private readonly listeners = new Map<() => void, number>()
  private readonly rpc: ClientConnectionRpc
  private readonly retryDelayMs: number
  private readonly sessionId: string
  private readonly onSubscriberActivity: ((active: boolean) => void) | undefined
  private state: DispatcherViewState = { phase: 'loading' }
  private subscribers = 0
  private generation = 0
  private controller: AbortController | undefined
  private disposed = false

  constructor(
    rpc: ClientConnectionRpc,
    sessionId: string,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    onSubscriberActivity?: (active: boolean) => void,
  ) {
    this.rpc = rpc
    this.sessionId = sessionId
    this.retryDelayMs = retryDelayMs
    this.onSubscriberActivity = onSubscriberActivity
  }

  getSnapshot = (): DispatcherViewState => this.state

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.set(listener, (this.listeners.get(listener) ?? 0) + 1)
    this.subscribers += 1
    if (this.subscribers === 1) {
      this.onSubscriberActivity?.(true)
      this.start()
    }
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.disposed) return
      const count = this.listeners.get(listener) ?? 0
      if (count <= 1) this.listeners.delete(listener)
      else this.listeners.set(listener, count - 1)
      this.subscribers -= 1
      if (this.subscribers === 0) {
        this.stop()
        this.onSubscriberActivity?.(false)
      }
    }
  }

  /** Abort the physical watch and permanently retire this source. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    this.listeners.clear()
    this.subscribers = 0
  }

  private start(): void {
    const generation = ++this.generation
    const controller = new AbortController()
    this.controller = controller
    this.publish({
      phase: this.state.snapshot === undefined ? 'loading' : 'reconnecting',
      ...(this.state.snapshot === undefined ? {} : { snapshot: this.state.snapshot }),
    })
    void this.run(generation, controller.signal)
  }

  private stop(): void {
    this.generation += 1
    this.controller?.abort()
    this.controller = undefined
  }

  private active(generation: number, signal: AbortSignal): boolean {
    return !this.disposed && this.subscribers > 0 && this.generation === generation && !signal.aborted
  }

  private async run(generation: number, signal: AbortSignal): Promise<void> {
    let needsSnapshot = true
    while (this.active(generation, signal)) {
      try {
        const endpoint = needsSnapshot ? 'snapshot' : 'watch'
        const payload = needsSnapshot
          ? { sessionId: this.sessionId }
          : { sessionId: this.sessionId, afterRevision: this.state.snapshot?.revision ?? 0 }
        const result = await this.rpc.call('/task-dispatcher', endpoint, payload, signal)
        if (!this.active(generation, signal)) return
        if (!result.ok) throw rpcFailure(endpoint, result.error)
        const snapshot = decodeDispatcherSnapshot(result.value, this.sessionId)
        const previous = this.state.snapshot
        if (!needsSnapshot && previous !== undefined && snapshot.revision < previous.revision) {
          // A live Host may restart or GC an inactive session while this
          // long-poll is in flight. A lower watch response is only a reset
          // signal: retain the last good view and force an authoritative
          // snapshot next. Continuing to watch after the old high revision
          // would make a reset Host answer immediately forever.
          needsSnapshot = true
          continue
        }
        this.accept(snapshot, needsSnapshot)
        needsSnapshot = false
      } catch (error) {
        if (!this.active(generation, signal)) return
        this.publish({
          phase: this.state.snapshot === undefined ? 'error' : 'reconnecting',
          ...(this.state.snapshot === undefined ? {} : { snapshot: this.state.snapshot }),
          error: failureText(error),
        })
        needsSnapshot = true
        await this.waitToRetry(signal)
      }
    }
  }

  private accept(snapshot: DispatcherSnapshot, baseline: boolean): void {
    const previous = this.state.snapshot
    // A fresh snapshot call is an explicit generation baseline. It must win
    // even when Host restart, HMR, or inactive-session GC reset revision to
    // zero. Inside one watch loop, equal timeout echoes preserve identity and
    // delayed lower revisions cannot move the UI backward.
    const accepted = baseline || previous === undefined || snapshot.revision > previous.revision
      ? snapshot
      : previous
    this.publish({ phase: 'ready', snapshot: accepted })
  }

  private publish(state: DispatcherViewState): void {
    if (this.sameState(this.state, state)) return
    this.state = state
    const listeners = Array.from(this.listeners.keys())
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[task-dispatcher] snapshot listener threw:', error)
      }
    }
  }

  private sameState(left: DispatcherViewState, right: DispatcherViewState): boolean {
    return left.phase === right.phase
      && left.snapshot === right.snapshot
      && left.error === right.error
  }

  private waitToRetry(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve()
        return
      }
      const timer = setTimeout(done, this.retryDelayMs)
      signal.addEventListener('abort', done, { once: true })
      function done(): void {
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        resolve()
      }
    })
  }
}

/** Idle-source retention policy; defaults bound an unbounded session history. */
export interface DispatcherSourceRegistryOptions {
  readonly retryDelayMs?: number
  readonly idleTtlMs?: number
  readonly maxIdleSources?: number
}

interface IdleSource {
  readonly source: DispatcherSessionSource
  readonly timer: ReturnType<typeof setTimeout>
}

/** Stable per-session source registry owned by one client plugin apply fiber. */
export class DispatcherSourceRegistry {
  private readonly idle = new Map<string, IdleSource>()
  private readonly idleTtlMs: number
  private readonly maxIdleSources: number
  private readonly rpc: ClientConnectionRpc
  private readonly retryDelayMs: number
  private readonly sessions = new Map<string, DispatcherSessionSource>()
  private disposed = false

  constructor(rpc: ClientConnectionRpc, options: DispatcherSourceRegistryOptions = {}) {
    this.rpc = rpc
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS
    this.maxIdleSources = options.maxIdleSources ?? DEFAULT_MAX_IDLE_SOURCES
  }

  forSession(sessionId: string): DispatcherSessionSource {
    const current = this.sessions.get(sessionId)
    if (current !== undefined) {
      this.touchIdle(sessionId, current)
      return current
    }
    if (this.disposed) throw new Error('task dispatcher source registry is disposed')
    const source = new DispatcherSessionSource(
      this.rpc,
      sessionId,
      this.retryDelayMs,
      active => { this.handleSubscriberActivity(sessionId, source, active) },
    )
    this.sessions.set(sessionId, source)
    this.markIdle(sessionId, source)
    return source
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.idle.values()) clearTimeout(entry.timer)
    this.idle.clear()
    for (const source of this.sessions.values()) source.dispose()
    this.sessions.clear()
  }

  private handleSubscriberActivity(
    sessionId: string,
    source: DispatcherSessionSource,
    active: boolean,
  ): void {
    if (this.disposed || this.sessions.get(sessionId) !== source) return
    if (active) this.clearIdle(sessionId, source)
    else this.markIdle(sessionId, source)
  }

  private touchIdle(sessionId: string, source: DispatcherSessionSource): void {
    if (this.idle.get(sessionId)?.source !== source) return
    this.markIdle(sessionId, source)
  }

  private markIdle(sessionId: string, source: DispatcherSessionSource): void {
    if (this.disposed || this.sessions.get(sessionId) !== source) return
    this.clearIdle(sessionId, source)
    const timer = setTimeout(() => {
      // `clearTimeout()` cannot retract a callback that is already queued.
      // Match the exact timer generation so a stale callback cannot evict a
      // source that was touched or entered a newer idle grace period.
      const current = this.idle.get(sessionId)
      if (current?.source !== source || current.timer !== timer) return
      this.evictIdle(sessionId, source)
    }, this.idleTtlMs)
    this.idle.set(sessionId, { source, timer })
    while (this.idle.size > this.maxIdleSources) {
      const oldest = this.idle.entries().next().value as [string, IdleSource] | undefined
      if (oldest === undefined) break
      this.evictIdle(oldest[0], oldest[1].source)
    }
  }

  private clearIdle(sessionId: string, source: DispatcherSessionSource): void {
    const current = this.idle.get(sessionId)
    if (current?.source !== source) return
    clearTimeout(current.timer)
    this.idle.delete(sessionId)
  }

  private evictIdle(sessionId: string, source: DispatcherSessionSource): void {
    const current = this.idle.get(sessionId)
    if (current?.source !== source) return
    clearTimeout(current.timer)
    this.idle.delete(sessionId)
    if (this.sessions.get(sessionId) !== source) return
    this.sessions.delete(sessionId)
    source.dispose()
  }
}
