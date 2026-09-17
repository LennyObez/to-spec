// A typed project's source stays typed. The canary replays the fixtures; the branch tests cover
// the conditions that turn the standard on and off: no tsconfig, allowJs, the output directory,
// and a tsconfig that cannot be read.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import standards from '../core/standards.js'
import canary from '../core/canary.js'
import check from '../standards/typed-source-only/check.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const definition = standards.loadStandard(ROOT, 'typed-source-only').definition

// A project is a map of path to content; the check reads tsconfig and lists files through it.
const ctxOver = (files) => ({
  exists: (p) => p in files,
  read: (p) => { if (!(p in files)) throw new Error('no such file'); return files[p] },
  list: () => Object.keys(files)
})
const run = (files) => check({ standard: definition }, ctxOver(files))

test('the committed fixtures answer for the reason declared, not just the verdict', () => {
  const result = canary.replayFixtures(standards.loadStandard(ROOT, 'typed-source-only'))
  assert.equal(result.ok, true, result.why)
})

test('a project without a tsconfig is not held to this at all', () => {
  const result = run({ 'src/a.js': 'export const x = 1' })
  assert.equal(result.findings.length, 0)
})

test('a hand-written js in a typed project source is reported', () => {
  const result = run({ 'tsconfig.json': '{"compilerOptions":{}}', 'src/a.js': 'export const x = 1' })
  assert.equal(result.findings.length, 1)
})

test('a project that turns on allowJs is left alone', () => {
  const result = run({ 'tsconfig.json': '{"compilerOptions":{"allowJs":true}}', 'src/a.js': 'export const x = 1' })
  assert.equal(result.findings.length, 0)
})

test('compiled output under the tsconfig outDir is not reported', () => {
  const result = run({ 'tsconfig.json': '{"compilerOptions":{"outDir":"src/dist"}}', 'src/dist/a.js': 'x', 'src/keep.js': 'y' })
  assert.deepEqual(result.findings.map((f) => f.path), ['src/keep.js'])
})

test('a tsconfig with comments is read, and one that cannot be parsed is unavailable', () => {
  const commented = run({ 'tsconfig.json': '{\n  // the source root\n  "compilerOptions": { "allowJs": true }\n}', 'src/a.js': 'x' })
  assert.equal(commented.findings.length, 0, 'a comment does not stop the tsconfig being read')

  const broken = check({ standard: definition }, ctxOver({ 'tsconfig.json': '{ not json', 'src/a.js': 'x' }))
  assert.equal(broken.status, 'unavailable', 'a tsconfig that cannot be read leaves the standard unable to decide')
})
