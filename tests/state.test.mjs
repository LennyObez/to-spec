// The state note: what it keeps, and how it fails.
//
// state.json is written constantly and read every turn. Two failures matter most: treating a
// corrupt file as an empty one (which erases a turn's memory in the middle of it), and keeping
// a field nobody reads (which is a promise the code does not honour).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const state = require(join(ROOT, 'core/state.js'))

function marked () {
  const dir = mkdtempSync(join(tmpdir(), 'to-spec-state-'))
  mkdirSync(join(dir, '.to-spec'), { recursive: true })
  writeFileSync(join(dir, '.to-spec', 'project.json'), JSON.stringify({ schemaVersion: 1, name: 'p' }))
  return dir
}

test('a corrupt state file is moved aside and flagged, not read as a blank slate', () => {
  const dir = marked()
  try {
    writeFileSync(join(dir, '.to-spec', 'state.json'), '{ this is not: valid json ]')
    const read = state.readState(dir)
    assert.ok(read.flags.error, 'a damaged state file must surface an error, not read as empty')
    assert.match(read.flags.error, /could not be read/)
    assert.ok(existsSync(join(dir, '.to-spec', 'state.json.corrupt')),
      'the damaged file must be kept for recovery, not overwritten in place')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an absent state file is simply empty, with no error', () => {
  const dir = marked()
  try {
    const read = state.readState(dir)
    assert.equal(read.flags.error, null, 'a project that has not run yet is not an error')
    assert.equal(read.turn.wrote, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the lock gives way in bounded time when it is held, without spinning forever', () => {
  const dir = marked()
  try {
    // Hold the lock, then a second acquisition must return null after its attempts rather than
    // block for ever. The Atomics.wait sleep keeps this from burning a core meanwhile.
    writeFileSync(join(dir, '.to-spec', '.lock'), String(process.pid), { flag: 'wx' })
    const started = Date.now()
    const out = state.updateState(dir, (s) => { s.turn.wrote = true })
    const elapsed = Date.now() - started
    assert.equal(out.written, false, 'a held lock must not be forced')
    assert.match(out.why, /another handler/)
    assert.ok(elapsed < 5000, `the wait ran ${elapsed}ms; it must be bounded by the attempt budget`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('every field the empty state declares is read or written by the runtime', () => {
  // The plugin's rule against a configuration option nothing reads, applied to state.json: a
  // reserved placeholder for a later phase is a field nobody reads. Each leaf key must be
  // accessed somewhere in the runtime.
  const runtime = ['core', 'harness', 'hooks'].flatMap((d) => {
    const walk = (dir, acc) => {
      for (const e of require('node:fs').readdirSync(join(ROOT, dir))) {
        const rel = join(dir, e)
        if (require('node:fs').statSync(join(ROOT, rel)).isDirectory()) walk(rel, acc)
        else if (rel.endsWith('.js')) acc.push(readFileSync(join(ROOT, rel), 'utf8'))
      }
      return acc
    }
    return walk(d, [])
  }).join('\n')

  const leaves = []
  const collect = (obj, path) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) collect(v, path.concat(k))
      else leaves.push(path.concat(k))
    }
  }
  collect(state.emptyState(), [])
  assert.ok(leaves.length > 0)
  for (const path of leaves) {
    const leaf = path[path.length - 1]
    assert.ok(new RegExp(`\\.${leaf}\\b`).test(runtime),
      `state.${path.join('.')} is declared but the runtime never reads or writes .${leaf}`)
  }
})
