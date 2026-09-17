'use strict'

// The one entry point every handler definition names.
//
// It stays deliberately thin: read the payload, ask the harness layer what to do, say it.
// Everything that could go wrong is caught here, because a handler that throws renders no
// decision at all, and an action that proceeds because nobody objected looks exactly like an
// action that was approved.
//
// CommonJS with relative requires rather than a bundle. The plugin ships as a directory and
// the runtime loads it from there, so a bundle would add a build step, a second copy of every
// line, and a way for the two to disagree, in exchange for nothing the directory does not
// already give. A test asserts that nothing reachable from here loads anything but the
// runtime's own modules, which is the guarantee the bundle was standing in for.

const path = require('path')

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..')
const EVENT = process.argv[2] || 'unknown'

function readStdin () {
  try {
    return require('fs').readFileSync(0, 'utf8')
  } catch (err) {
    // Empty input is normal: the harness sometimes invokes a handler with nothing on stdin,
    // and an empty payload is a legitimate "nothing to decide". A genuine read error is not
    // that -- it is a fault worth a trace -- so it propagates to the top-level catch, which
    // records it to the error log while still failing open, rather than vanishing as "".
    if (err.code === 'ENOENT' || err.code === 'EOF' || err.code === 'EAGAIN') return ''
    throw err
  }
}

// One command, one answer, no shell. Arguments travel in a vector so that nothing in a path
// or a filename is ever interpreted, on any platform.
//
// The directory is supplied by the caller rather than read from the environment. The guards
// reason about a particular project, and an answer from a different repository is worse than
// no answer: it is a confident one about the wrong thing.
function gitIn (cwd) {
  return function git (args, env) {
    const { spawnSync } = require('child_process')
    const run = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 5000
    })
    return {
      status: run.error ? 127 : (run.status === null ? 124 : run.status),
      stdout: run.stdout || '',
      stderr: run.stderr || ''
    }
  }
}

function main () {
  const raw = readStdin()
  let payload = {}
  try {
    payload = JSON.parse(raw)
  } catch (_) {
    // An unreadable payload is not a reason to block: it says nothing about the action, and
    // refusing on it would refuse everything the day a field changes shape.
    payload = {}
  }

  const harness = require('../harness/claude-code')
  const answer = harness.handle(EVENT, payload, { pluginRoot: PLUGIN_ROOT, gitIn })

  const io = require('./io')
  io.emit(answer)
}

try {
  main()
} catch (err) {
  // Fail open, and leave a trace where someone will find it. The alternative, refusing
  // because the plugin is broken, turns a defect in the guard into a project nobody can work
  // on, which is how a guard gets removed rather than repaired.
  try {
    const fs = require('fs')
    const dir = process.env.CLAUDE_PROJECT_DIR
      ? path.join(process.env.CLAUDE_PROJECT_DIR, '.to-spec', 'reports')
      : null
    if (dir) {
      fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(path.join(dir, 'error.log'),
        `${new Date().toISOString()} ${EVENT} ${err && err.stack ? err.stack : err}\n`)
    }
  } catch (_) { /* nowhere to write it; the exit code below is what matters */ }
  process.exitCode = 0
}
