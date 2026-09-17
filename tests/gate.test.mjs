// The finish gate, against situations rather than sessions.
//
// Every branch here has a cost if it is wrong. Arming on a turn that wrote nothing
// interrogates someone who asked a question. Failing to arm lets broken work through.
// Blocking without a limit hands the last word to the harness. Treating a check that could
// not run as a check that passed is the false green this whole plugin exists to prevent.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const gate = require(join(ROOT, 'core/gate.js'))
const { emptyState } = require(join(ROOT, 'core/state.js'))

const PROMPT = 'turn-1'

const situation = (over = {}) => {
  const state = emptyState()
  state.turn = { prompt_id: PROMPT, wrote: true, tools: ['Write'] }
  return {
    payload: { prompt_id: PROMPT, stop_hook_active: false },
    marked: true,
    worksite: 'building the thing',
    state,
    results: [],
    ...over
  }
}

const failing = (id) => ({ id, status: 'fail', findings: [{ path: 'a.txt', message: 'not right' }] })
const unavailable = (id, why = 'the tool is not installed') => ({ id, status: 'unavailable', why })

test('a turn that changed nothing is left alone', () => {
  const state = emptyState()
  state.turn = { prompt_id: PROMPT, wrote: false, tools: [] }
  const out = gate.evaluate(situation({ state, results: [failing('marker')] }))
  assert.equal(out.verdict, gate.SILENT)
  assert.equal(out.armed, false)
  assert.match(out.why, /changed nothing/)
})

test('an unmarked project is left alone even when something is wrong', () => {
  const out = gate.evaluate(situation({ marked: false, results: [failing('marker')] }))
  assert.equal(out.verdict, gate.SILENT)
})

test('the gate reads no field that nothing in the product writes', () => {
  // Arming may read only state the product actually writes. A condition on a field that no
  // code path ever sets would read well and never fire on a real project, while a test could
  // still satisfy it by hand and stay green -- a pass that nothing could turn red, which is
  // the outcome this plugin exists to prevent. This asserts the property structurally, so it
  // holds for the design and not merely for the fields that happen to be read today.
  const source = readFileSync(join(ROOT, 'core/gate.js'), 'utf8')
  // The anchors that bound the arming block must both exist, or a rename would empty the slice
  // and the test would pass having inspected nothing.
  const start = source.indexOf('const wroteThisTurn')
  const end = source.indexOf('// What the standards said.')
  assert.ok(start !== -1 && end !== -1 && end > start, 'the arming block anchors moved; this test would go vacuous')
  const armingBlock = source.slice(start, end)
  const readFields = [...armingBlock.matchAll(/state\.(\w+)/g)].map((m) => m[1])
  assert.ok(readFields.length > 0, 'no state field is read in the arming block, so this guard would pass vacuously')

  // The field must be PERSISTED by the harness, not merely assembled in gate.js: the corpus is
  // the ledger and the harness, gate.js excluded. Gate state is persisted as a whole object via
  // Object.assign, so that shape counts as a write alongside a direct assignment.
  const written = readFileSync(join(ROOT, 'core/ledger.js'), 'utf8') +
    readFileSync(join(ROOT, 'harness/claude-code/index.js'), 'utf8')
  for (const field of new Set(readFields)) {
    const writes = new RegExp(`\\b(?:s|state|nextState)\\.${field}\\s*=|Object\\.assign\\(\\s*(?:s|state|nextState)\\.${field}\\b`)
    assert.ok(writes.test(written),
      `the gate arms on state.${field}, which the harness never persists`)
  }
})

test('a turn that wrote and is clean passes, and never says so in praise', () => {
  const out = gate.evaluate(situation({ results: [{ id: 'marker', status: 'pass', findings: [] }] }))
  assert.equal(out.verdict, gate.PASS)
  assert.deepEqual(out.outstanding.agent, [])
  // What comes back is a list of what was not looked at, not a verdict on the whole.
  assert.ok('unverifiable' in out)
  assert.ok('needsPerson' in out)
})

test('a turn that wrote and is not clean is refused', () => {
  const out = gate.evaluate(situation({ results: [failing('marker')] }))
  assert.equal(out.verdict, gate.BLOCK)
  assert.equal(out.count, 1)
  assert.match(out.reason, /marker/)
  assert.match(out.reason, /gate\.json/)
})

test('the continuation of a refused turn stays armed even though it wrote nothing', () => {
  // Otherwise the way past the gate would be to stop writing, which is the opposite of what
  // it is asking for.
  const state = emptyState()
  state.turn = { prompt_id: PROMPT, wrote: false, tools: [] }
  state.gate = { ...state.gate, prompt_id: PROMPT, blocks: 1, lastList: ['marker'], identicalRuns: 1 }
  const out = gate.evaluate(situation({
    state,
    payload: { prompt_id: PROMPT, stop_hook_active: true },
    results: [failing('marker')]
  }))
  assert.equal(out.armed, true)
  assert.equal(out.verdict, gate.BLOCK)
})

test('a continuation flag from someone else does not arm this gate', () => {
  const state = emptyState()
  state.turn = { prompt_id: PROMPT, wrote: false, tools: [] }
  state.gate = { ...state.gate, prompt_id: 'a-different-turn' }
  const out = gate.evaluate(situation({
    state,
    payload: { prompt_id: PROMPT, stop_hook_active: true },
    results: [failing('marker')]
  }))
  assert.equal(out.verdict, gate.SILENT)
})

test('the same complaint three times gives way rather than argues', () => {
  let state = emptyState()
  state.turn = { prompt_id: PROMPT, wrote: true, tools: ['Write'] }
  const verdicts = []

  for (let round = 0; round < 3; round++) {
    const out = gate.evaluate(situation({ state, results: [failing('marker')] }))
    verdicts.push(out.verdict)
    state = { ...state, ...out.nextState }
  }

  assert.deepEqual(verdicts, [gate.BLOCK, gate.BLOCK, gate.SOFT],
    'the third identical list must be let go, not refused a third time')
})

test('giving way resets the counters so the next turn starts fresh', () => {
  let state = emptyState()
  state.turn = { prompt_id: PROMPT, wrote: true, tools: ['Write'] }
  let out
  for (let round = 0; round < 3; round++) {
    out = gate.evaluate(situation({ state, results: [failing('marker')] }))
    state = { ...state, ...out.nextState }
  }
  assert.equal(out.verdict, gate.SOFT)
  assert.equal(out.nextState.gate.blocks, 0)
  assert.equal(out.nextState.gate.identicalRuns, 0)
})

test('once the way out is taken, the same turn is not blocked again', () => {
  // The failure this closes: giving way resets the counters, so a continuation on the same
  // prompt used to re-arm and refuse from zero, looping block, block, soft without end. The
  // turn continues after the soft path, stops again carrying the same prompt, and must be let
  // go in silence rather than interrogated afresh.
  let state = emptyState()
  state.turn = { prompt_id: PROMPT, wrote: true, tools: ['Write'] }
  const verdicts = []
  for (let round = 0; round < 6; round++) {
    const out = gate.evaluate(situation({
      state,
      payload: { prompt_id: PROMPT, stop_hook_active: round > 0 },
      results: [failing('marker')]
    }))
    verdicts.push(out.verdict)
    if (out.nextState) state = { ...state, ...out.nextState }
  }
  assert.deepEqual(verdicts,
    [gate.BLOCK, gate.BLOCK, gate.SOFT, gate.SILENT, gate.SILENT, gate.SILENT],
    'after the soft path the same turn stands down, it does not begin refusing again')
})

test('a genuinely new turn on the same failing list gets its own budget', () => {
  // Standing down is keyed on the prompt that was let go, not on the list, so the next turn
  // that writes and stops with the same thing still outstanding is refused on its own account.
  let state = emptyState()
  state.turn = { prompt_id: PROMPT, wrote: true, tools: ['Write'] }
  for (let round = 0; round < 3; round++) {
    const out = gate.evaluate(situation({ state, results: [failing('marker')] }))
    state = { ...state, ...out.nextState }
  }
  const nextTurn = gate.evaluate({
    payload: { prompt_id: 'turn-2', stop_hook_active: false },
    marked: true,
    state: { ...state, turn: { prompt_id: 'turn-2', wrote: true, tools: ['Write'] } },
    results: [failing('marker')]
  })
  assert.equal(nextTurn.verdict, gate.BLOCK, 'a new turn is not silenced by the previous turn having given way')
})

test('a changing list is progress, and progress is not held against the turn', () => {
  let state = emptyState()
  state.turn = { prompt_id: PROMPT, wrote: true, tools: ['Write'] }

  const first = gate.evaluate(situation({ state, results: [failing('one')] }))
  state = { ...state, ...first.nextState }
  const second = gate.evaluate(situation({ state, results: [failing('two')] }))

  assert.equal(second.verdict, gate.BLOCK)
  assert.equal(second.nextState.gate.identicalRuns, 1, 'a different list restarts the count')
})

test('a check that could not run is carried, never counted as a pass', () => {
  const out = gate.evaluate(situation({ results: [unavailable('marker')] }))
  assert.notEqual(out.verdict, gate.PASS)
  assert.deepEqual(out.outstanding.agent, ['marker'])
  assert.match(out.reason, /could not be checked/)
})

test('what could not be checked is named before what merely failed', () => {
  const out = gate.evaluate(situation({
    results: [failing('b-failed'), unavailable('a-unavailable')]
  }))
  const lines = out.reason.split('\n').filter((l) => l.startsWith('- '))
  assert.match(lines[0], /a-unavailable/,
    'a short look and a short list read the same unless the difference is put first')
})

test('only what the agent can act on holds the turn', () => {
  const out = gate.evaluate(situation({
    results: [failing('needs-a-person')],
    categoryOf: () => 'user-required'
  }))
  assert.equal(out.verdict, gate.PASS, 'a person cannot be asked to answer mid-turn')
  assert.deepEqual(out.outstanding.user, ['needs-a-person'])
})

test('a standard declared worth reporting does not hold the turn', () => {
  // Four severities that all behave alike would be four names for one behaviour, and
  // declaring one would mean nothing.
  const out = gate.evaluate(situation({
    results: [failing('worth-mentioning')],
    categoryOf: () => 'agent-fixable',
    severityOf: () => 'report'
  }))
  assert.equal(out.verdict, gate.PASS)
  assert.deepEqual(out.outstanding.agent, [])
  assert.deepEqual(out.outstanding.unverifiable, ['worth-mentioning'])
})

test('only a standard declared blocking, and fixable by the agent, holds the turn', () => {
  const both = gate.evaluate(situation({
    results: [failing('must-fix')],
    categoryOf: () => 'agent-fixable',
    severityOf: () => 'block'
  }))
  assert.equal(both.verdict, gate.BLOCK)

  const wrongCategory = gate.evaluate(situation({
    results: [failing('needs-a-person')],
    categoryOf: () => 'user-required',
    severityOf: () => 'block'
  }))
  assert.equal(wrongCategory.verdict, gate.PASS,
    'a person cannot be asked to answer mid-turn, however hard the standard is declared')
})

test('what cannot be verified here is announced, not blocked on', () => {
  const out = gate.evaluate(situation({
    results: [unavailable('needs-a-live-site')],
    categoryOf: () => 'unverifiable-here'
  }))
  assert.equal(out.verdict, gate.PASS)
  assert.deepEqual(out.outstanding.unverifiable, ['needs-a-live-site'])
})

test('the reason names at most ten things and says how many there are', () => {
  // The bounds are asserted as independent literals, not against the module's own constants:
  // a test that reads gate.MAX_ITEMS_IN_REASON would stay green if that constant were changed
  // to the wrong value, checking the code against itself.
  const many = Array.from({ length: 25 }, (_, i) => failing(`standard-${String(i).padStart(2, '0')}`))
  const out = gate.evaluate(situation({ results: many }))
  const lines = out.reason.split('\n').filter((l) => l.startsWith('- '))
  assert.equal(lines.length, 10)
  assert.match(out.reason, /the 10 that matter most/)
  assert.match(out.reason, /25 things are outstanding/)
})

test('the reason stays within the budget it is given', () => {
  const wordy = Array.from({ length: 10 }, (_, i) => ({
    id: `standard-${i}`,
    status: 'fail',
    findings: [{ path: 'x'.repeat(4000), message: 'y'.repeat(4000) }]
  }))
  const out = gate.evaluate(situation({ results: wordy }))
  assert.ok(out.reason.length <= 9000,
    `the reason ran to ${out.reason.length} characters`)
  assert.match(out.reason, /The full report is at/,
    'the pointer to the full report must survive the trim, or the trim loses the way back')
})

test('three of the same list is stuck; the block budget spent on changing lists is spent', () => {
  // Two ways out, two different words, and a person told the wrong one is misled. Stuck means
  // the work is not moving (the same list three times); spent means it moved but the budget for
  // asking ran out (the block budget exhausted while the list kept changing).
  let state = emptyState()
  state.turn = { prompt_id: PROMPT, wrote: true, tools: ['Write'] }
  let stuck
  for (let round = 0; round < 3; round++) {
    stuck = gate.evaluate(situation({ state, results: [failing('marker')] }))
    state = { ...state, ...stuck.nextState }
  }
  assert.equal(stuck.verdict, gate.SOFT)
  assert.equal(stuck.exhausted, 'stuck', 'the same list three times is stuck, not spent')

  // A fresh turn, the list changing every round so identicalRuns never reaches its cap while
  // the block budget does.
  let s2 = emptyState()
  s2.turn = { prompt_id: PROMPT, wrote: true, tools: ['Write'] }
  let spent
  for (let round = 0; round < 4; round++) {
    spent = gate.evaluate(situation({ state: s2, results: [failing(`item-${round}`)] }))
    s2 = { ...s2, ...spent.nextState }
  }
  assert.equal(spent.verdict, gate.SOFT)
  assert.equal(spent.exhausted, 'spent', 'a changing list that exhausts the block budget is spent, not stuck')
})

test('an abandoned turn does not dock the next turn its refusal budget', () => {
  // The budget belongs to the turn. A turn blocked twice then abandoned mid-refusal leaves a
  // spent count on disk; a new prompt must still get its full budget rather than inherit it.
  let state = emptyState()
  state.turn = { prompt_id: PROMPT, wrote: true, tools: ['Write'] }
  for (let round = 0; round < 2; round++) {
    const out = gate.evaluate(situation({ state, results: [failing('marker')] }))
    state = { ...state, ...out.nextState }
  }
  assert.equal(state.gate.blocks, 2, 'two blocks were spent and left on disk')

  // A new prompt, same problem outstanding. It must block twice and only then give way.
  const verdicts = []
  let s = { ...state, turn: { prompt_id: 'turn-2', wrote: true, tools: ['Write'] } }
  for (let round = 0; round < 3; round++) {
    const out = gate.evaluate({
      payload: { prompt_id: 'turn-2', stop_hook_active: false },
      marked: true,
      state: s,
      results: [failing('marker')]
    })
    verdicts.push(out.verdict)
    s = { ...s, ...out.nextState }
  }
  assert.deepEqual(verdicts, [gate.BLOCK, gate.BLOCK, gate.SOFT],
    'the new turn got its own full budget, not the remainder of the abandoned one')
})
