'use strict'

// Loading standards and running them.
//
// A standard is a directory, not a branch in this file. That is the whole design: adding one
// must never require editing the code that runs them, and an exit criterion of this milestone
// is that adding a second standard leaves the handler definitions untouched.
//
// Every check returns one of three states. `fail` carries findings. `pass` carries none.
// `unavailable` means the check could not run -- a tool missing, a version out of range, a
// deadline reached, an exception -- and it is never quietly folded into `pass`. That fold is
// how a project comes to look checked when nothing checked it.

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const htmlScan = require('../lib/html-scan')

const PASS = 'pass'
const FAIL = 'fail'
const UNAVAILABLE = 'unavailable'

const CATEGORIES = ['agent-fixable', 'user-required', 'unverifiable-here']
const SEVERITIES = ['off', 'report', 'require', 'block']
// Only the events a standard can actually be dispatched for: PreToolUse, where a guard looks at
// one file before it is written, and Stop, where the gate looks at the whole tree. An event
// added here without a dispatch path would let a standard declare a moment it will never run at;
// an invariant ties this list to the events index.js actually selects for.
const EVENTS = ['PreToolUse', 'Stop']
const SCOPES = ['file', 'tree']
const KINDS = ['check', 'guard']

function standardsRoot (pluginRoot) {
  return path.join(pluginRoot, 'standards')
}

// Why the root could not become a list of standards, or null when it could. An unreadable or
// absent catalogue is not an empty one: an empty list read as "nothing to check" is the exact
// fold this file exists to refuse, one level up. The caller that judges the machinery reads
// this so that a vanished catalogue is a red canary rather than a silent pass.
function catalogueError (pluginRoot) {
  const root = standardsRoot(pluginRoot)
  try {
    fs.readdirSync(root)
    return null
  } catch (err) {
    return `the standards directory could not be read: ${err.message}`
  }
}

function listStandardIds (pluginRoot) {
  const root = standardsRoot(pluginRoot)
  let entries
  try {
    entries = fs.readdirSync(root)
  } catch (_) {
    return []
  }
  // Per entry, never the whole listing at once. One entry that cannot be stat'ed -- a broken
  // symlink, a permission the rest of the directory does not share -- must name itself as a
  // broken standard, not erase every sound standard beside it by taking the filter down.
  const ids = []
  for (const entry of entries) {
    try {
      if (fs.statSync(path.join(root, entry)).isDirectory()) ids.push(entry)
    } catch (_) {
      ids.push(entry) // unstattable: kept so loadStandard reports it broken, rather than dropped
    }
  }
  return ids.sort()
}

function loadDefinition (pluginRoot, id) {
  const file = path.join(standardsRoot(pluginRoot), id, 'standard.json')
  let raw = fs.readFileSync(file, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  return JSON.parse(raw)
}

// Reported as problems rather than thrown, so that one malformed standard names itself
// instead of taking every other standard down with it.
function describeProblems (definition, id) {
  // A standard.json is valid JSON that is not an object: `null`, a number, an array. Reaching
  // for a field on it throws, and this runs outside the caller's try, so the throw would take
  // the whole run down. It becomes one named problem instead, like every other malformation.
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return ['its standard.json is not a JSON object']
  }

  const problems = []
  const need = (cond, what) => { if (!cond) problems.push(what) }

  need(definition.schemaVersion === 1, 'schemaVersion must be 1')
  need(definition.id === id, `id is "${definition.id}" but the directory is "${id}"`)
  need(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(definition.id)), 'id must be lowercase with hyphens')
  // The family groups rules that share a concern, so a whole family can be composed or tuned at
  // once without merging them into one rule that could carry only one severity. It is the unit
  // of organisation; the standard stays the unit of enforcement.
  need(typeof definition.family === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(definition.family),
    'family must be a lowercase-with-hyphens name')
  need(CATEGORIES.includes(definition.category), `category must be one of ${CATEGORIES.join(', ')}`)
  need(SEVERITIES.includes(definition.severity), `severity must be one of ${SEVERITIES.join(', ')}`)
  need(Array.isArray(definition.events) && definition.events.length > 0, 'events must be a non-empty list')
  for (const event of definition.events || []) {
    need(EVENTS.includes(event), `unknown event ${event}`)
  }
  for (const scope of definition.scope || []) {
    need(SCOPES.includes(scope), `unknown scope ${scope}`)
  }
  need(KINDS.includes(definition.kind), `kind must be one of ${KINDS.join(', ')}`)

  // The invariant that keeps a gate honest: only a standard the agent can act on may stop
  // it. Blocking on something only a person can resolve turns a guard into an obstacle.
  need(!(definition.severity === 'block' && definition.category !== 'agent-fixable'),
    'only an agent-fixable standard may block')
  need(!(definition.severity === 'require' && definition.category !== 'user-required'),
    'a required standard is one a person must resolve')

  need(definition.events && definition.events.includes('Stop')
    ? (definition.scope || []).includes('tree') : true,
  'a standard that runs at the end of a turn must be able to look at the whole tree')

  need(definition.events && definition.events.includes('PreToolUse')
    ? (definition.scope || []).includes('file') : true,
  'a standard that runs before a write must be able to look at that one file')

  // Declared limits must be present and usable, or a bound the runtime is meant to apply is a
  // key nobody reads. `max_findings` caps how much a noisy check can make the run write;
  // `timeout_ms` is the budget a cooperative check honours through ctx.timeLeft().
  const limits = definition.limits
  need(limits && typeof limits === 'object', 'limits must declare timeout_ms and max_findings')
  if (limits && typeof limits === 'object') {
    need(Number.isInteger(limits.timeout_ms) && limits.timeout_ms > 0, 'limits.timeout_ms must be a positive integer')
    need(Number.isInteger(limits.max_findings) && limits.max_findings > 0, 'limits.max_findings must be a positive integer')
  }

  // The person- and model-facing text, and the fixtures the canary needs. Validated here, so a
  // standard that declares any of them is held to a shape rather than carrying a key nothing
  // reads. `title` and `summary` are internal English; `message` is the person's line, two
  // strings at most and short enough to survive the event-name prefix the harness adds;
  // `reason` is the model's line; `review` says whether a reviewer looks at this standard.
  need(definition.title && typeof definition.title.en === 'string', 'title.en must be a string')
  need(definition.summary && typeof definition.summary.en === 'string', 'summary.en must be a string')
  need(typeof definition.review === 'boolean', 'review must be a boolean')
  need(definition.reason && typeof definition.reason.en === 'string', 'reason.en must be a string')
  const message = definition.message
  need(message && typeof message === 'object', 'message must declare en and fr')
  for (const lang of ['en', 'fr']) {
    const lines = message && message[lang]
    need(Array.isArray(lines) && lines.length >= 1 && lines.length <= 2,
      `message.${lang} must be one or two lines`)
    for (const line of Array.isArray(lines) ? lines : []) {
      need(typeof line === 'string' && line.length <= 200, `each message.${lang} line must be text of at most 200 characters`)
    }
  }

  const fixtures = definition.fixtures
  need(fixtures && typeof fixtures === 'object', 'fixtures must declare bad, good and meta')
  for (const part of ['bad', 'good', 'meta']) {
    need(fixtures && typeof fixtures[part] === 'string', `fixtures.${part} must name a path`)
  }

  // Optional data a standard may carry, each held to a shape so a declared key is one the
  // runtime reads. `paths` narrows what files the standard looks at; `allowlist` and `params`
  // are its own knobs, merged from the archetype then the project; `adapters` names the tools a
  // check needs, absent when it needs none.
  if (definition.paths !== undefined) {
    const p = definition.paths
    const ok = p && typeof p === 'object' && !Array.isArray(p)
    need(ok, 'paths must be an object with include and/or exclude')
    if (ok) {
      for (const key of Object.keys(p)) need(['include', 'exclude'].includes(key), `unknown paths key "${key}"`)
      for (const which of ['include', 'exclude']) {
        if (p[which] !== undefined) {
          need(Array.isArray(p[which]) && p[which].every((g) => typeof g === 'string' && g.length > 0),
            `paths.${which} must be a list of glob strings`)
        }
      }
    }
  }
  if (definition.allowlist !== undefined) {
    need(definition.allowlist && typeof definition.allowlist === 'object' && !Array.isArray(definition.allowlist),
      'allowlist must be an object')
  }
  if (definition.params !== undefined) {
    need(definition.params && typeof definition.params === 'object' && !Array.isArray(definition.params),
      'params must be an object')
  }
  if (definition.adapters !== undefined) {
    need(Array.isArray(definition.adapters) && definition.adapters.every((a) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(a)),
      'adapters must be a list of lowercase-with-hyphens ids')
  }

  // Nothing beyond the known schema. A key nobody validates is a key nobody reads, and this
  // file's whole design is that a standard is data with a fixed shape, not a place to stash
  // configuration the runtime silently ignores.
  const KNOWN = new Set([
    'schemaVersion', 'id', 'family', 'title', 'summary', 'category', 'severity',
    'events', 'scope', 'kind', 'review', 'message', 'reason', 'fixtures', 'limits',
    'paths', 'allowlist', 'params', 'adapters'
  ])
  for (const key of Object.keys(definition)) {
    // A $-prefixed key is a comment by convention, the same as in the catalogues, and is not
    // configuration; everything else must be part of the known schema.
    need(key.startsWith('$') || KNOWN.has(key), `unknown key "${key}": a standard.json holds no configuration the runtime does not read`)
  }
  if (limits && typeof limits === 'object') {
    for (const key of Object.keys(limits)) {
      need(['timeout_ms', 'max_findings'].includes(key), `unknown limits key "${key}"`)
    }
  }

  return problems
}

function loadStandard (pluginRoot, id) {
  const dir = path.join(standardsRoot(pluginRoot), id)
  let definition
  try {
    definition = loadDefinition(pluginRoot, id)
  } catch (err) {
    return { id, dir, broken: `its definition could not be read: ${err.message}` }
  }
  const problems = describeProblems(definition, id)
  if (problems.length) return { id, dir, definition, broken: problems.join('; ') }
  return { id, dir, definition }
}

function loadAll (pluginRoot) {
  return listStandardIds(pluginRoot).map((id) => loadStandard(pluginRoot, id))
}

// The context a check is handed. Everything a check needs to look at the project arrives
// through here, so that the same check runs identically against a real project, against a
// fixture, and inside the canary.
function makeContext ({ projectDir, deadline = null, log = () => {} }) {
  return {
    projectDir,
    read (relative) {
      return fs.readFileSync(path.join(projectDir, relative), 'utf8')
    },
    exists (relative) {
      return fs.existsSync(path.join(projectDir, relative))
    },
    // A standard is handed the scanner rather than reaching for it, so the same call runs
    // identically against a real project, a fixture and the canary.
    html: {
      scan (content) { return htmlScan.scan(content) }
    },
    // Read-only git, in the project this check is about. Arguments travel in a vector, never a
    // shell string. A command that fails returns its exit status rather than throwing, so a check
    // reads "not a repository" or "no such object" as an answer instead of a crash.
    git: {
      run (args) {
        try {
          const stdout = execFileSync('git', args, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
          return { status: 0, stdout }
        } catch (err) {
          return { status: typeof err.status === 'number' ? err.status : -1, stdout: err.stdout ? String(err.stdout) : '' }
        }
      }
    },
    list (relative = '.') {
      // A walk that cannot complete is not an empty project. Swallowing the error and returning
      // a short list would read as "the check looked and found nothing", which is the false
      // pass this whole file refuses. The exception propagates the way read()'s does, and
      // runStandard turns it into unavailable naming the standard.
      const walk = (dir, acc) => {
        for (const entry of fs.readdirSync(path.join(projectDir, dir))) {
          if (entry === '.git' || entry === 'node_modules' || entry === '.to-spec') continue
          const rel = dir === '.' ? entry : path.posix.join(dir, entry)
          if (fs.statSync(path.join(projectDir, rel)).isDirectory()) walk(rel, acc)
          else acc.push(rel)
        }
        return acc
      }
      return walk(relative, [])
    },
    timeLeft () {
      return deadline ? deadline.remaining : Infinity
    },
    log
  }
}

// One standard, one verdict. An exception inside a check becomes `unavailable` naming the
// standard, never a crash of the run and never a pass: a check that threw did not look.
function runStandard (standard, input, ctx) {
  if (standard.broken) {
    return { id: standard.id, status: UNAVAILABLE, findings: [], why: standard.broken }
  }
  let check
  try {
    check = require(path.join(standard.dir, 'check.js'))
  } catch (err) {
    return { id: standard.id, status: UNAVAILABLE, findings: [], why: `its check could not be loaded: ${err.message}` }
  }

  let result
  try {
    // The definition travels with the input, so a check reads its own paths, allowlist and
    // params from one place, whether the caller is the gate, the canary or a guard.
    result = check({ ...input, standard: standard.definition }, ctx)
  } catch (err) {
    return { id: standard.id, status: UNAVAILABLE, findings: [], why: `the check for ${standard.id} threw: ${err.message}` }
  }

  if (!result || typeof result !== 'object') {
    return { id: standard.id, status: UNAVAILABLE, findings: [], why: 'the check returned nothing usable' }
  }
  if (result.status === UNAVAILABLE) {
    return { id: standard.id, status: UNAVAILABLE, findings: [], why: result.why || 'no reason given', facts: result.facts }
  }

  // Findings decide the verdict, not a status the check also happens to set: a check that
  // reports findings and calls itself a pass is a contradiction, and the findings win.
  const findings = Array.isArray(result.findings) ? result.findings : []
  const sorted = findings.slice().sort((a, b) =>
    String(a.path || '').localeCompare(String(b.path || '')) || (a.line || 0) - (b.line || 0))

  // Capped to the standard's declared limit, with the true count kept. A check that finds ten
  // thousand things must not make every turn write a report of ten thousand things; the number
  // is what the person needs, and the first few are what they act on.
  const cap = standard.definition && standard.definition.limits && standard.definition.limits.max_findings
  const kept = Number.isInteger(cap) && cap > 0 ? sorted.slice(0, cap) : sorted

  return {
    id: standard.id,
    status: sorted.length === 0 ? PASS : FAIL,
    findings: kept,
    total: sorted.length,
    facts: result.facts
  }
}

// Selection is by event and by severity. A standard switched off is not run at all, rather
// than run and ignored, so that switching one off cannot cost time or throw.
function selectFor (standards, event) {
  return standards.filter((s) => {
    if (s.broken) return true // a broken standard reports itself wherever it would have run
    const d = s.definition
    return d.severity !== 'off' && Array.isArray(d.events) && d.events.includes(event)
  })
}

module.exports = {
  PASS,
  FAIL,
  UNAVAILABLE,
  CATEGORIES,
  SEVERITIES,
  EVENTS,
  SCOPES,
  KINDS,
  standardsRoot,
  catalogueError,
  listStandardIds,
  loadStandard,
  loadAll,
  describeProblems,
  makeContext,
  runStandard,
  selectFor
}
