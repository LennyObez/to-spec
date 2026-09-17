'use strict'

// The second fixture standard. Identical in shape to the first and pointed at a different
// file, because what it demonstrates is not a check but a property of the design: a standard
// is a directory, and adding one touches no code that runs.

const FILE = 'MARKER-TWO.md'
const TOKEN = 'MARKER'

module.exports = function check (input, ctx) {
  if (!ctx.exists(FILE)) {
    return {
      findings: [{ path: FILE, message: `${FILE} is missing from the project root` }],
      facts: { secondMarkerPresent: false }
    }
  }

  let contents
  try {
    contents = ctx.read(FILE)
  } catch (err) {
    return { status: 'unavailable', why: `${FILE} exists but could not be read: ${err.message}` }
  }

  const holds = contents.split(/\r?\n/).some((line) => line.trim() === TOKEN)
  return holds
    ? { findings: [], facts: { secondMarkerPresent: true } }
    : {
        findings: [{ path: FILE, message: `${FILE} does not carry ${TOKEN} on a line of its own` }],
        facts: { secondMarkerPresent: false }
      }
}
