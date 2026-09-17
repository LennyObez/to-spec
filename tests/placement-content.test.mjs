// Content stays out of the shared layout. The canary replays the fixtures; the branch tests
// cover the line the standard draws by counting: a paragraph of prose is content, a short label
// is not, a template expression is data, and a content element outside a layout path is a page's
// own and left alone.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import standards from '../core/standards.js'
import canary from '../core/canary.js'
import check from '../standards/placement-content/check.js'
import htmlScan from '../lib/html-scan.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const definition = standards.loadStandard(ROOT, 'placement-content').definition

const ctxOver = (files) => ({
  list: () => Object.keys(files),
  read: (p) => { if (!(p in files)) throw new Error('no such file'); return files[p] },
  html: { scan: (c) => htmlScan.scan(c) }
})
const run = (files) => check({ standard: definition }, ctxOver(files))

test('the committed fixtures answer for the reason declared, not just the verdict', () => {
  const result = canary.replayFixtures(standards.loadStandard(ROOT, 'placement-content'))
  assert.equal(result.ok, true, result.why)
})

test('a paragraph of prose in a layout is content; a short label is not', () => {
  const prose = run({ 'layouts/a.html': '<p>This is a whole sentence of real content that a page ought to own itself.</p>' })
  assert.equal(prose.findings.length, 1)

  const label = run({ 'layouts/a.html': '<p>Menu</p><li>About</li>' })
  assert.equal(label.findings.length, 0, 'a short structural label is not content')
})

test('a template expression is data the page supplies, not content', () => {
  const result = run({ 'layouts/a.html': '<p>{{ page.description }}</p>' })
  assert.equal(result.findings.length, 0)
})

test('a content element outside a layout path is a page\'s own and left alone', () => {
  const result = run({ 'src/pages/about.html': '<p>A long paragraph of real prose that clearly belongs to this one page and no other.</p>' })
  assert.equal(result.findings.length, 0)
})

test('a report standard is not selected for a write, only for the end of a turn', () => {
  // It carries no PreToolUse event, so it never runs before a write; the gate reports it.
  assert.deepEqual(definition.events, ['Stop'])
  assert.equal(definition.severity, 'report')
})
