'use strict'

// Where the project stands, written down rather than asked about.
//
// A person who has to ask "how is it going" gets an answer shaped by what the model happens
// to remember. This file is produced from the note the gate keeps, at every evaluation that
// armed, so the answer is the same whoever asks and whenever.
//
// Three rules govern what goes in it.
//
// It never says the work is finished, safe or correct. A guard can observe that it found
// nothing; it cannot observe that there is nothing to find, and the difference is the entire
// distance between a check and a promise.
//
// It always ends with something to do. A status that lists problems and stops leaves the
// person holding a list; one that names the next concrete action leaves them holding a step.
//
// It always names what was not looked at. A short list and a short look read identically
// otherwise, and the second is the one that hurts later.

const path = require('path')

// English, canonical, the same in every language. Only the name is fixed: a name that moved
// with the language would have to be resolved on every read, by the gate, by the session start
// and by the ignore file, and a change of language would leave the previous file orphaned. The
// content is drawn from the message catalogue, so a French session reads a French file rather
// than a heading in one language over a sentence in another.
const FILENAME = 'project-status.md'

function render (state, catalogue, { worksite = null, reportPath = null } = {}) {
  const outstanding = state.outstanding || { agent: [], user: [], unverifiable: [] }
  const lines = []

  // The first two lines are what the session start reads back. Everything below is for a
  // person who opened the file on purpose.
  lines.push(`# ${worksite || catalogue.get('status.title_default')}`)
  lines.push('')

  const agentCount = (outstanding.agent || []).length
  const userCount = (outstanding.user || []).length

  if (agentCount === 0 && userCount === 0) {
    lines.push(catalogue.get('status.all_clear'))
  } else if (agentCount > 0) {
    lines.push(catalogue.plural('gate.blocked', agentCount))
  } else {
    lines.push(catalogue.plural('gate.needs_you', userCount, { first: outstanding.user[0] }))
  }
  lines.push('')

  if (agentCount > 0) {
    lines.push(`## ${catalogue.get('status.can_do')}`)
    lines.push('')
    for (const id of outstanding.agent) lines.push(`- ${id}`)
    lines.push('')
  }

  if (userCount > 0) {
    lines.push(`## ${catalogue.get('status.need_you')}`)
    lines.push('')
    for (const id of outstanding.user) lines.push(`- ${id}`)
    lines.push('')
  }

  // Always present, even when empty, because its absence would read as "everything was
  // checked" and that is the one thing this file must never imply.
  lines.push(`## ${catalogue.get('status.not_checked')}`)
  lines.push('')
  const unverifiable = outstanding.unverifiable || []
  if (unverifiable.length === 0) {
    lines.push(catalogue.get('status.nothing_skipped'))
  } else {
    for (const id of unverifiable) lines.push(`- ${id}`)
  }
  lines.push('')

  if (reportPath) {
    lines.push(catalogue.get('status.full_report', { path: reportPath }))
    lines.push('')
  }

  return lines.join('\n')
}

// The first two lines, for the session start. Reading the whole file into a session would
// spend context on something the model can open when it needs it.
function summarise (contents) {
  return contents.split('\n').filter((line) => line.trim().length > 0).slice(0, 2)
}

function pathIn (projectDir) {
  return path.join(projectDir, FILENAME)
}

module.exports = { FILENAME, render, summarise, pathIn }
