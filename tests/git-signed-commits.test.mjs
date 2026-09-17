// Commits carry a signature. The canary replays the fixtures, which set up real git repositories
// and really sign one of them, so the whole path is exercised. The branch tests drive the check
// with a stubbed git to cover the readings a two-repository fixture does not: no repository, and
// a signature present but unverifiable.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import standards from '../core/standards.js'
import canary from '../core/canary.js'
import check from '../standards/git-signed-commits/check.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const definition = standards.loadStandard(ROOT, 'git-signed-commits').definition

const stubGit = (headStatus, logLines) => ({
  git: {
    run: (args) => {
      if (args[0] === 'rev-parse') return { status: headStatus, stdout: '' }
      if (args[0] === 'log') return { status: 0, stdout: logLines.join('\n') }
      return { status: 1, stdout: '' }
    }
  }
})
const run = (ctx) => check({ standard: definition }, ctx)

test('the committed fixtures answer for the reason declared, through their git setup', () => {
  const result = canary.replayFixtures(standards.loadStandard(ROOT, 'git-signed-commits'))
  assert.equal(result.ok, true, result.why)
})

test('a project not under version control has nothing to check', () => {
  assert.equal(run(stubGit(128, [])).findings.length, 0)
})

test('an unsigned commit is reported; a signed but unverifiable one is not', () => {
  const mixed = run(stubGit(0, ['aaaaaaaaaaaa N', 'bbbbbbbbbbbb G']))
  assert.equal(mixed.findings.length, 1)
  assert.equal(mixed.findings[0].message, 'a commit in the recent history is not signed')

  const unverifiable = run(stubGit(0, ['cccccccccccc U', 'dddddddddddd E']))
  assert.equal(unverifiable.findings.length, 0, 'a signature this machine cannot check is still a signature')
})
