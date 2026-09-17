// Invariants of the plugin itself.
//
// A convention a test can verify must be a test. A test fails on its own, for everyone, in
// six months; a note depends on who reads it. Everything asserted here is a property the
// plugin claims about itself.
//
// Two rules govern how these are written. An assertion states what must be true, not a list of
// things that might be absent: a blacklist is a guess about the shapes a defect can take. A
// few guards here legitimately require an absence -- no carriage return, no em dash, no
// competitor's name, no shell -- but each does so over the shape of the violation, and each
// carries a counter so it cannot pass having inspected nothing. And an assertion that cannot
// fail is a comment wearing a test's clothes, so each one has been checked against the
// violation it forbids.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join, dirname, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const json = (p) => JSON.parse(read(p))

function walk (dir, acc = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === '.git' || entry === 'node_modules') continue
    const rel = dir === '.' ? entry : join(dir, entry)
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, acc)
    else acc.push(rel)
  }
  return acc
}

// Files the repository ignores are not published, so a stray gitignored note -- a worklog, a
// local settings file -- must not be held to the rules for tracked content. git decides what
// is ignored; if git is absent or fails, everything is kept, so the guards can only tighten,
// never silently weaken.
function gitIgnored () {
  try {
    const { execFileSync } = createRequire(import.meta.url)('node:child_process')
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '--others', '--ignored', '--exclude-standard'], { encoding: 'utf8' })
    return new Set(out.split('\n').filter(Boolean))
  } catch (_) {
    return new Set()
  }
}

// git reports with forward slashes; walk() uses the platform separator. Compared on a common
// spelling so the filter holds on every platform.
const IGNORED = gitIgnored()
const ALL_FILES = walk('.').filter((f) => !IGNORED.has(f.split('\\').join('/')))

// Words that make a value look filled in while saying nothing. A length check alone lets
// every one of them through.
const UNFINISHED = /\b(TODO|FIXME|TBD|XXX|placeholder|to be decided|fill in|later)\b/i

function meaningful (value, what) {
  assert.equal(typeof value, 'string', `${what} must be text`)
  assert.ok(value.trim().length > 0, `${what} is empty`)
  assert.ok(!UNFINISHED.test(value), `${what} still reads as unfinished: ${JSON.stringify(value)}`)
}

// The events this plugin instruments. Naming them here is what turns a typo in a manifest
// into a failing test rather than a handler that is simply never called.
const INSTRUMENTED_EVENTS = ['SessionStart', 'PreToolUse', 'Stop', 'ConfigChange']

test('the suite itself is not empty', () => {
  // A runner given no matching file reports success. The gate can therefore become vacuous
  // without ever going red, so the file count is asserted rather than assumed.
  const suites = ALL_FILES.filter((f) => f.startsWith('tests') && f.endsWith('.test.mjs'))
  assert.ok(suites.length >= 1, 'no test file was discovered, so a green run would mean nothing')
})

test('the plugin manifest declares what the marketplace needs, and means it', () => {
  const manifest = json('.claude-plugin/plugin.json')
  for (const field of ['name', 'version', 'description', 'license']) {
    meaningful(manifest[field], `manifest field ${field}`)
  }
  assert.match(manifest.name, /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'the plugin name is an immutable slug and must be lowercase with hyphens')
  assert.match(manifest.version, /^\d+\.\d+\.\d+/, 'the version must be comparable')
  assert.match(manifest.license, /^[A-Za-z0-9.+-]+$/,
    'the licence must be a recognised identifier, not prose')
})

test('every instrumented event has a handler, and no handler names an unknown event', () => {
  const hooks = json('hooks/hooks.json')
  assert.ok(hooks.hooks && typeof hooks.hooks === 'object',
    'the handler map lives under a "hooks" key; a bare map is silently ignored')
  meaningful(hooks.description, 'the handler file description')

  const declared = Object.keys(hooks.hooks).map((k) => k.split(':')[0])
  for (const event of INSTRUMENTED_EVENTS) {
    assert.ok(declared.includes(event), `${event} is instrumented nowhere`)
  }
  for (const event of declared) {
    assert.ok(INSTRUMENTED_EVENTS.includes(event),
      `${event} is declared but is not one of the events this plugin instruments`)
  }
})

test('the pre-tool matcher is every tool, not a list believed to write', () => {
  // The ledger treats a tool as writing unless proven to only read, and the manifest must
  // agree: an enumerated matcher would miss the shell, the subagent, the connected tool, and
  // their turns would end in silence. The matcher is the widest one.
  const hooks = json('hooks/hooks.json')
  const groups = hooks.hooks.PreToolUse || []
  const matchers = groups.map((g) => g.matcher)
  assert.ok(matchers.includes('.*'),
    `the PreToolUse matcher must be ".*", not an enumerated list: ${JSON.stringify(matchers)}`)
})

test('the manifest declares exactly the events a real handler decides', () => {
  // An event declared in the manifest spawns a process on every occurrence. If its handler
  // only renders silence, that process does nothing, and the declaration is a cost with no
  // effect. So the manifest must name exactly the events wired to a deciding handler, never a
  // placeholder that falls through to the silent default.
  const require = createRequire(import.meta.url)
  const { HANDLERS } = require(join(ROOT, 'harness/claude-code/index.js'))
  const deciding = new Set(Object.entries(HANDLERS)
    .filter(([, fn]) => fn.name && fn.name !== 'onOther')
    .map(([event]) => event))
  const declared = new Set(Object.keys(json('hooks/hooks.json').hooks).map((k) => k.split(':')[0]))
  assert.deepEqual([...declared].sort(), [...deciding].sort(),
    'the manifest and the deciding handlers must name the same events, or one declares work the other does not do')
})

test('every handler is invoked in exec form, and its entry point exists', () => {
  const hooks = json('hooks/hooks.json')
  const entries = new Set()

  for (const [event, groups] of Object.entries(hooks.hooks)) {
    assert.ok(Array.isArray(groups) && groups.length > 0, `${event} must hold at least one matcher group`)
    for (const group of groups) {
      assert.ok(Array.isArray(group.hooks) && group.hooks.length > 0, `${event}: an empty group runs nothing`)
      for (const h of group.hooks) {
        assert.equal(h.type, 'command', `${event}: only command handlers are used`)
        assert.equal(h.command, 'node',
          `${event}: the interpreter is named explicitly so no shell is involved`)
        assert.ok(Array.isArray(h.args) && h.args.length >= 2,
          `${event}: arguments travel in a vector, never in a command string`)

        const prefix = '${CLAUDE_PLUGIN_ROOT}/'
        assert.ok(h.args[0].startsWith(prefix),
          `${event}: the entry point is resolved from the plugin root`)

        // The path is checked for existence with its exact spelling, because the platform
        // most likely to disagree about case is the one whose filesystem does not care.
        const relative = h.args[0].slice(prefix.length)
        entries.add(relative)
        const segments = relative.split('/')
        let atPath = ROOT
        for (const segment of segments) {
          const siblings = readdirSync(atPath)
          assert.ok(siblings.includes(segment),
            `${event}: ${relative} does not exist with that exact spelling (${segment} not found)`)
          atPath = join(atPath, segment)
        }

        assert.equal(h.args[1], event.split(':')[0],
          `${event}: the handler is told which event it is serving`)
        assert.ok(Number.isInteger(h.timeout) && h.timeout > 0,
          `${event}: a declared timeout is what makes an internal deadline meaningful`)
      }
    }
  }
  assert.ok(entries.size >= 1, 'no entry point is referenced at all')
})

test('no handler is invoked through a script a platform might not run', () => {
  const flat = JSON.stringify(json('hooks/hooks.json'))
  for (const ext of ['.cmd', '.bat', '.ps1', '.sh']) {
    assert.ok(!flat.includes(ext),
      `a ${ext} entry point does not run on every platform this plugin claims to support`)
  }
})

test('the dispatcher survives a payload it cannot parse', async () => {
  const { spawnSync } = await import('node:child_process')
  const run = spawnSync(process.execPath, [join(ROOT, 'hooks/dispatch.js'), 'SessionStart'], {
    input: 'this is not json',
    encoding: 'utf8'
  })
  assert.equal(run.status, 0,
    'an unparsable payload must not turn into a non-zero exit: that would block an action for the wrong reason')
})

test('a decision reaches a pipe whole, however large', async () => {
  // Standard output is a pipe whenever a handler is invoked, and writes to a pipe are
  // asynchronous. Code that ends the process the moment it has written loses whatever has not
  // drained.
  //
  // The obvious version of this test, writing a lot and reading it all back at once, passes
  // against the very defect it describes roughly half the time, because a reader that drains
  // continuously keeps the pipe from ever filling. So the reader is held shut first. The
  // child then blocks mid-write, which is the situation this guard exists for, and an early
  // exit truncates every time rather than sometimes.
  const { spawn } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')

  const dir = mkdtempSync(join(tmpdir(), 'to-spec-flush-'))
  try {
    const script = join(dir, 'emit.js')
    writeFileSync(script, `
      const io = require(${JSON.stringify(join(ROOT, 'hooks/io.js'))})
      io.emit({ stdout: { decision: 'block', reason: 'x'.repeat(400000) }, exitCode: 2 })
    `)

    const { stdout, code } = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'ignore'] })
      let collected = ''
      child.stdout.pause()
      setTimeout(() => {
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk) => { collected += chunk })
        child.stdout.resume()
      }, 400)
      child.on('error', reject)
      child.on('close', (c) => resolve({ stdout: collected, code: c }))
    })

    assert.equal(code, 2, 'the exit code has to survive the process ending on its own')
    const parsed = JSON.parse(stdout)
    assert.equal(parsed.reason.length, 400000,
      `the decision was truncated: ${parsed.reason.length} of 400000 characters arrived`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('every compatibility floor cites the feature that imposes it', () => {
  const compat = json('compat.json')
  for (const key of ['harness', 'node', 'git']) {
    assert.ok(compat[key], `compat.json is missing ${key}`)
    // A real, comparable version, and one no leading zero could have smuggled past: "2.05.0"
    // matches a lax pattern, is not a release anyone shipped, and quietly means 2.5.0. Each
    // segment is its own integer with no leading zero, so a floor that names no real version
    // cannot masquerade as one.
    const floor = String(compat[key].min)
    assert.match(floor, /^\d+\.\d+\.\d+$/, `${key}: the floor must be a comparable version`)
    for (const segment of floor.split('.')) {
      assert.equal(String(Number(segment)), segment, `${key}: "${floor}" has a segment that is not a bare integer`)
    }
    meaningful(compat[key].minReason, `${key}: the reason for the floor`)
    assert.ok(compat[key].minReason.length > 25,
      `${key}: a floor whose reason fits in a few words cannot be revised later on purpose`)

    // A floor derived from a document and a floor derived from a run are different claims,
    // and the difference is exactly what gets forgotten. Each one says which it is.
    assert.ok(typeof compat[key].minEvidence === 'string' &&
      /^(measured|reasoned)\b/.test(compat[key].minEvidence),
      `${key}: the floor must say whether it was measured or reasoned`)
  }
  assert.equal(typeof compat.stop.softVerified, 'boolean')
  meaningful(compat.stop.softVerifiedReason, 'the reason the soft path is marked verified')
  assert.match(compat.stop.softVerifiedReason, /\bF1b\b/, 'a probed flag names the probe that set it')
})

test('the runtime running these tests satisfies the floor the plugin declares', () => {
  const floor = json('compat.json').node.min.split('.').map(Number)
  const actual = process.versions.node.split('.').map(Number)
  const compare = actual.map((n, i) => n - (floor[i] || 0)).find((d) => d !== 0) ?? 0
  assert.ok(compare >= 0,
    `these tests run on Node ${process.versions.node}, below the declared floor of ${floor.join('.')}; a suite green under an unsupported runtime measures nothing`)
})

test('no text file carries carriage returns', () => {
  // Every file is inspected. Deciding by extension would skip exactly the files that have
  // none, and a normalisation rule that skips files is not a normalisation rule.
  let inspected = 0
  for (const file of ALL_FILES) {
    const bytes = readFileSync(join(ROOT, file))
    if (bytes.includes(0)) continue // binary
    inspected++
    assert.ok(!bytes.includes(0x0d),
      `${file} carries a carriage return, which the no-carriage-return rule rejects and which shifts the bytes of a shipped file between platforms`)
  }
  assert.ok(inspected > 0, 'no file was inspected, so this guard would pass vacuously')
})

test('the licence the manifest declares is the one the repository carries', () => {
  // A declared licence with no text grants nothing: whoever clones the repository is told
  // which terms apply and given no way to read them. The table is what makes this fail on a
  // change of licence as well as on a missing file, since an identifier it does not know is
  // an identifier whose text nobody has added.
  const identifying = {
    'Apache-2.0': /Apache License\s+Version 2\.0, January 2004/,
    'CC0-1.0': /Creative Commons Legal Code\s+CC0 1\.0 Universal/
  }
  const declared = json('.claude-plugin/plugin.json').license
  assert.ok(identifying[declared], `${declared} is declared, and this guard holds no text to recognise it by`)
  assert.ok(existsSync(join(ROOT, 'LICENSE')), `the manifest declares ${declared} and there is no LICENSE file`)
  assert.match(read('LICENSE'), identifying[declared],
    `LICENSE does not read as ${declared}, which the manifest declares`)
})

test('no text file uses an em dash', () => {
  // The house style punctuates with commas, colons and full stops. The character is written
  // by code point rather than typed, so that this guard is not itself the one occurrence it
  // is looking for.
  const emDash = String.fromCharCode(0x2014)
  let inspected = 0
  for (const file of ALL_FILES) {
    const bytes = readFileSync(join(ROOT, file))
    if (bytes.includes(0)) continue // binary
    inspected++
    assert.ok(!bytes.toString('utf8').includes(emDash),
      `${file} uses an em dash, which the writing conventions of this repository do not`)
  }
  assert.ok(inspected > 0, 'no file was inspected, so this guard would pass vacuously')
})

test('documentation filenames are lowercase with hyphens', () => {
  // The extension is matched case-insensitively, or a file named in the very style the rule
  // forbids would be excluded from the rule.
  //
  // The conventional health files keep their conventional names. Tooling and people both
  // look for them by those exact spellings, and a repository that renamed them to follow a
  // house style would be following it into invisibility.
  const conventional = new Set([
    'README.md', 'LICENSE.md', 'CHANGELOG.md', 'CONTRIBUTING.md',
    'SECURITY.md', 'CODE_OF_CONDUCT.md', 'SUPPORT.md', 'CODEOWNERS.md'
  ])
  let checked = 0
  for (const file of ALL_FILES) {
    if (extname(file).toLowerCase() !== '.md') continue
    // Fixtures are shaped like the projects they stand in for, and real projects carry files
    // named the way real projects name them. Holding test data to a documentation convention
    // would make the fixture a worse likeness for no gain.
    if (file.split('\\').join('/').includes('/fixtures/')) continue
    if (conventional.has(basename(file))) continue
    checked++
    assert.match(basename(file), /^[a-z0-9]+(-[a-z0-9]+)*\.md$/, `${file} does not follow the naming rule`)
  }
  assert.ok(checked > 0, 'no documentation was checked, so this guard would pass vacuously')
})

test('the roadmap and the bench agree on which probes exist', () => {
  const roadmap = read('docs/roadmap.md')
  const bench = read('bench/probes/run.mjs')

  // Every checkbox state, not only the two that were in use when this was written.
  const inRoadmap = new Set([...roadmap.matchAll(/^- \[[^\]]\] (F\d+[a-c]?):/gm)].map((m) => m[1]))
  const inBench = new Set([...bench.matchAll(/^\s*id: '(F\d+[a-c]?)'/gm)].map((m) => m[1]))

  assert.ok(inBench.size > 0, 'no probe was found in the bench, so this guard would pass vacuously')
  assert.deepEqual([...inRoadmap].filter((id) => !inBench.has(id)), [],
    'probes listed in the roadmap with nothing in the bench to measure them')
  assert.deepEqual([...inBench].filter((id) => !inRoadmap.has(id)), [],
    'probes in the bench that the roadmap never claims')
})

test('every probe the roadmap marks done records what was observed', () => {
  const roadmap = read('docs/roadmap.md')
  const evidence = read('docs/evidence.md')
  const done = [...roadmap.matchAll(/^- \[x\] (F\d+[a-c]?):/gm)].map((m) => m[1])
  assert.ok(done.length > 0, 'no probe is marked done, so this guard would pass vacuously')

  const sections = evidence.split(/^## /m)
  for (const id of done) {
    const section = sections.find((s) => s.startsWith(`${id}:`))
    assert.ok(section, `${id} is marked done but the evidence register has no section for it`)
    assert.ok(section.length > 400,
      `the entry for ${id} is a heading with almost nothing under it, which records nothing`)
    assert.match(section, /\*\*(Observed|Stable|Measured)/,
      `the entry for ${id} never states what was observed`)
  }
})

test('every workflow pins every third-party action to a full commit', () => {
  const workflows = ALL_FILES.filter((f) => f.startsWith(join('.github', 'workflows')))
  assert.ok(workflows.length > 0, 'no workflow was found, so this guard would pass vacuously')
  let pinned = 0
  for (const file of workflows) {
    for (const [, ref] of read(file).matchAll(/uses:\s*([^\s]+)/g)) {
      pinned++
      assert.match(ref, /@[0-9a-f]{40}$/,
        `${file}: ${ref} is not pinned to a full commit, which is the only immutable reference`)
    }
  }
  assert.ok(pinned > 0, 'no action is used anywhere, so this guard would pass vacuously')
})

test('the status file is named in one place only', () => {
  // Every reader of this name, the session start, the gate and the ignore file, has to agree
  // with every other. One literal is how they are kept in agreement; several is how they
  // stop being.
  // The module that owns the name, and this guard, which cannot look for a literal without
  // containing it. Those two, and nothing else.
  const mayName = new Set(['core/status-file.js', 'tests/invariants.test.mjs'])
  const offenders = []
  for (const file of ALL_FILES) {
    if (mayName.has(file.split('\\').join('/'))) continue
    const bytes = readFileSync(join(ROOT, file))
    if (bytes.includes(0)) continue
    if (bytes.toString('utf8').includes('project-status.md')) offenders.push(file)
  }
  assert.deepEqual(offenders, [],
    'the status file name belongs in core/status-file.js and nowhere else')
})

test('the plugin loads nothing beyond the runtime it can assume', () => {
  // Stated over the whole of the plugin's own source rather than one file, because the entry
  // point is only as constrained as the least constrained thing it loads. A dependency here
  // would mean an install step before a single guard could run.
  const allowed = new Set([
    'fs', 'path', 'crypto', 'child_process',
    'node:fs', 'node:path', 'node:crypto', 'node:child_process'
  ])
  let inspected = 0
  for (const file of ALL_FILES) {
    const normalised = file.split('\\').join('/')
    if (!/^(core|harness|hooks)\//.test(normalised) || !normalised.endsWith('.js')) continue
    inspected++
    for (const [, mod] of read(file).matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (mod.startsWith('.')) continue // within the plugin, and held to this same rule
      assert.ok(allowed.has(mod), `${file} loads ${mod}, which is not part of the runtime`)
    }
  }
  assert.ok(inspected >= 3, 'too little was inspected for this guard to mean anything')
})

test('the plugin never reaches a shell, however it runs a command', () => {
  // Naming an interpreter is not the danger; handing a string to a shell is. Asserted over the
  // shape rather than a handful of literals: any spelling of a `shell` key set to a truthy
  // value (bare, quoted, any spacing), and any string-command entry point (exec, execSync, and
  // the string form of a spawn), are refused. A command assembled as a string is the shape
  // every injection takes; arguments must travel in a vector so nothing in a path is
  // interpreted. The counter refuses a version of this guard that inspected nothing.
  const SHELL_KEY = /["']?shell["']?\s*:\s*(true|["']?(bash|sh|cmd|powershell|pwsh)["']?)/i
  // An allowlist, not a blacklist of the two bad names: every child_process entry point a file
  // reaches for must be one of the vector-argument forms. A new string-command spelling, or a
  // computed method name, is caught by being absent from the allowed set rather than by being
  // present in a forbidden one.
  const ALLOWED_CP = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync'])
  const CP_CALL = /\b(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/g
  let inspected = 0
  for (const file of ALL_FILES) {
    const normalised = file.split('\\').join('/')
    if (!/^(core|harness|hooks)\//.test(normalised) || !normalised.endsWith('.js')) continue
    inspected++
    const source = read(file)
    assert.ok(!SHELL_KEY.test(source),
      `${file} sets a shell for a command: arguments must travel in a vector so nothing in a path is interpreted`)
    for (const [, method] of source.matchAll(CP_CALL)) {
      assert.ok(ALLOWED_CP.has(method),
        `${file} runs a command through ${method}(): only the vector-argument forms ${[...ALLOWED_CP].join(', ')} are allowed`)
    }
  }
  assert.ok(inspected > 0, 'no source file was inspected, so this guard would pass vacuously')
})

test('nothing that runs knows the name of any standard', () => {
  // The load-bearing property of the whole design: a standard is a directory. If the code
  // that runs named even one of them, the catalogue could only grow as fast as someone could
  // safely edit a dispatcher, and every addition would risk every existing guard.
  //
  // Asserted structurally rather than by observing one addition, because "adding a standard
  // changed no code" is true of a particular afternoon and this is true of the design.
  const ids = readdirSync(join(ROOT, 'standards'))
    .filter((entry) => statSync(join(ROOT, 'standards', entry)).isDirectory())
  assert.ok(ids.length >= 2,
    'one standard cannot demonstrate that a second costs nothing; there must be at least two')

  for (const file of ALL_FILES) {
    const normalised = file.split('\\').join('/')
    if (!/^(core|harness|hooks)\//.test(normalised)) continue
    const source = read(file)
    for (const id of ids) {
      assert.ok(!source.includes(id),
        `${file} names the standard "${id}"; nothing that runs may know a standard by name`)
    }
  }
})

test('every standard declares itself the same way, and the loader agrees', async () => {
  const standards = createRequire(import.meta.url)(join(ROOT, 'core/standards.js'))
  const loaded = standards.loadAll(ROOT)
  assert.ok(loaded.length >= 2)
  for (const standard of loaded) {
    assert.equal(standard.broken, undefined,
      `${standard.id} does not load: ${standard.broken}`)
    // At least both faces, or the canary has nothing to replay and the standard cannot be
    // shown to work in either direction.
    for (const face of ['bad', 'good']) {
      assert.ok(existsSync(join(standard.dir, 'fixtures', face)),
        `${standard.id} has no ${face} fixture`)
    }
    // Every declared expectation has a fixture, and every fixture a declared expectation, so
    // that a branch of the check either gets replayed by the canary or is not silently missing
    // one. A directory with no expectation would never be replayed; an expectation with no
    // directory would make the canary red on a machine where the standard is fine.
    const meta = JSON.parse(readFileSync(join(standard.dir, 'fixtures', 'meta.json'), 'utf8'))
    const declaredFaces = Object.keys(meta).filter((key) => key !== '$comment')
    const fixtureDirs = readdirSync(join(standard.dir, 'fixtures'))
      .filter((name) => statSync(join(standard.dir, 'fixtures', name)).isDirectory())
    for (const face of declaredFaces) {
      assert.ok(fixtureDirs.includes(face),
        `${standard.id} declares a ${face} expectation with no fixture to replay it against`)
      // Every face declares its findings as an array, even an empty one for a good fixture. A
      // status without findings is half an expectation, and the canary would then accept any
      // findings at all for that face.
      assert.ok(Array.isArray(meta[face].findings),
        `${standard.id}'s ${face} expectation declares no findings array, so its answer cannot be judged for the right reason`)
    }
    for (const dir of fixtureDirs) {
      assert.ok(declaredFaces.includes(dir),
        `${standard.id} carries a ${dir} fixture that no expectation names, so the canary never replays it`)
    }
    assert.ok(existsSync(join(standard.dir, 'guidance.md')),
      `${standard.id} carries no guidance, so what it refuses can only be guessed at`)
  }
})

test('no tracked file names another product', () => {
  // A published file must not name a competitor. The earlier version of this guard proved the
  // rule by listing the very names it forbade and then exempting itself from its own rule, so
  // the one file advertising the discipline was the one file breaking it. This carries the
  // forbidden names only as truncated hashes: it recognises a name where it appears without
  // ever writing one down, and needs no exemption because it names nothing to begin with. The
  // plaintext list lives in the gitignored worklog, where the rule was written, not here.
  const forbidden = new Set([
    '57de4cf40144bdf7', '46a4eebd20d881ec', '3ea125d0bff386e6', '5d72436256ada538',
    '2f9cb7cda5222087', 'e0400ee81cd07bb2', '5d0c0ab127fdea24', '60965168ce762e94',
    '53b69ef92c836777'
  ])
  const digest = (token) => createHash('sha256').update(token).digest('hex').slice(0, 16)
  for (const file of ALL_FILES) {
    const bytes = readFileSync(join(ROOT, file))
    if (bytes.includes(0)) continue
    for (const token of bytes.toString('utf8').toLowerCase().match(/[a-z0-9]+/g) || []) {
      assert.ok(!forbidden.has(digest(token)),
        `${file} names a competing product; describe the mechanism generically instead`)
    }
  }
})

test('the test matrix runs on every platform the plugin claims, both Windows shells included', () => {
  // Parsed from the matrix that actually runs the suite, not searched over the whole file: a
  // windows-latest sitting only in the no-runtime job would satisfy a text search while the
  // tests never ran there. Each include entry is read as an (os, shell) pair.
  const text = read(join('.github', 'workflows', 'tests.yml'))
  // The block for the job named "matrix", up to the next top-level job, so entries from other
  // jobs cannot leak in.
  const start = text.indexOf('\n  matrix:')
  const rest = text.slice(start + 1)
  const nextJob = rest.search(/\n {2}[a-z][\w-]*:\n/)
  const matrixJob = nextJob === -1 ? rest : rest.slice(0, nextJob)
  const entries = [...matrixJob.matchAll(/- label:[^\n]*\n(?:\s+\w+:[^\n]*\n)*/g)].map((m) => m[0])
  const pairs = entries.map((e) => ({
    os: (e.match(/\bos:\s*(\S+)/) || [])[1],
    shell: (e.match(/\bshell:\s*(\S+)/) || [])[1]
  }))
  assert.ok(pairs.length >= 5, `the matrix should exercise several platforms: found ${pairs.length}`)
  const has = (os, shell) => pairs.some((p) => p.os === os && p.shell === shell)
  assert.ok(has('ubuntu-latest', 'bash'), 'linux with a POSIX shell must run the suite')
  assert.ok(has('macos-latest', 'bash'), 'macos must run the suite')
  assert.ok(has('windows-latest', 'bash'), 'windows with a POSIX shell must run the suite')
  assert.ok(has('windows-latest', 'pwsh'), 'windows without a POSIX shell is the case most likely to be wrong')
})

test('the empty-suite floor is a real floor, tied to the size of the suite', () => {
  // The workflow rejects a run reporting fewer than N passing tests, to catch a runner that
  // matched no files and called it success. That floor must be positive (a floor of zero is no
  // floor) and no higher than the suite actually carries (or CI would fail on a real run). If a
  // whole suite were deleted, the count would fall below the floor and this fails first, here.
  const text = read(join('.github', 'workflows', 'tests.yml'))
  const floors = [...text.matchAll(/-lt\s+(\d+)/g)].map((m) => Number(m[1]))
  assert.ok(floors.length >= 1, 'the workflow declares no empty-suite floor')
  assert.ok(floors.every((f) => f === floors[0]), 'the two shells must use the same floor')
  const floor = floors[0]
  assert.ok(floor > 0, 'a floor of zero is no floor at all')

  const suiteFiles = ALL_FILES.filter((f) => f.split('\\').join('/').match(/^tests\/.*\.test\.mjs$/))
  const testPoints = suiteFiles.reduce((n, f) => n + (read(f).match(/^test\(/gm) || []).length, 0)
  assert.ok(testPoints >= floor,
    `the suite carries ${testPoints} tests but the workflow floor is ${floor}: a floor above the suite would fail every real run`)
})
