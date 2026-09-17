// A small, finite root. The canary replays the fixtures through their setup; the branch tests
// drive the check with synthetic listings so the count and its limit are exercised directly.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import standards from '../core/standards.js'
import canary from '../core/canary.js'
import check from '../standards/root-finite/check.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const definition = standards.loadStandard(ROOT, 'root-finite').definition

const run = (paths) => check({ standard: definition }, { list: () => paths })

test('the committed fixtures answer for the reason declared, through their setup', () => {
  const result = canary.replayFixtures(standards.loadStandard(ROOT, 'root-finite'))
  assert.equal(result.ok, true, result.why)
})

test('a root within the limit passes; one past it is reported', () => {
  const tidy = run(['README.md', 'package.json', 'src/index.js', 'src/deep/a.js', 'docs/guide.md'])
  assert.equal(tidy.findings.length, 0)

  const many = Array.from({ length: 40 }, (_, i) => `loose-${i}.txt`)
  assert.equal(run(many).findings.length, 1)
})

test('a directory is counted once, however deep it goes', () => {
  const deep = Array.from({ length: 50 }, (_, i) => `src/a/b/c/file-${i}.js`)
  assert.equal(run(deep).findings.length, 0, 'fifty files in one directory are one top-level entry')
})
