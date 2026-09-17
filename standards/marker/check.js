'use strict'

// The fixture standard.
//
// It exists so that the gate, the canary and the bench have something with a known answer to
// run against, and so that the shape of a check is demonstrated by one that works rather
// than described in prose. It deliberately depends on nothing: no tool, no network, no
// version. A fixture that can be unavailable cannot be used to tell a working gate from a
// broken one.

const FILE = 'MARKER.md'
const TOKEN = 'MARKER'

module.exports = function check (input, ctx) {
  if (!ctx.exists(FILE)) {
    return {
      findings: [{ path: FILE, message: `${FILE} is missing from the project root` }],
      facts: { markerPresent: false }
    }
  }

  let contents
  try {
    contents = ctx.read(FILE)
  } catch (err) {
    // Present but unreadable is not the same as absent, and reporting it as absent would
    // send someone to create a file that already exists.
    return {
      status: 'unavailable',
      why: `${FILE} exists but could not be read: ${err.message}`
    }
  }

  const holds = contents.split(/\r?\n/).some((line) => line.trim() === TOKEN)
  if (!holds) {
    return {
      findings: [{ path: FILE, message: `${FILE} does not carry ${TOKEN} on a line of its own` }],
      facts: { markerPresent: false }
    }
  }

  return { findings: [], facts: { markerPresent: true } }
}
