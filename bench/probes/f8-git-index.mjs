// Probe F8 -- snapshotting through a temporary git index.
//
// The finish gate and the destructive-command guard both build a tree without touching the
// staging area. Four properties have to hold, and none of them is provable from the
// documentation alone:
//
//   1. `git status` is byte-identical before and after, so the snapshot is invisible.
//   2. Untracked files are captured, or a snapshot taken before a destructive command
//      restores nothing.
//   3. Ignored files are excluded, or a snapshot swallows a dependency directory.
//   4. The commit survives garbage collection, or the safety net evaporates.
//
// Property 1 holds only if the temporary index sits at a path git already ignores. The last
// case proves the constraint the hard way: an index written anywhere else shows up as an
// untracked file and is captured by the snapshot that follows.
//
// The verdict is the assertions and nothing else. Housekeeping never touches the exit code,
// and the summary line is always printed, because the caller reads it.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const results = []

function git (cwd, args, env = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  })
}

function assert (name, actual, expected, detail) {
  const ok = actual === expected
  results.push({ name, ok, actual, expected, detail })
  process.stdout.write(`${ok ? 'pass' : 'FAIL'}  ${name}\n`)
  if (!ok) process.stdout.write(`      expected: ${expected}\n      got:      ${actual}\n`)
}

// A git invocation that throws must become a named failed assertion, not an interruption
// that discards everything measured so far and prints no summary at all.
function step (name, fn) {
  try {
    fn()
  } catch (err) {
    results.push({ name, ok: false, actual: 'threw', expected: 'completed', detail: String(err && err.message || err) })
    process.stdout.write(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n')[0]}\n`)
  }
}

const repo = mkdtempSync(join(tmpdir(), 'to-spec-f8-'))
let tree = null
let commit = null
let statusBefore = ''
let stagedBefore = ''
const indexFile = join(repo, '.to-spec', 'cache', 'index-snapshot')

step('setup', () => {
  git(repo, ['init', '-q'])
  git(repo, ['config', 'user.name', 'to-spec'])
  git(repo, ['config', 'user.email', 'to-spec@invalid'])
  git(repo, ['config', 'commit.gpgsign', 'false'])

  writeFileSync(join(repo, '.gitignore'), 'ignored/\n.to-spec/\n')
  writeFileSync(join(repo, 'tracked.txt'), 'tracked\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', 'base'])

  // The three states a snapshot has to tell apart.
  writeFileSync(join(repo, 'untracked.txt'), 'untracked\n')
  writeFileSync(join(repo, 'tracked.txt'), 'tracked, modified\n')
  mkdirSync(join(repo, 'ignored'), { recursive: true })
  writeFileSync(join(repo, 'ignored', 'heavy.bin'), 'x'.repeat(1024))

  statusBefore = git(repo, ['status', '--porcelain=v1'])
  stagedBefore = git(repo, ['diff', '--cached', '--name-only'])

  // Absolute path, inside a directory the project's own ignore rules cover.
  mkdirSync(join(repo, '.to-spec', 'cache'), { recursive: true })
})

step('build the snapshot', () => {
  const env = { GIT_INDEX_FILE: indexFile }
  git(repo, ['add', '-A'], env)
  tree = git(repo, ['write-tree'], env).trim()
  commit = git(repo, [
    '-c', 'commit.gpgsign=false',
    'commit-tree', tree, '-p', 'HEAD'
  ], {
    ...env,
    GIT_AUTHOR_NAME: 'to-spec',
    GIT_AUTHOR_EMAIL: 'to-spec@invalid',
    GIT_COMMITTER_NAME: 'to-spec',
    GIT_COMMITTER_EMAIL: 'to-spec@invalid',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z'
  }).trim()
  git(repo, ['update-ref', 'refs/snapshots/probe', commit])
})

step('1. the snapshot is invisible', () => {
  assert('1. git status unchanged', git(repo, ['status', '--porcelain=v1']), statusBefore,
    'the staging area does not move')
  assert('1b. nothing is staged', git(repo, ['diff', '--cached', '--name-only']),
    stagedBefore, 'diff --cached identical')
})

step('2. the snapshot captures what it must', () => {
  const listed = git(repo, ['ls-tree', '-r', '--name-only', tree]).trim().split('\n').sort()
  assert('2. untracked file captured', listed.includes('untracked.txt'), true, 'ls-tree of the snapshot')
  assert('2b. modification captured', git(repo, ['show', `${tree}:tracked.txt`]), 'tracked, modified\n',
    'contents at the moment of the snapshot')
  assert('3. ignored file excluded', listed.includes('ignored/heavy.bin'), false, 'ls-tree of the snapshot')
  assert('3b. temporary index absent from the snapshot', listed.some((p) => p.startsWith('.to-spec/')), false,
    'the index does not capture itself')
})

step('4. the snapshot survives garbage collection', () => {
  git(repo, ['reflog', 'expire', '--expire=now', '--all'])
  git(repo, ['gc', '--prune=now', '--quiet'])
  let survived = true
  try {
    git(repo, ['cat-file', '-e', `${commit}^{commit}`])
  } catch (_) {
    survived = false
  }
  assert('4. the snapshot survives gc --prune=now', survived, true, 'reachable through refs/snapshots/')
})

step('5. the snapshot stays out of the usual views', () => {
  assert('5. invisible in git branch', git(repo, ['branch', '--list']).trim().includes('snapshots'),
    false, 'git branch --list')
  assert('5b. invisible in git log', git(repo, ['log', '--oneline']).trim().split('\n').length, 1,
    'a single commit visible without --all')
})

step('6. the ignored-path constraint is real', () => {
  const strayIndex = join(repo, '.stray-index')
  git(repo, ['add', '-A'], { GIT_INDEX_FILE: strayIndex })
  assert('6. an index outside an ignored path pollutes git status',
    git(repo, ['status', '--porcelain=v1']) === statusBefore, false,
    'forbidden fixture: the constraint is real')

  // git writes the index after walking the tree, so the first pass misses it and the second
  // swallows it. The defect is invisible on a single run, which is why it needs a fixture.
  const firstTree = git(repo, ['write-tree'], { GIT_INDEX_FILE: strayIndex }).trim()
  const firstListed = git(repo, ['ls-tree', '-r', '--name-only', firstTree]).trim().split('\n')
  git(repo, ['add', '-A'], { GIT_INDEX_FILE: strayIndex })
  const secondTree = git(repo, ['write-tree'], { GIT_INDEX_FILE: strayIndex }).trim()
  const secondListed = git(repo, ['ls-tree', '-r', '--name-only', secondTree]).trim().split('\n')
  assert('6b. first pass: the index escapes still', firstListed.includes('.stray-index'), false,
    'git writes the index after the walk')
  assert('6c. second pass: the index captures itself', secondListed.includes('.stray-index'), true,
    'forbidden fixture')
})

const failed = results.filter((r) => !r.ok)
process.stdout.write(`\nF8: ${results.length - failed.length}/${results.length} assertions held\n`)
process.exitCode = failed.length === 0 ? 0 : 1

// Housekeeping is not part of the verdict. A locked object under an antivirus must not turn
// a held contract into a reported failure.
try {
  rmSync(repo, { recursive: true, force: true })
} catch (err) {
  process.stderr.write(`incomplete cleanup, directory left in place: ${repo} (${err && err.message})\n`)
}
