// The copy taken before something irreversible.
//
// Two halves are tested separately because they fail differently. Recognising a destructive
// command wrong in one direction refuses innocent work; wrong in the other direction it stands
// by while work is deleted. Taking the copy wrong is worse than not taking one, because the
// command then runs believing it is protected.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const snapshot = require(join(ROOT, 'core/snapshot.js'))

const recognised = (command) => snapshot.whatWouldBeDestroyed(command)

test('the shapes that have actually destroyed work are recognised', () => {
  const destructive = [
    'rm -rf build',
    'rm -fr ./dist',
    'rm --recursive --force build',
    'rm --force notes.txt',
    'git reset --hard origin/main',
    'git clean -fd',
    'git clean --force -d',
    'git clean --force --directory',
    'git checkout -- src/index.js',
    'git restore src/index.js',
    'git -C /tmp/repo reset --hard',
    'git -C /tmp/repo clean -fd',
    'git -c core.pager=cat checkout -- f',
    'find . -name "*.tmp" -delete',
    'rsync -a --delete src/ dest/',
    'npx rimraf node_modules',
    'Remove-Item -Recurse -Force build',
    'php artisan migrate:fresh',
    'DROP TABLE users;',
    'truncate -s 0 app.log',
    'echo "" > src/index.js'
  ]
  for (const command of destructive) {
    assert.ok(recognised(command), `not recognised: ${command}`)
  }
})

test('every recognised shape has a case, so a half-applied repair fails a test', () => {
  // Iterate the shipped list: an entry whose kind of command is not exercised above is a
  // pattern that could be broken without any test noticing.
  const covered = [
    'rm -rf build', 'git reset --hard x', 'git clean -fd', 'git checkout -- f', 'git restore f',
    'find . -delete', 'rsync --delete a b', 'npx rimraf x', 'Remove-Item -Recurse x',
    'php artisan migrate:fresh', 'DROP TABLE t;', 'truncate -s 0 f', 'echo x > a.js'
  ]
  for (const entry of snapshot.DESTRUCTIVE) {
    assert.ok(covered.some((c) => entry.pattern.test(c)),
      `the ${entry.what} pattern is matched by no case in this test, so a break in it would go unnoticed`)
  }
})

test('ordinary commands are left alone', () => {
  // A guard that cries wolf is switched off by the person it was protecting, so the cost of
  // a false alarm is the whole guard rather than one command.
  const innocent = [
    'npm test',
    'git status',
    'git log --oneline',
    'ls -la',
    'grep -r "rm -rf" docs/',
    'cat notes.md',
    'git add -A',
    'git restore --staged -- src/index.js',
    'node scripts/build.mjs'
  ]
  for (const command of innocent) {
    assert.equal(recognised(command), null, `wrongly recognised: ${command}`)
  }
})

test('the list is partial on purpose, and the code says so', () => {
  const source = require('node:fs').readFileSync(join(ROOT, 'core/snapshot.js'), 'utf8')
  assert.match(source, /deliberately partial/,
    'a partial guard that does not admit it is a guard someone will trust further than it goes')
})

// A repository that answers however a test needs it to, and records what it was asked.
const repository = (answers = {}) => {
  const asked = []
  const git = (args, env) => {
    asked.push({ args, env })
    const key = args.filter((a) => !a.startsWith('-')).slice(0, 2).join(' ')
    for (const [prefix, answer] of Object.entries(answers)) {
      if (args.join(' ').includes(prefix)) return answer
    }
    if (args.includes('--git-path')) return { status: 0, stdout: '.git/to-spec/index-snapshot\n', stderr: '' }
    if (key.startsWith('rev-parse')) return { status: 0, stdout: 'abc123\n', stderr: '' }
    return { status: 0, stdout: 'deadbeef\n', stderr: '' }
  }
  const prepared = []
  const disk = { exists: () => true, ensureDir: (p) => { prepared.push(p) } }
  return { git, asked, prepared, deps: { git, disk, now: () => '2026-09-07T12:00:00.000Z' } }
}

test('no repository means the command is refused, not run unprotected', () => {
  const repo = repository({ 'rev-parse --git-dir': { status: 128, stdout: '', stderr: 'not a repository' } })
  const out = snapshot.take('/project', repo.deps)
  assert.equal(out.outcome, snapshot.REFUSED)
  assert.equal(out.key, 'snapshot.no_repository')
})

test('the temporary index is absolute, inside the git directory, and its directory is made first', () => {
  // Measured constraint: an index in the working tree appears in the status unless ignored,
  // and because it is written after the tree is walked it escapes the first copy and joins
  // the second. Inside the git directory no walk reaches it. And git does not create the
  // parents of an index file, so the directory has to exist before the first command needs it.
  const repo = repository()
  snapshot.take('/project', repo.deps)
  const withIndex = repo.asked.filter((call) => call.env && call.env.GIT_INDEX_FILE)
  assert.ok(withIndex.length >= 2, 'assembling and recording both need the temporary index')
  for (const call of withIndex) {
    const file = call.env.GIT_INDEX_FILE
    assert.ok(file.startsWith('/project'), `the index path must be absolute: ${file}`)
    assert.match(file, /[\\/]\.git[\\/]to-spec[\\/]/, `the index must sit inside the git directory: ${file}`)
  }
  assert.ok(repo.asked.some((call) => call.args.includes('--git-path')),
    'the git directory is asked for, never assumed, because in a linked worktree it is elsewhere')
  const firstIndexed = repo.asked.findIndex((call) => call.env && call.env.GIT_INDEX_FILE)
  assert.equal(repo.prepared.length, 1, 'the directory holding the index is created exactly once')
  assert.ok(withIndex[0].env.GIT_INDEX_FILE.startsWith(repo.prepared[0]), 'the directory made is the one the index lives in')
  assert.ok(firstIndexed >= 0)
})

test('a project without ignore rules is refused a copy, and told why', () => {
  const repo = repository()
  repo.deps.disk.exists = () => false
  const out = snapshot.take('/project', repo.deps)
  assert.equal(out.outcome, snapshot.REFUSED)
  assert.equal(out.key, 'snapshot.no_ignore_rules')
  assert.ok(!repo.asked.some((call) => call.args[0] === 'add'), 'nothing is assembled once the copy is refused')
})

test('against a real repository, a copy is taken, kept, and leaves nothing behind', () => {
  // The fakes above exercise every branch. This is the one place the sequence meets git
  // itself, which is where a directory that was never created, or an index that lands in the
  // working tree, would show.
  const dir = mkdtempSync(join(tmpdir(), 'to-spec-snap-'))
  try {
    const run = (args, env) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } })
    run(['init', '-q'])
    run(['config', 'user.email', 'test@example.com'])
    run(['config', 'user.name', 'test'])
    writeFileSync(join(dir, '.gitignore'), 'ignored/\n')
    writeFileSync(join(dir, 'kept.txt'), 'kept\n')
    mkdirSync(join(dir, 'ignored'))
    writeFileSync(join(dir, 'ignored', 'skip.txt'), 'skip\n')
    run(['add', '-A'])
    run(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'first'])
    writeFileSync(join(dir, 'unstaged.txt'), 'new\n')
    const statusBefore = run(['status', '--porcelain']).stdout

    const out = snapshot.take(dir, { git: run })
    assert.equal(out.outcome, snapshot.TAKEN, JSON.stringify(out))

    const refs = run(['for-each-ref', '--format=%(refname)', 'refs/snapshots']).stdout.trim()
    assert.match(refs, /^refs\/snapshots\//, 'the copy is kept behind a private reference')
    const inCopy = run(['ls-tree', '-r', '--name-only', out.commit]).stdout.split('\n').filter(Boolean).sort()
    assert.deepEqual(inCopy, ['.gitignore', 'kept.txt', 'unstaged.txt'], 'untracked in, ignored out, index out')
    assert.equal(run(['status', '--porcelain']).stdout, statusBefore, 'the working tree and the real index are untouched')

    const second = snapshot.take(dir, { git: run, now: () => '2099-01-01T00:00:00.000Z' })
    assert.equal(second.outcome, snapshot.TAKEN, 'a second copy must not be refused by the first')
    const inSecond = run(['ls-tree', '-r', '--name-only', second.commit]).stdout.split('\n').filter(Boolean).sort()
    assert.deepEqual(inSecond, inCopy, 'the index file of the first copy must not join the second')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('signing is disabled on the copy, and by an option that belongs to the right command', () => {
  const repo = repository()
  snapshot.take('/project', repo.deps)
  const commit = repo.asked.find((call) => call.args.includes('commit-tree'))
  assert.ok(commit, 'no copy was sealed')
  const before = commit.args.indexOf('commit-tree')
  assert.ok(commit.args.slice(0, before).includes('commit.gpgsign=false'),
    'the configuration override belongs before the subcommand, not after it')
})

test('the copy is attributed to the tool, never to the person', () => {
  const repo = repository()
  snapshot.take('/project', repo.deps)
  const commit = repo.asked.find((call) => call.args.includes('commit-tree'))
  assert.equal(commit.env.GIT_AUTHOR_NAME, 'to-spec')
  assert.equal(commit.env.GIT_COMMITTER_NAME, 'to-spec')
})

test('the copy is kept behind a private reference', () => {
  const repo = repository()
  const out = snapshot.take('/project', repo.deps)
  assert.equal(out.outcome, snapshot.TAKEN)
  assert.match(out.ref, /^refs\/snapshots\//,
    'anything under refs/heads would appear in the branch list the person reads')
})

test('a copy that cannot be sealed refuses the command', () => {
  const repo = repository({ 'commit-tree': { status: 1, stdout: '', stderr: 'no identity configured' } })
  const out = snapshot.take('/project', repo.deps)
  assert.equal(out.outcome, snapshot.REFUSED)
  assert.match(out.why, /could not be sealed/)
})

test('a copy that cannot be kept refuses the command', () => {
  const repo = repository({ 'update-ref': { status: 1, stdout: '', stderr: 'permission denied' } })
  const out = snapshot.take('/project', repo.deps)
  assert.equal(out.outcome, snapshot.REFUSED)
  assert.match(out.why, /could not be kept/)
})

test('an ordinary command needs no copy and pays nothing for one', () => {
  const repo = repository()
  const out = snapshot.guard({ tool_input: { command: 'npm test' } }, '/project', repo.deps)
  assert.equal(out.outcome, snapshot.NOT_NEEDED)
  assert.equal(repo.asked.length, 0, 'a command that needs no copy must not touch the repository at all')
})

test('a destructive command names what it would have destroyed', () => {
  const repo = repository()
  const out = snapshot.guard({ tool_input: { command: 'rm -rf src' } }, '/project', repo.deps)
  assert.equal(out.outcome, snapshot.TAKEN)
  assert.match(out.what, /delete/)
})
