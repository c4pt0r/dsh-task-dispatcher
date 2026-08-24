import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  GitWorkspaceProvider,
  PathLeaseTable,
  WorkspaceIsolationError,
  normalizeWriteScopes,
  stableTopologicalOrder,
  transitionCandidateTransaction,
  validateChangedPaths,
} from './workspace-isolation.js'

const OID_A = 'a'.repeat(40)
const OID_B = 'b'.repeat(40)
const OID_C = 'c'.repeat(40)

function workspaceRoots(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-workspace-isolation-'))
  const repositoryRoot = join(root, 'source')
  const isolationRoot = join(root, 'isolation')
  const liveRoot = join(root, 'live')
  mkdirSync(repositoryRoot)
  mkdirSync(isolationRoot)
  mkdirSync(liveRoot)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, repositoryRoot, isolationRoot, liveRoot }
}

function step(id, dependsOn, writeScopes) {
  return { id, dependsOn, writeScopes }
}

test('write scopes are portable, unique, non-overlapping, and deeply frozen', () => {
  const scopes = normalizeWriteScopes([
    { path: 'styles/site.css', kind: 'file' },
    { path: 'content', kind: 'tree' },
  ])
  assert.deepEqual(scopes, [
    { path: 'content', kind: 'tree' },
    { path: 'styles/site.css', kind: 'file' },
  ])
  assert.equal(Object.isFrozen(scopes), true)
  assert.equal(Object.isFrozen(scopes[0]), true)

  for (const value of [
    [{ path: '/etc/passwd', kind: 'file' }],
    [{ path: 'C:\\windows\\system.ini', kind: 'file' }],
    [{ path: '../escape', kind: 'tree' }],
    [{ path: 'src/../escape', kind: 'file' }],
    [{ path: 'src\0secret', kind: 'file' }],
    [{ path: 'src/.GIT/config', kind: 'file' }],
    [{ path: 'src\\file.js', kind: 'file' }],
  ]) {
    assert.throws(() => normalizeWriteScopes(value), WorkspaceIsolationError)
  }
  assert.throws(() => normalizeWriteScopes([
    { path: 'Src/app.js', kind: 'file' },
    { path: 'src/app.js', kind: 'file' },
  ]), error => error.code === 'PATH_CASE_COLLISION')
  assert.throws(() => normalizeWriteScopes([
    { path: 'src', kind: 'tree' },
    { path: 'src/app.js', kind: 'file' },
  ]), error => error.code === 'OVERLAPPING_WRITE_SCOPE')
})

test('PathLeaseTable acquires all scopes atomically and fences prefix conflicts', () => {
  let id = 0
  const table = new PathLeaseTable({ createId: () => `lease-${++id}` })
  const first = table.acquire('agent-a', [
    { path: 'src', kind: 'tree' },
    { path: 'package.json', kind: 'file' },
  ])
  assert.equal(table.size, 1)
  assert.throws(() => table.acquire('agent-b', [
    { path: 'docs', kind: 'tree' },
    { path: 'src/app.js', kind: 'file' },
  ]), error => error.code === 'PATH_LEASE_CONFLICT')
  assert.equal(table.size, 1, 'a conflicting multi-scope acquire must not retain its non-conflicting scope')

  const second = table.acquire('agent-b', [{ path: 'docs', kind: 'tree' }])
  assert.equal(table.size, 2)
  assert.equal(table.release(first), true)
  assert.equal(table.release(second), true)
  assert.deepEqual(table.snapshot(), [])
})

test('a quarantined path lease stays fenced and cannot be forged or released', () => {
  const table = new PathLeaseTable()
  const lease = table.acquire('agent-a', [{ path: 'src/app.js', kind: 'file' }])
  const quarantined = table.quarantine(lease, 'child cleanup was not confirmed')
  assert.equal(quarantined.state, 'quarantined')
  assert.equal(Object.isFrozen(quarantined), true)
  assert.throws(() => table.release(lease), error => error.code === 'PATH_LEASE_QUARANTINED')
  assert.throws(() => table.acquire('agent-b', [{ path: 'src/app.js', kind: 'file' }]), error => error.code === 'PATH_LEASE_CONFLICT')
  assert.throws(() => table.release({ leaseId: lease.leaseId }), error => error.code === 'INVALID_LEASE')
})

test('Host-observed changes reject escape, scope overflow, size overflow, and symlinks', () => {
  const scopes = [{ path: 'site', kind: 'tree' }]
  const manifest = validateChangedPaths([
    { path: 'site/index.html', type: 'file', bytes: 120 },
    { path: 'site/old.css', type: 'delete', bytes: 0 },
  ], scopes, { maxPaths: 2, maxBytes: 120 })
  assert.equal(manifest.totalBytes, 120)
  assert.equal(Object.isFrozen(manifest.changes[0]), true)

  assert.throws(() => validateChangedPaths([
    { path: 'README.md', type: 'file', bytes: 1 },
  ], scopes), error => error.code === 'CHANGED_PATH_OUT_OF_SCOPE')
  assert.throws(() => validateChangedPaths([
    { path: '../site/index.html', type: 'file', bytes: 1 },
  ], scopes), error => error.code === 'PATH_ESCAPE')
  assert.throws(() => validateChangedPaths([
    { path: 'site/link', type: 'symlink', bytes: 4 },
  ], scopes), error => error.code === 'SYMLINK_CHANGE')
  assert.throws(() => validateChangedPaths([
    { path: 'site/a', type: 'file', bytes: 1 },
    { path: 'site/b', type: 'file', bytes: 1 },
  ], scopes, { maxPaths: 1 }), error => error.code === 'CHANGED_PATH_LIMIT')
  assert.throws(() => validateChangedPaths([
    { path: 'site/a', type: 'file', bytes: 2 },
  ], scopes, { maxBytes: 1 }), error => error.code === 'CHANGED_BYTES_LIMIT')
})

test('stableTopologicalOrder is deterministic and rejects unknown edges and cycles', () => {
  const nodes = [
    { id: 'finish', dependsOn: ['style', 'content'] },
    { id: 'style', dependsOn: ['base'] },
    { id: 'content', dependsOn: ['base'] },
    { id: 'base', dependsOn: [] },
  ]
  assert.deepEqual(stableTopologicalOrder(nodes), ['base', 'content', 'style', 'finish'])
  assert.equal(Object.isFrozen(stableTopologicalOrder(nodes)), true)
  assert.throws(() => stableTopologicalOrder([
    { id: 'a', dependsOn: ['missing'] },
  ]), error => error.code === 'UNKNOWN_DAG_DEPENDENCY')
  assert.throws(() => stableTopologicalOrder([
    { id: 'a', dependsOn: ['b'] },
    { id: 'b', dependsOn: ['a'] },
  ]), error => error.code === 'DAG_CYCLE')
})

test('GitWorkspaceProvider is dry-run by default and detects canonical root symlink overlap', async (t) => {
  const roots = workspaceRoots(t)
  const provider = new GitWorkspaceProvider({
    isolationRoot: roots.isolationRoot,
    liveRoot: roots.liveRoot,
    createId: () => 'workspace-one',
  })
  const plan = provider.plan({
    taskId: 'task-one',
    repositoryRoot: roots.repositoryRoot,
    baseOid: OID_A,
    steps: [step('site', [], [{ path: 'site', kind: 'tree' }])],
  })
  const provision = await provider.provision(plan)
  assert.equal(provision.state, 'planned')
  assert.equal(provision.executed, false)
  assert.equal(existsSync(plan.taskRoot), false, 'dry-run planning must not create the task root')
  assert.equal(Object.isFrozen(provision.plan.provisionCommands[0].args), true)
  await assert.rejects(
    provider.seal(provision, { stepId: 'site', changes: [] }),
    error => error.code === 'INVALID_PROVISION',
  )

  const alias = join(roots.root, 'isolation-alias')
  symlinkSync(roots.repositoryRoot, alias)
  assert.throws(() => new GitWorkspaceProvider({ isolationRoot: alias }).plan({
    taskId: 'task-two', repositoryRoot: roots.repositoryRoot, baseOid: OID_A,
    steps: [step('site', [], [{ path: 'site', kind: 'tree' }])],
  }), error => error.code === 'ROOT_OVERLAP')
})

test('GitWorkspaceProvider seals bounded manifests and integrates in stable topological order', async (t) => {
  const roots = workspaceRoots(t)
  const commands = []
  const exec = async (command) => {
    commands.push(command)
    if (command.purpose === 'read sealed commit for content') return { stdout: `${OID_B}\n` }
    if (command.purpose === 'read sealed commit for style') return { stdout: `${OID_C}\n` }
    if (command.purpose === 'read integrated candidate head') return { stdout: `${OID_A}\n` }
    return { stdout: '' }
  }
  const ids = ['workspace-one', 'candidate-one']
  const provider = new GitWorkspaceProvider({
    isolationRoot: roots.isolationRoot,
    liveRoot: roots.liveRoot,
    createId: () => ids.shift(),
    exec,
  })
  const plan = provider.plan({
    taskId: 'task-one',
    repositoryRoot: roots.repositoryRoot,
    baseOid: OID_A,
    steps: [
      step('style', [], [{ path: 'styles', kind: 'tree' }]),
      step('content', [], [{ path: 'content', kind: 'tree' }]),
    ],
  })
  const liveSignal = new AbortController()
  const provision = await provider.provision(plan, { signal: liveSignal.signal })
  const style = await provider.seal(provision, {
    stepId: 'style', changes: [{ path: 'styles/site.css', type: 'file', bytes: 10 }],
  })
  const content = await provider.seal(provision, {
    stepId: 'content', changes: [{ path: 'content/resume.html', type: 'file', bytes: 20 }],
  })
  const transaction = await provider.integrate(provision, [style, content])
  assert.equal(transaction.state, 'committed')
  assert.deepEqual(transaction.integrationOrder, ['content', 'style'])
  assert.deepEqual(
    transaction.commands.filter(item => item.purpose.startsWith('integrate sealed')).map(item => item.purpose),
    ['integrate sealed step content', 'integrate sealed step style'],
  )
  assert.equal(Object.isFrozen(transaction), true)
  assert.equal(Object.isFrozen(transaction.history), true)
  assert.ok(commands.length > 0)
})

test('malformed Host execution output quarantines sealing after commands started', async (t) => {
  const roots = workspaceRoots(t)
  const provider = new GitWorkspaceProvider({
    isolationRoot: roots.isolationRoot,
    createId: () => 'workspace-one',
    exec: async () => ({ stdout: 'not-a-git-object-id' }),
  })
  const plan = provider.plan({
    taskId: 'task-one', repositoryRoot: roots.repositoryRoot, baseOid: OID_A,
    steps: [step('site', [], [{ path: 'site', kind: 'tree' }])],
  })
  const provision = await provider.provision(plan)
  await assert.rejects(provider.seal(provision, {
    stepId: 'site', changes: [{ path: 'site/index.html', type: 'file', bytes: 1 }],
  }), error => error.code === 'WORKSPACE_SEAL_QUARANTINED' && error.quarantined === true)
})

test('candidate cancellation aborts before execution and uncertain cleanup quarantines', async (t) => {
  const roots = workspaceRoots(t)
  let mode = 'success'
  const exec = async (command) => {
    if (mode === 'integration-failure' && command.purpose.startsWith('integrate sealed')) {
      throw Object.assign(new Error('cherry-pick failed'), { cleanupUncertain: true })
    }
    if (mode === 'integration-failure' && command.purpose === 'remove failed candidate worktree') {
      throw new Error('cleanup failed')
    }
    if (command.purpose.startsWith('read sealed commit')) return { stdout: `${OID_B}\n` }
    return { stdout: `${OID_A}\n` }
  }
  const ids = ['workspace-one', 'candidate-cancelled', 'candidate-quarantined']
  const provider = new GitWorkspaceProvider({ isolationRoot: roots.isolationRoot, createId: () => ids.shift(), exec })
  const plan = provider.plan({
    taskId: 'task-one', repositoryRoot: roots.repositoryRoot, baseOid: OID_A,
    steps: [step('site', [], [{ path: 'site', kind: 'tree' }])],
  })
  const provision = await provider.provision(plan)
  const sealed = await provider.seal(provision, {
    stepId: 'site', changes: [{ path: 'site/index.html', type: 'file', bytes: 10 }],
  })

  const cancelled = new AbortController()
  cancelled.abort('operator cancelled')
  const aborted = await provider.integrate(provision, [sealed], { signal: cancelled.signal })
  assert.equal(aborted.state, 'aborted')
  assert.deepEqual(aborted.history.map(item => item.state), ['planned', 'aborted'])

  mode = 'integration-failure'
  const quarantined = await provider.integrate(provision, [sealed])
  assert.equal(quarantined.state, 'quarantined')
  assert.deepEqual(quarantined.history.map(item => item.state), ['planned', 'applying', 'quarantined'])
  assert.match(quarantined.reason, /cherry-pick failed/u)
  assert.throws(
    () => transitionCandidateTransaction(quarantined, 'aborted', { reason: 'too late' }),
    error => error.code === 'INVALID_CANDIDATE_TRANSITION',
  )
})
