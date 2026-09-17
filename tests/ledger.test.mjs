// The turn ledger: whether a turn changed anything, decided by the tool it used.
//
// The burden runs the other way round from the obvious design: a tool is treated as writing
// unless it is proven to only read. Wrong in that direction costs a check that finds nothing;
// wrong the other way costs a project changed with nothing watching. These pin the direction.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ledger = require(join(ROOT, 'core/ledger.js'))

test('a tool proven to only read is not counted as writing', () => {
  for (const tool of ledger.READING_TOOLS) {
    assert.equal(ledger.isWritingTool(tool), false, `${tool} is a reading tool and must not arm the gate`)
  }
})

test('anything not proven to only read counts as writing', () => {
  // The tools most likely to change a project without a dedicated write API: a shell, a
  // subagent, a connected tool. None is enumerated, and each must count as a write.
  for (const tool of ['Bash', 'PowerShell', 'Task', 'Agent', 'mcp__github__create_pr', 'SomeFutureTool']) {
    assert.equal(ledger.isWritingTool(tool), true, `${tool} is not proven read-only and must count as a write`)
  }
})

test('an empty tool name is not a write', () => {
  // A payload with no tool named nothing, so it changed nothing.
  assert.equal(ledger.isWritingTool(''), false)
  assert.equal(ledger.isWritingTool(null), false)
  assert.equal(ledger.isWritingTool(undefined), false)
})
