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
const archetypes = require('../../core/archetypes')
const canary = require('../../core/canary')
const secrets = require('../../core/secrets')
const snapshot = require('../../core/snapshot')
const statusFile = require('../../core/status-file')
const deadline = require('../../core/deadline')
const i18n = require('../../core/i18n')
const out = require('./output')

const REPORT_RELATIVE = path.join('.to-spec', 'reports', 'gate.json')

// How many refusals of the same file the guard makes before it hands the decision to the
// person instead of repeating itself. The fourth refusal asks rather than denies.
const ESCALATE_AFTER = 4

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

// The standards a project's archetype composes, and the problems that stop a composition from
// being trusted. One reading, shared by the gate at the end of a turn and the guard before a
// write, so the two never disagree about what a project is held to.
function composeStandards (pluginRoot, project, loaded) {
  const archetypeId = (project && project.archetype && project.archetype.id) || null
  const archetype = archetypeId
    ? archetypes.loadArchetype(pluginRoot, archetypeId)
    : { broken: 'the project names no archetype to compose' }
  if (archetype.broken) {
    return { standards: [], problems: [{ id: 'to-spec.archetype', why: `the archetype '${archetypeId || ''}' could not be composed: ${archetype.broken}` }] }
  }
  const byId = new Map(loaded.map((s) => [s.id, s]))
  const composed = []
  const problems = []
  for (const id of archetypes.composedStandardIds(archetype)) {
    const found = byId.get(id)
    if (found) composed.push(found)
    else problems.push({ id, why: `the archetype composes '${id}', which the catalogue does not hold` })
  }
  return { standards: composed, problems }
}

// Deny rules for the secret-bearing files this repository actually ignores. Precise rather than
// coarse: only a file git ignores is denied, so a tracked template of the same name is untouched,
// and the guard's own name test decides what counts as secret-bearing. Empty when there is no
// git, no ignored file, or none that is secret-bearing.
function secretDenyRules (projectDir, git) {
  const listing = git(['ls-files', '--others', '--ignored', '--exclude-standard'], {})
  if (listing.status !== 0) return []
  const rules = []
  for (const file of String(listing.stdout || '').split('\n').filter(Boolean)) {
    if (secrets.candidatePaths(file).length === 0) continue
    for (const tool of ['Read', 'Grep', 'Write', 'Edit']) rules.push(`${tool}(${file})`)
  }
  return rules.sort()
}

// Merge deny rules into the project's settings without overwriting anything: the union of what is
// there and what is passed. Returns whether it changed, so an unchanged start writes nothing.
function mergeDenyRules (projectDir, rules) {
  const fs = require('fs')
  const dir = path.join(projectDir, '.claude')
  const file = path.join(dir, 'settings.json')
  let settings = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed
  } catch (_) { /* absent or unreadable: start from an empty object rather than fail */ }

  if (!settings.permissions || typeof settings.permissions !== 'object') settings.permissions = {}
  const existing = Array.isArray(settings.permissions.deny) ? settings.permissions.deny : []
  if (rules.every((rule) => existing.includes(rule))) return false

  settings.permissions.deny = [...new Set([...existing, ...rules])].sort()
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`)
  fs.renameSync(tmp, file)
  return true
}

// The file a write would leave behind, so a guard sees the result rather than a fragment. A
// path is returned project-relative with forward slashes, the one spelling the standards match.
// An edit whose text is not in the file cannot be reconstructed here; null lets the gate catch
// it at the end of the turn rather than blocking on a reconstruction that could be wrong.
function resultingFile (toolName, toolInput, projectDir) {
  const fs = require('fs')
  const raw = toolInput && toolInput.file_path
  if (typeof raw !== 'string' || !raw) return null
  const abs = path.isAbsolute(raw) ? raw : path.join(projectDir, raw)
  const rel = path.relative(projectDir, abs).split(path.sep).join('/')

  if (toolName === 'Write') {
    return { path: rel, content: String(toolInput.content == null ? '' : toolInput.content) }
  }
  if (toolName === 'Edit') {
    let current
    try {
      current = fs.readFileSync(abs, 'utf8')
    } catch (_) {
      return null
    }
    const oldText = toolInput.old_string
    const newText = toolInput.new_string == null ? '' : String(toolInput.new_string)
    if (typeof oldText !== 'string') return null
    const at = current.indexOf(oldText)
    if (at === -1) return null
    const content = toolInput.replace_all
      ? current.split(oldText).join(newText)
      : current.slice(0, at) + newText + current.slice(at + oldText.length)
    return { path: rel, content }
  }
  return null
}

// Session start.

function onSessionStart (payload, env) {
  const projectDir = projectDirFrom(payload)
  const project = state.readProject(projectDir)

  // After a compaction the model has lost the thread but the session is the same one: re-inject
  // only what it must not lose, and run no canary and write nothing. A compaction continues a
  // session, it does not restart it.
  if (payload.source === 'compact') {
    if (!project) return out.silent()
    const archetype = (project.archetype && project.archetype.id) || 'not yet decided'
    return out.sessionStart({
      contextForModel: `Still a to-spec project of type ${archetype}. Its guards remain in force: structure and presentation stay apart, no secret reaches a published file, commits stay signed, and nothing half-finished ships. See ${statusFile.FILENAME} for what is open.`
    })
  }

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

  // A second layer for a session where the hooks cannot run: deny rules for the secret files this
  // repository ignores, written into the project's settings. It is not this session's protection
  // -- that is PreToolUse, F9 having shown a rule written mid-session binds unreliably -- so it is
  // best-effort, and never presented as immediate.
  try {
    const rules = secretDenyRules(projectDir, env.gitIn(projectDir))
    if (rules.length) mergeDenyRules(projectDir, rules)
  } catch (_) { /* best-effort; the pre-tool guard carries the protection */ }

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

  // Before a write lands, the file it would produce is held to the placement standards this
  // project's archetype composes: styling, scripting or logic about to be mixed into the markup
  // is stopped here, where the fix is cheap, rather than only caught at the end of the turn. An
  // edit is reconstructed as the file would read after it, since the fragment alone has no
  // context. Where the guards cannot be composed or the result cannot be reconstructed, the
  // write is allowed and the gate catches it: prevention where it can, repair otherwise.
  if (toolName === 'Write' || toolName === 'Edit') {
    const target = resultingFile(toolName, payload.tool_input, projectDir)
    if (target) {
      const { standards: composed } = composeStandards(env.pluginRoot, project, standards.loadAll(env.pluginRoot))
      // Only a blocking standard refuses a write; a report-level one is surfaced at the gate, not
      // used to stop a tool, so it never turns a write into a refusal here.
      const guards = standards.selectFor(composed, 'PreToolUse').filter((s) => s.definition.severity === 'block')
      const guardCtx = standards.makeContext({ projectDir, deadline: clock })
      let refusing = null
      const findings = []
      for (const guard of guards) {
        const result = standards.runStandard(guard, { mode: 'file', projectDir, files: [target] }, guardCtx)
        if (result.status === standards.FAIL && result.findings.length) {
          if (!refusing) refusing = guard
          for (const finding of result.findings) findings.push(finding)
        }
      }
      if (refusing) {
        const def = refusing.definition
        const lang = String(catalogue.language || 'en').split('-')[0]
        const personLines = (def.message && (def.message[lang] || def.message.en)) || []
        const cap = (def.limits && def.limits.max_findings) || findings.length
        const detail = findings.slice(0, cap).map((f) => `${f.path}:${f.line || '?'} ${f.message}`).join('; ')

        // A guard that refuses the same file over and over becomes a tax rather than a help.
        // The count is per file and persisted, so past the fourth refusal the decision is handed
        // to the person. If the count cannot be written, denying is the safe direction.
        let refusals = 0
        state.updateState(projectDir, (s) => {
          if (!s.refusals) s.refusals = {}
          s.refusals[target.path] = (s.refusals[target.path] || 0) + 1
          refusals = s.refusals[target.path]
        })
        const answer = refusals >= ESCALATE_AFTER ? out.askTool : out.refuseTool
        return answer({
          reasonForModel: `${def.reason.en} Found: ${detail}`,
          lineForPerson: personLines.join(' ')
        })
      }
    }
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
  const ctx = standards.makeContext({ projectDir, deadline: clock })

  const results = []

  // The project is held to the standards its archetype composes, not to every standard that
  // exists: a rule for one kind of project must not fire on another. A catalogue that cannot be
  // read, an archetype that cannot be composed, or an archetype naming a standard the catalogue
  // does not hold is not a turn with nothing to check. Each is surfaced as unavailable so it
  // reaches the gate as something outstanding, never as the silence the whole plugin refuses.
  const catalogueProblem = standards.catalogueError(env.pluginRoot)
  if (catalogueProblem) {
    results.push({ id: 'to-spec.catalogue', status: standards.UNAVAILABLE, findings: [], why: catalogueProblem })
  }

  const archetypeId = (project.archetype && project.archetype.id) || null
  const archetype = archetypeId
    ? archetypes.loadArchetype(env.pluginRoot, archetypeId)
    : { broken: 'the project names no archetype to compose' }

  let selected = []
  if (archetype.broken) {
    results.push({
      id: 'to-spec.archetype',
      status: standards.UNAVAILABLE,
      findings: [],
      why: `the archetype '${archetypeId || ''}' could not be composed: ${archetype.broken}`
    })
  } else {
    const byId = new Map(loaded.map((s) => [s.id, s]))
    const composed = []
    for (const id of archetypes.composedStandardIds(archetype)) {
      const found = byId.get(id)
      if (found) composed.push(found)
      else {
        results.push({
          id,
          status: standards.UNAVAILABLE,
          findings: [],
          why: `the archetype composes '${id}', which the catalogue does not hold`
        })
      }
    }
    selected = standards.selectFor(composed, 'Stop')
    if (selected.length === 0 && results.length === 0) {
      results.push({
        id: 'to-spec.archetype',
        status: standards.UNAVAILABLE,
        findings: [],
        why: 'the archetype composes nothing that runs at the end of a turn'
      })
    }
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

// A prompt is being submitted. This never blocks; it only adds context. Outside a project it
// points the model at starting one; inside one it carries the rule that guards against undoing
// work already done, and the open items when there are any, so a clean project pays one line and
// a busy one is reminded of what is still open.
function onUserPromptSubmit (payload) {
  const projectDir = projectDirFrom(payload)
  const project = state.readProject(projectDir)

  if (!project) {
    return out.promptSubmit({
      contextForModel: 'This directory is not a to-spec project yet. If the person is describing a site or app to build, deduce the archetype from what they say, tell them the defaults you will start with, and invoke Skill to-spec:new; do not ask questions first.'
    })
  }

  const current = state.readState(projectDir)
  const outstanding = current.outstanding || {}
  const open = ['agent', 'user', 'unverifiable'].map((key) => (outstanding[key] || []).length)

  const context = ['Before acting on this request, check that it does not regress a quality the project has already reached.']
  if (open.some((count) => count > 0)) {
    context.push(`Open items: ${open[0]} to put right, ${open[1]} that need the person, ${open[2]} not verifiable here. See ${statusFile.FILENAME}.`)
  }
  return out.promptSubmit({ contextForModel: context.join(' ') })
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
  ConfigChange: onConfigChange,
  UserPromptSubmit: onUserPromptSubmit
}

function handle (event, payload, env) {
  const handler = HANDLERS[event] || onOther
  return handler(payload || {}, env)
}

module.exports = { handle, HANDLERS, REPORT_RELATIVE }
