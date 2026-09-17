// The reference placement standard: styling stays out of the markup.
//
// Two readings are exercised. The canary replays the committed fixtures and compares the
// findings, not just the verdict, so a check that stopped catching one of them would be seen.
// The branch tests drive the check directly for the shapes a two-file fixture cannot hold
// cheaply: the svg exemption, the size bound on a critical block, and exclusion by path.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import standards from '../core/standards.js'
import canary from '../core/canary.js'
import check from '../standards/placement-css/check.js'
import htmlScan from '../lib/html-scan.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const definition = standards.loadStandard(ROOT, 'placement-css').definition

// A check reads the project through ctx; a map of path to content is the whole project it needs.
const ctxOver = (files) => ({
  list: () => Object.keys(files),
  read: (p) => { if (!(p in files)) throw new Error('no such file'); return files[p] },
  html: { scan: (c) => htmlScan.scan(c) }
})
const run = (files) => check({ standard: definition }, ctxOver(files))
const messages = (result) => result.findings.map((f) => f.message)

test('the committed fixtures answer for the reason declared, not just the verdict', () => {
  const result = canary.replayFixtures(standards.loadStandard(ROOT, 'placement-css'))
  assert.equal(result.ok, true, result.why)
})

test('a style attribute and a style element in a page are both reported', () => {
  const result = run({ 'index.html': '<style>.a{}</style>\n<p style="color:red">x</p>' })
  assert.equal(result.findings.length, 2)
})

test('a style attribute inside an svg subtree is left alone', () => {
  const result = run({ 'index.html': '<svg><rect style="fill:red"/></svg><p style="color:red">x</p>' })
  assert.deepEqual(messages(result), ['a style attribute on <p> puts presentation into the markup'],
    'only the one outside the svg is reported')
})

test('a small critical block passes, an oversized one does not', () => {
  const small = run({ 'index.html': '<style data-critical>body{color:#222}</style>' })
  assert.equal(small.findings.length, 0)

  const big = '/*' + 'x'.repeat(2100) + '*/'
  const oversized = run({ 'index.html': `<style data-critical>${big}</style>` })
  assert.equal(oversized.findings.length, 1, 'data-critical is an exemption only while it stays small')
})

test('a file excluded by path is not scanned', () => {
  const result = run({ 'src/App.vue': '<template><p style="color:red">x</p></template>' })
  assert.equal(result.findings.length, 0, 'a single-file component co-locates its styling by design')
})

test('a file that cannot be read is unavailable, never a silent pass', () => {
  const ctx = { list: () => ['index.html'], read: () => { throw new Error('denied') }, html: { scan: htmlScan.scan } }
  const result = check({ standard: definition }, ctx)
  assert.equal(result.status, 'unavailable')
})
