import { isAbsolute, relative } from 'node:path'

/** Shared limits and side-effect-free helpers used across dispatcher modules. */
export const MAX_TITLE_LENGTH = 200
export const MAX_ERROR_TEXT_LENGTH = 2_000

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function own(value, key) {
  return Object.hasOwn(value, key)
}

export function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Contain diagnostic logging so observability can never alter task results. */
export function telemetryWarn(logger, error) {
  try {
    logger?.warn?.(`dsh-task-dispatcher telemetry contained failure: ${errorText(error)}`)
  } catch {
    // Observability is strictly subordinate to task execution, including its logger.
  }
}

export function trimmed(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be non-empty`)
  }
  if (value !== value.trim()) throw new TypeError(`${label} must be trimmed`)
  return value
}

export function clipped(value, limit) {
  if (typeof value !== 'string') return ''
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

export function insideOrEqual(path, root) {
  const offset = relative(root, path)
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset))
}
