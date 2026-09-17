'use strict'

// A copy taken before a command that cannot be undone.
//
// Not a stash: a stash changes the working tree, and a guard that alters what the session is
// working on to protect it has already broken the thing it was protecting. This builds a
// commit through a temporary index instead, points a private reference at it, and leaves
// everything else exactly as it was.
//
// A probe established the four properties this relies on, and one constraint that is not
// obvious: a temporary index inside the working tree must be covered by the ignore rules.
// Written anywhere else it shows up as an untracked file, and because the index is written
// after the working tree is walked, it escapes the first copy and is captured by the second.
// That does not show up in a single run. The index is therefore kept inside the git directory,
// which no walk of the working tree ever enters, so the constraint holds by construction
// rather than by a rule someone has to remember to keep.
//
// The detection list below is deliberately partial and says so. Guessing at every destructive
// shape would produce refusals on innocent commands, and a guard that cries wolf is switched
// off by the person it was protecting. What it catches, it catches; what it misses is caught
// by the gate afterwards, which is the whole point of preventing where you can and repairing
// where you cannot.

const fs = require('fs')
const path = require('path')

const TAKEN = 'taken'
const REFUSED = 'refused'
const NOT_NEEDED = 'not-needed'

// Git's global options sit between `git` and the subcommand: `git -C dir reset --hard`,
// `git -c k=v clean -fd`. A pattern anchored straight to the subcommand is walked around by
// them, so this optional run of them is allowed in front of every git shape below.
const GIT_GLOBAL = '(?:\\s+-[cC]\\s+\\S+|\\s+--git-dir=\\S+|\\s+--work-tree=\\S+|\\s+-[a-z])*'
const gitShape = (subcommand, flags) => new RegExp(`\\bgit${GIT_GLOBAL}\\s+${subcommand}${flags}`)

// Each entry is a shape that has actually destroyed someone's work. The list grows by
// incident, never by imagination.
const DESTRUCTIVE = [
  // Both spellings of the same flags, and a separator after them. The separator is what keeps
  // a mention inside a quoted string, such as a search of the documentation for this very
  // command, from being read as the command. The guard still over-approximates, and says so;
  // it just does not need to over-approximate here.
  { pattern: /\brm\s+(?:-[a-zA-Z]*[rf][a-zA-Z]*|--(?:recursive|force))(?:\s|$)/, what: 'a recursive or forced delete' },
  { pattern: gitShape('reset', '\\s+--hard\\b'), what: 'a hard reset' },
  { pattern: gitShape('clean', '\\s+(?:-[a-zA-Z]*[fd]|--force|--directory)'), what: 'a clean that removes untracked files' },
  { pattern: gitShape('checkout', '\\s+--\\s'), what: 'a checkout that discards changes' },
  // Restore discards working-tree changes, except `--staged` alone, which only unstages. It is
  // destructive again the moment `--worktree` joins it. Safe only when staged-without-worktree.
  { pattern: gitShape('restore', '\\b(?:(?=[^;|]*(?:--worktree|-W)\\b)|(?![^;|]*--staged\\b))'), what: 'a restore that discards changes' },
  { pattern: /\bfind\b[^|;]*-delete\b/, what: 'a find that deletes what it matches' },
  { pattern: /\brsync\b[^|;]*--delete\b/, what: 'a sync that deletes on the far side' },
  { pattern: /\brimraf\b/, what: 'a recursive delete' },
  { pattern: /Remove-Item\b[^|;]*-Recurse\b/, what: 'a recursive delete' },
  { pattern: /\bmigrate:?(reset|fresh)\b/, what: 'a migration that drops the database' },
  { pattern: /\bdb:drop\b|\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i, what: 'a drop' },
  { pattern: /\btruncate\b/i, what: 'a truncate' },
  // Redirection over a file that exists is a delete with a friendlier face.
  { pattern: /(^|[^>])>\s*[A-Za-z0-9_./-]+\.(js|mjs|ts|json|php|py|rs|go|css|html|md)\b/, what: 'a redirect over a source file' }
]

function whatWouldBeDestroyed (command) {
  if (typeof command !== 'string' || command.length === 0) return null
  for (const entry of DESTRUCTIVE) {
    if (entry.pattern.test(command)) return entry.what
  }
  return null
}

// Where the temporary index is kept, relative to the git directory. Asked of git rather than
// assembled from `.git`, because in a linked worktree that name is a file pointing elsewhere.
const INDEX_IN_GIT_DIR = 'to-spec/index-snapshot'

const realDisk = {
  exists: (p) => fs.existsSync(p),
  ensureDir: (p) => fs.mkdirSync(p, { recursive: true })
}

// `git` runs one command and returns { status, stdout, stderr }. Injected, like `disk`, so
// that every branch below can be exercised without a repository, including the ones that only
// happen when something has already gone wrong.
function take (projectDir, { git, now = () => new Date().toISOString(), disk = realDisk }) {
  const inRepo = git(['rev-parse', '--git-dir'], {})
  if (inRepo.status !== 0) {
    return {
      outcome: REFUSED,
      key: 'snapshot.no_repository',
      why: 'there is no version history here, so there would be nothing to come back to'
    }
  }

  // Without ignore rules the copy would swallow every dependency directory in the project,
  // which turns a safety net into a reason to disable the safety net.
  if (!disk.exists(path.join(projectDir, '.gitignore'))) {
    return {
      outcome: REFUSED,
      key: 'snapshot.no_ignore_rules',
      why: 'the project has no ignore rules, so the copy would swallow every generated and downloaded file in it'
    }
  }

  // Absolute, because this variable is resolved from the working directory of the invocation
  // rather than from the repository root. Inside the git directory, so that the index file
  // can never join the next copy. And the directory is made before it is used: git does not
  // create the parents of an index file, it fails on them.
  const where = git(['rev-parse', '--git-path', INDEX_IN_GIT_DIR], {})
  if (where.status !== 0 || !where.stdout.trim()) {
    return { outcome: REFUSED, key: 'snapshot.failed', why: 'the repository could not say where a copy may be assembled' }
  }
  const indexFile = path.resolve(projectDir, where.stdout.trim())
  try {
    disk.ensureDir(path.dirname(indexFile))
  } catch (err) {
    return { outcome: REFUSED, key: 'snapshot.failed', why: `the copy could not be prepared: ${err.message}` }
  }
  const env = { GIT_INDEX_FILE: indexFile }

  const added = git(['add', '-A'], env)
  if (added.status !== 0) {
    return { outcome: REFUSED, key: 'snapshot.failed', why: `the copy could not be assembled: ${added.stderr || 'no reason given'}` }
  }

  const tree = git(['write-tree'], env)
  if (tree.status !== 0) {
    return { outcome: REFUSED, key: 'snapshot.failed', why: `the copy could not be recorded: ${tree.stderr || 'no reason given'}` }
  }

  const head = git(['rev-parse', 'HEAD'], {})
  const parents = head.status === 0 ? ['-p', head.stdout.trim()] : []

  // Signing is disabled explicitly rather than left to whatever the project configured. This
  // is not the person's commit, and a signature here would either prompt, which is impossible
  // inside a handler, or attribute a machine's copy to them.
  const commit = git([
    '-c', 'commit.gpgsign=false',
    'commit-tree', tree.stdout.trim(), ...parents,
    '-m', 'copy taken before an irreversible command'
  ], {
    ...env,
    GIT_AUTHOR_NAME: 'to-spec',
    GIT_AUTHOR_EMAIL: 'to-spec@localhost',
    GIT_COMMITTER_NAME: 'to-spec',
    GIT_COMMITTER_EMAIL: 'to-spec@localhost'
  })
  if (commit.status !== 0) {
    return { outcome: REFUSED, key: 'snapshot.failed', why: `the copy could not be sealed: ${commit.stderr || 'no reason given'}` }
  }

  // A private reference: absent from the branch list and from the default log, so it never
  // appears in anything the person looks at, and reachable, so collection cannot take it.
  const ref = `refs/snapshots/${now().replace(/[:.]/g, '-')}`
  const pointed = git(['update-ref', ref, commit.stdout.trim()], {})
  if (pointed.status !== 0) {
    return { outcome: REFUSED, key: 'snapshot.failed', why: `the copy could not be kept: ${pointed.stderr || 'no reason given'}` }
  }

  return { outcome: TAKEN, ref, commit: commit.stdout.trim() }
}

// The decision a pre-tool handler needs: does this command warrant a copy, and could one be
// taken. A copy that cannot be taken refuses the command rather than letting it run
// unprotected. It is the one moment where refusing costs less than regretting.
function guard (payload, projectDir, deps) {
  const command = payload && payload.tool_input && payload.tool_input.command
  const what = whatWouldBeDestroyed(command)
  if (!what) return { outcome: NOT_NEEDED }

  const result = take(projectDir, deps)
  return { ...result, what }
}

module.exports = {
  TAKEN,
  REFUSED,
  NOT_NEEDED,
  DESTRUCTIVE,
  INDEX_IN_GIT_DIR,
  whatWouldBeDestroyed,
  take,
  guard
}
