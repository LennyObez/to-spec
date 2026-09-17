// The self-imposed budget, at the edge where it decides whether to start work.
//
// A probe established that a handler which overruns its declared timeout is cancelled and the
// action proceeds. The only defence is to refuse to start what cannot finish and be reported,
// so `attempt` reserves time for the answer. These pin that behaviour, since the whole point
// is a decision rendered in time rather than none at all.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const deadline = require(join(ROOT, 'core/deadline.js'))

// A clock the test drives by hand, so nothing here depends on wall time.
function fakeClock (start) {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}

test('a check with room to finish and be reported is run', () => {
  const clock = fakeClock(1000)
  const dl = deadline.start('Stop', { now: clock.now, budgetMs: 10000 })
  let ran = false
  const out = dl.attempt('x', () => { ran = true; return 'value' }, { needsMs: 3000 })
  assert.equal(out.status, 'ran')
  assert.equal(out.value, 'value')
  assert.ok(ran)
})

test('a check that would leave no time to report is stood down, not started', () => {
  const clock = fakeClock(1000)
  const dl = deadline.start('Stop', { now: clock.now, budgetMs: 10000 })
  clock.advance(8000) // 2000 ms left, less than the 3000 ms reserve
  let ran = false
  const out = dl.attempt('x', () => { ran = true }, { needsMs: 3000 })
  assert.equal(out.status, 'unavailable')
  assert.equal(ran, false, 'the work must not start when there is no time to hear its answer')
  assert.match(out.why, /no time left/)
})

test('remaining never goes negative, and expired is reached exactly at the budget', () => {
  const clock = fakeClock(0)
  const dl = deadline.start('PreToolUse', { now: clock.now, budgetMs: 100 })
  assert.equal(dl.remaining, 100)
  clock.advance(100)
  assert.equal(dl.remaining, 0)
  assert.equal(dl.expired, true)
  clock.advance(50)
  assert.equal(dl.remaining, 0, 'overrun clamps to zero rather than a negative budget')
})

test('every instrumented event has a budget below its declared hook timeout', () => {
  // hooks.json declares the outer timeout in seconds; the internal budget must sit under it,
  // with room to write the answer, or the self-imposed deadline is not self-imposed at all.
  const hooks = require(join(ROOT, 'hooks/hooks.json'))
  for (const [event, groups] of Object.entries(hooks.hooks)) {
    const declaredSec = Math.max(...groups.flatMap((g) => g.hooks.map((h) => h.timeout || 0)))
    const budgetMs = deadline.budgetFor(event)
    assert.ok(budgetMs < declaredSec * 1000,
      `${event}: internal budget ${budgetMs}ms is not below the declared ${declaredSec}s`)
  }
})
