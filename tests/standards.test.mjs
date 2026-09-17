// Loading and running standards, at the edges where the run stays up or comes down.
//
// A standard is data, and data is malformed sooner or later. What matters is that a bad one
// names itself and the sound ones beside it keep working, and that a declared bound is a
// bound the runtime actually applies rather than a key nobody reads.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const standards = require(join(ROOT, 'core/standards.js'))

// A complete, valid standard definition, so a test can vary one field and keep the rest sound.
function validStandard (id, over = {}) {
  return {
    schemaVersion: 1,
    id,
    title: { en: `The ${id} standard` },
    summary: { en: `A fixture standard named ${id}.` },
    category: 'agent-fixable',
    severity: 'block',
    events: ['Stop'],
    scope: ['tree'],
    kind: 'check',
    review: false,
    message: { en: ['One line.', 'A second.'], fr: ['Une ligne.', 'Une seconde.'] },
    reason: { en: 'The reason, for the model.' },
    fixtures: { bad: 'fixtures/bad', good: 'fixtures/good', meta: 'fixtures/meta.json' },
    limits: { timeout_ms: 1000, max_findings: 5 },
    ...over
  }
}

// A throwaway plugin root with one hand-built standard, so a malformed standard.json can be
// loaded without touching the shipped catalogue.
function withStandard (id, standardJson, checkSource) {
  const dir = mkdtempSync(join(tmpdir(), 'to-spec-std-'))
  const sdir = join(dir, 'standards', id)
  mkdirSync(sdir, { recursive: true })
  writeFileSync(join(sdir, 'standard.json'), typeof standardJson === 'string' ? standardJson : JSON.stringify(standardJson))
  writeFileSync(join(sdir, 'check.js'), checkSource || 'module.exports = () => ({ findings: [] })\n')
  return { dir, sdir }
}

test('a standard.json that is valid JSON but not an object loads broken, it does not crash the run', () => {
  // JSON.parse('null') is null; reaching for a field on it throws, and describeProblems runs
  // outside the caller's try. Before the guard, one such file took the whole loadAll down.
  for (const body of ['null', '42', '[]', '"a string"']) {
    const { dir } = withStandard('weird', body)
    try {
      const loaded = standards.loadStandard(dir, 'weird')
      assert.ok(loaded.broken, `${body} must load broken, not throw: ${JSON.stringify(loaded)}`)
      assert.match(loaded.broken, /not a JSON object/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('a standard that declares no limits is refused', () => {
  const def = validStandard('nolimits')
  delete def.limits
  const { dir } = withStandard('nolimits', def)
  try {
    const loaded = standards.loadStandard(dir, 'nolimits')
    assert.ok(loaded.broken, 'a bound nobody declares is a bound nobody applies')
    assert.match(loaded.broken, /limits/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a standard that declares a key the runtime does not read is refused', () => {
  // The house rule against a configuration option nothing reads, made structural: a stray key
  // is refused rather than silently carried.
  const { dir } = withStandard('stray', validStandard('stray', { colour: 'blue' }))
  try {
    const loaded = standards.loadStandard(dir, 'stray')
    assert.ok(loaded.broken, 'a key nothing reads must not be quietly accepted')
    assert.match(loaded.broken, /unknown key "colour"/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findings are capped to the declared limit, and the true count is kept', () => {
  const { dir } = withStandard('noisy', validStandard('noisy', { limits: { timeout_ms: 1000, max_findings: 3 } }),
    'module.exports = () => ({ findings: Array.from({ length: 500 }, (_, i) => ({ path: "p" + String(i).padStart(4, "0"), message: "x" })) })\n')
  try {
    const loaded = standards.loadStandard(dir, 'noisy')
    assert.equal(loaded.broken, undefined, loaded.broken)
    const result = standards.runStandard(loaded, { mode: 'tree', projectDir: dir }, standards.makeContext({ projectDir: dir }))
    assert.equal(result.status, standards.FAIL)
    assert.equal(result.findings.length, 3, 'the report is capped so a noisy check cannot make every turn write 500 findings')
    assert.equal(result.total, 500, 'the true count survives the cap, because that is the number the person needs')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the shipped catalogue loads with no broken standard', () => {
  const loaded = standards.loadAll(ROOT)
  assert.ok(loaded.length >= 2)
  for (const s of loaded) assert.equal(s.broken, undefined, `${s.id}: ${s.broken}`)
})

test('a tree the check cannot fully walk is unavailable, never a silent pass', () => {
  // ctx.list() once swallowed a walk error and returned a short list, which a check reads as
  // "looked, found nothing" -- a pass. An unreadable subdirectory must surface as unavailable.
  if (typeof process.getuid === 'function' && process.getuid() === 0) return // root reads anyway
  // A mode of 0 does not make a directory unreadable on Windows, so the condition this test
  // needs cannot be produced there. The behaviour under test -- a walk error becoming
  // unavailable -- is platform-independent; only the way to provoke it here is not.
  if (process.platform === 'win32') return
  const { chmodSync } = require('node:fs')
  const { dir } = withStandard('walker', validStandard('walker'),
    'module.exports = (input, ctx) => ({ findings: ctx.list().length ? [] : [] })\n')
  const project = mkdtempSync(join(tmpdir(), 'to-spec-walk-'))
  try {
    mkdirSync(join(project, 'locked'))
    writeFileSync(join(project, 'locked', 'x.txt'), 'x')
    chmodSync(join(project, 'locked'), 0o000)
    const loaded = standards.loadStandard(dir, 'walker')
    const result = standards.runStandard(loaded, { mode: 'tree', projectDir: project }, standards.makeContext({ projectDir: project }))
    chmodSync(join(project, 'locked'), 0o700)
    assert.equal(result.status, standards.UNAVAILABLE, `a walk that could not complete must not read as a pass: ${JSON.stringify(result)}`)
  } finally {
    try { chmodSync(join(project, 'locked'), 0o700) } catch (_) {}
    rmSync(project, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

test('selectFor runs a block standard and skips an identical off one', () => {
  const off = { ...validStandard('a'), severity: 'off' }
  const on = { ...validStandard('b') }
  // A severity of off makes a standard user-required rather than block? No: off is a switch,
  // not a category. Build them as loaded shapes the way loadAll would.
  const loaded = [{ id: 'a', definition: off }, { id: 'b', definition: on }]
  const selected = standards.selectFor(loaded, 'Stop').map((s) => s.id)
  assert.deepEqual(selected, ['b'], 'a standard switched off must not be run at all')
})

test('describeProblems refuses a severity that outranks its category', () => {
  const cases = [
    ['bad1', { severity: 'block', category: 'user-required' }, /only an agent-fixable standard may block/],
    ['bad2', { severity: 'require', category: 'agent-fixable' }, /a required standard is one a person must resolve/]
  ]
  for (const [id, over, pattern] of cases) {
    const { dir } = withStandard(id, validStandard(id, over))
    try {
      assert.match(standards.loadStandard(dir, id).broken || '', pattern)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('every event a standard may declare is one the harness actually dispatches', () => {
  // The event vocabulary must not run ahead of the wiring: a standard that could declare an
  // event nothing selects for would silently never run. The harness selects standards by
  // calling selectFor(loaded, '<event>'); this ties the vocabulary to those call sites.
  const harness = readFileSync(join(ROOT, 'harness/claude-code/index.js'), 'utf8')
  const dispatched = new Set(
    [...harness.matchAll(/selectFor\([^,]+,\s*'([^']+)'\)/g)].map((m) => m[1]))
  assert.ok(dispatched.size > 0, 'no selectFor dispatch was found, so this guard would pass vacuously')
  for (const event of standards.EVENTS) {
    assert.ok(dispatched.has(event),
      `standards may declare "${event}" but the harness selects for none such: the vocabulary is ahead of the wiring`)
  }
})
