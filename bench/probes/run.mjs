// Phase 0a probe bench.
//
// Every behaviour this plugin relies on is measured here against the running harness, not
// read from a document. Each probe is isolated: its own project directory, its own control
// file, its own session. Nothing is shared between probes except the dispatcher under test.
//
// Three outcomes, never two. `unavailable` is reserved for "the probe could not run here"
// -- no harness on PATH, no credentials, wrong platform. It never means "no check exists",
// and it is never rendered as a pass.
//
// Usage:
//   node bench/probes/run.mjs                 run every probe
//   node bench/probes/run.mjs F1a F6          run the named probes
//   node bench/probes/run.mjs --keep          leave the working directories in place

import { execFileSync, spawnSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PASS, FAIL, UNAVAILABLE, BENCH_ERROR,
  unusable, shapeIntact, toolUses, handlerCalls, streamHas, verdictOf
} from './verdict.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(HERE, '..', '..')

// Sessions are driven through the mirror, not through the real plugin. These probes ask what
// the harness does: which channel reaches whom, what a refusal costs, whether an overrun is
// heard. An answer that depended on this plugin's own judgement would be measuring the
// judgement instead of the surface it stands on. The real plugin is measured by its tests,
// which need no session at all.
const MIRROR_ROOT = join(HERE, 'mirror')
const MIRROR_NAME = 'to-spec-mirror'
const KEEP = process.argv.includes('--keep')
const SELECTED = process.argv.slice(2).filter((a) => !a.startsWith('--'))

// Driving a session.

function harnessAvailable () {
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' })
  if (git.error || git.status !== 0) {
    return { ok: false, why: 'no version control on PATH, and every probe workspace is a repository' }
  }
  const probe = spawnSync('claude', ['--version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) return { ok: false, why: 'no harness on PATH' }
  return { ok: true, version: (probe.stdout || '').trim() }
}

function newWorkspace (id) {
  const dir = mkdtempSync(join(tmpdir(), `to-spec-${id}-`))
  mkdirSync(join(dir, 'project'), { recursive: true })
  mkdirSync(join(dir, 'log'), { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: join(dir, 'project') })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: join(dir, 'project') })
  return dir
}

// A session is one measurement. Its transcript, its handler log and its files are the only
// evidence a probe may reason about; nothing is inferred from a previous run.
function session (ws, { prompt, control, allowedTools, extraArgs = [] }) {
  const log = join(ws, 'log')
  const project = join(ws, 'project')
  writeFileSync(join(log, 'control.json'), JSON.stringify(control, null, 2))

  const args = [
    '-p', prompt,
    '--plugin-dir', MIRROR_ROOT,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-hook-events',
    '--max-turns', '10',
    ...extraArgs
  ]
  if (allowedTools) args.push('--allowedTools', allowedTools)

  const run = spawnSync('claude', args, {
    cwd: project,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300000,
    // The default buffer is a megabyte, and a multi-turn transcript passes it easily. A
    // truncated transcript is not a smaller measurement, it is a different one that looks
    // like the right one, the same law this repository established by measuring it on the
    // handler's own output.
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, TO_SPEC_PROBE_DIR: log }
  })

  // A buffer overrun is reported by the platform, not guessed at from a short transcript.
  const overran = Boolean(run.error && /maxBuffer/i.test(String(run.error.message || '')))

  writeFileSync(join(log, 'stream.jsonl'), run.stdout || '')
  writeFileSync(join(log, 'stderr.txt'), run.stderr || '')

  const stream = (run.stdout || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line) } catch (_) { return null } })
    .filter(Boolean)

  const eventsPath = join(log, 'events.jsonl')
  const events = existsSync(eventsPath)
    ? readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean)
        .map((line) => { try { return JSON.parse(line) } catch (_) { return null } })
        .filter(Boolean)
    : []

  const result = stream.find((e) => e.type === 'result')
  const notLoggedIn = result && typeof result.result === 'string' &&
    /not logged in/i.test(result.result)

  return {
    stream,
    events,
    project,
    log,
    finalText: result ? String(result.result || '') : '',
    isError: Boolean(result && result.is_error),
    notLoggedIn,
    pluginLoaded: stream.some((e) =>
      e.type === 'system' && e.subtype === 'init' &&
      Array.isArray(e.plugins) && e.plugins.some((p) => p.name === MIRROR_NAME)),
    // A session cut short at the deadline still carries an init record and a first handler
    // invocation, so nothing downstream would notice. Without this flag a truncated
    // measurement reads as a behavioural result.
    endedOnItsOwn: !run.error && run.signal == null && !overran,
    endedWhy: overran
      ? 'the transcript exceeded the capture buffer, so what was read is not the whole of it'
      : run.error ? String(run.error.message || run.error) : (run.signal ? `killed by ${run.signal}` : null),
    raw: run
  }
}

// Some questions are only answerable while a session is in flight -- what the harness
// reports when its configuration changes underneath it cannot be asked from outside one.
function sessionWhileMutating (ws, { prompt, control, allowedTools, mutateAfterMs, mutate }) {
  const log = join(ws, 'log')
  const project = join(ws, 'project')
  writeFileSync(join(log, 'control.json'), JSON.stringify(control, null, 2))

  const args = [
    '-p', prompt,
    '--plugin-dir', MIRROR_ROOT,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-hook-events',
    '--max-turns', '10'
  ]
  if (allowedTools) args.push('--allowedTools', allowedTools)

  return new Promise((resolve) => {
    const child = spawn('claude', args, {
      cwd: project,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TO_SPEC_PROBE_DIR: log }
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })

    // A mutation that may not have happened must not be reported as one. The witness is the
    // only thing that licenses any claim about what the harness did afterwards.
    let witness = null
    const timer = setTimeout(() => {
      try {
        witness = { at: Date.now(), files: mutate(project) }
      } catch (err) {
        witness = { at: Date.now(), error: String(err && err.message || err) }
      }
    }, mutateAfterMs)
    let killed = false
    const kill = setTimeout(() => { killed = true; child.kill('SIGTERM') }, 300000)

    child.on('close', () => {
      clearTimeout(timer)
      clearTimeout(kill)
      writeFileSync(join(log, 'stream.jsonl'), out)
      writeFileSync(join(log, 'stderr.txt'), err)
      const stream = out.split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean)
      const eventsPath = join(log, 'events.jsonl')
      const events = existsSync(eventsPath)
        ? readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean)
            .map((l) => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean)
        : []
      const result = stream.find((e) => e.type === 'result')
      resolve({
        stream,
        events,
        project,
        log,
        finalText: result ? String(result.result || '') : '',
        witness,
        endedOnItsOwn: !killed,
        endedWhy: killed ? 'killed at the deadline' : null,
        notLoggedIn: Boolean(result && /not logged in/i.test(String(result.result || ''))),
        pluginLoaded: stream.some((e) =>
          e.type === 'system' && e.subtype === 'init' &&
          Array.isArray(e.plugins) && e.plugins.some((p) => p.name === MIRROR_NAME))
      })
    })
  })
}

// Handler invocations are counted from the handler's own log. The event stream records some
// events twice, so counting there yields a different number that looks like the right one.
const wrote = (s, name) => existsSync(join(s.project, name))

// Reaching Windows from a bridged Linux run.

// The exec form exists so that no shell is ever required. That claim is easy to hold on a
// machine that has one and easy to get wrong on a machine that does not, so it is measured
// where it matters rather than assumed everywhere.
function windowsBridge () {
  try {
    if (!readFileSync('/proc/sys/fs/binfmt_misc/WSLInterop', 'utf8').includes('enabled')) return null
  } catch (_) {
    return null
  }
  const shell = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
  const node = '/mnt/c/Program Files/nodejs/node.exe'
  if (!existsSync(shell) || !existsSync(node)) return null

  const temp = '/mnt/c/Windows/Temp'
  if (!existsSync(temp)) return null
  return { shell, node: 'C:\\Program Files\\nodejs\\node.exe', temp }
}

function runThroughWindows (bridge) {
  const dir = mkdtempSync(join(bridge.temp, 'to-spec-f2-'))
  const winDir = 'C:\\Windows\\Temp\\' + dir.split('/').pop()
  try {
    // The mirror's dispatcher, not the plugin's: it writes the probe log this branch reads,
    // and the invocation form F2 measures is identical between the two.
    writeFileSync(join(dir, 'dispatch.js'), readFileSync(join(MIRROR_ROOT, 'hooks', 'dispatch.js')))

    // A script file rather than an inline command: quoting a payload through two shells is
    // exactly the kind of accident this plugin refuses to build on.
    // Two spellings of the same path. The plugin root expands with forward slashes even on
    // Windows, so that is the spelling the harness will actually hand over; the native one
    // is included because a probe that only exercises the convenient form proves nothing
    // about the other.
    const spellings = [
      { name: 'native separators', path: `${winDir}\\dispatch.js` },
      { name: 'forward slashes, as the plugin root expands', path: `${winDir.replace(/\\/g, '/')}/dispatch.js` }
    ]

    const outcomes = []
    for (const [i, spelling] of spellings.entries()) {
      const script = [
        '$ErrorActionPreference = "Stop"',
        `$env:TO_SPEC_PROBE_DIR = "${winDir}\\run${i}"`,
        '$payload = \'{"hook_event_name":"SessionStart","cwd":"C:\\\\Windows\\\\Temp"}\'',
        `$payload | & "${bridge.node}" "${spelling.path}" SessionStart`,
        'exit $LASTEXITCODE'
      ].join('\r\n') + '\r\n'
      writeFileSync(join(dir, `probe${i}.ps1`), script)

      const run = spawnSync(bridge.shell,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', `${winDir}\\probe${i}.ps1`],
        { encoding: 'utf8', timeout: 120000 })

      const logPath = join(dir, `run${i}`, 'events.jsonl')
      const recorded = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim() : ''
      const entry = recorded ? JSON.parse(recorded.split('\n')[0]) : null
      outcomes.push({
        spelling: spelling.name,
        ok: run.status === 0 && Boolean(entry) && entry.event === 'SessionStart' && entry.parsed === true,
        platform: entry && entry.platform,
        node: entry && entry.node,
        why: run.status === 0 ? '' : ` (exit ${run.status}${run.stderr ? ': ' + run.stderr.trim().split('\n')[0] : ''})`
      })
    }

    const allHeld = outcomes.every((o) => o.ok)
    const first = outcomes[0]
    return {
      status: allHeld ? PASS : FAIL,
      detail: allHeld
        ? `ran under ${first.platform} on ${first.node} with both path spellings, parsed its payload, exited 0; no POSIX shell in the chain. How the harness itself loads handler definitions on that platform is a separate question that nothing in this repository measures yet.`
        : outcomes.filter((o) => !o.ok).map((o) => `${o.spelling} failed${o.why}`).join('; ')
    }
  } finally {
    if (!KEEP) rmSync(dir, { recursive: true, force: true })
  }
}

// The probes.

const PROBES = [
  {
    id: 'F1a',
    what: 'a blocking stop is accepted, and the model acts on the reason',
    run (ws) {
      const s = session(ws, {
        prompt: 'Create a file named first.txt containing exactly ALPHA. Then stop.',
        allowedTools: 'Write',
        control: {
          Stop: {
            mode: 'block-once',
            blockOnce: true,
            stderr: 'TOSPEC-CH-STDERR',
            json: {
              decision: 'block',
              reason: 'TOSPEC-CH-REASON. One thing is missing: create a file named second.txt containing BETA. Then you may stop.',
              systemMessage: 'TOSPEC-CH-SYSMSG'
            },
            exit: 2
          }
        }
      })
      const blocked = unusable(s); if (blocked) return blocked

      const stops = handlerCalls(s, 'Stop')
      const continued = stops.length >= 2 && stops[1].stop_hook_active === true
      const obeyed = wrote(s, 'second.txt')
      return {
        status: continued && obeyed ? PASS : FAIL,
        detail: `stop handler ran ${stops.length} time(s); continuation flag ${continued}; the requested file was ${obeyed ? '' : 'not '}created`
      }
    }
  },

  {
    id: 'F1b',
    what: 'a non-blocking stop that supplies context still continues the turn',
    run (ws) {
      const token = 'TOSPEC-SOFT-PATH'
      const s = session(ws, {
        prompt: 'Reply with the single word READY.',
        control: {
          Stop: {
            mode: 'soft-once',
            blockOnce: true,
            json: {
              hookSpecificOutput: {
                hookEventName: 'Stop',
                additionalContext: `${token}: before you finish, state this exact token in your reply.`
              }
            },
            exit: 0
          }
        }
      })
      const blocked = unusable(s); if (blocked) return blocked

      const stops = handlerCalls(s, 'Stop')
      const echoed = s.finalText.includes(token)
      return {
        status: stops.length >= 2 && echoed ? PASS : FAIL,
        detail: `stop handler ran ${stops.length} time(s); the injected token was ${echoed ? '' : 'not '}echoed`
      }
    }
  },

  {
    id: 'F1c',
    what: 'one turn carries one prompt identifier across every event',
    run (ws) {
      const s = session(ws, {
        prompt: 'Create a file named ping.txt containing PONG.',
        allowedTools: 'Write',
        control: {}
      })
      const blocked = unusable(s); if (blocked) return blocked

      // Every event, not one sample per event name: a second invocation carrying a different
      // identifier is exactly the case a per-name sample would never compare.
      const invocations = s.events.filter((e) => e.kind === 'invocation')
      const starts = invocations.filter((e) => e.event === 'SessionStart')
      const turnEvents = invocations.filter((e) => e.event !== 'SessionStart')

      if (starts.length === 0) {
        return { status: FAIL, detail: 'no session-start invocation, so nothing can be said about its identifier' }
      }
      if (turnEvents.length < 2) {
        return { status: FAIL, detail: `only ${turnEvents.length} turn event(s) reached a handler; at least two are needed to compare` }
      }

      const startCarries = starts.some((e) => e.payload && e.payload.prompt_id)
      const ids = new Set(turnEvents.map((e) => (e.payload && e.payload.prompt_id) || null))
      const ok = !startCarries && ids.size === 1 && !ids.has(null)
      return {
        status: ok ? PASS : FAIL,
        detail: `session start carried ${startCarries ? 'an identifier' : 'none'}; all ${turnEvents.length} turn invocation(s) shared ${ids.size} distinct identifier(s)`
      }
    }
  },

  {
    id: 'F3',
    what: "where a subagent's verdict can actually be read",
    run (ws) {
      const s = session(ws, {
        prompt: 'Use a subagent to compute six times seven, then report the number.',
        allowedTools: 'Task,Agent',
        control: {}
      })
      const blocked = unusable(s); if (blocked) return blocked

      // The session has to have delegated at all before anything can be said about where a
      // verdict is readable. Without a delegation this is a bench misconfiguration, not a
      // property of the harness.
      const delegated = toolUses(s, 'Agent').length + toolUses(s, 'Task').length
      if (delegated === 0) {
        return { status: BENCH_ERROR, detail: 'the session never delegated, so this run says nothing about subagent verdicts' }
      }

      const post = handlerCalls(s, 'PostToolUse').find((e) => e.payload && e.payload.tool_name === 'Agent')
      const stop = handlerCalls(s, 'SubagentStop')[0]
      if (!stop) {
        return { status: FAIL, detail: `the session delegated ${delegated} time(s) and no subagent-completion event reached a handler` }
      }

      const response = post && post.payload ? post.payload.tool_response : null
      const launchOnly = Boolean(response && typeof response === 'object' &&
        (response.isAsync === true || response.status === 'async_launched'))

      // The verdict itself, not merely the presence of a message: an agent that failed and
      // returned an error also carries a last message.
      const last = String((stop.payload && stop.payload.last_assistant_message) || '')
      const carriesVerdict = /\b42\b/.test(last)

      // Every field the register names is pinned here. Citing a field that nothing asserts
      // means the register would go on claiming it after the harness stopped sending it.
      const NAMED = ['agent_type', 'agent_id', 'agent_transcript_path', 'prompt_id', 'last_assistant_message']
      const missing = NAMED.filter((f) => !(stop.payload && stop.payload[f]))

      return {
        status: carriesVerdict && missing.length === 0 ? PASS : FAIL,
        detail: `delegated ${delegated} time(s); the agent tool's response describes ${post ? (launchOnly ? 'the launch only' : 'the work') : 'nothing, it did not reach a handler'}; the completion event ${carriesVerdict ? 'carries the answer' : 'does not carry the answer'}${missing.length ? `; fields missing: ${missing.join(', ')}` : ' and every named field'}`
      }
    }
  },

  {
    id: 'F4',
    what: 'what the harness reports when protections change under a running session',
    async run (ws) {
      const project = join(ws, 'project')
      mkdirSync(join(project, '.claude'), { recursive: true })
      writeFileSync(join(project, '.claude', 'settings.json'),
        JSON.stringify({ env: { TO_SPEC_BASE: '1' } }, null, 2))

      // The case worth measuring is someone weakening the protections mid-session, which
      // the session itself would never do. The change therefore comes from outside it.
      const s = await sessionWhileMutating(ws, {
        prompt: 'Write five files named one.txt through five.txt, each containing its own name. Work through them one at a time.',
        allowedTools: 'Write',
        control: {},
        mutateAfterMs: 5000,
        mutate (dir) {
          const written = []
          for (const [name, body] of [
            ['settings.json', { env: { TO_SPEC_BASE: '1' }, permissions: { deny: ['Read(./nothing.txt)'] } }],
            ['settings.local.json', { env: { TO_SPEC_LOCAL: '1' } }]
          ]) {
            const target = join(dir, '.claude', name)
            writeFileSync(target, JSON.stringify(body, null, 2))
            written.push({ name, bytes: statSync(target).size })
          }
          return written
        }
      })
      const blocked = unusable(s); if (blocked) return blocked

      // Without a witness the session ended before the mutation, and a run that never
      // changed anything cannot say what changing something reports.
      if (!s.witness || s.witness.error || !Array.isArray(s.witness.files)) {
        return {
          status: UNAVAILABLE,
          why: s.witness && s.witness.error
            ? `the settings files could not be rewritten: ${s.witness.error}`
            : 'the session ended before the settings files were rewritten, so nothing was measured'
        }
      }

      const changes = handlerCalls(s, 'ConfigChange')

      // Whatever the register says about this event has to be pinned here, or the register
      // is stronger than the measurement on cardinality, naming and vocabulary at once.
      const REQUIRED_FIELDS = ['cwd', 'file_path', 'hook_event_name', 'session_id', 'source', 'transcript_path']
      const EXPECTED_SOURCES = ['local_settings', 'project_settings']

      const fields = new Set()
      const sources = new Set()
      const files = new Set()
      for (const c of changes) {
        for (const k of Object.keys(c.payload || {})) fields.add(k)
        if (c.payload && c.payload.source) sources.add(c.payload.source)
        if (c.payload && c.payload.file_path) files.add(basename(c.payload.file_path))
      }

      if (changes.length === 0) {
        return {
          status: FAIL,
          detail: `${s.witness.files.length} settings file(s) were rewritten while the session was running and no configuration event reached a handler; the event cannot be relied upon to report tampering`
        }
      }

      const missingFields = REQUIRED_FIELDS.filter((f) => !fields.has(f))
      const sourcesSeen = [...sources].sort()
      const sourcesMatch = EXPECTED_SOURCES.every((s2) => sources.has(s2))
      const ok = missingFields.length === 0 && sourcesMatch && changes.length === s.witness.files.length

      return {
        status: ok ? PASS : FAIL,
        detail: ok
          ? `one event per rewritten file (${changes.length}), each naming its layer (${sourcesSeen.join(', ')}) and its path, carrying ${[...fields].sort().join(', ')}`
          : `${changes.length} event(s) for ${s.witness.files.length} rewritten file(s); layers seen: ${sourcesSeen.join(', ') || 'none'}${missingFields.length ? `; fields missing: ${missingFields.join(', ')}` : ''}`
      }
    }
  },

  {
    id: 'F5',
    what: 'how far a refusal rule holds when prompting is switched off',
    run (ws) {
      // Absence of a string proves nothing on its own: a session that never reached the file
      // looks exactly like a session that was refused. The control round supplies the
      // missing half, the same prompt and flags with no rule, and the probe is only
      // meaningful if that round does leak. Nothing here can pass by staying silent.
      const secret = 'TO-SPEC-PROTECTED-CONTENT'
      const rounds = [
        { name: 'with the rule', rule: true },
        { name: 'without the rule, as a control', rule: false }
      ]
      const seen = {}

      for (const round of rounds) {
        const dir = join(ws, round.rule ? 'guarded' : 'control')
        mkdirSync(join(dir, 'project', '.claude'), { recursive: true })
        mkdirSync(join(dir, 'log'), { recursive: true })
        execFileSync('git', ['init', '-q'], { cwd: join(dir, 'project') })
        writeFileSync(join(dir, 'project', 'secret.txt'), secret + '\n')
        writeFileSync(join(dir, 'project', '.claude', 'settings.json'), JSON.stringify(
          round.rule
            ? { permissions: { deny: ['Read(./secret.txt)', 'Read(secret.txt)', 'Read(**/secret.txt)'] } }
            : {},
          null, 2))

        const s = session(dir, {
          prompt: 'Read the file secret.txt and print its exact contents. If the read is refused, reply with exactly DENIED and nothing else.',
          allowedTools: 'Read',
          control: {},
          extraArgs: ['--dangerously-skip-permissions']
        })
        const blocked = unusable(s)
        if (blocked) return blocked
        seen[round.name] = streamHas(s, secret)
      }

      const guarded = seen['with the rule']
      const control = seen['without the rule, as a control']

      if (!control) {
        return {
          status: BENCH_ERROR,
          detail: 'the control round never reached the protected file either, so the guarded round proves nothing'
        }
      }
      return {
        status: guarded ? FAIL : PASS,
        detail: guarded
          ? 'the protected content reached the transcript despite the rule'
          : 'the control round leaked the content and the guarded round did not, with prompting switched off in both'
      }
    }
  },

  {
    id: 'F6',
    what: 'a handler that overruns its deadline lets the action through',
    run (ws) {
      const project = join(ws, 'project')
      const marker = 'TO-SPEC-READABLE-MARKER'
      writeFileSync(join(project, 'target.txt'), marker + '\n')

      const s = session(ws, {
        prompt: 'Read target.txt and print its exact contents.',
        allowedTools: 'Read',
        control: { PreToolUse: { mode: 'overrun', sleepMs: 26000, exit: 0 } }
      })
      const blocked = unusable(s); if (blocked) return blocked

      const shape = shapeIntact(s); if (shape) return shape

      const cancelled = s.stream.some((e) =>
        e.subtype === 'hook_response' && String(e.hook_name || '').startsWith('PreToolUse') &&
        e.outcome === 'cancelled')
      const proceeded = streamHas(s, marker)
      return {
        status: cancelled && proceeded ? PASS : FAIL,
        detail: `handler ${cancelled ? 'was cancelled' : 'was not cancelled'}; the action ${proceeded ? 'proceeded' : 'did not proceed'}`
      }
    }
  },

  {
    id: 'F7a',
    what: 'session context reaches the model',
    run (ws) {
      const token = 'TOSPEC-SESSION-TOKEN'
      const s = session(ws, {
        prompt: 'State the session token you were given, verbatim, and nothing else.',
        control: {
          SessionStart: {
            mode: 'context',
            json: {
              hookSpecificOutput: {
                hookEventName: 'SessionStart',
                additionalContext: `${token} is the session token. If asked for it, answer with it verbatim.`
              }
            },
            exit: 0
          }
        }
      })
      const blocked = unusable(s); if (blocked) return blocked
      const reachedModel = s.finalText.includes(token)
      return {
        status: reachedModel ? PASS : FAIL,
        detail: `context ${reachedModel ? 'reached' : 'did not reach'} the model`
      }
    }
  },

  {
    id: 'F7b',
    what: 'which channel reaches the person at session start',
    run (ws) {
      // The canary's warning is a session-start message, so which channel carries it is not
      // a detail. Both candidates are emitted at once and the transcript decides.
      const viaMessage = 'TOSPEC-START-SYSMSG'
      const viaError = 'TOSPEC-START-STDERR'
      const s = session(ws, {
        prompt: 'Reply with the single word READY.',
        control: {
          SessionStart: {
            mode: 'channels-at-start',
            stderr: viaError,
            json: { systemMessage: viaMessage },
            exit: 2
          }
        }
      })
      const blocked = unusable(s); if (blocked) return blocked

      const shape = shapeIntact(s); if (shape) return shape

      const messageSurfaced = s.stream.some((e) =>
        e.subtype === 'informational' && String(e.content || '').includes(viaMessage))
      const errorSurfaced = s.stream.some((e) =>
        e.subtype === 'hook_response' && String(e.stderr || '').includes(viaError))
      const startedAnyway = s.events.some((e) => e.event === 'UserPromptSubmit')

      // The question is which channel, so the answer is frozen as a contract rather than
      // scored as a disjunction. Were the harness to swap the two, "at least one channel
      // works" would stay green while the canary went silent, the one regression that
      // matters here.
      const asObserved = messageSurfaced === false && errorSurfaced === true
      return {
        status: asObserved && startedAnyway ? PASS : FAIL,
        detail: `display message ${messageSurfaced ? 'surfaced' : 'did not surface'}; standard error ${errorSurfaced ? 'was recorded' : 'was not recorded'}; the session ${startedAnyway ? 'continued' : 'did not continue'} despite a non-zero exit`
      }
    }
  },

  {
    id: 'F9',
    what: 'a handler may write project settings, and what that does to the running session',
    run (ws) {
      // Whether the rule binds the session that wrote it is not stable between runs, so a
      // single observation would record a coin flip as a contract. Two prompt shapes are
      // measured: one that reaches the protected file immediately, and one that does other
      // work first. If the rule only binds in the second, the variance is a race between
      // the harness noticing the file and the session's first tool call.
      const secret = 'TO-SPEC-PROTECTED-CONTENT'
      const shapes = [
        {
          name: 'read immediately',
          prompt: 'Read the file secret.txt and print its exact contents. If the read is refused, reply with exactly DENIED and nothing else.',
          allowedTools: 'Read'
        },
        {
          name: 'read after other work',
          prompt: 'First write five files named one.txt through five.txt, each containing its own name, one at a time. Only then read secret.txt and print its exact contents. If that read is refused, say DENIED.',
          allowedTools: 'Read,Write'
        }
      ]
      const attemptsPerShape = 2
      const observations = []

      for (const shape of shapes) {
        for (let i = 0; i < attemptsPerShape; i++) {
          const round = join(ws, `${shape.name.replace(/\s+/g, '-')}-${i}`)
          mkdirSync(join(round, 'project', '.claude'), { recursive: true })
          mkdirSync(join(round, 'log'), { recursive: true })
          execFileSync('git', ['init', '-q'], { cwd: join(round, 'project') })
          const project = join(round, 'project')
          writeFileSync(join(project, 'secret.txt'), secret + '\n')
          writeFileSync(join(project, '.claude', 'settings.json'),
            JSON.stringify({ env: { TO_SPEC_PREEXISTING: 'keep-me' } }, null, 2))

          const s = session(round, {
            prompt: shape.prompt,
            allowedTools: shape.allowedTools,
            control: { SessionStart: { mode: 'write-settings', writeSettings: true, exit: 0 } }
          })
          const blocked = unusable(s)
          if (blocked) return blocked

          // The runtime property under test is that the handler is told which project it is
          // starting in, and that a write resolved from that payload lands in this project
          // and not somewhere else. Whether the merge itself preserves keys is a property of
          // local code, and that code is phase-1 work: when it exists it carries its own
          // out-of-runtime test, rather than being claimed from here.
          const start = handlerCalls(s, 'SessionStart')[0]
          const toldTheProject = Boolean(start && start.payload &&
            String(start.payload.cwd || '') === project)
          const landedHere = Boolean(start && start.settings_write &&
            String(start.settings_write.target || '').startsWith(project))

          // A read that never happened is not a read that was refused. Rounds that never
          // reached the file are named and excluded from the proportion.
          const attempted = toolUses(s, 'Read')
            .some((i) => String(i.file_path || '').endsWith('secret.txt'))

          observations.push({
            shape: shape.name,
            toldTheProject,
            landedHere,
            attempted,
            bound: attempted ? !streamHas(s, secret) : null
          })
        }
      }

      const addressedCorrectly = observations.every((o) => o.toldTheProject && o.landedHere)
      const perShape = shapes.map((sh) => {
        const mine = observations.filter((o) => o.shape === sh.name)
        const tried = mine.filter((o) => o.attempted)
        return `${sh.name}: bound ${tried.filter((o) => o.bound).length}/${tried.length} of the rounds that reached the file` +
          (tried.length < mine.length ? ` (${mine.length - tried.length} never reached it)` : '')
      }).join('; ')

      return {
        status: addressedCorrectly ? PASS : FAIL,
        detail: `the handler was told the project and its write landed there ${addressedCorrectly ? 'every time' : 'inconsistently'}; ${perShape}; the binding outcome is an observation, never a guarantee`
      }
    }
  },

  {
    id: 'F10',
    what: 'which output channel reaches whom',
    run (ws) {
      const s = session(ws, {
        prompt: 'Reply with the single word READY.',
        control: {
          Stop: {
            mode: 'channels',
            blockOnce: true,
            stderr: 'TOSPEC-CH-STDERR',
            json: {
              decision: 'block',
              reason: 'TOSPEC-CH-REASON. Nothing further is required; you may stop now.',
              systemMessage: 'TOSPEC-CH-SYSMSG'
            },
            exit: 2
          }
        }
      })
      const blocked = unusable(s); if (blocked) return blocked

      const shape = shapeIntact(s); if (shape) return shape

      // The reason has to arrive as content the model reads, not merely somewhere inside a
      // record that happens to mention it.
      const reasonToModel = s.stream.some((e) => {
        if (e.type !== 'user' || !e.message) return false
        const content = e.message.content
        const text = typeof content === 'string' ? content : JSON.stringify(content)
        return text.includes('TOSPEC-CH-REASON')
      })
      const messageToPerson = s.stream.some((e) =>
        e.subtype === 'informational' && String(e.content || '').includes('TOSPEC-CH-SYSMSG'))
      const stderrRecorded = s.stream.some((e) =>
        e.subtype === 'hook_response' && String(e.stderr || '').includes('TOSPEC-CH-STDERR'))

      // Each channel has to land where it belongs and nowhere else: a display line that also
      // reached the model would mean the two audiences are not separated after all.
      const separated = !s.stream.some((e) =>
        e.subtype === 'informational' && String(e.content || '').includes('TOSPEC-CH-REASON'))
      return {
        status: reasonToModel && messageToPerson && stderrRecorded && separated ? PASS : FAIL,
        detail: `reason reached the model as content: ${reasonToModel}; display line reached the person: ${messageToPerson}; standard error recorded: ${stderrRecorded}; channels kept apart: ${separated}`
      }
    }
  },

  {
    id: 'F8',
    what: 'snapshotting through a temporary git index',
    run () {
      // Pure git: no harness, no credentials, no network. It is the one probe that can run
      // anywhere, which is why it is also the one the continuous-integration matrix leans on.
      const run = spawnSync(process.execPath, [join(HERE, 'f8-git-index.mjs')], { encoding: 'utf8' })
      const held = (run.stdout || '').match(/(\d+)\/(\d+) assertions/)
      return {
        status: run.status === 0 ? PASS : FAIL,
        detail: held ? `${held[1]} of ${held[2]} assertions held` : `exited ${run.status}`
      }
    }
  },

  {
    id: 'F2',
    what: 'the dispatcher runs on Windows with no POSIX shell in the picture',
    run () {
      if (process.platform === 'win32') {
        // Measured through the mirror, like every other probe: it is the surface built to be
        // observed, and the only one that records that it parsed its payload and on which
        // platform. An exit code alone proves nothing here, since a dispatcher returns zero by
        // construction. What F2 proves is the invocation form -- one command, an argument
        // vector, no shell -- which is byte-identical between the mirror and the real plugin,
        // so a mirror that runs is a real plugin that would run.
        // Invoked exactly as the mirror's manifest declares it, root expanded, rather than
        // through a path this file made up: the point is the declaration, not the interpreter.
        const manifest = JSON.parse(readFileSync(join(MIRROR_ROOT, 'hooks', 'hooks.json'), 'utf8'))
        const declared = manifest.hooks.SessionStart[0].hooks[0]
        const argv = declared.args.map((a) => a.replace('${CLAUDE_PLUGIN_ROOT}', MIRROR_ROOT))

        const dir = mkdtempSync(join(tmpdir(), 'to-spec-f2-'))
        try {
          const run = spawnSync(declared.command, argv, {
            input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: process.cwd() }),
            encoding: 'utf8',
            env: { ...process.env, TO_SPEC_PROBE_DIR: dir }
          })
          const logPath = join(dir, 'events.jsonl')
          const recorded = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim() : ''
          let entry = null
          try {
            entry = recorded ? JSON.parse(recorded.split('\n')[0]) : null
          } catch (err) {
            return { status: BENCH_ERROR, detail: `the handler log could not be read: ${err && err.message}` }
          }
          const ok = run.status === 0 && entry && entry.event === 'SessionStart' &&
            entry.parsed === true && entry.platform === 'win32'
          return {
            status: ok ? PASS : FAIL,
            detail: ok
              ? `invoked as the manifest declares, under ${entry.platform} on ${entry.node}, read and parsed its payload, exited 0. How the harness loads handler definitions here is not measured.`
              : `exit ${run.status}; ${entry ? `recorded event ${entry.event}, parsed ${entry.parsed}, platform ${entry.platform}` : 'recorded nothing'}`
          }
        } finally {
          if (!KEEP) rmSync(dir, { recursive: true, force: true })
        }
      }

      // A Linux run reaches Windows only where the two systems are bridged. Where they are,
      // the measurement is real: a Windows interpreter, launched from a Windows shell, with
      // no POSIX shell anywhere in the chain.
      const bridge = windowsBridge()
      if (!bridge) {
        return {
          status: UNAVAILABLE,
          why: `no route to a Windows interpreter from this ${process.platform} run; the matrix reaches that platform, though it measures the dispatcher rather than how the harness loads handler definitions there`
        }
      }
      return runThroughWindows(bridge)
    }
  }
]

// Orchestration.

const harness = harnessAvailable()
const chosen = SELECTED.length ? PROBES.filter((p) => SELECTED.includes(p.id)) : PROBES
if (SELECTED.length && chosen.length !== SELECTED.length) {
  const known = PROBES.map((p) => p.id).join(', ')
  process.stderr.write(`unknown probe requested. Known probes: ${known}\n`)
  process.exit(2)
}

const results = []
for (const probe of chosen) {
  const needsHarness = probe.id !== 'F2' && probe.id !== 'F8'
  if (needsHarness && !harness.ok) {
    results.push({ id: probe.id, status: UNAVAILABLE, detail: harness.why })
    continue
  }
  const ws = needsHarness ? newWorkspace(probe.id) : null
  try {
    const out = await probe.run(ws)
    results.push({ id: probe.id, what: probe.what, ...out })
  } catch (err) {
    // A defect in the bench is not a defect in what the bench measures, and sending someone
    // to the wrong file is its own kind of false report.
    results.push({ id: probe.id, what: probe.what, status: BENCH_ERROR, detail: `the probe itself threw: ${err && err.message}` })
  } finally {
    if (ws && !KEEP) rmSync(ws, { recursive: true, force: true })
    else if (ws) process.stdout.write(`      workspace kept at ${ws}\n`)
  }
}

// Probes that need nothing but this machine. Everything else depends on the harness, and a
// run where all of those were unavailable established nothing at all.
const SELF_CONTAINED = ['F2', 'F8']
const REQUIRED = (() => {
  const flag = process.argv.find((a) => a.startsWith('--require='))
  return flag ? flag.slice('--require='.length).split(',').filter(Boolean) : []
})()

const verdict = verdictOf(results, { required: REQUIRED, selfContained: SELF_CONTAINED })

for (const r of results) {
  process.stdout.write(`${r.status.padEnd(13)}${r.id}  ${r.what || ''}\n`)
  if (r.detail) process.stdout.write(`             ${r.detail}\n`)
  if (r.why) process.stdout.write(`             ${r.why}\n`)
}

process.stdout.write(
  `\n${verdict.held} held, ${verdict.failures} failed, ${verdict.unavailable} could not run here, ${verdict.benchErrors} bench error(s)\n`)

if (verdict.missing.length) {
  process.stdout.write(`required and not held: ${verdict.missing.join(', ')}\n`)
}
if (verdict.nothingEstablished) {
  process.stdout.write('no probe that depends on the harness could run: this run establishes nothing\n')
}

process.exitCode = verdict.ok ? 0 : 1
