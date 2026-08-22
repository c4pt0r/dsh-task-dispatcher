import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'
import { defineConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-task-dispatcher'
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url))
const CSS_VIRTUAL_PREFIX = '\0dsh-task-dispatcher-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

function stableProjectPath(fileId: string): string {
  const projectPath = relative(PROJECT_ROOT, fileId).split(sep).join('/')
  if (projectPath === '..' || projectPath.startsWith('../')) {
    throw new Error(`client bundle input escapes the project root: ${JSON.stringify(fileId)}`)
  }
  return projectPath
}

const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/** Standalone copy of Harness' client-bundle handoff and CSS-module contract. */
export default defineConfig({
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  // Keep lib/package.json: it marks the classic loader bundle as CommonJS
  // inside this otherwise ESM package, and makes package tooling agree with
  // the Harness module-loader contract.
  clean: false,
  deps: {
    neverBundle: [...CLIENT_EXTERNALS],
    alwaysBundle: (id: string) => CLIENT_EXTERNALS.includes(id as typeof CLIENT_EXTERNALS[number])
      ? undefined
      : true,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [{
    name: 'dsh-task-dispatcher-client-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source as typeof CLIENT_EXTERNALS[number])) return null
      throw new Error(
        `client bundle purity: ${JSON.stringify(source)} is not a Harness platform module; `
        + 'cross-plugin runtime imports must use Cordis services',
      )
    },
  }, {
    name: 'dsh-task-dispatcher-css-modules',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      if (importer === undefined) throw new Error(`cannot resolve ${source} without an importer`)
      const projectPath = stableProjectPath(resolve(dirname(importer), source))
      return `${CSS_VIRTUAL_PREFIX}${projectPath}${CSS_VIRTUAL_SUFFIX}`
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const projectPath = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      const fileId = resolve(PROJECT_ROOT, projectPath)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: projectPath,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      const entries = Object.entries(cssExports ?? {}).sort(([left], [right]) => (
        left < right ? -1 : left > right ? 1 : 0
      ))
      for (const [local, entry] of entries) classMap[local] = entry.name
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(`${PLUGIN_ID}/${basename(fileId)}`)};`,
        "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
        "  const tag = document.createElement('style');",
        `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})
