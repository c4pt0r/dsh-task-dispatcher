import { describe, expect, it, vi } from 'vitest'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { DispatcherSessionSource, DispatcherSourceRegistry } from '../../src/client/source.ts'

function snapshot(revision: number, title = `revision-${revision}`) {
  return {
    protocolVersion: 1,
    revision,
    sessionId: 'session-1',
    generatedAt: 1_700_000_000_000 + revision,
    tasks: [{
      taskId: 'task-1', lane: 'lane', title, status: 'running', phase: 'preparing',
      startedAt: 1, updatedAt: revision + 1, workers: [],
    }],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function turn(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('DispatcherSessionSource', () => {
  it('shares one watcher across subscribers and aborts only at ref-count zero', async () => {
    const watch = deferred<never>()
    const signals: AbortSignal[] = []
    const call = vi.fn(async (_channel: string, endpoint: string, _payload: unknown, signal?: AbortSignal) => {
      if (signal !== undefined) signals.push(signal)
      if (endpoint === 'snapshot') return { ok: true as const, value: snapshot(1) }
      return watch.promise
    })
    const source = new DispatcherSessionSource({ call } as ClientConnectionRpc, 'session-1')
    const first = source.subscribe(() => {})
    const second = source.subscribe(() => {})
    await turn()

    expect(call).toHaveBeenCalledTimes(2)
    expect(call.mock.calls[0]?.slice(0, 3)).toEqual([
      '/task-dispatcher', 'snapshot', { sessionId: 'session-1' },
    ])
    expect(call.mock.calls[1]?.slice(0, 3)).toEqual([
      '/task-dispatcher', 'watch', { sessionId: 'session-1', afterRevision: 1 },
    ])
    first()
    expect(signals.at(-1)?.aborted).toBe(false)
    second()
    expect(signals.at(-1)?.aborted).toBe(true)
  })

  it('ignores a lower, older watch revision without regressing the retained snapshot', async () => {
    const pending = deferred<never>()
    let calls = 0
    const call = vi.fn(async (_channel: string, _endpoint: string, _payload: unknown) => {
      calls += 1
      if (calls === 1) return { ok: true as const, value: snapshot(5, 'fresh') }
      if (calls === 2) return { ok: true as const, value: snapshot(4, 'stale') }
      return pending.promise
    })
    const source = new DispatcherSessionSource({ call } as ClientConnectionRpc, 'session-1')
    const stop = source.subscribe(() => {})
    await turn()
    await turn()
    expect(source.getSnapshot()).toMatchObject({
      phase: 'ready',
      snapshot: { revision: 5, tasks: [{ title: 'fresh' }] },
    })
    expect(call.mock.calls[2]?.slice(0, 3)).toEqual([
      '/task-dispatcher', 'snapshot', { sessionId: 'session-1' },
    ])
    stop()
  })

  it('rebases snapshot 5 -> watch 0 through snapshot 0 before resuming watch 0', async () => {
    const pending = deferred<never>()
    let calls = 0
    const call = vi.fn(async (_channel: string, _endpoint: string, _payload: unknown) => {
      calls += 1
      if (calls === 1) return { ok: true as const, value: snapshot(5, 'revision five') }
      if (calls === 2) return { ok: true as const, value: snapshot(0, 'watch reset signal') }
      if (calls === 3) return { ok: true as const, value: snapshot(0, 'snapshot baseline') }
      return pending.promise
    })
    const source = new DispatcherSessionSource({ call } as ClientConnectionRpc, 'session-1')
    const stop = source.subscribe(() => {})
    await turn()
    await turn()

    expect(call.mock.calls.slice(0, 4).map(entry => entry.slice(0, 3))).toEqual([
      ['/task-dispatcher', 'snapshot', { sessionId: 'session-1' }],
      ['/task-dispatcher', 'watch', { sessionId: 'session-1', afterRevision: 5 }],
      ['/task-dispatcher', 'snapshot', { sessionId: 'session-1' }],
      ['/task-dispatcher', 'watch', { sessionId: 'session-1', afterRevision: 0 }],
    ])
    expect(source.getSnapshot()).toMatchObject({
      phase: 'ready',
      snapshot: { revision: 0, tasks: [{ title: 'snapshot baseline' }] },
    })
    stop()
  })

  it('accepts a lower revision with a newer generation timestamp as a Host restart baseline', async () => {
    const firstWatch = deferred<never>()
    const secondWatch = deferred<never>()
    let calls = 0
    const first = { ...snapshot(5, 'old process'), generatedAt: 100 }
    const restarted = { ...snapshot(1, 'new process'), generatedAt: 200 }
    const call = vi.fn(async (_channel: string, _endpoint: string, _payload: unknown) => {
      calls += 1
      if (calls === 1) return { ok: true as const, value: first }
      if (calls === 2) return firstWatch.promise
      if (calls === 3) return { ok: true as const, value: restarted }
      return secondWatch.promise
    })
    const source = new DispatcherSessionSource({ call } as ClientConnectionRpc, 'session-1')
    const stopFirst = source.subscribe(() => {})
    await turn()
    stopFirst()
    const stopSecond = source.subscribe(() => {})
    await turn()
    expect(source.getSnapshot()).toMatchObject({
      phase: 'ready',
      snapshot: { revision: 1, generatedAt: 200, tasks: [{ title: 'new process' }] },
    })
    expect(call.mock.calls[2]?.slice(0, 3)).toEqual([
      '/task-dispatcher', 'snapshot', { sessionId: 'session-1' },
    ])
    expect(call.mock.calls[3]?.[2]).toEqual({ sessionId: 'session-1', afterRevision: 1 })
    stopSecond()
  })

  it('retains the last good snapshot and exposes reconnecting after a watch failure', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: snapshot(2) })
      .mockRejectedValueOnce(new Error('offline'))
    const source = new DispatcherSessionSource({ call } as ClientConnectionRpc, 'session-1', 60_000)
    const stop = source.subscribe(() => {})
    await turn()
    await turn()
    expect(source.getSnapshot()).toMatchObject({
      phase: 'reconnecting',
      error: 'offline',
      snapshot: { revision: 2 },
    })
    stop()
  })

  it('shows an RPC/decoder error before any snapshot and retries from snapshot', async () => {
    vi.useFakeTimers()
    try {
      const pending = deferred<never>()
      const call = vi.fn()
        .mockResolvedValueOnce({ ok: false, error: { code: 'bad-request', message: 'no session', details: {} } })
        .mockImplementationOnce(() => pending.promise)
      const source = new DispatcherSessionSource({ call } as ClientConnectionRpc, 'session-1', 10)
      const stop = source.subscribe(() => {})
      await turn()
      expect(source.getSnapshot()).toMatchObject({ phase: 'error', error: expect.stringContaining('bad-request') })
      await vi.advanceTimersByTimeAsync(10)
      expect(call.mock.calls[1]?.slice(0, 3)).toEqual([
        '/task-dispatcher', 'snapshot', { sessionId: 'session-1' },
      ])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('DispatcherSourceRegistry', () => {
  it('returns stable per-session identities and retires all sources on dispose', () => {
    const rpc = { call: vi.fn() } as unknown as ClientConnectionRpc
    const registry = new DispatcherSourceRegistry(rpc)
    const first = registry.forSession('one')
    expect(registry.forSession('one')).toBe(first)
    expect(registry.forSession('two')).not.toBe(first)
    registry.dispose()
    expect(() => registry.forSession('three')).toThrow('disposed')
  })

  it('evicts the least-recently-idle source at max idle + 1 and creates a new instance', () => {
    vi.useFakeTimers()
    try {
      const rpc = { call: vi.fn() } as unknown as ClientConnectionRpc
      const registry = new DispatcherSourceRegistry(rpc, { idleTtlMs: 60_000, maxIdleSources: 2 })
      const first = registry.forSession('one')
      const second = registry.forSession('two')
      // Touch `one`, making `two` the least recently used idle entry.
      expect(registry.forSession('one')).toBe(first)
      const third = registry.forSession('three')

      expect(registry.forSession('one')).toBe(first)
      expect(registry.forSession('three')).toBe(third)
      expect(registry.forSession('two')).not.toBe(second)
      registry.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('expires an idle source after its TTL', async () => {
    vi.useFakeTimers()
    try {
      const rpc = { call: vi.fn() } as unknown as ClientConnectionRpc
      const registry = new DispatcherSourceRegistry(rpc, { idleTtlMs: 50, maxIdleSources: 64 })
      const first = registry.forSession('idle')
      await vi.advanceTimersByTimeAsync(50)
      expect(registry.forSession('idle')).not.toBe(first)
      registry.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('touching an idle source starts a fresh timer generation', async () => {
    vi.useFakeTimers()
    try {
      const rpc = { call: vi.fn() } as unknown as ClientConnectionRpc
      const registry = new DispatcherSourceRegistry(rpc, { idleTtlMs: 100, maxIdleSources: 64 })
      const first = registry.forSession('idle')

      await vi.advanceTimersByTimeAsync(90)
      expect(registry.forSession('idle')).toBe(first)
      await vi.advanceTimersByTimeAsync(20)
      expect(registry.forSession('idle')).toBe(first)

      await vi.advanceTimersByTimeAsync(100)
      expect(registry.forSession('idle')).not.toBe(first)
      registry.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never evicts an active source and cancels StrictMode-style idle eviction on resubscribe', async () => {
    vi.useFakeTimers()
    try {
      const pending = deferred<never>()
      const rpc = { call: vi.fn(() => pending.promise) } as unknown as ClientConnectionRpc
      const registry = new DispatcherSourceRegistry(rpc, { idleTtlMs: 100, maxIdleSources: 1 })
      const source = registry.forSession('active')
      const stopFirst = source.subscribe(() => {})

      // Capacity pressure may evict only the idle entries, never `source`.
      registry.forSession('idle-one')
      registry.forSession('idle-two')
      expect(registry.forSession('active')).toBe(source)

      // A transient zero-subscriber window enters grace; resubscribing before
      // its TTL cancels eviction and preserves the observable identity.
      stopFirst()
      await vi.advanceTimersByTimeAsync(50)
      const stopSecond = source.subscribe(() => {})
      await vi.advanceTimersByTimeAsync(100)
      expect(registry.forSession('active')).toBe(source)

      stopSecond()
      await vi.advanceTimersByTimeAsync(100)
      expect(registry.forSession('active')).not.toBe(source)
      registry.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('registry dispose clears idle timers, aborts active sources, and clears every identity', () => {
    vi.useFakeTimers()
    try {
      const pending = deferred<never>()
      const signals: AbortSignal[] = []
      const call = vi.fn((_channel: string, _endpoint: string, _payload: unknown, signal?: AbortSignal) => {
        if (signal !== undefined) signals.push(signal)
        return pending.promise
      })
      const registry = new DispatcherSourceRegistry(
        { call } as ClientConnectionRpc,
        { idleTtlMs: 100, maxIdleSources: 64 },
      )
      const idle = registry.forSession('idle')
      const active = registry.forSession('active')
      const unsubscribe = active.subscribe(() => {})
      expect(vi.getTimerCount()).toBe(1)
      expect(signals[0]?.aborted).toBe(false)

      registry.dispose()
      expect(vi.getTimerCount()).toBe(0)
      expect(signals[0]?.aborted).toBe(true)
      expect(() => registry.forSession('idle')).toThrow('disposed')

      const callsBeforeRetiredSubscribe = call.mock.calls.length
      idle.subscribe(() => {})()
      expect(call).toHaveBeenCalledTimes(callsBeforeRetiredSubscribe)
      // React may run its already-issued cleanup after registry teardown.
      expect(unsubscribe).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })
})
