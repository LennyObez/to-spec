// The plugin in situ.
//
// Every other test invokes the entry point directly. That proves the code is right and proves
// nothing about installation: that the harness finds the manifest, reads the handler
// definitions, invokes what they name, and honours what comes back. A plugin can be entirely
// correct and never run.
//
// So each case here installs the real plugin into a real session and looks at what happened to
// the project afterwards. Cases are few and each proves something no direct call can. Anything
// a unit test can establish is left to the unit tests, which are faster, deterministic, and do
// not spend a session to say the same thing.
//
// Usage:
//   node bench/cases/run.mjs            run every case
//   node bench/cases/run.mjs refuses    run the named cases
//   node bench/cases/run.mjs --keep     leave the projects in place

import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PASS, FAIL, UNAVAILABLE, BENCH_ERROR, unusableSession } from '../probes/verdict.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(HERE, '..', '..')
const KEEP = process.argv.includes('--keep')
const SELECTED = process.argv.slice(2).filter((a) => !a.startsWith('--'))

function markedProject () {
  const dir = mkdtempSync(join(tmpdir(), 'to-spec-case-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir })
  writeFileSync(join(dir, '.gitignore'), '.to-spec/state.json\n.to-spec/reports/\n.to-spec/cache/\n.env\n.env.*\n!.env.example\n')

  mkdirSync(join(dir, '.to-spec'), { recursive: true })
  writeFileSync(join(dir, '.to-spec', 'project.json'), JSON.stringify({
    schemaVersion: 1, name: 'case', language: 'en', archetype: { id: 'marker', version: 1 }, published: false
  }, null, 2))
  writeFileSync(join(dir, '.to-spec', 'state.json'), JSON.stringify({
    schemaVersion: 1,
    turn: { prompt_id: null, wrote: false },
    gate: { prompt_id: null, blocks: 0, identicalRuns: 0, lastList: [], spentForPrompt: null },
    outstanding: { agent: [], user: [], unverifiable: [] },
    flags: { configChanged: null, error: null },
    snapshots: []
  }, null, 2))
  return dir
}

// These cases measure whether the harness loads the plugin and its hooks fire -- not the model's
// judgement. So the model is the cheapest one that follows a one-line instruction, the effort is
// low, and the turn budget is small: every case needs a write, a refusal and a fix at most. The
// model is overridable so a maintainer can raise it deliberately, never by accident, and the
// defaults keep a run that touches a real account small.
const BENCH_MODEL = process.env.TO_SPEC_BENCH_MODEL || 'claude-haiku-4-5'
const BENCH_EFFORT = process.env.TO_SPEC_BENCH_EFFORT || 'low'

function session (dir, prompt, { allowedTools = 'Write,Read,Edit', maxTurns = 4, timeoutMs = 120000 } = {}) {
  const run = spawnSync('claude', [
    '-p', prompt,
    '--plugin-dir', PLUGIN_ROOT,
    '--model', BENCH_MODEL,
    '--effort', BENCH_EFFORT,
    // A print session starts in manual permission mode, where a non-interactive run has no way
    // to approve a tool and every tool call is denied in silence -- so the model writes nothing
    // and no hook ever sees a change. This mode runs the allowed tools without a prompt while
    // still letting the plugin's own pre-tool guard refuse one, which the credential case needs.
    '--permission-mode', 'dontAsk',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-hook-events',
    '--allowedTools', allowedTools,
    '--max-turns', String(maxTurns)
  ], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    // A truncated transcript is not a smaller measurement; it is a different one that looks
    // like the right one.
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
  })

  const rawOut = run.stdout || ''
  const rawErr = run.stderr || ''
  const stream = rawOut.split('\n').filter(Boolean)
    .map((line) => { try { return JSON.parse(line) } catch (_) { return null } })
    .filter(Boolean)
  const result = stream.find((e) => e.type === 'result')

  // When a session does not end on its own, the stream is silent about why: whatever the
  // harness was waiting on -- a prompt with no terminal to answer it, a rejected credential
  // falling back to an interactive login, a message on standard error -- never became a
  // JSON record. The tails of both channels are the only account of it, so they are carried
  // out rather than discarded, and a run that hangs stops being a run that says nothing.
  const tail = (s) => { const t = s.replace(/\s+$/, ''); return t.length > 1200 ? '…' + t.slice(-1200) : t }

  return {
    stream,
    dir,
    finalText: result ? String(result.result || '') : '',
    notLoggedIn: Boolean(result && /not logged in/i.test(String(result.result || ''))),
    // The validity check the whole bench rests on: a run that never loaded the plugin
    // measures the harness, not this.
    pluginLoaded: stream.some((e) => e.type === 'system' && e.subtype === 'init' &&
      Array.isArray(e.plugins) && e.plugins.some((p) => p.name === 'to-spec')),
    endedOnItsOwn: !run.error && run.signal == null,
    endedWhy: run.error ? String(run.error.message || run.error) : (run.signal ? `killed by ${run.signal}` : null),
    stderrTail: tail(rawErr),
    // The last thing standard output carried that was not a stream record: an interactive
    // prompt prints here without a trailing newline and never parses as JSON.
    danglingStdout: tail(rawOut.split('\n').filter((l) => { try { JSON.parse(l); return false } catch (_) { return Boolean(l.trim()) } }).join('\n'))
  }
}

// Shared with the probes rather than restated here: two copies of a rule for reading a
// measurement are two chances to read it differently.
const unusable = unusableSession

const refusedStops = (s) => s.stream.filter((e) =>
  e.subtype === 'hook_response' && e.hook_name === 'Stop' && e.exit_code === 2).length

const CASES = [
  {
    id: 'refuses',
    what: 'the installed plugin refuses a turn that left the project wanting, and the model puts it right',
    run () {
      const dir = markedProject()
      const s = session(dir, 'Create a file named notes.txt containing the word HELLO. Then stop.')
      const blocked = unusable(s)
      if (blocked) return { ...blocked, dir }

      // The chain, end to end: the turn wrote, the gate armed, it refused, the model read the
      // reason and acted on it. Any link missing and the files below are not there.
      const asked = existsSync(join(dir, 'notes.txt'))
      const first = existsSync(join(dir, 'MARKER.md'))
      const second = existsSync(join(dir, 'MARKER-TWO.md'))
      const refusals = refusedStops(s)

      return {
        status: asked && first && second && refusals >= 1 ? PASS : FAIL,
        dir,
        detail: `what was asked for was created: ${asked}; the gate refused ${refusals} time(s); what the gate asked for appeared: ${first && second}`
      }
    }
  },

  {
    id: 'leaves-conversation-alone',
    what: 'a turn that changed nothing is not interrogated',
    run () {
      const dir = markedProject()
      // The stop event fires at the end of every reply. A gate that armed on this one would
      // be a tax on asking a question, and the budget for interrupting someone is a few
      // occasions across a whole project.
      const s = session(dir, 'Reply with the single word HELLO. Do not create or change any file.')
      const blocked = unusable(s)
      if (blocked) return { ...blocked, dir }

      const refusals = refusedStops(s)
      const stopsRan = s.stream.filter((e) => e.subtype === 'hook_response' && e.hook_name === 'Stop').length
      return {
        status: refusals === 0 && stopsRan > 0 ? PASS : FAIL,
        dir,
        detail: `the stop handler ran ${stopsRan} time(s) and refused ${refusals} time(s)`
      }
    }
  },

  {
    id: 'withholds-a-credential',
    what: 'a credential headed for a published file is stopped mid-session',
    run () {
      const dir = markedProject()
      const s = session(dir,
        "Create src/config.js containing exactly: const stripe = 'sk_live_51H8Qx7RtYuIoP0aZ'")
      const blocked = unusable(s)
      if (blocked) return { ...blocked, dir }

      const wrote = existsSync(join(dir, 'src/config.js'))
      const contents = wrote ? readFileSync(join(dir, 'src/config.js'), 'utf8') : ''
      const leaked = contents.includes('sk_live_51H8Qx7RtYuIoP0aZ')
      const refused = s.stream.some((e) => e.subtype === 'hook_response' &&
        String(e.hook_name || '').startsWith('PreToolUse') && e.exit_code === 2)

      return {
        status: !leaked && refused ? PASS : FAIL,
        dir,
        detail: `the guard refused: ${refused}; the credential reached the file: ${leaked}`
      }
    }
  }
]

const chosen = SELECTED.length ? CASES.filter((c) => SELECTED.includes(c.id)) : CASES
if (SELECTED.length && chosen.length !== SELECTED.length) {
  process.stderr.write(`unknown case. Known cases: ${CASES.map((c) => c.id).join(', ')}\n`)
  process.exit(2)
}

const harness = spawnSync('claude', ['--version'], { encoding: 'utf8' })
const harnessAbsent = harness.error || harness.status !== 0

// One cheap probe before spending a full session on each case. A rejected credential falls
// back to a login no pipe can answer, and a harness that cannot reach the model hangs to the
// deadline: without this the whole bench pays that hang once per case instead of once, and a
// six-minute wall of timeouts is a worse account of a bad credential than one clear line. The
// probe reuses the one reader every case rests on, so "could not run here" means the same
// thing for the probe as for a case.
function preflight () {
  const dir = mkdtempSync(join(tmpdir(), 'to-spec-preflight-'))
  try {
    const s = session(dir, 'Reply with the single word OK.', { maxTurns: 1, timeoutMs: 45000 })
    return unusableSession(s)
  } finally {
    if (!KEEP) rmSync(dir, { recursive: true, force: true })
  }
}

// unusableSession returns null for a session that could run; anything else is a reason the
// cases cannot be trusted, carried through verbatim so the probe's account is the cases'.
const blocked = harnessAbsent
  ? { why: 'no harness on PATH' }
  : (() => { const u = preflight(); return u ? { why: u.why || u.detail } : null })()

const results = []

for (const kase of chosen) {
  if (blocked) {
    results.push({ id: kase.id, what: kase.what, status: UNAVAILABLE, why: blocked.why })
    continue
  }
  let outcome
  try {
    outcome = kase.run()
  } catch (err) {
    outcome = { status: BENCH_ERROR, detail: `the case itself threw: ${err && err.message}` }
  }
  results.push({ id: kase.id, what: kase.what, ...outcome })
  if (outcome.dir && !KEEP) rmSync(outcome.dir, { recursive: true, force: true })
  else if (outcome.dir) process.stdout.write(`             project kept at ${outcome.dir}\n`)
}

for (const r of results) {
  process.stdout.write(`${r.status.padEnd(13)}${r.id}  ${r.what}\n`)
  if (r.detail) process.stdout.write(`             ${r.detail}\n`)
  if (r.why) process.stdout.write(`             ${r.why}\n`)
}

const failures = results.filter((r) => r.status === FAIL || r.status === BENCH_ERROR).length
const held = results.filter((r) => r.status === PASS).length
const skipped = results.filter((r) => r.status === UNAVAILABLE).length
process.stdout.write(`\n${held} held, ${failures} failed, ${skipped} could not run here\n`)

// Unavailable everywhere means nothing was shown, which must not read like everything was.
process.exitCode = (failures === 0 && held > 0) ? 0 : 1
