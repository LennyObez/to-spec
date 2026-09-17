// How the bench routes a credential to the variable the harness reads. The guard for a defect
// that reads green until a real session runs: oat and api share the sk-ant- prefix, and
// misrouting one hangs on a login rather than failing loudly.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { authVarFor } from '../bench/probes/auth.mjs'

test('a subscription OAuth token goes to the variable the subscription reads', () => {
  assert.equal(authVarFor('sk-ant-oat01-abcdef'), 'CLAUDE_CODE_OAUTH_TOKEN')
})

test('a console API key goes to the API-key variable', () => {
  assert.equal(authVarFor('sk-ant-api03-abcdef'), 'ANTHROPIC_API_KEY')
})

test('the oat and api forms are not conflated by their shared prefix', () => {
  // Both begin sk-ant-, so a rule keyed on the prefix alone misroutes the subscription token.
  assert.notEqual(authVarFor('sk-ant-oat01-x'), authVarFor('sk-ant-api03-x'))
})

test('a value on no known prefix is treated as a subscription token', () => {
  assert.equal(authVarFor('a-long-lived-setup-token'), 'CLAUDE_CODE_OAUTH_TOKEN')
})

test('no credential yields no variable', () => {
  assert.equal(authVarFor(''), null)
  assert.equal(authVarFor(undefined), null)
})
