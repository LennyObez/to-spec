'use strict'

// The finish gate, as a function of its inputs and nothing else.
//
// It is pure on purpose. Everything that touches a disk, a repository or a clock happens
// before it is called, and what it returns is a decision plus the note to write. That is what
// makes it testable against fabricated situations -- a turn that wrote, a turn that did not,
// the same complaint three times running -- without needing a session, a project, or luck.
//
// Two measured facts shape it, and one reasoned bound.
//
// Measured (probe F1c): the stop event fires at the end of *every* reply, not at the end of
// the work, so an unconditional gate would interrogate someone who asked what time it is. It
// arms only on turns that changed something, and it learns that from the turn ledger rather
// than the transcript, which the same probe showed may lag the conversation.
//
// Measured (probe F1a): refusing to stop works -- the model receives the reason and acts on
// it. That makes the reason the most valuable thing here, and the budget for it worth
// spending carefully.
//
// Reasoned, not measured: the harness caps consecutive refusals, and reaching that cap would
// hand the last word to the harness. The gate keeps its own, lower cap and steps aside while
// it can still explain itself. That the harness cap is higher than three is inferred from its
// documented behaviour, not observed in the evidence register, so the number below is chosen,
// not derived.

const PASS = 'pass'
const BLOCK = 'block'
const SOFT = 'soft'
const SILENT = 'silent'

// Chosen below the harness's own limit -- reasoned from its documented behaviour, not
// measured -- and low enough that a person notices being helped rather than argued with.
// Three attempts at the same list is the point where repeating stops being persistence.
const MAX_BLOCKS = 3
const MAX_IDENTICAL_RUNS = 3

// The reason is read by a model with a finite context, and a list of everything is a list of
// nothing. Ten items, worst first.
const MAX_ITEMS_IN_REASON = 10
const MAX_REASON_CHARS = 9000

function sortedIds (results) {
  return results.map((r) => r.id).sort()
}

function sameList (a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

// What could not be checked comes first. A person told "two things are missing" acts on it;
// a person told "two things are missing, and I could not look at four others" knows the
// difference between a short list and a short look.
function orderForReason (unavailable, failures) {
  return [...unavailable, ...failures].slice(0, MAX_ITEMS_IN_REASON)
}

function buildReason (items, reportPath, totalCount) {
  const lines = items.map((item) => {
    const detail = item.status === 'unavailable'
      ? `could not be checked: ${item.why || 'no reason given'}`
      : (item.findings || []).slice(0, 3)
          .map((f) => `${f.path ? f.path + ': ' : ''}${f.message}`)
          .join('; ')
    return `- ${item.id}: ${detail}`
  })

  const header = totalCount > items.length
    ? `${totalCount} things are outstanding; the ${items.length} that matter most:`
    : `${totalCount} thing${totalCount === 1 ? ' is' : 's are'} outstanding:`

  const tail = `\nThe full report is at ${reportPath}.`
  let reason = [header, ...lines].join('\n') + tail
  if (reason.length > MAX_REASON_CHARS) {
    reason = reason.slice(0, MAX_REASON_CHARS - tail.length - 1) + tail
  }
  return reason
}

// `results` are the verdicts of the standards that ran, already computed. Passing them in
// rather than running them here is what keeps this function pure, and it also lets a cached
// tree replay a previous verdict through exactly the same reasoning as a fresh one.
function evaluate ({
  payload = {},
  marked = false,
  state,
  results = [],
  categoryOf = () => 'agent-fixable',
  severityOf = () => 'block',
  reportPath = '.to-spec/reports/gate.json'
} = {}) {
  const promptId = payload.prompt_id || null
  const stopHookActive = payload.stop_hook_active === true

  const nextState = {
    turn: { ...state.turn },
    gate: { ...state.gate },
    outstanding: { agent: [], user: [], unverifiable: [] }
  }

  // Arming.
  //
  // A continuation of a turn this gate already refused stays armed even when the
  // continuation itself wrote nothing. Otherwise the way out of the gate would be to stop
  // writing, which is the opposite of what it is asking for.
  const wroteThisTurn = Boolean(state.turn && state.turn.prompt_id === promptId && state.turn.wrote)
  const ourContinuation = stopHookActive && state.gate && state.gate.prompt_id === promptId

  // Two conditions, and only two. Arming reads nothing but the turn ledger and the gate's own
  // record of its last decision, both of which the product writes on every turn. An invariant
  // enforces exactly that: a decision may not read a state field that nothing in the product
  // writes, so a condition can never be added here that no real project could ever satisfy.
  if (!marked || (!wroteThisTurn && !ourContinuation)) {
    return {
      verdict: SILENT,
      armed: false,
      why: !marked ? 'not a marked project' : 'this turn changed nothing',
      nextState: null
    }
  }

  // The release belongs to the turn, not to the counters. Once the way out has been taken for
  // this prompt, the turn continues and stops again on the same prompt, and re-running the
  // budget would refuse it afresh: the counters were just reset, so the turn would be blocked
  // twice, nudged, blocked twice more, without end. So a stop that carries the prompt already
  // let go stands down in silence. The mark clears itself, because the next turn carries a
  // different prompt and never matches.
  if (state.gate && state.gate.spentForPrompt === promptId) {
    return {
      verdict: SILENT,
      armed: false,
      why: 'the budget for this turn was already spent and the turn was let go',
      nextState: null
    }
  }

  // What the standards said.
  const unavailable = results.filter((r) => r.status === 'unavailable')
  const failures = results.filter((r) => r.status === 'fail')

  // Triage.
  //
  // Two questions, not one, and both have to be asked. *Who* can resolve this decides where
  // it is surfaced; *how hard it is declared* decides whether it may hold the turn. A
  // standard the agent could fix but which is only declared worth reporting must not stop
  // anyone. Otherwise the four severities in the model would be four names for one
  // behaviour, and declaring one would mean nothing.
  const byCategory = { 'agent-fixable': [], 'user-required': [], 'unverifiable-here': [] }
  const holdsTheTurn = (id) => categoryOf(id) === 'agent-fixable' && severityOf(id) === 'block'

  const place = (result) => {
    if (holdsTheTurn(result.id)) return byCategory['agent-fixable'].push(result)
    if (categoryOf(result.id) === 'user-required') return byCategory['user-required'].push(result)
    return byCategory['unverifiable-here'].push(result)
  }

  for (const failure of failures) place(failure)

  // A check that could not run is not a passing check. It becomes the agent's problem when
  // the agent could plausibly resolve it, and is announced otherwise; either way it is named.
  for (const missing of unavailable) place(missing)

  nextState.outstanding = {
    agent: sortedIds(byCategory['agent-fixable']),
    user: sortedIds(byCategory['user-required']),
    unverifiable: sortedIds(byCategory['unverifiable-here'])
  }

  const blocking = byCategory['agent-fixable']
  const list = sortedIds(blocking)

  // Progress, within this turn. The same list repeated across two different prompts is two
  // turns each facing the same problem, not one turn arguing twice, so the count only carries
  // within a prompt -- the same scoping the refusal budget uses just below.
  const sameTurn = state.gate.prompt_id === promptId
  const runsOnSameList = sameTurn && sameList(list, state.gate.lastList) ? (state.gate.identicalRuns || 0) + 1 : 1
  nextState.gate.lastList = list
  nextState.gate.identicalRuns = runsOnSameList
  nextState.gate.prompt_id = promptId

  if (list.length === 0) {
    nextState.gate.blocks = 0
    nextState.gate.identicalRuns = 0
    return {
      verdict: PASS,
      armed: true,
      outstanding: nextState.outstanding,
      // Never "finished": what a person gets is something to do and an explicit list of what
      // was not looked at. A positive verdict is the one thing a gate cannot earn.
      unverifiable: nextState.outstanding.unverifiable,
      needsPerson: nextState.outstanding.user,
      nextState
    }
  }

  // The refusal budget belongs to the turn. A turn abandoned mid-block leaves a spent count on
  // disk, and reading it on a different prompt would dock the next turn's budget for a refusal
  // it never received. So a change of prompt starts the count fresh; only a continuation of the
  // same prompt inherits it.
  const blocksSoFar = state.gate.prompt_id === promptId ? (state.gate.blocks || 0) : 0
  const mayBlock = blocksSoFar < MAX_BLOCKS && runsOnSameList < MAX_IDENTICAL_RUNS

  const items = orderForReason(
    blocking.filter((r) => r.status === 'unavailable'),
    blocking.filter((r) => r.status === 'fail'))
  const reason = buildReason(items, reportPath, blocking.length)

  if (mayBlock) {
    nextState.gate.blocks = blocksSoFar + 1
    return {
      verdict: BLOCK,
      armed: true,
      reason,
      count: blocking.length,
      outstanding: nextState.outstanding,
      nextState
    }
  }

  // The way out.
  //
  // Same complaint three times, or three refusals already spent. Repeating a fourth time
  // would be arguing, and the harness would end it for us anyway. The turn is let go with
  // the list intact, so that the next one starts from what is actually outstanding.
  nextState.gate.blocks = 0
  nextState.gate.identicalRuns = 0
  nextState.gate.spentForPrompt = promptId
  return {
    verdict: SOFT,
    armed: true,
    reason,
    count: blocking.length,
    // Two different situations, and a person told the wrong one is being misled about what
    // just happened: stuck means the work is not moving, spent means it moved and the budget
    // for asking ran out.
    exhausted: runsOnSameList >= MAX_IDENTICAL_RUNS ? 'stuck' : 'spent',
    outstanding: nextState.outstanding,
    nextState
  }
}

module.exports = {
  PASS,
  BLOCK,
  SOFT,
  SILENT,
  MAX_BLOCKS,
  MAX_IDENTICAL_RUNS,
  MAX_ITEMS_IN_REASON,
  MAX_REASON_CHARS,
  evaluate,
  buildReason,
  sameList
}
