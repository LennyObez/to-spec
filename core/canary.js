'use strict'

// Whether the protections are actually working on this machine.
//
// Everything else in this plugin assumes its own checks run. That assumption is worth exactly
// nothing unless something tests it, because the failure mode is silence: a check that never
// runs and a check that found nothing produce the same result, which is no result at all.
//
// So each standard is replayed against both of its fixtures at session start. The one that
// is meant to fail must fail, and with the findings it declared. The one that is meant to
// pass must pass. A standard that reports itself unavailable in either direction is red:
// unavailable is an honest answer to a question about a project, and a useless answer to a
// question about whether the machinery works.
//
// Only silence is cached. A red result is replayed at every start, because a broken guard
// that reports itself once and then goes quiet is worse than one that never reported at all.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const { loadAll, catalogueError, makeContext, runStandard, PASS, FAIL } = require('./standards')

const RED = 'red'
const GREEN = 'green'

// Every byte the verdict depends on, so that a cached green is served only when nothing that
// could change the verdict has changed. The earlier key hashed process.version, three
// manifests and, per standard, standard.json + check.js -- and so served a stale green after
// a fixture was emptied, a meta.json rewritten, or the runner in core/ altered, none of which
// it covered. This folds in each standard's whole directory (fixtures and their expectations
// included) and every source file that produces the verdict.
function hashTree (hash, root) {
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir).sort()
    } catch (err) {
      hash.update(`unreadable:${dir}:${err.code || err.message}`)
      return
    }
    for (const name of entries) {
      const full = path.join(dir, name)
      let stat
      try {
        stat = fs.statSync(full)
      } catch (err) {
        hash.update(`unstattable:${full}`)
        continue
      }
      if (stat.isDirectory()) {
        walk(full)
      } else {
        hash.update(full)
        try {
          hash.update(fs.readFileSync(full))
        } catch (err) {
          hash.update(`unreadable:${full}`)
        }
      }
    }
  }
  walk(root)
}

function fingerprintOf (pluginRoot, standards) {
  const hash = crypto.createHash('sha256')
  hash.update(process.version)
  for (const file of ['hooks/hooks.json', 'compat.json', '.claude-plugin/plugin.json']) {
    try {
      hash.update(fs.readFileSync(path.join(pluginRoot, file)))
    } catch (_) {
      hash.update(`missing:${file}`)
    }
  }
  // The code that produces the verdict: the runner, the harness that drives it, the entry
  // point, and the catalogues a message is drawn from.
  for (const dir of ['core', 'harness', 'hooks', 'messages']) {
    hashTree(hash, path.join(pluginRoot, dir))
  }
  // Each standard whole, so a fixture or its declared expectations count as much as the check.
  for (const standard of standards.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update(standard.id)
    hashTree(hash, standard.dir)
  }
  return hash.digest('hex').slice(0, 32)
}

// The plugin's own prerequisites, checked before it judges anyone else's. A carriage return
// in a shipped file changes the bytes between platforms; a handler definition that does not
// point at this dispatcher means the thing being tested is not the thing that runs.
function ownPrerequisites (pluginRoot) {
  const problems = []

  const [major] = process.versions.node.split('.').map(Number)
  let floor = 20
  try {
    floor = Number(JSON.parse(fs.readFileSync(path.join(pluginRoot, 'compat.json'), 'utf8')).node.min.split('.')[0])
  } catch (_) { /* the declared floor is unreadable; the built-in one still applies */ }
  if (major < floor) problems.push(`the runtime is version ${process.versions.node}, below the declared floor of ${floor}`)

  let hooks
  try {
    hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks/hooks.json'), 'utf8'))
  } catch (err) {
    problems.push(`the handler definitions could not be read: ${err.message}`)
    return problems
  }
  for (const [event, groups] of Object.entries(hooks.hooks || {})) {
    for (const group of groups) {
      for (const handler of group.hooks || []) {
        if (handler.command !== 'node' || !Array.isArray(handler.args)) {
          problems.push(`${event} is not invoked the way this plugin expects`)
          continue
        }
        const relative = String(handler.args[0] || '').replace('${CLAUDE_PLUGIN_ROOT}/', '')
        if (!fs.existsSync(path.join(pluginRoot, relative))) {
          problems.push(`${event} points at ${relative}, which is not there`)
        }
      }
    }
  }
  return problems
}

function findingsMatch (declared, actual) {
  // The caller guarantees `declared` is an array; a face with no declared findings is caught
  // before this is reached, so an undeclared expectation can never pass by defaulting here.
  if (!Array.isArray(declared)) return false
  if (declared.length !== actual.length) return false
  return declared.every((want, index) => {
    const got = actual[index] || {}
    if (want.path !== undefined && want.path !== got.path) return false
    if (want.message !== undefined && want.message !== got.message) return false
    return true
  })
}

// One standard, both faces. The declared findings are compared as well as the verdict,
// because "still fails" and "still fails for the reason it was written for" are different
// claims, and only the second one means the guard is intact.
function replayFixtures (standard) {
  if (standard.broken) return { id: standard.id, ok: false, why: standard.broken }

  const meta = standard.definition.fixtures || {}
  const expectations = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(standard.dir, meta.meta || 'fixtures/meta.json'), 'utf8'))
    } catch (err) {
      return null
    }
  })()
  if (!expectations) {
    return { id: standard.id, ok: false, why: 'it declares no expected findings, so its fixtures cannot be judged' }
  }

  // Every face the standard declares an answer for, not a hard-coded pair. A check with three
  // branches needs three fixtures, and a canary that only ever replays two of them cannot see
  // a regression that deletes the third: a file present but empty of what was looked for, a
  // syntax the guard stopped recognising. The faces are whatever the standard says it expects.
  const faces = Object.keys(expectations).filter((key) => key !== '$comment')
  if (!faces.includes('bad') || !faces.includes('good')) {
    return { id: standard.id, ok: false, why: 'it must declare at least a bad and a good fixture' }
  }

  for (const face of faces) {
    const dir = path.join(standard.dir, meta[face] || `fixtures/${face}`)
    if (!fs.existsSync(dir)) {
      return { id: standard.id, ok: false, why: `its ${face} fixture is declared but missing` }
    }
    const ctx = makeContext({ projectDir: dir })
    const result = runStandard(standard, { mode: 'tree', projectDir: dir }, ctx)
    const want = expectations[face] || {}
    const wantStatus = want.status || (face === 'good' ? PASS : FAIL)

    // A face that names a status but no findings has declared half an expectation. Comparing
    // against it would pass on any findings at all, which is the verdict-only match the whole
    // two-sided replay exists to avoid, so it is red rather than trusted.
    if (!Array.isArray(want.findings)) {
      return {
        id: standard.id,
        ok: false,
        why: `its ${face} fixture declares a status but no findings, so its answer cannot be judged for the right reason`
      }
    }

    if (result.status !== wantStatus) {
      return {
        id: standard.id,
        ok: false,
        why: `its ${face} fixture answered ${result.status} where ${wantStatus} was declared${result.why ? ` (${result.why})` : ''}`
      }
    }
    if (!findingsMatch(want.findings, result.findings)) {
      return {
        id: standard.id,
        ok: false,
        why: `its ${face} fixture still answers ${result.status}, but not for the reason it was written for`
      }
    }
  }
  return { id: standard.id, ok: true }
}

function cacheFile (dataDir, fingerprint) {
  return path.join(dataDir, 'canary', `${fingerprint}.json`)
}

// `dataDir` is the directory that survives an update of the plugin. Caching next to the code
// would mean every release starts by trusting a result produced by different code.
function run (pluginRoot, { dataDir = null, force = false } = {}) {
  const standards = loadAll(pluginRoot)
  const fingerprint = fingerprintOf(pluginRoot, standards)

  if (dataDir && !force) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile(dataDir, fingerprint), 'utf8'))
      if (cached && cached.state === GREEN) return { state: GREEN, fingerprint, fromCache: true, problems: [] }
    } catch (_) { /* no usable cache; measure again */ }
  }

  const problems = ownPrerequisites(pluginRoot)

  // A catalogue that could not be read, or one with nothing in it, is not a plugin that found
  // nothing to complain about: it is a plugin that cannot complain at all. Either would leave
  // the gate passing every turn by abstention, so both are red here rather than silent.
  const catalogueProblem = catalogueError(pluginRoot)
  if (catalogueProblem) {
    problems.push(catalogueProblem)
  } else if (standards.length === 0) {
    problems.push('the standards directory holds nothing to run, so the gate would pass every turn by abstention')
  }

  for (const standard of standards) {
    const outcome = replayFixtures(standard)
    if (!outcome.ok) problems.push(`${outcome.id}: ${outcome.why}`)
  }

  const state = problems.length === 0 ? GREEN : RED

  // Only silence is written down. A red result has to be earned again at every start.
  if (dataDir && state === GREEN) {
    try {
      const file = cacheFile(dataDir, fingerprint)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify({ state: GREEN, at: new Date().toISOString() }))
    } catch (_) { /* an uncacheable result is measured again, which is only slower */ }
  }

  return { state, fingerprint, fromCache: false, problems }
}

module.exports = { RED, GREEN, run, replayFixtures, ownPrerequisites, fingerprintOf }
