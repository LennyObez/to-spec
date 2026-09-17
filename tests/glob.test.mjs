// Path matching for a standard's include and exclude lists. The cases that matter are the ones
// where a segment boundary decides the answer: `*` stops at a slash, `**` crosses them, and a
// dot in the pattern is a literal dot, not "any character".

import { test } from 'node:test'
import assert from 'node:assert/strict'

import glob from '../lib/glob.js'
const { matches, matchesAny } = glob

test('a single star does not cross a slash', () => {
  assert.equal(matches('*.html', 'index.html'), true)
  assert.equal(matches('*.html', 'pages/index.html'), false, 'a root pattern must not reach into a directory')
})

test('a double star crosses any number of segments, including none', () => {
  assert.equal(matches('**/*.vue', 'App.vue'), true)
  assert.equal(matches('**/*.vue', 'src/components/App.vue'), true)
  assert.equal(matches('**/*.vue', 'src/App.js'), false)
})

test('a trailing double star matches everything beneath a directory', () => {
  assert.equal(matches('src/emails/**', 'src/emails/welcome.html'), true)
  assert.equal(matches('src/emails/**', 'src/emails/partials/head.html'), true)
  assert.equal(matches('src/emails/**', 'src/pages/index.html'), false)
})

test('a dot in the pattern is literal, not a wildcard', () => {
  assert.equal(matches('*.html', 'indexxhtml'), false, 'the dot must not match an arbitrary character')
  assert.equal(matches('a.b.js', 'a.b.js'), true)
  assert.equal(matches('a.b.js', 'axbxjs'), false)
})

test('a question mark matches exactly one character within a segment', () => {
  assert.equal(matches('page-?.html', 'page-1.html'), true)
  assert.equal(matches('page-?.html', 'page-12.html'), false)
  assert.equal(matches('page-?.html', 'page-/.html'), false, 'it must not match a slash')
})

test('matchesAny is true when any pattern matches, false for an empty or absent list', () => {
  assert.equal(matchesAny(['**/*.svelte', '**/*.vue'], 'src/App.vue'), true)
  assert.equal(matchesAny(['**/*.svelte'], 'src/App.vue'), false)
  assert.equal(matchesAny([], 'src/App.vue'), false)
  assert.equal(matchesAny(undefined, 'src/App.vue'), false)
})
