// The canary, and the one thing it exists to prove.
//
// Every other guard here assumes its own checks run. The canary is what turns that
// assumption into an observation, so a canary that reports green on a broken guard is worse
// than having none: it converts an absence of protection into a claim of protection.
//
// These tests break things on a copy and require the canary to notice. A canary that has
// never been seen to go red has not been shown to work.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync, unlinkSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const canary = require(join(ROOT, 'core/canary.js'))

// Work on a copy, always. A test that damages the plugin to prove a point and then restores
// it is one interrupted run away from leaving the damage behind.
function onACopy (mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'to-spec-canary-'))
  try {
    for (const part of ['core', 'standards', 'hooks', 'compat.json', '.claude-plugin', 'messages']) {
      cpSync(join(ROOT, part), join(dir, part), { recursive: true })
    }
    if (mutate) mutate(dir)
    return canary.run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the canary is green on an intact plugin', () => {
  const out = canary.run(ROOT)
  assert.equal(out.state, canary.GREEN,
    `the canary is red on an intact plugin: ${out.problems.join('; ')}`)
})

test('a check that stops finding what it was written to find turns the canary red', () => {
  // The failure this is built for: a guard that still runs, still exits cleanly, and no
  // longer catches anything. Nothing else in the repository would notice.
  const out = onACopy((dir) => {
    writeFileSync(join(dir, 'standards/marker/check.js'),
      'module.exports = function check () { return { findings: [] } }\n')
  })
  assert.equal(out.state, canary.RED)
  assert.match(out.problems.join(' '), /marker/)
})

test('a check that starts refusing everything turns the canary red', () => {
  const out = onACopy((dir) => {
    writeFileSync(join(dir, 'standards/marker/check.js'),
      "module.exports = function check () { return { findings: [{ path: 'x', message: 'no' }] } }\n")
  })
  assert.equal(out.state, canary.RED)
})

test('a check that still fails, but for another reason, turns the canary red', () => {
  // "Still fails" and "still fails for the reason it was written for" are different claims,
  // and only the second one means the guard is intact.
  const out = onACopy((dir) => {
    writeFileSync(join(dir, 'standards/marker/check.js'),
      "module.exports = function check () { return { findings: [{ path: 'MARKER.md', message: 'something else entirely' }] } }\n")
  })
  assert.equal(out.state, canary.RED)
  assert.match(out.problems.join(' '), /not for the reason/)
})

test('a check that reports itself unavailable turns the canary red', () => {
  // Unavailable is an honest answer about a project and a useless one about the machinery.
  const out = onACopy((dir) => {
    writeFileSync(join(dir, 'standards/marker/check.js'),
      "module.exports = function check () { return { status: 'unavailable', why: 'no tool' } }\n")
  })
  assert.equal(out.state, canary.RED)
})

test('a check that throws turns the canary red rather than taking the run with it', () => {
  const out = onACopy((dir) => {
    writeFileSync(join(dir, 'standards/marker/check.js'),
      "module.exports = function check () { throw new Error('boom') }\n")
  })
  assert.equal(out.state, canary.RED)
  assert.match(out.problems.join(' '), /marker/)
})

test('a catalogue that holds nothing to run turns the canary red', () => {
  // An empty catalogue is not a plugin that found nothing wrong: it is a plugin that cannot
  // find anything. Read as a pass, it would let the gate wave every turn through.
  const out = onACopy((dir) => {
    rmSync(join(dir, 'standards/marker'), { recursive: true, force: true })
    rmSync(join(dir, 'standards/marker-two'), { recursive: true, force: true })
  })
  assert.equal(out.state, canary.RED)
  assert.match(out.problems.join(' '), /nothing to run|by abstention/)
})

test('a catalogue that cannot be read turns the canary red, not green', () => {
  const out = onACopy((dir) => {
    // A file where the directory should be: readdir on it throws, which the old code folded
    // into an empty list and a silent pass.
    rmSync(join(dir, 'standards'), { recursive: true, force: true })
    writeFileSync(join(dir, 'standards'), 'not a directory\n')
  })
  assert.equal(out.state, canary.RED)
  assert.match(out.problems.join(' '), /could not be read|nothing to run/)
})

test('one unreadable standard does not erase the sound ones beside it', () => {
  // The failure this closes: a single unstattable entry used to take the whole listing down,
  // so the plugin ran every turn believing there was nothing to check.
  const standards = require(join(ROOT, 'core/standards.js'))
  const dir = mkdtempSync(join(tmpdir(), 'to-spec-list-'))
  try {
    cpSync(join(ROOT, 'standards'), join(dir, 'standards'), { recursive: true })
    // A dangling symlink: statSync throws on it, readdir still lists it.
    const { symlinkSync } = require('node:fs')
    symlinkSync(join(dir, 'standards', 'does-not-exist'), join(dir, 'standards', 'zzz-dangling'))
    const ids = standards.listStandardIds(dir)
    assert.ok(ids.includes('marker') && ids.includes('marker-two'),
      `the sound standards must survive a bad entry: ${JSON.stringify(ids)}`)
    assert.ok(ids.includes('zzz-dangling'), 'the bad entry is kept so it names itself broken')
    const loaded = standards.loadStandard(dir, 'zzz-dangling')
    assert.ok(loaded.broken, 'an entry that is not a real standard loads broken, never silently absent')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing fixture turns the canary red', () => {
  const out = onACopy((dir) => {
    rmSync(join(dir, 'standards/marker/fixtures/bad'), { recursive: true, force: true })
  })
  assert.equal(out.state, canary.RED)
  assert.match(out.problems.join(' '), /bad fixture.*missing/)
})

test('a handler pointing at a file that is not there turns the canary red', () => {
  const out = onACopy((dir) => {
    unlinkSync(join(dir, 'hooks/dispatch.js'))
  })
  assert.equal(out.state, canary.RED)
  assert.match(out.problems.join(' '), /dispatch\.js/)
})

test('a malformed standard names itself instead of hiding the others', () => {
  const out = onACopy((dir) => {
    writeFileSync(join(dir, 'standards/marker/standard.json'), '{ "id": "marker", "severity": "block" }')
  })
  assert.equal(out.state, canary.RED)
  assert.match(out.problems.join(' '), /marker/)
})

test('the fingerprint follows the code, so a change cannot inherit an old verdict', () => {
  const before = canary.run(ROOT).fingerprint
  const after = onACopy((dir) => {
    writeFileSync(join(dir, 'standards/marker/check.js'),
      readFileSync(join(ROOT, 'standards/marker/check.js'), 'utf8') + '\n// changed\n')
  }).fingerprint
  assert.notEqual(before, after, 'a cache keyed on an unchanging fingerprint would outlive the code it describes')
})

test('the fingerprint covers the fixtures and the runtime, not only the check', () => {
  // The hole this closes: the old key hashed standard.json + check.js per standard and three
  // manifests, so emptying a fixture, rewriting its meta.json, or changing the runner in core/
  // left the fingerprint identical and served a stale green over a plugin that no longer works.
  const base = canary.run(ROOT).fingerprint

  const afterFixture = onACopy((dir) => {
    writeFileSync(join(dir, 'standards/marker/fixtures/bad/README.md'), 'changed\n')
  }).fingerprint
  assert.notEqual(base, afterFixture, 'a changed fixture must change the fingerprint')

  const afterMeta = onACopy((dir) => {
    writeFileSync(join(dir, 'standards/marker/fixtures/meta.json'),
      readFileSync(join(ROOT, 'standards/marker/fixtures/meta.json'), 'utf8') + '\n')
  }).fingerprint
  assert.notEqual(base, afterMeta, 'a changed expectation must change the fingerprint')

  const afterRunner = onACopy((dir) => {
    writeFileSync(join(dir, 'core/standards.js'),
      readFileSync(join(ROOT, 'core/standards.js'), 'utf8') + '\n// changed\n')
  }).fingerprint
  assert.notEqual(base, afterRunner, 'a changed runner must change the fingerprint')
})

test('a green verdict is answered from the cache, and force bypasses it', () => {
  // The direction the cache must act in: an intact plugin measured once is not re-measured on
  // the next start with the same fingerprint, and force asks again regardless.
  const dataDir = mkdtempSync(join(tmpdir(), 'to-spec-green-'))
  const dir = mkdtempSync(join(tmpdir(), 'to-spec-intact-'))
  try {
    for (const part of ['core', 'standards', 'hooks', 'compat.json', '.claude-plugin', 'messages']) {
      cpSync(join(ROOT, part), join(dir, part), { recursive: true })
    }
    const first = canary.run(dir, { dataDir })
    assert.equal(first.state, canary.GREEN)
    assert.equal(first.fromCache, false, 'the first measurement is not from a cache')

    const second = canary.run(dir, { dataDir })
    assert.equal(second.state, canary.GREEN)
    assert.equal(second.fromCache, true, 'an unchanged green plugin is answered from the cache')

    const forced = canary.run(dir, { dataDir, force: true })
    assert.equal(forced.fromCache, false, 'force measures again rather than trusting the cache')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('only silence is cached', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'to-spec-data-'))
  try {
    const first = onACopy(null)
    assert.equal(first.state, canary.GREEN)

    // A red result must be earned again at every start: a broken guard that reports itself
    // once and then goes quiet is worse than one that never reported at all.
    const dir = mkdtempSync(join(tmpdir(), 'to-spec-red-'))
    try {
      for (const part of ['core', 'standards', 'hooks', 'compat.json', '.claude-plugin', 'messages']) {
        cpSync(join(ROOT, part), join(dir, part), { recursive: true })
      }
      writeFileSync(join(dir, 'standards/marker/check.js'),
        'module.exports = function check () { return { findings: [] } }\n')
      const red = canary.run(dir, { dataDir })
      assert.equal(red.state, canary.RED)
      const again = canary.run(dir, { dataDir })
      assert.equal(again.state, canary.RED, 'a red verdict must not be answered from a cache')
      assert.equal(again.fromCache, false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})
