'use strict'

// Writing the answer out.
//
// Standard output is a pipe whenever a handler is invoked, and writes to a pipe are
// asynchronous. Nothing here calls process.exit: ending the process the moment it has written
// loses whatever has not drained, and loses it intermittently. Measured on this repository, a
// two-hundred-thousand-character decision arrived cut off mid-string.

function emit ({ stdout = null, stderr = null, exitCode = 0 } = {}, io = process) {
  if (stderr) {
    const text = String(stderr)
    io.stderr.write(text.endsWith('\n') ? text : text + '\n')
  }
  if (stdout) {
    io.stdout.write(typeof stdout === 'string' ? stdout : JSON.stringify(stdout))
  }
  io.exitCode = exitCode
}

module.exports = { emit }
