# Development

[Documentation index](./README.md) · [Project overview](../README.md) · [简体中文](./zh-CN/development.md)

This document covers source installation, generated Web-client ownership, validation, packaging, and the maintainer release boundary.


## Install from source

Install and test this project, then add its absolute path to a DSH profile that already provides the standard agents, jobs, settings, subagents, and tools services:

```sh
cd /path/to/dsh-task-dispatcher
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run bundle

cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /path/to/dsh-task-dispatcher
pnpm dsh --profile web --dump-config
```

The Host `settings` service is a hard dependency, not an optional enhancement.
A profile that omits it cannot compose this plugin; this is distinct from the
page reporting a configured provider as read-only or temporarily unavailable.

The dumped composition should contain a `dsh-task-dispatcher` row whose plugin
name is the package root, `dsh-task-dispatcher`. That root row is required for
Harness to discover and serve `lib/client.js`; the compatibility export
`dsh-task-dispatcher/dispatcher` remains importable but must not be used as the
Cordis row name.

Harness supplies the optional Cordis and Web-client peer modules named by the
bundle. The repository commits its generated `lib/client.js` artifacts, so a
Git or file dependency does not run a package build or require compiler/dev
dependencies during installation. The DSH plugin-management command itself
invokes pnpm, so pnpm must still be available in `PATH`. Maintainers must run
the bundle command and tests before committing; `npm publish` also rebuilds the
client through the package's `prepublishOnly` gate. Run the documented bundle
command before a local `npm pack`.

The bundled `general-analysis` lane targets the `deepseek-official` provider
route names, enables the master-plan pipeline, and is intentionally read-only.
Those routes may be supplied by the normal DeepSeek provider. To use the
optional local `dsh-ds4` mapping, install and configure that bundle separately,
run its local server, and provide its nominal `DS4_LOCAL_API_KEY`; `dsh-ds4` is
not a dependency of this package. The checked-in bundle deliberately leaves
`distribution` disabled and this lane in the default local execution mode:

- planner: `deepseek-official/deepseek-v4-flash` with 12,000 tokens
- executor: `deepseek-official/deepseek-v4-pro`
- verifier: `deepseek-official/deepseek-v4-flash`
- planner tools: `read`, `glob`, `grep`
- executor tools: `read`, `glob`, `grep`
- verifier tools: `read`, `glob`, `grep`
- plan budget: 6 steps, 4 accepted pending-suffix replacements, and 32 total child runs
- deadlines: 1 hour for the complete task and 15 minutes for each child
- required criteria: `requirements`, `tests`, `regression`

The configured tool names are an upper bound. Child execution still follows the Harness sandbox and delegated-child approval policy; a child cannot escalate its own permissions.

## Validate and package

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm lint
pnpm test
pnpm run bundle
pnpm run publint
pnpm pack --dry-run
```

The generated `lib/client.js` and `lib/client.js.map` are release artifacts. Commit them whenever their TypeScript or CSS sources change, and verify the package tarball contains both English and Chinese documentation before publishing.


---

[Documentation index](./README.md) · [Project overview](../README.md)
