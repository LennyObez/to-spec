'use strict'

// The layer that knows this particular harness, and the only one that does.
//
// Everything under core/ is written against a project and a set of standards; nothing there
// knows what an event is called, which field carries a refusal, or which channel reaches a
// person. That separation is not tidiness. A second harness names its events differently,
// grants trust against the hash of a handler definition, and offers no way to escalate to a
// human. The only way to find that out without rewriting the plugin is for the plugin's
// judgement to live somewhere that never mentioned the first harness.
//
// Each handler here does three things in the same order: work out what is true, decide, and
// say it in the shape this harness reads. None of them throws; a handler that throws renders
// no decision, and a decision that is not rendered is an action allowed in silence.

const path = require('path')

const state = require('../../core/state')
const ledger = require('../../core/ledger')
const gate = require('../../core/gate')
const standards = require('../../core/standards')
const canary = require('../../core/canary')
const secrets = require('../../core/secrets')
const snapshot = require('../../core/snapshot')
const statusFile = require('../../core/status-file')
const deadline = require('../../core/deadline')
const i18n = require('../../core/i18n')
const out = require('./output')

const REPORT_RELATIVE = path.join('.to-spec', 'reports', 'gate.json')

function projectDirFrom (payload) {
  return (payload && payload.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd()
}

function catalogueFor (projectDir, project) {
  return i18n.catalogue({
    projectDir,
    project,
    dataDir: process.env.CLAUDE_PLUGIN_DATA || null
  })
}

// Session start.

function onSessionStart (payload, env) {
  const projectDir = projectDirFrom(payload)
  const project = state.readProject(projectDir)

  // The canary runs whether or not this is a marked project: a broken plugin is worth saying
  // out loud even where it would have had nothing to do.
  const health = canary.run(env.pluginRoot, { dataDir: process.env.CLAUDE_PLUGIN_DATA || null })
  const catalogue = catalogueFor(projectDir, project)

  if (health.state === canary.RED) {
    return out.sessionStart({
      warningForPerson: catalogue.get('canary.broken'),
      contextForModel: 'to-spec cannot verify its own guards on this machine. Do not begin construction; if asked to repair them, follow docs/repair.md.'
    })
  }

  if (!project) return out.silent()

  // Two lines, not the whole file. Spending a session's context on a status the model can
  // open when it needs it is a cost paid every turn for a benefit taken once.
  let summary = []
  try {
    summary = statusFile.summarise(require('fs').readFileSync(statusFile.pathIn(projectDir), 'utf8'))
  } catch (_) { /* no status yet: the first armed evaluation will write one */ }

  const facts = [
    `Project type: ${project.archetype && project.archetype.id ? project.archetype.id : 'not yet decided'}.`,
    ...summary
  ]
  return out.sessionStart({ contextForModel: facts.join(' ') })
}

// Before a tool.

function onPreToolUse (payload, env) {
  const projectDir = projectDirFrom(payload)
  const toolName = payload.tool_name || ''

  const clock = deadline.start('PreToolUse')
  const project = state.readProject(projectDir)
  const catalogue = catalogueFor(projectDir, project)

  // The note comes first, before any decision. A refused write is still an attempt to change
  // the project, and a turn that tried and was stopped is not a turn that did nothing.
  //
  // If the note cannot be kept, the tool is refused rather than allowed. The gate learns that
  // a turn changed something from this note and from nowhere else, so an unrecorded write is
  // a change nothing will ever check, and letting it through would buy convenience with the
  // one guarantee this plugin makes.
  if (project) {
    const noted = ledger.recordTurn(projectDir, {
      promptId: payload.prompt_id || null,
      toolName,
      deadline: clock
    })
    if (!noted.written && ledger.isWritingTool(toolName)) {
      return out.refuseTool({
        reasonForModel: `I could not record that this turn is changing the project (${noted.why}), so nothing would check the result. Retry once; if it persists, the project's .to-spec directory is not writable.`,
        lineForPerson: catalogue.get('ledger.cannot_note')
      })
    }
  }

  // Everything below acts on the project, and a directory that never opted in has no project
  // to act on. Refusing a command or copying a repository there would be the plugin making
  // itself felt in every directory on the machine.
  if (!project) return out.allowTool()

  // Consulted before the guards, not only after: if the budget is already spent, starting the
  // git work would only run the handler past its declared timeout, and a pre-tool handler the
  // harness cancels lets the action through. Refusing now is the fail-closed answer, in time
  // to be heard.
  if (clock.expired) {
    return out.refuseTool({
      reasonForModel: 'I could not finish checking this action within the time available, so I did not run it.',
      lineForPerson: catalogue.get('secrets.cannot_check')
    })
  }

  // Bound to the project this call is about, not to whatever directory the process happens to
  // be in: an answer from another repository would be a confident one about the wrong thing.
  const git = env.gitIn(projectDir)

  const verdict = secrets.inspect(payload, {
    projectDir,
    checkIgnore: (candidate) => git(['check-ignore', '--quiet', '--', candidate], {}).status,
    exists: (candidate) => require('fs').existsSync(secrets.resolveAgainst(projectDir, candidate))
  })
  if (verdict.decision === secrets.REFUSE) {
    return out.refuseTool({
      reasonForModel: verdict.reason,
      lineForPerson: catalogue.get(verdict.key)
    })
  }

  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const copy = snapshot.guard(payload, projectDir, { git })
    if (copy.outcome === snapshot.REFUSED) {
      return out.refuseTool({
        reasonForModel: `That command would run ${copy.what}, and no copy could be taken first: ${copy.why}. Nothing has been changed.`,
        lineForPerson: catalogue.get(copy.key)
      })
    }
    // Where the copy went, so that it can be found. A safety net nobody can locate is not one.
    if (copy.outcome === snapshot.TAKEN) {
      state.updateState(projectDir, (s) => {
        s.snapshots.push({ at: new Date().toISOString(), ref: copy.ref, before: copy.what })
        if (s.snapshots.length > 50) s.snapshots.shift()
      })
    }
  }

  // Reaching the deadline is itself a decision, and saying so beats being timed out into
  // silence: a handler that renders nothing lets the action through.
  if (clock.expired) {
    return out.refuseTool({
      reasonForModel: 'I could not finish checking this action within the time available, so I did not run it.',
      lineForPerson: catalogue.get('secrets.cannot_check')
    })
  }

  return out.allowTool()
}

// The end of a turn.

function onStop (payload, env) {
  const projectDir = projectDirFrom(payload)
  const project = state.readProject(projectDir)
  if (!project) return out.silent()

  const current = state.readState(projectDir)
  const catalogue = catalogueFor(projectDir, project)
  const clock = deadline.start('Stop')

  // Arming is decided before anything is run, so that a turn which changed nothing costs
  // nothing. The stop event fires at the end of every reply, including the ones that only
  // answered a question.
  const dry = gate.evaluate({
    payload,
    marked: true,
    state: current,
    results: [],
    reportPath: REPORT_RELATIVE
  })
  if (!dry.armed) return out.silent()

  const loaded = standards.loadAll(env.pluginRoot)
  const selected = standards.selectFor(loaded, 'Stop')
  const ctx = standards.makeContext({ projectDir, deadline: clock })

  const results = []

  // A catalogue that could not be read is not a turn with nothing to check. Passing here would
  // be the fold the whole plugin refuses: work declared sound because nothing looked at it.
  // Named as unavailable, it reaches the gate as something outstanding rather than as silence.
  const catalogueProblem = standards.catalogueError(env.pluginRoot)
  if (catalogueProblem || loaded.length === 0) {
    results.push({
      id: 'to-spec.catalogue',
      status: standards.UNAVAILABLE,
      findings: [],
      why: catalogueProblem || 'the standards directory holds nothing to run'
    })
  }

  // A check is started only if the budget still leaves room to write the report and emit the
  // decision after it. `attempt` reserves that time and stands a check down as unavailable
  // rather than starting what could run the handler past its declared timeout, where the
  // harness cancels it and the stop passes unchecked -- the silent pass this gate exists to
  // prevent. A check already running cannot be interrupted; a slow one consults ctx.timeLeft().
  const REPORT_RESERVE_MS = 3000
  for (const standard of selected) {
    const attempt = clock.attempt(
      standard.id,
      () => standards.runStandard(standard, { mode: 'tree', projectDir }, ctx),
      { needsMs: REPORT_RESERVE_MS })
    if (attempt.status === 'ran') {
      results.push(attempt.value)
      continue
    }
    results.push({
      id: standard.id,
      status: standards.UNAVAILABLE,
      findings: [],
      why: 'the turn ran out of checking time before this one could be started'
    })
  }

  const declared = (id, field, fallback) => {
    const found = loaded.find((s) => s.id === id)
    return found && found.definition ? found.definition[field] : fallback
  }
  const categoryOf = (id) => declared(id, 'category', 'agent-fixable')
  const severityOf = (id) => declared(id, 'severity', 'block')

  const decision = gate.evaluate({
    payload,
    marked: true,
    state: current,
    results,
    categoryOf,
    severityOf,
    reportPath: REPORT_RELATIVE
  })

  // Persisting the gate state is where the refusal counter advances, and updateState reports
  // failure by return value rather than by throwing: a held lock, a read-only directory, a
  // Windows rename an indexer holds all come back as { written: false }. The result is read,
  // because a refusal that was not counted is one the internal cap can never reach.
  const persisted = state.updateState(projectDir, (s) => {
    Object.assign(s.gate, decision.nextState.gate)
    s.outstanding = decision.nextState.outstanding
  })

  try {
    const fs = require('fs')
    fs.mkdirSync(path.join(projectDir, '.to-spec', 'reports'), { recursive: true })
    state.writeAtomic(path.join(projectDir, REPORT_RELATIVE),
      JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n')
    state.writeAtomic(statusFile.pathIn(projectDir),
      statusFile.render({ ...current, outstanding: decision.outstanding }, catalogue,
        { worksite: project.name || null, reportPath: REPORT_RELATIVE }))
  } catch (_) { /* the decision stands even if the report could not be filed */ }

  // A refusal that could not be counted must not repeat unbounded. When the note was not kept,
  // the counter on disk is unchanged, so a BLOCK would be re-issued from the same numbers on
  // every stop until the harness's own cap ends it -- the outcome the internal cap exists to
  // prevent. The turn is let go through the soft path instead, naming why.
  if (decision.verdict === gate.BLOCK && !persisted.written) {
    return out.nudgeStop({
      contextForModel: decision.reason,
      lineForPerson: catalogue.get('gate.spent', { path: REPORT_RELATIVE })
    })
  }

  if (decision.verdict === gate.BLOCK) {
    return out.refuseStop({
      reasonForModel: decision.reason,
      lineForPerson: catalogue.plural('gate.blocked', decision.count)
    })
  }
  if (decision.verdict === gate.SOFT) {
    // Both keys spelled as literals, so the i18n check that collects every dotted-literal
    // message key from this file sees them and holds each catalogue to carrying it. A key
    // pasted together at runtime would reach the catalogue but not that check.
    const key = decision.exhausted === 'stuck' ? 'gate.stuck' : 'gate.spent'
    return out.nudgeStop({
      contextForModel: decision.reason,
      lineForPerson: catalogue.get(key, { path: REPORT_RELATIVE })
    })
  }
  // Passing is not finishing. What comes back is what still needs a person and what was not
  // looked at, never a verdict on the whole. A pass carrying unchecked items must not be
  // byte-identical to a clean one: the person is told, in that order of priority, what needs
  // them, or failing that what could not be checked here.
  const needs = (decision.needsPerson || [])
  const unlooked = (decision.unverifiable || [])
  let lineForPerson = null
  if (needs.length) {
    lineForPerson = catalogue.plural('gate.needs_you', needs.length, { first: needs[0] })
  } else if (unlooked.length) {
    lineForPerson = catalogue.plural('gate.not_looked', unlooked.length, { path: REPORT_RELATIVE })
  }
  return out.letStopThrough({ lineForPerson })
}

// Events that only take notes.

function onConfigChange (payload) {
  const projectDir = projectDirFrom(payload)
  if (!state.isMarked(projectDir)) return out.silent()
  state.updateState(projectDir, (s) => {
    s.flags.configChanged = {
      at: new Date().toISOString(),
      source: payload.source || null,
      file: payload.file_path || null
    }
  })
  // A journal, not a gate: by the time this arrives the session is already running under the
  // new configuration, and saying so at the next start is the honest moment.
  return out.silent()
}

function onOther () {
  return out.silent()
}

// Only the events this milestone acts on are wired and declared in hooks.json. An event that
// would dispatch to onOther spawns a process to render silence, so it is not declared at all;
// handle() still falls back to onOther for anything undeclared, which is what keeps a future
// event from throwing before its handler exists. An invariant holds hooks.json and this table
// to the same set.
const HANDLERS = {
  SessionStart: onSessionStart,
  PreToolUse: onPreToolUse,
  Stop: onStop,
  ConfigChange: onConfigChange
}

function handle (event, payload, env) {
  const handler = HANDLERS[event] || onOther
  return handler(payload || {}, env)
}

module.exports = { handle, HANDLERS, REPORT_RELATIVE }
