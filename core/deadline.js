'use strict'

// A budget the handler enforces on itself, shorter than the one it was given.
//
// A probe measured what happens when a pre-tool handler overruns its declared timeout: the
// harness reports it cancelled and the action proceeds. The failure is open by construction,
// and nothing inside the handler can change that after the fact.
//
// What can change is arriving at a conclusion first. The handler runs against a clock set
// below the declared timeout, and it will not START a check it cannot finish and report
// within the budget: `attempt` reserves time for the answer and stands the check down as
// unavailable when the reserve is all that is left. A synchronous check already running
// cannot be interrupted -- this process is single-threaded -- so a long-running check is
// expected to consult `ctx.timeLeft()` and stop itself; the reserve is the floor, not a way
// to abort work in flight. Refusing on the grounds of not knowing is a defensible answer;
// being timed out into silence is not an answer at all.

// Declared timeouts live in hooks.json. These are the internal budgets, chosen well below
// them so that a handler still has room to write its note and its answer after the checks
// have given up.
const BUDGETS = {
  SessionStart: 15000,
  PreToolUse: 12000,
  Stop: 240000,
  ConfigChange: 15000
}

const DEFAULT_BUDGET = 10000

function budgetFor (event) {
  return BUDGETS[event] || DEFAULT_BUDGET
}

class Deadline {
  constructor (event, budgetMs, now) {
    this.event = event
    this.budgetMs = budgetMs
    this.startedAt = now()
    this.now = now
  }

  get elapsed () {
    return this.now() - this.startedAt
  }

  get remaining () {
    return Math.max(0, this.budgetMs - this.elapsed)
  }

  get expired () {
    return this.remaining === 0
  }

  // Run a piece of work only if there is time to hear the answer. The point is not to
  // interrupt work in flight -- a synchronous check cannot be interrupted -- but to refuse
  // to start what cannot finish, so that the remaining budget goes to reporting instead.
  attempt (label, work, { needsMs = 0 } = {}) {
    if (this.remaining <= needsMs) {
      return { status: 'unavailable', label, why: `no time left to run ${label} within this turn's budget` }
    }
    return { status: 'ran', label, value: work() }
  }
}

function start (event, { now = Date.now, budgetMs = null } = {}) {
  return new Deadline(event, budgetMs === null ? budgetFor(event) : budgetMs, now)
}

module.exports = { BUDGETS, DEFAULT_BUDGET, budgetFor, start, Deadline }
