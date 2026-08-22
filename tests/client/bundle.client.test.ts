import { readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'

interface ClientRegistration {
  readonly id: string
  readonly factory: (require: (id: string) => unknown) => Record<string, unknown>
}

afterEach(() => {
  for (const tag of document.querySelectorAll('style[data-plugin="dsh-task-dispatcher"]')) tag.remove()
})

describe('built Web client bundle', () => {
  it('registers the exact package id, resolves only platform modules, and injects CSS once', () => {
    const code = readFileSync(resolve(process.cwd(), 'lib/client.js'), 'utf8')
    let registration: ClientRegistration | undefined
    runInNewContext(code, {
      document,
      window: {
        __ModuleLoader__: {
          load(value: ClientRegistration) { registration = value },
        },
      },
    })

    expect(registration?.id).toBe('dsh-task-dispatcher')
    expect(typeof registration?.factory).toBe('function')

    const requested = new Set<string>()
    const requirePlatform = (id: string): Record<string, unknown> => {
      requested.add(id)
      return {}
    }
    const first = registration!.factory(requirePlatform)
    const second = registration!.factory(requirePlatform)

    expect(typeof first['apply']).toBe('function')
    expect(typeof second['apply']).toBe('function')
    expect([...requested].sort()).toEqual([
      '@deepseek-ai/dsh-client-ui-primitives',
      'react',
      'react/jsx-runtime',
    ])
    expect(document.querySelectorAll('style[data-plugin="dsh-task-dispatcher"]')).toHaveLength(1)
  })

  it('keeps generated code and source maps independent of the checkout path', () => {
    const projectRoot = process.cwd()
    const code = readFileSync(resolve(projectRoot, 'lib/client.js'), 'utf8')
    const sourceMapText = readFileSync(resolve(projectRoot, 'lib/client.js.map'), 'utf8')
    const sourceMap = JSON.parse(sourceMapText) as { readonly sources?: readonly string[] }

    expect(code).not.toContain(projectRoot)
    expect(sourceMapText).not.toContain(projectRoot)
    expect(sourceMap.sources).toEqual([
      '../src/client/TaskDispatcherAction.tsx',
      '../src/client/locales.ts',
      '../src/client/types.ts',
      '../src/client/decode.ts',
      '../src/client/source.ts',
      '../src/client/index.ts',
    ])

    const cssSource = resolve(projectRoot, 'src/client/TaskDispatcherAction.module.css')
    const stableCssId = relative(projectRoot, cssSource).split(sep).join('/')
    expect(code).toContain(`dsh-task-dispatcher-css:${stableCssId}.mjs`)
  })
})
