// How the bench reads a measurement.
//
// These rules decide whether a run is reported as a property of the plugin, a property of
// the machine, or a defect in the bench itself. Getting them wrong is how a run of nothing
// comes to read like a run of everything, so they are exercised here directly, with
// fabricated sessions, rather than trusted because they are short.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PASS, FAIL, UNAVAILABLE, BENCH_ERROR,
  unusable, shapeIntact, toolUses, handlerCalls, streamHas, verdictOf
} from '../bench/probes/verdict.mjs'

const session = (over = {}) => ({
  endedOnItsOwn: true,
  notLoggedIn: false,
  pluginLoaded: true,
  events: [{ event: 'SessionStart', kind: 'invocation' }],
  stream: [],
  ...over
})

test('an interrupted session is a bench error, never a behavioural result', () => {
  const verdict = unusable(session({ endedOnItsOwn: false, endedWhy: 'killed at the deadline' }))
  assert.equal(verdict.status, BENCH_ERROR)
  assert.match(verdict.detail, /did not end on its own/)
})

test('truncation is checked before anything else', () => {
  // A session cut short still carries an init record and a first invocation, so every later
  // check would happily accept it.
  const verdict = unusable(session({ endedOnItsOwn: false, endedWhy: 'killed', notLoggedIn: true }))
  assert.equal(verdict.status, BENCH_ERROR, 'an interruption must not be reported as a missing login')
})

test('an interruption surfaces what the harness was blocked on', () => {
  // A hang whose cause never became a stream record is otherwise mute; the tails carry it out.
  const verdict = unusable(session({
    endedOnItsOwn: false, endedWhy: 'ETIMEDOUT',
    stderrTail: 'some unexpected trouble', danglingStdout: ''
  }))
  assert.equal(verdict.status, BENCH_ERROR)
  assert.match(verdict.detail, /some unexpected trouble/, 'the cause of the hang must reach the report')
})

test('a session hung on authentication could not run, and is not a bench defect', () => {
  // A rejected credential hangs on a login; that session exercised nothing, so it "could not
  // run" -- the class of a missing login, not a broken bench.
  const verdict = unusable(session({
    endedOnItsOwn: false, endedWhy: 'ETIMEDOUT',
    stderrTail: 'Invalid API key · Please run /login', danglingStdout: ''
  }))
  assert.equal(verdict.status, UNAVAILABLE)
  assert.match(verdict.why, /authenticate/)
})

test('the auth reading is narrow enough to leave a real hang a bench error', () => {
  // Only auth vocabulary diverts a hang -- not a long message that merely mentions the model.
  const verdict = unusable(session({
    endedOnItsOwn: false, endedWhy: 'ETIMEDOUT',
    stderrTail: 'the model produced a very long turn and the buffer filled', danglingStdout: ''
  }))
  assert.equal(verdict.status, BENCH_ERROR, 'a non-auth interruption stays a bench error')
})

test('a session that could not run is unavailable, not failed', () => {
  assert.equal(unusable(session({ notLoggedIn: true })).status, UNAVAILABLE)
  assert.equal(unusable(session({ pluginLoaded: false })).status, UNAVAILABLE)
})

test('a loaded plugin that invoked no handler is a failure, not an unavailability', () => {
  // This is the defect the whole milestone exists to catch. Reporting it as "could not run
  // here" would absorb it in silence, which is exactly the shape of failure being guarded
  // against.
  const verdict = unusable(session({ events: [] }))
  assert.equal(verdict.status, FAIL)
  assert.match(verdict.detail, /not one handler was invoked/)
})

test('a usable session yields no verdict of its own', () => {
  assert.equal(unusable(session()), null)
})

test('a changed stream shape is reported as such, not as a behavioural claim', () => {
  const changed = shapeIntact(session({ stream: [{ type: 'assistant' }] }))
  assert.equal(changed.status, BENCH_ERROR)
  assert.match(changed.detail, /shape/)
  assert.equal(shapeIntact(session({ stream: [{ subtype: 'hook_response' }] })), null)
})

test('tool uses are read from the model\'s own messages', () => {
  const s = session({
    stream: [
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a/secret.txt' } }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Read' }] } },
      { type: 'user', message: { content: 'Read' } }
    ]
  })
  const uses = toolUses(s, 'Read')
  assert.equal(uses.length, 1, 'a mention of the tool name in prose is not a use of the tool')
  assert.equal(uses[0].file_path, '/a/secret.txt')
})

test('handler invocations are counted apart from side notes', () => {
  const s = session({
    events: [
      { event: 'PreToolUse', kind: 'invocation' },
      { event: 'PreToolUse', kind: 'note', overran_ms: 26000 },
      { event: 'Stop', kind: 'invocation' }
    ]
  })
  assert.equal(handlerCalls(s, 'PreToolUse').length, 1,
    'a note recorded alongside an invocation must not inflate the count')
})

test('a search of the stream covers nested content', () => {
  assert.equal(streamHas(session({ stream: [{ a: { b: 'needle' } }] }), 'needle'), true)
  assert.equal(streamHas(session({ stream: [{ a: 'hay' }] }), 'needle'), false)
})

test('a run where nothing could be established does not exit green', () => {
  const results = [
    { id: 'F1a', status: UNAVAILABLE },
    { id: 'F5', status: UNAVAILABLE },
    { id: 'F8', status: PASS }
  ]
  const verdict = verdictOf(results, { selfContained: ['F2', 'F8'] })
  assert.equal(verdict.nothingEstablished, true)
  assert.equal(verdict.ok, false, 'a run that established nothing must not read like a run that established everything')
})

test('a bench error is not counted as held and is not green', () => {
  const verdict = verdictOf([{ id: 'F5', status: BENCH_ERROR }, { id: 'F1a', status: PASS }],
    { selfContained: [] })
  assert.equal(verdict.held, 1)
  assert.equal(verdict.benchErrors, 1)
  assert.equal(verdict.ok, false)
})

test('a required probe that did not hold turns the run red', () => {
  const results = [{ id: 'F8', status: UNAVAILABLE }, { id: 'F1a', status: PASS }]
  const verdict = verdictOf(results, { required: ['F8'], selfContained: ['F8'] })
  assert.deepEqual(verdict.missing, ['F8'])
  assert.equal(verdict.ok, false)
})

test('an ordinary run with every probe held is green', () => {
  const verdict = verdictOf([{ id: 'F1a', status: PASS }, { id: 'F8', status: PASS }],
    { required: ['F8'], selfContained: ['F8'] })
  assert.equal(verdict.ok, true, 'the floor must not refuse a run that actually held')
})
