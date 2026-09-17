// A delivered file carries no leftover markers. The discriminating property is that a marker is
// judged only where a comment is: the same words in a string are legitimate. The canary replays
// the fixtures; the branch tests cover strict case, the string exemption, and exclusion by path.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import standards from '../core/standards.js'
import canary from '../core/canary.js'
import check from '../standards/no-placeholder-tokens/check.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const definition = standards.loadStandard(ROOT, 'no-placeholder-tokens').definition

const ctxOver = (files) => ({
  list: () => Object.keys(files),
  read: (p) => { if (!(p in files)) throw new Error('no such file'); return files[p] }
})
const run = (files) => check({ standard: definition }, ctxOver(files))
const messages = (result) => result.findings.map((f) => f.message)

test('the committed fixtures answer for the reason declared, not just the verdict', () => {
  const result = canary.replayFixtures(standards.loadStandard(ROOT, 'no-placeholder-tokens'))
  assert.equal(result.ok, true, result.why)
})

test('a marker in a comment is reported; the same word in a string is not', () => {
  const inComment = run({ 'a.js': '// TODO later\nconst x = 1' })
  assert.deepEqual(messages(inComment), ['a TODO marker was left in a comment'])

  const inString = run({ 'a.js': 'const s = "TODO is just text here"' })
  assert.equal(inString.findings.length, 0, 'a marker quoted in a string is not a leftover')
})

test('TODO, FIXME and XXX are matched in their exact case only', () => {
  assert.equal(run({ 'a.js': '// todo lowercase' }).findings.length, 0)
  assert.equal(run({ 'a.js': '// FIXME this' }).findings.length, 1)
  assert.equal(run({ 'a.js': '// XXX here' }).findings.length, 1)
})

test('an unfinished-content marker is caught without regard to case', () => {
  assert.deepEqual(messages(run({ 'a.css': '/* Lorem Ipsum dolor */' })), ['a lorem ipsum marker was left in a comment'])
})

test('documentation is outside the standard by its paths', () => {
  assert.equal(run({ 'docs/notes.md': '<!-- TODO write this -->' }).findings.length, 0)
  assert.equal(run({ 'README.md': '<!-- TODO -->' }).findings.length, 0)
})

test('a file mode run reads the given content, never disk', () => {
  const result = check({ standard: definition, mode: 'file', files: [{ path: 'x.js', content: '// FIXME soon' }] }, {})
  assert.equal(result.findings.length, 1)
})
