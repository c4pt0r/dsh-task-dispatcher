import { describe, expect, it } from 'vitest'
import { decodeDispatcherConfigSnapshot } from '../../src/client/config-decode.ts'
import { configSnapshot } from './config-fixture.ts'

describe('Task Dispatcher configuration decoder', () => {
  it('accepts the exact restart-only Host contract and detaches nested values', () => {
    const wire = configSnapshot(7)
    const decoded = decodeDispatcherConfigSnapshot(wire)
    expect(decoded).toMatchObject({
      protocolVersion: 1,
      available: true,
      writable: true,
      applies: 'restart',
      revision: 7,
      userLaneIds: [],
      value: { lanes: { analysis: { executor: { model: 'executor' } } } },
    })
    wire.value.lanes.analysis!.executor.model = 'changed-after-decode'
    expect(decoded.value.lanes['analysis']?.executor.model).toBe('executor')
  })

  it('rejects unknown root and nested keys', () => {
    expect(() => decodeDispatcherConfigSnapshot({ ...configSnapshot(), secret: 'leak' }))
      .toThrow(/unexpected secret/u)
    const nested = configSnapshot()
    Object.assign(nested.value.lanes.analysis!.executor, { temperature: 1 })
    expect(() => decodeDispatcherConfigSnapshot(nested)).toThrow(/unexpected temperature/u)
    const orchestration = configSnapshot()
    Object.assign(orchestration.value.lanes.analysis!.orchestration, { rawTool: 'workflow' })
    expect(() => decodeDispatcherConfigSnapshot(orchestration)).toThrow(/unexpected rawTool/u)
  })

  it('uses the canonical base as a repair draft only when Host marks the stored candidate invalid', () => {
    const wire = configSnapshot()
    const decoded = decodeDispatcherConfigSnapshot({
      ...wire,
      value: { broken: true },
      invalid: 'lanes must be an object',
    })
    expect(decoded.invalid).toBe('lanes must be an object')
    expect(decoded.value).toEqual(decoded.base)
    expect(() => decodeDispatcherConfigSnapshot({ ...wire, value: { broken: true } })).toThrow()
  })
})
