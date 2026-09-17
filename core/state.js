'use strict'

// The two files a marked project carries, and the only code that writes them.
//
// `project.json` is the decision record: what this project is, what was chosen for it, what
// was answered. It is tracked, it changes rarely, and a person may read it.
//
// `state.json` is the working note: what happened this turn, what the gate saw last time,
// what is outstanding. It is ignored by version control, it changes constantly, and nobody
// should ever have to read it -- what a person reads is written out of it, elsewhere.
//
// Handlers for different events can run at the same moment, so every write takes a lock and
// lands atomically. A half-written state file would be worse than none: it parses as
// nothing, and the code that reads it would start again from a blank slate in the middle of
// a turn, silently forgetting that the turn had written.

const fs = require('fs')
const path = require('path')

const DIR = '.to-spec'
const PROJECT_FILE = 'project.json'
const STATE_FILE = 'state.json'
const LOCK_FILE = '.lock'

const SCHEMA_VERSION = 1

// Long enough to outlast a slow disk, short enough that a crashed handler does not wedge the
// next turn. A lock older than this is treated as debris rather than as an owner.
const LOCK_STALE_MS = 10000
const LOCK_ATTEMPTS = 20
const LOCK_WAIT_MS = 50

function toSpecDir (projectDir) {
  return path.join(projectDir, DIR)
}

// Only the fields this milestone reads or writes. A reserved placeholder for a later phase is
// a field nobody reads, which the plugin's own rule forbids; each returns with its consumer. An
// invariant asserts every key here is read or written somewhere in the runtime.
const emptyState = () => ({
  schemaVersion: SCHEMA_VERSION,
  turn: { prompt_id: null, wrote: false },
  gate: { prompt_id: null, blocks: 0, identicalRuns: 0, lastList: [], spentForPrompt: null },
  outstanding: { agent: [], user: [], unverifiable: [] },
  flags: { configChanged: null, error: null },
  // How many times a write to a given path has been refused this project, so a guard that keeps
  // refusing the same file hands the decision to the person rather than looping against them.
  refusals: {},
  snapshots: []
})

// Distinguishes a file that is not there from one that is there and will not parse. The second
// is corruption, not absence, and must not be read as a blank slate: the caller says so, and
// a damaged file is moved aside rather than overwritten so a person can recover it.
function readJsonFile (file) {
  try {
    let raw = fs.readFileSync(file, 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    return { value: JSON.parse(raw), status: 'ok' }
  } catch (err) {
    if (err.code === 'ENOENT') return { value: null, status: 'absent' }
    return { value: null, status: 'unreadable', why: err.message }
  }
}

// A project is "marked" when this file exists. Everywhere else the plugin does nothing at
// all, which is what keeps it from being a nuisance in every other directory on the machine.
function readProject (projectDir) {
  return readJsonFile(path.join(toSpecDir(projectDir), PROJECT_FILE)).value
}

function isMarked (projectDir) {
  return readProject(projectDir) !== null
}

function readState (projectDir) {
  const file = path.join(toSpecDir(projectDir), STATE_FILE)
  const read = readJsonFile(file)

  // A file that is there but will not parse is corruption, not a blank slate. Reading it as
  // empty and letting the next write overwrite it would erase whatever might be recovered and
  // forget silently that the turn had written. The damaged file is moved aside and the error
  // recorded, so the fresh state carries a flag the handler can act on rather than nothing.
  if (read.status === 'unreadable') {
    try { fs.renameSync(file, `${file}.corrupt`) } catch (_) { /* best effort; the flag still stands */ }
    const fresh = emptyState()
    fresh.flags.error = `the previous state file could not be read (${read.why}); it was moved aside`
    return fresh
  }
  if (!read.value) return emptyState()

  // Merge over a fresh shape so that a file written by an older version is missing keys rather
  // than crashing the reader. A handler that throws lets the action through.
  const found = read.value
  return { ...emptyState(), ...found, turn: { ...emptyState().turn, ...(found.turn || {}) }, gate: { ...emptyState().gate, ...(found.gate || {}) }, flags: { ...emptyState().flags, ...(found.flags || {}) }, outstanding: { ...emptyState().outstanding, ...(found.outstanding || {}) } }
}

function writeAtomic (file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // A distinct temporary name per process, so two handlers writing at once cannot truncate
  // each other's temporary file before either rename happens.
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, contents)
  fs.renameSync(temp, file)
}

function acquireLock (projectDir) {
  const lock = path.join(toSpecDir(projectDir), LOCK_FILE)
  fs.mkdirSync(path.dirname(lock), { recursive: true })

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' })
      return lock
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      let age = 0
      try {
        age = Date.now() - fs.statSync(lock).mtimeMs
      } catch (_) {
        continue // it vanished between the failure and the check; try again immediately
      }
      if (age > LOCK_STALE_MS) {
        try { fs.unlinkSync(lock) } catch (_) { /* someone else got there first */ }
        continue
      }
      // Synchronous by design: a handler has one job and a deadline, and yielding to the event
      // loop here would mean returning to the harness without a decision. But a spin loop would
      // burn a core for the wait; Atomics.wait blocks this thread without spinning, timing out
      // after the interval because the value it waits on never changes.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_WAIT_MS)
    }
  }
  return null
}

function releaseLock (lock) {
  if (!lock) return
  try { fs.unlinkSync(lock) } catch (_) { /* already gone */ }
}

// Read, change, write, under one lock. The mutator is given the current state and returns
// nothing; whatever it changed is what gets written.
//
// If the lock cannot be taken the change is dropped rather than forced, and the caller is
// told. Losing one note is recoverable; two handlers interleaving their writes is not.
function updateState (projectDir, mutate) {
  let lock = null
  try {
    lock = acquireLock(projectDir)
  } catch (err) {
    // A read-only volume, a missing directory, a permission the session does not have. The
    // caller decides what an unwritable note means for its own decision; throwing from here
    // would let the failure escape and take the decision with it.
    return { written: false, why: `the note could not be locked: ${err.message}` }
  }
  if (!lock) return { written: false, why: 'another handler holds the note' }

  try {
    const state = readState(projectDir)
    mutate(state)
    writeAtomic(path.join(toSpecDir(projectDir), STATE_FILE), JSON.stringify(state, null, 2) + '\n')
    return { written: true, state }
  } catch (err) {
    return { written: false, why: `the note could not be written: ${err.message}` }
  } finally {
    releaseLock(lock)
  }
}

function writeProject (projectDir, project) {
  writeAtomic(
    path.join(toSpecDir(projectDir), PROJECT_FILE),
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...project }, null, 2) + '\n')
}

module.exports = {
  DIR,
  SCHEMA_VERSION,
  LOCK_STALE_MS,
  toSpecDir,
  emptyState,
  isMarked,
  readProject,
  writeProject,
  readState,
  updateState,
  writeAtomic
}
