// The entry point, end to end, against a real project on disk.
//
// Everything else in this suite tests a piece in isolation. This one runs the thing the
// harness actually invokes, with a payload of the shape the harness actually sends, and reads
// what comes back on the channels the harness actually reads. It is the only test that would
// catch a plugin whose parts are all correct and whose wiring is not.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DISPATCH = join(ROOT, 'hooks/dispatch.js')

// Asked for rather than written down. Every reader of this name has to agree with every
// other, and a test that hard-codes it is one more place for them to disagree.
const STATUS_FILE = createRequire(import.meta.url)(join(ROOT, 'core/status-file.js')).FILENAME

function project ({ marked = true, turn = null, gate = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'to-spec-e2e-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir })
  writeFileSync(join(dir, '.gitignore'), '.to-spec/state.json\n.to-spec/reports/\n.to-spec/cache/\n')

  if (marked) {
    mkdirSync(join(dir, '.to-spec'), { recursive: true })
    writeFileSync(join(dir, '.to-spec', 'project.json'), JSON.stringify({
      schemaVersion: 1, name: 'probe', language: 'en', archetype: { id: 'marker', version: 1 }, published: false
    }, null, 2))
    const state = {
      schemaVersion: 1,
      turn: turn || { prompt_id: 'turn-1', wrote: true },
      gate: gate || { prompt_id: null, blocks: 0, identicalRuns: 0, lastList: [], spentForPrompt: null },
      outstanding: { agent: [], user: [], unverifiable: [] },
      flags: { configChanged: null, error: null },
      snapshots: []
    }
    writeFileSync(join(dir, '.to-spec', 'state.json'), JSON.stringify(state, null, 2))
  }
  return dir
}

function invoke (event, dir, payload, pluginRoot = ROOT) {
  const run = spawnSync(process.execPath, [DISPATCH, event], {
    input: JSON.stringify({ hook_event_name: event, cwd: dir, ...payload }),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: pluginRoot }
  })
  let parsed = null
  try {
    parsed = run.stdout ? JSON.parse(run.stdout) : null
  } catch (_) { /* not every answer carries structured output */ }
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, json: parsed }
}

test('a turn that changed the project and left it wanting is refused', () => {
  const dir = project()
  try {
    const out = invoke('Stop', dir, { prompt_id: 'turn-1', stop_hook_active: false })
    assert.equal(out.status, 2, 'a refusal has to carry the exit code the harness has always honoured')
    assert.equal(out.json.decision, 'block')
    assert.match(out.json.reason, /marker/, 'the reason has to name what is missing')
    assert.ok(out.json.systemMessage, 'the person gets a line of their own, or the refusal is a mystery to them')
    assert.match(out.stderr, /marker/, 'both forms of refusal are emitted, so one surviving a change of field name is enough')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the same turn, once put right, is let through', () => {
  const dir = project()
  try {
    // Every standard in the catalogue, satisfied. That this list grew when a second standard
    // was added, and that no code changed for it to, is the property the catalogue rests on.
    writeFileSync(join(dir, 'MARKER.md'), 'MARKER\n')
    writeFileSync(join(dir, 'MARKER-TWO.md'), 'MARKER\n')
    const out = invoke('Stop', dir, { prompt_id: 'turn-1', stop_hook_active: false })
    assert.equal(out.status, 0)
    assert.ok(!out.json || !('decision' in out.json), 'nothing should be refused')
    // A pass that had nothing to say says nothing. Silence is the correct output here, and a
    // reassuring line would be a verdict nobody earned.
    assert.equal(out.stderr.trim(), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a stop with an unreadable catalogue does not pass by abstention', () => {
  // If the plugin's own standards directory is gone, the gate has nothing to run. Read as a
  // pass, a finished-looking turn would go through unchecked. It must surface instead.
  const pluginRoot = mkdtempSync(join(tmpdir(), 'to-spec-plugin-'))
  const dir = project()
  try {
    for (const part of ['core', 'lib', 'harness', 'hooks', 'compat.json', '.claude-plugin', 'messages', 'standards']) {
      cpSync(join(ROOT, part), join(pluginRoot, part), { recursive: true })
    }
    rmSync(join(pluginRoot, 'standards'), { recursive: true, force: true })
    // The two marker files present, so with a full catalogue this turn would pass in silence.
    writeFileSync(join(dir, 'MARKER.md'), 'MARKER\n')
    writeFileSync(join(dir, 'MARKER-TWO.md'), 'MARKER\n')
    const out = invoke('Stop', dir, { prompt_id: 'turn-1', stop_hook_active: false }, pluginRoot)
    assert.notEqual(out.status, 0, 'a turn the plugin could not check must not report itself fine')
    assert.match(out.stderr + (out.json ? out.json.reason : ''), /catalogue|standards/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
  }
})

test('a copy taken before a destructive command is recorded and recoverable', () => {
  // The snapshot must leave a trace a person can find: a ref under refs/snapshots and an entry
  // in state.json naming the command it guarded. Both are what the repair doc points at.
  const dir = project()
  writeFileSync(join(dir, '.gitignore'), '.env\n.to-spec/state.json\n.to-spec/reports/\n.to-spec/cache/\n')
  // An identity, because a bare runner has none and commit-tree needs one.
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir })
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base'], { cwd: dir })
  try {
    const out = invoke('PreToolUse', dir, {
      prompt_id: 'turn-1', tool_name: 'Bash', tool_input: { command: 'rm -rf build' }
    })
    assert.equal(out.status, 0, 'the command is allowed once a copy has been taken')
    const refs = execFileSync('git', ['for-each-ref', '--format=%(refname)', 'refs/snapshots'], { cwd: dir, encoding: 'utf8' })
    assert.match(refs, /^refs\/snapshots\//, 'a copy must be kept under a private ref')
    const state = JSON.parse(readFileSync(join(dir, '.to-spec', 'state.json'), 'utf8'))
    assert.ok(state.snapshots.length >= 1, 'the copy must be recorded in state so it can be found')
    assert.match(state.snapshots[0].before, /delete/, 'the record names the command it guarded')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a compaction re-injects the essentials without a fresh start', () => {
  const dir = project()
  try {
    const out = invoke('SessionStart', dir, { source: 'compact' })
    assert.equal(out.status, 0)
    assert.match(out.json.hookSpecificOutput.additionalContext, /guards remain in force/)
    assert.match(out.json.hookSpecificOutput.additionalContext, /marker/, 'the archetype is re-injected')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a prompt outside a project is pointed at starting one, and never blocked', () => {
  const dir = project({ marked: false })
  try {
    const out = invoke('UserPromptSubmit', dir, { prompt: 'build me a site' })
    assert.equal(out.status, 0, 'a prompt-submit hook must never block; an exit 2 erases the prompt')
    assert.match(out.json.hookSpecificOutput.additionalContext, /to-spec:new/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a prompt inside a project carries the no-regression rule', () => {
  const dir = project()
  try {
    const out = invoke('UserPromptSubmit', dir, { prompt: 'change the header' })
    assert.equal(out.status, 0)
    assert.match(out.json.hookSpecificOutput.additionalContext, /regress/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('open items reach the prompt only when there are some', () => {
  const withOpen = project()
  const clean = project()
  try {
    // Seed one outstanding agent item.
    const statePath = join(withOpen, '.to-spec', 'state.json')
    const s = JSON.parse(readFileSync(statePath, 'utf8'))
    s.outstanding = { agent: ['placement-css'], user: [], unverifiable: [] }
    writeFileSync(statePath, JSON.stringify(s))

    assert.match(invoke('UserPromptSubmit', withOpen, {}).json.hookSpecificOutput.additionalContext, /Open items/)
    assert.doesNotMatch(invoke('UserPromptSubmit', clean, {}).json.hookSpecificOutput.additionalContext, /Open items/)
  } finally {
    rmSync(withOpen, { recursive: true, force: true })
    rmSync(clean, { recursive: true, force: true })
  }
})

// A plugin whose marker archetype composes exactly the given standards, so a guard can be
// exercised against a real standard without a shipping web archetype to host it yet.
function pluginComposing (ids) {
  const pluginRoot = mkdtempSync(join(tmpdir(), 'to-spec-plugin-'))
  for (const part of ['core', 'lib', 'harness', 'hooks', 'compat.json', '.claude-plugin', 'messages', 'standards']) {
    cpSync(join(ROOT, part), join(pluginRoot, part), { recursive: true })
  }
  mkdirSync(join(pluginRoot, 'archetypes', 'marker'), { recursive: true })
  writeFileSync(join(pluginRoot, 'archetypes', 'marker', 'archetype.json'), JSON.stringify({
    schemaVersion: 1, id: 'marker', standards: ids.map((id) => ({ id }))
  }))
  return pluginRoot
}

test('a write that would mix styling into the markup is refused before it lands', () => {
  const pluginRoot = pluginComposing(['placement-css'])
  const dir = project()
  try {
    const out = invoke('PreToolUse', dir, {
      prompt_id: 'turn-1', tool_name: 'Write',
      tool_input: { file_path: 'index.html', content: '<p style="color:red">hi</p>' }
    }, pluginRoot)
    assert.equal(out.status, 2, 'the write is denied')
    assert.equal(out.json.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /style attribute/)
    assert.ok(out.json.systemMessage, 'the person is told, in their words')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
  }
})

test('a clean write is allowed through', () => {
  const pluginRoot = pluginComposing(['placement-css'])
  const dir = project()
  try {
    const out = invoke('PreToolUse', dir, {
      prompt_id: 'turn-1', tool_name: 'Write',
      tool_input: { file_path: 'index.html', content: '<p class="lead">hi</p>' }
    }, pluginRoot)
    assert.equal(out.status, 0, 'nothing was mixed into the markup, so the write proceeds')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
  }
})

test('an edit is judged on the file it would produce, not on the fragment', () => {
  const pluginRoot = pluginComposing(['placement-css'])
  const dir = project()
  try {
    writeFileSync(join(dir, 'index.html'), '<p class="lead">hi</p>\n')
    const out = invoke('PreToolUse', dir, {
      prompt_id: 'turn-1', tool_name: 'Edit',
      tool_input: { file_path: 'index.html', old_string: 'class="lead"', new_string: 'style="color:red"' }
    }, pluginRoot)
    assert.equal(out.status, 2, 'the reconstructed file carries an inline style, so the edit is refused')
    assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /style attribute/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
  }
})

test('a file outside the standard\'s paths is left alone', () => {
  const pluginRoot = pluginComposing(['placement-css'])
  const dir = project()
  try {
    const out = invoke('PreToolUse', dir, {
      prompt_id: 'turn-1', tool_name: 'Write',
      tool_input: { file_path: 'src/App.vue', content: '<template><p style="color:red">x</p></template>' }
    }, pluginRoot)
    assert.equal(out.status, 0, 'a single-file component co-locates its styling by design')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
  }
})

test('a write is allowed when the archetype does not compose the guard', () => {
  // The shipped marker archetype composes the fixtures, not placement-css, so a marker project
  // writes freely: a rule fires only for the kind of project that composes it.
  const dir = project()
  try {
    const out = invoke('PreToolUse', dir, {
      prompt_id: 'turn-1', tool_name: 'Write',
      tool_input: { file_path: 'index.html', content: '<p style="color:red">hi</p>' }
    })
    assert.equal(out.status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the fourth refusal of the same file hands the decision to the person', () => {
  const pluginRoot = pluginComposing(['placement-css'])
  const dir = project()
  try {
    const payload = {
      prompt_id: 'turn-1', tool_name: 'Write',
      tool_input: { file_path: 'index.html', content: '<p style="color:red">hi</p>' }
    }
    for (const round of [1, 2, 3]) {
      const out = invoke('PreToolUse', dir, payload, pluginRoot)
      assert.equal(out.json.hookSpecificOutput.permissionDecision, 'deny', `refusal ${round} still denies`)
    }
    const fourth = invoke('PreToolUse', dir, payload, pluginRoot)
    assert.equal(fourth.status, 0, 'asking is not a refusal, so it carries no failing code')
    assert.equal(fourth.json.hookSpecificOutput.permissionDecision, 'ask',
      'past the fourth refusal, the person decides, not the guard')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
  }
})

test('a clean pass carrying an unchecked item is not silent about it', () => {
  // A pass whose only outstanding items could not be checked here must not be byte-identical to
  // a pass with nothing outstanding: the person is told what was not looked at.
  const pluginRoot = mkdtempSync(join(tmpdir(), 'to-spec-plugin-'))
  const dir = project()
  try {
    for (const part of ['core', 'lib', 'harness', 'hooks', 'compat.json', '.claude-plugin', 'messages', 'standards']) {
      cpSync(join(ROOT, part), join(pluginRoot, part), { recursive: true })
    }
    // A standard that can only report itself unavailable, in a non-blocking category.
    const sdir = join(pluginRoot, 'standards', 'needs-a-live-site')
    mkdirSync(sdir, { recursive: true })
    writeFileSync(join(sdir, 'standard.json'), JSON.stringify({
      schemaVersion: 1, id: 'needs-a-live-site', family: 'fixture',
      title: { en: 'Needs a live site' }, summary: { en: 'A check that can only run against a deployed site.' },
      category: 'unverifiable-here', severity: 'report', events: ['Stop'], scope: ['tree'], kind: 'check', review: false,
      message: { en: ['One thing needs the live site.', 'I will note it.'], fr: ['Une chose demande le site en ligne.', 'Je la note.'] },
      reason: { en: 'This can only be checked against the deployed site.' },
      fixtures: { bad: 'fixtures/bad', good: 'fixtures/good', meta: 'fixtures/meta.json' },
      limits: { timeout_ms: 1000, max_findings: 1 }
    }))
    writeFileSync(join(sdir, 'check.js'), "module.exports = () => ({ status: 'unavailable', why: 'needs the deployed site' })\n")
    // An archetype that composes the three, so the gate runs them and only them: the two markers
    // and the one that can only report itself unavailable here.
    mkdirSync(join(pluginRoot, 'archetypes', 'marker'), { recursive: true })
    writeFileSync(join(pluginRoot, 'archetypes', 'marker', 'archetype.json'), JSON.stringify({
      schemaVersion: 1, id: 'marker', standards: [{ id: 'marker' }, { id: 'marker-two' }, { id: 'needs-a-live-site' }]
    }))
    // The markers present, so the two shipped standards pass and the only outstanding item is
    // the one that could not be checked here.
    writeFileSync(join(dir, 'MARKER.md'), 'MARKER\n')
    writeFileSync(join(dir, 'MARKER-TWO.md'), 'MARKER\n')
    const out = invoke('Stop', dir, { prompt_id: 'turn-1', stop_hook_active: false }, pluginRoot)
    assert.equal(out.status, 0, 'nothing agent-fixable is outstanding, so the turn passes')
    assert.ok(out.json && out.json.systemMessage, 'a pass with an unchecked item must say so, not stay silent')
    assert.match(out.json.systemMessage, /could not be checked/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
  }
})

test('a refusal that cannot be counted gives way rather than repeating for ever', () => {
  // The gate's cap advances only when the state note is kept. If the note cannot be written --
  // the lock unacquirable, a read-only directory -- a BLOCK re-issued from the unchanged
  // numbers would repeat until the harness's own cap ends it. It must take the soft path.
  // The lock path is held as a directory so it can never be taken; this reproduces on every
  // platform, where a mode bit would not.
  const dir = project() // marked, turn wrote, and the marker files are absent, so the gate blocks
  mkdirSync(join(dir, '.to-spec', '.lock'))
  try {
    const out = invoke('Stop', dir, { prompt_id: 'turn-1', stop_hook_active: false })
    assert.equal(out.status, 0, 'an uncountable refusal must not be a hard block that repeats')
    assert.ok(out.json && out.json.hookSpecificOutput,
      'it takes the soft path, which reaches the model without spending the refusal budget')
    assert.ok(!out.json.decision, 'nothing is refused when the refusal could not be counted')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a write that cannot be recorded is refused, a read is not', () => {
  // The one guarantee the pre-tool handler makes: a write is noted before it happens, or it
  // does not happen, because the gate learns a turn changed something from that note alone.
  // With the note unwritable (the lock path held as a directory), a writing tool is refused
  // and a reading tool is left alone.
  const dir = project()
  mkdirSync(join(dir, '.to-spec', '.lock')) // a directory where the lock file would go: it can never be taken
  try {
    const write = invoke('PreToolUse', dir, {
      prompt_id: 'turn-1', tool_name: 'Write', tool_input: { file_path: join(dir, 'notes.md'), content: 'x' }
    })
    assert.equal(write.status, 2, 'a write whose note could not be kept must be refused')
    assert.equal(write.json.hookSpecificOutput.permissionDecision, 'deny')
    assert.ok(write.json.systemMessage, 'the person gets a line explaining the refusal')

    const read = invoke('PreToolUse', dir, {
      prompt_id: 'turn-1', tool_name: 'Read', tool_input: { file_path: join(dir, 'notes.md') }
    })
    assert.equal(read.status, 0, 'a read changes nothing, so an unrecordable note must not refuse it')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a turn that changed nothing is not interrogated', () => {
  // The stop event fires at the end of every reply, including the ones that only answered a
  // question. A gate that armed on those would be a tax on conversation.
  const dir = project({ turn: { prompt_id: 'turn-1', wrote: false, tools: [] } })
  try {
    const out = invoke('Stop', dir, { prompt_id: 'turn-1', stop_hook_active: false })
    assert.equal(out.status, 0)
    assert.equal(out.stdout, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a project that never asked for any of this is left entirely alone', () => {
  // The payloads are real ones, naming a tool and a file, because an empty payload lets every
  // guard out through its cheap path and proves nothing about the guards.
  const dir = project({ marked: false })
  writeFileSync(join(dir, '.gitignore'), '.env\n')
  writeFileSync(join(dir, '.env'), 'API_KEY=sk_live_abcdefghijklmnop\n')
  try {
    for (const event of ['SessionStart', 'Stop', 'ConfigChange']) {
      const out = invoke(event, dir, { prompt_id: 'turn-1' })
      assert.equal(out.status, 0, `${event} must not interfere`)
    }
    const calls = [
      { tool_name: 'Read', tool_input: { file_path: join(dir, '.env') } },
      { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } },
      { tool_name: 'Write', tool_input: { file_path: join(dir, 'notes.md'), content: 'hello' } }
    ]
    for (const call of calls) {
      const out = invoke('PreToolUse', dir, { prompt_id: 'turn-1', ...call })
      assert.equal(out.status, 0, `${call.tool_name} in a directory that never opted in must be allowed`)
      assert.ok(!out.json || !out.json.hookSpecificOutput || out.json.hookSpecificOutput.permissionDecision !== 'deny',
        `${call.tool_name} must not be refused outside a marked project`)
    }
    assert.ok(!existsSync(join(dir, '.to-spec')), 'nothing may be written into a project that never asked')
    const refs = execFileSync('git', ['for-each-ref', 'refs/snapshots'], { cwd: dir, encoding: 'utf8' })
    assert.equal(refs.trim(), '', 'no copy may be taken in a repository that never asked')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an existing private file is not overwritten, whichever way its path is spelled', () => {
  // The harness sends absolute paths. A guard that only recognised the relative spelling would
  // hold in the tests and fail on every real call.
  const dir = project()
  writeFileSync(join(dir, '.gitignore'), '.env\n.to-spec/state.json\n.to-spec/reports/\n.to-spec/cache/\n')
  writeFileSync(join(dir, '.env'), 'API_KEY=old\n')
  try {
    for (const spelling of [join(dir, '.env'), '.env']) {
      const out = invoke('PreToolUse', dir, {
        prompt_id: 'turn-1',
        tool_name: 'Write',
        tool_input: { file_path: spelling, content: 'API_KEY=new\n' }
      })
      assert.equal(out.status, 2, `overwriting a private file spelled ${JSON.stringify(spelling)} must be refused`)
    }
    assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'API_KEY=old\n')

    // Creating one is a different act, and legitimate: that is where a secret belongs.
    rmSync(join(dir, '.env'))
    const created = invoke('PreToolUse', dir, {
      prompt_id: 'turn-1',
      tool_name: 'Write',
      tool_input: { file_path: join(dir, '.env'), content: 'API_KEY=new\n' }
    })
    assert.equal(created.status, 0, 'a private file that does not exist yet may be created')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('refusing three times on the same list gives way rather than arguing', () => {
  const dir = project()
  try {
    const verdicts = []
    for (let round = 0; round < 3; round++) {
      const out = invoke('Stop', dir, { prompt_id: 'turn-1', stop_hook_active: round > 0 })
      verdicts.push(out.status)
    }
    assert.deepEqual(verdicts, [2, 2, 0],
      'the third pass must let go: the harness caps refusals, and reaching its cap gives it the last word')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the state of the project is written down, not left to be asked about', () => {
  const dir = project()
  try {
    invoke('Stop', dir, { prompt_id: 'turn-1', stop_hook_active: false })
    const statusPath = join(dir, STATUS_FILE)
    assert.ok(existsSync(statusPath), 'nothing was written for a person to read')
    const contents = readFileSync(statusPath, 'utf8')
    assert.match(contents, /What I can still do/)
    assert.match(contents, /Not checked here/,
      'a short list and a short look read the same unless the difference is written down')
    assert.ok(!/\b(ready|finished|complete|all good)\b/i.test(contents),
      'a guard can observe that it found nothing; it cannot observe that there is nothing to find')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the full report is filed where the reason says it is', () => {
  const dir = project()
  try {
    const out = invoke('Stop', dir, { prompt_id: 'turn-1', stop_hook_active: false })
    const quoted = out.json.reason.match(/at ([^\s]+)\./)
    assert.ok(quoted, 'the reason must say where the full report is')
    assert.ok(existsSync(join(dir, quoted[1])), `the reason points at ${quoted[1]}, which is not there`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a write is noted before it happens, refused or not', () => {
  // The gate learns that a turn changed something from this note and from nothing else, so a
  // note made after the fact would be a note that is sometimes missing.
  const dir = project({ turn: { prompt_id: 'turn-2', wrote: false, tools: [] } })
  try {
    invoke('PreToolUse', dir, {
      prompt_id: 'turn-2',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.js', content: 'const x = 1' }
    })
    const state = JSON.parse(readFileSync(join(dir, '.to-spec', 'state.json'), 'utf8'))
    assert.equal(state.turn.prompt_id, 'turn-2')
    assert.equal(state.turn.wrote, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a credential headed somewhere published is stopped, and the person is told plainly', () => {
  const dir = project()
  try {
    const out = invoke('PreToolUse', dir, {
      prompt_id: 'turn-3',
      tool_name: 'Write',
      tool_input: { file_path: 'src/config.js', content: "const k = 'sk_live_51H8Qx7RtYuIoP0aZ'" }
    })
    assert.equal(out.status, 2)
    assert.equal(out.json.hookSpecificOutput.permissionDecision, 'deny')
    assert.ok(out.json.systemMessage)
    assert.ok(!/sk_live/.test(out.json.systemMessage),
      'the line a person reads must not repeat the credential it just stopped')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unreadable payload does not become a refusal', () => {
  // A payload this plugin cannot parse says nothing about the action. Refusing on it would
  // refuse everything the day a field changes shape.
  const run = spawnSync(process.execPath, [DISPATCH, 'PreToolUse'], {
    input: 'not json at all',
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT }
  })
  assert.equal(run.status, 0)
})

test('a session start on a marked project tells the model where things stand', () => {
  const dir = project()
  try {
    writeFileSync(join(dir, STATUS_FILE), '# building the thing\n\nTwo things are left.\n')
    const out = invoke('SessionStart', dir, {})
    assert.equal(out.status, 0)
    assert.match(out.json.hookSpecificOutput.additionalContext, /marker/,
      'the model should be told what kind of project this is')
    assert.match(out.json.hookSpecificOutput.additionalContext, /Two things are left/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a change to the protections is written down for the next session', () => {
  const dir = project()
  try {
    const out = invoke('ConfigChange', dir, { source: 'project_settings', file_path: '.claude/settings.json' })
    assert.equal(out.status, 0, 'this is a journal, not a gate: by now the session is already running under the change')
    const state = JSON.parse(readFileSync(join(dir, '.to-spec', 'state.json'), 'utf8'))
    assert.equal(state.flags.configChanged.source, 'project_settings')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
