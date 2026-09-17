// No static check is switched off in place. The comment-borne directives are judged only where a
// comment is, so one named in a string is left alone; the Rust allow attribute is code, so it is
// read from the source. The canary replays the fixtures; the branch tests cover both readings and
// the configuration exemption.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import standards from '../core/standards.js'
import canary from '../core/canary.js'
import check from '../standards/no-analyzer-suppression/check.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const definition = standards.loadStandard(ROOT, 'no-analyzer-suppression').definition

const ctxOver = (files) => ({
  list: () => Object.keys(files),
  read: (p) => { if (!(p in files)) throw new Error('no such file'); return files[p] }
})
const run = (files) => check({ standard: definition }, ctxOver(files))
const messages = (result) => result.findings.map((f) => f.message)

test('the committed fixtures answer for the reason declared, not just the verdict', () => {
  const result = canary.replayFixtures(standards.loadStandard(ROOT, 'no-analyzer-suppression'))
  assert.equal(result.ok, true, result.why)
})

test('a directive in a comment is reported; the same name in a string is not', () => {
  const inComment = run({ 'a.js': '// eslint-disable-next-line\nx()' })
  assert.deepEqual(messages(inComment), ['eslint-disable switches off a check'])

  const inString = run({ 'a.js': 'const s = "eslint-disable is just text"' })
  assert.equal(inString.findings.length, 0)
})

test('the Rust allow attribute is read from the source, not from a comment', () => {
  assert.deepEqual(messages(run({ 'lib.rs': '#[allow(dead_code)]\nfn f() {}' })), ['an allow attribute switches off a check'])
  assert.deepEqual(messages(run({ 'lib.rs': '#![allow(unused)]' })), ['an allow attribute switches off a check'])
})

test('a python type-ignore and a noqa are each recognised in a comment', () => {
  assert.equal(run({ 'a.py': 'x = 1  # type: ignore' }).findings.length, 1)
  assert.equal(run({ 'a.py': 'import os  # noqa' }).findings.length, 1)
})

test('an analyser configuration file is outside the standard by its paths', () => {
  assert.equal(run({ 'eslint.config.js': '// eslint-disable a rule here' }).findings.length, 0)
  assert.equal(run({ 'types.d.ts': '// @ts-ignore' }).findings.length, 0)
})
