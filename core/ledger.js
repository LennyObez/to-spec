'use strict'

// Whether the turn now ending actually changed anything.
//
// The finish gate needs to know, and the transcript cannot tell it: the harness documents
// that it may lag behind the conversation, so a gate reading it would sometimes see an empty
// turn whose files were already written. The record is therefore made where the writing
// happens, keyed on the turn identifier that every event of one turn was measured to share.
//
// The note is made before the decision to allow or refuse. A refused write is still an
// attempt to change the project.

const { updateState } = require('./state')

// The burden runs the other way round from the obvious design. A list of tools believed to
// write has to be complete and will not be: a shell command redirects into a file, a subagent
// edits on its own, a connected tool writes through a channel nobody enumerated, and each of
// those turns would end in silence. So this lists the tools proven to leave nothing behind,
// and everything else counts as having written. Wrong in this direction costs a check that
// finds nothing; wrong in the other, a project broken quietly.
const READING_TOOLS = [
  'Read', 'Grep', 'Glob', 'NotebookRead',
  'WebFetch', 'WebSearch', 'TodoWrite', 'ListMcpResources', 'ReadMcpResource'
]

function isWritingTool (toolName) {
  if (!toolName) return false
  return !READING_TOOLS.includes(toolName)
}

// Tool calls arrive in parallel, so several handlers reach for the note at once. Losing the
// contest would lose the record that the turn wrote, and the gate would then stay silent over
// a changed project. Only contention is retried: a note that cannot be written at all will not
// become writable by asking again, and spending the budget on it would end in a timeout, which
// renders no decision and lets the action through.
function recordTurn (projectDir, { promptId, toolName, deadline = null }) {
  const write = () => updateState(projectDir, (state) => {
    if (state.turn.prompt_id !== promptId) {
      state.turn = { prompt_id: promptId, wrote: false }
    }
    if (isWritingTool(toolName)) state.turn.wrote = true
  })

  let attempt = write()
  while (!attempt.written && /another handler/.test(attempt.why || '')) {
    if (!deadline || deadline.remaining < 500) break
    attempt = write()
  }
  return attempt
}

// Read back by the gate: the note must belong to the turn being judged, and that turn must
// have written.
function turnWrote (state, promptId) {
  return Boolean(state.turn && state.turn.prompt_id === promptId && state.turn.wrote)
}

// A continuation is the harness re-entering the same turn after a refusal. It often writes
// nothing, and judging it as an empty turn would let the work escape by standing still.
function inContinuation (state, promptId) {
  return Boolean(state.gate && state.gate.prompt_id === promptId)
}

module.exports = { READING_TOOLS, isWritingTool, recordTurn, turnWrote, inContinuation }
