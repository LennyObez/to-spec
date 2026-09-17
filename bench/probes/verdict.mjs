// The bench's decision vocabulary, and the pure functions that apply it.
//
// These live apart from the runner so that they can be exercised directly, with fabricated
// sessions, in milliseconds and without credentials. A rule about how to read a measurement
// is itself something that can be got wrong, and a rule nothing tests is a comment.

export const PASS = 'pass'
export const FAIL = 'fail'
export const UNAVAILABLE = 'unavailable'
// A fourth outcome, because a defect in the bench and a defect in the system under test send
// someone looking in different places. Counting the first as the second wastes an afternoon.
export const BENCH_ERROR = 'bench-error'

// Three different things get confused here if they are not kept apart.
//
// A measurement that was interrupted says nothing about behaviour. A session that never
// authenticated, or never loaded the plugin, could not run the probe. But a session that
// loaded the plugin and still invoked no handler is not an unavailable probe. It is the very
// defect this milestone exists to catch, and calling it unavailable would absorb it.
// The three that apply to any session, whatever is being measured through it.
export function unusableSession (s) {
  if (s.endedOnItsOwn === false) {
    // The tails of both channels are the only account of what the harness was blocked on,
    // so they travel with the verdict: a hang that prints its cause is one someone can fix.
    const account = [
      s.stderrTail ? `stderr said: ${s.stderrTail}` : null,
      s.danglingStdout ? `stdout left this outside the stream: ${s.danglingStdout}` : null
    ].filter(Boolean).join(' | ')
    // A hang on authentication reached neither model nor plugin, so it exercised nothing:
    // "could not run", not a broken bench. Narrow by design -- a plugin defect ends on its own.
    // Only unambiguous auth vocabulary diverts a hang; a bare "token"/"expired" is left out, as
    // it occurs in ordinary output and diverting on it would absorb a real defect.
    const authWall = /\b(log ?in|logged in|authenticat|unauthor|oauth|invalid[ _-]?(api[ _-]?key|token|credential))\b/i
    if (authWall.test(account)) {
      return { status: UNAVAILABLE, why: `the session could not authenticate, so nothing here ran. ${account}` }
    }
    return {
      status: BENCH_ERROR,
      detail: `the session did not end on its own (${s.endedWhy}); this run says nothing about the behaviour` +
        (account ? `. ${account}` : '')
    }
  }
  if (s.notLoggedIn) return { status: UNAVAILABLE, why: 'session not authenticated' }
  if (!s.pluginLoaded) {
    return { status: UNAVAILABLE, why: 'the plugin is absent from the session record, so nothing here was exercised' }
  }
  return null
}

export function unusable (s) {
  const shared = unusableSession(s)
  if (shared) return shared
  if (!s.events || s.events.length === 0) {
    return { status: FAIL, detail: 'the plugin loaded and not one handler was invoked' }
  }
  return null
}

// The channel probes read a vocabulary the harness owns: record types, field names. If that
// vocabulary changes, the honest report is "the shape of the stream changed", not a
// behavioural claim like "the message did not surface", which would be false and would send
// someone to fix a channel that still works.
export function shapeIntact (s) {
  if (!s.stream.some((e) => e.subtype === 'hook_response')) {
    return {
      status: BENCH_ERROR,
      detail: 'no hook-response record in the stream: the shape this probe reads has changed, so no behaviour is claimed'
    }
  }
  return null
}

// What the model actually asked for, read from its own messages rather than from a handler,
// so that a probe can tell "the tool was refused" from "the tool was never reached".
export function toolUses (s, name) {
  const found = []
  for (const e of s.stream) {
    if (e.type !== 'assistant' || !e.message || !Array.isArray(e.message.content)) continue
    for (const part of e.message.content) {
      if (part && part.type === 'tool_use' && part.name === name) found.push(part.input || {})
    }
  }
  return found
}

// Handler invocations are counted from the handler's own log, and only the records that are
// invocations. The event stream records some events twice, so a count taken there is a
// different number that looks like the right one.
export function handlerCalls (s, event) {
  return s.events.filter((e) => e.event === event && e.kind === 'invocation')
}

export function streamHas (s, needle) {
  return s.stream.some((e) => JSON.stringify(e).includes(needle))
}

// The floor that stops a run of nothing from reading like a run of everything.
export function verdictOf (results, { required = [], selfContained = [] } = {}) {
  const count = (status) => results.filter((r) => r.status === status).length
  const failures = count(FAIL)
  const benchErrors = count(BENCH_ERROR)
  const missing = required.filter((id) => !results.some((r) => r.id === id && r.status === PASS))
  const runtimeProbes = results.filter((r) => !selfContained.includes(r.id))
  const nothingEstablished = runtimeProbes.length > 0 &&
    runtimeProbes.every((r) => r.status === UNAVAILABLE)

  return {
    held: count(PASS),
    failures,
    unavailable: count(UNAVAILABLE),
    benchErrors,
    missing,
    nothingEstablished,
    ok: failures === 0 && benchErrors === 0 && missing.length === 0 && !nothingEstablished
  }
}
