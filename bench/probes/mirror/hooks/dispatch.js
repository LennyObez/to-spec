'use strict'

// Phase 0a probe dispatcher.
//
// It does two things and nothing else: it records every hook payload it receives, and it
// emits the response a control file asks for. Behaviour is driven by that file rather than
// by hooks.json, so the handler definitions stay byte-stable across probes -- which a second
// harness will require, since it grants trust against the hash of a definition, and which
// keeps this file honest here.
//
// CommonJS, native modules only, exec form, no shell. It must never throw: an unhandled
// error in a hook is a silent gate failure, which is the exact defect this plugin exists
// to prevent.

const fs = require('fs')
const path = require('path')

const EVENT = process.argv[2] || 'unknown'
const PROBE_DIR = process.env.TO_SPEC_PROBE_DIR || ''

function readStdin () {
  try {
    return fs.readFileSync(0, 'utf8')
  } catch (_) {
    return ''
  }
}

function record (entry) {
  if (!PROBE_DIR) return
  try {
    fs.mkdirSync(PROBE_DIR, { recursive: true })
    fs.appendFileSync(path.join(PROBE_DIR, 'events.jsonl'), JSON.stringify(entry) + '\n')
  } catch (_) {
    // Recording is best effort. Losing a line must never change the hook's decision.
  }
}

function control () {
  if (!PROBE_DIR) return {}
  try {
    const raw = fs.readFileSync(path.join(PROBE_DIR, 'control.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return (parsed && parsed[EVENT]) || {}
  } catch (_) {
    return {}
  }
}

// A probe that blocks unconditionally loops until the runtime's own cap stops it, which
// measures the cap rather than the contract. `blockOnce` fires on the first pass and steps
// aside afterwards, so the observation is "the turn continued", not "the turn was capped".
function alreadyFired (name) {
  if (!PROBE_DIR) return false
  const flag = path.join(PROBE_DIR, 'fired-' + name)
  try {
    fs.writeFileSync(flag, '', { flag: 'wx' })
    return false
  } catch (_) {
    return true
  }
}

// Probe F9: can a session-start handler install a permission rule that binds the session it
// is starting? The merge has to preserve whatever the project already declared -- a guard
// that silently overwrites a user's settings is worse than no guard.
function writeProjectDeny (projectDir) {
  const target = path.join(projectDir, '.claude', 'settings.json')
  let existing = {}
  try {
    existing = JSON.parse(fs.readFileSync(target, 'utf8'))
  } catch (_) {
    existing = {}
  }
  const permissions = existing.permissions && typeof existing.permissions === 'object'
    ? existing.permissions
    : {}
  const deny = Array.isArray(permissions.deny) ? permissions.deny.slice() : []
  const rule = 'Read(./secret.txt)'
  if (!deny.includes(rule)) deny.push(rule)
  const next = { ...existing, permissions: { ...permissions, deny } }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = target + '.to-spec-tmp'
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n')
  fs.renameSync(tmp, target)
  return { target, rule, preserved: Object.keys(existing) }
}

function main () {
  const raw = readStdin()
  let payload = null
  try {
    payload = JSON.parse(raw)
  } catch (_) {
    payload = null
  }

  let cfg = control()
  const suppressed = cfg.blockOnce === true && alreadyFired(EVENT)
  if (suppressed) cfg = { mode: 'silent-after-block', exit: 0 }

  let settingsWrite = null
  if (cfg.writeSettings === true) {
    const dir = (payload && payload.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd()
    try {
      settingsWrite = writeProjectDeny(dir)
    } catch (err) {
      settingsWrite = { error: String(err && err.message || err) }
    }
  }

  record({
    at: new Date().toISOString(),
    // One record per invocation carries this; side notes carry something else, so a count
    // of invocations stays a count of invocations however many notes are added later.
    kind: 'invocation',
    event: EVENT,
    argv_event: process.argv[2] || null,
    parsed: payload !== null,
    raw_bytes: Buffer.byteLength(raw, 'utf8'),
    payload,
    plugin_root: process.env.CLAUDE_PLUGIN_ROOT || null,
    plugin_data: process.env.CLAUDE_PLUGIN_DATA || null,
    project_dir: process.env.CLAUDE_PROJECT_DIR || null,
    cwd: process.cwd(),
    platform: process.platform,
    node: process.version,
    mode: cfg.mode || 'silent',
    suppressed,
    stop_hook_active: payload && payload.stop_hook_active === true,
    settings_write: settingsWrite
  })

  // Probe F6: a handler that overruns its declared timeout renders no decision. Busy-wait
  // rather than sleep, so the process is unmistakably alive when the runtime gives up on it.
  if (Number.isInteger(cfg.sleepMs) && cfg.sleepMs > 0) {
    const until = Date.now() + cfg.sleepMs
    while (Date.now() < until) { /* hold the process */ }
    record({ at: new Date().toISOString(), kind: 'note', event: EVENT, overran_ms: cfg.sleepMs })
  }

  if (cfg.stderr) process.stderr.write(String(cfg.stderr) + '\n')
  if (cfg.stdoutText) process.stdout.write(String(cfg.stdoutText) + '\n')

  if (cfg.json) {
    process.stdout.write(JSON.stringify(cfg.json))
  }

  // Never `process.exit()` here. When standard output is a pipe -- which is exactly how a
  // handler is invoked -- writes are asynchronous, and exiting truncates whatever has not
  // drained. A decision cut in half is not a decision, and the loss is intermittent, which
  // is the worst way for it to be wrong. Setting the code and returning lets the loop drain
  // and the process end on its own.
  process.exitCode = Number.isInteger(cfg.exit) ? cfg.exit : 0
}

try {
  main()
} catch (err) {
  // Fail open, recorded where it can be found, silent to the session.
  record({ at: new Date().toISOString(), kind: 'note', event: EVENT, crash: String(err && err.stack || err) })
  process.exitCode = 0
}
