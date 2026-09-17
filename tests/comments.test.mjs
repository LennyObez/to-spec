// The comment scan the transversal standards read. The property that matters is the line
// between a comment and a string: a marker written in a string is code, not a comment, and a
// standard that confused the two would fire on the wrong thing.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import comments from '../lib/comments.js'
const { syntaxFor, spans } = comments

const textsFor = (source, ext) => spans(source, syntaxFor(ext)).map((s) => s.text.trim())

test('a line comment is read, and a marker in a string is not', () => {
  const src = 'const x = "// not a comment"\n// a real comment\n'
  assert.deepEqual(textsFor(src, '.js'), ['a real comment'])
})

test('a block comment is read whole, with the line it opens on', () => {
  const src = 'a\n/* first\nsecond */\n'
  const found = spans('a\n/* first\nsecond */\n', syntaxFor('.js'))
  assert.equal(found.length, 1)
  assert.equal(found[0].line, 2)
  assert.match(found[0].text, /first/)
  assert.match(found[0].text, /second/)
})

test('the hash family reads # comments and keeps strings out', () => {
  const src = "name = 'value # not a comment'\n# a real one\n"
  assert.deepEqual(textsFor(src, '.py'), ['a real one'])
})

test('markup reads only its comment shape', () => {
  assert.deepEqual(textsFor('<p>text</p><!-- a note -->', '.html'), ['a note'])
  assert.deepEqual(textsFor('<p>// not a comment</p>', '.html'), [])
})

test('sql reads a -- line comment', () => {
  assert.deepEqual(textsFor("select 1 -- a note\n", '.sql'), ['a note'])
})

test('an unknown extension yields no comments rather than a guess', () => {
  assert.equal(syntaxFor('.unknown'), null)
  assert.deepEqual(spans('// whatever', syntaxFor('.unknown')), [])
})

test('an escaped quote does not end a string early', () => {
  // The closing quote of "a \" b" is the last one; a // after it is a comment, one inside is not.
  const src = 'const s = "a \\" // still string"\n// comment\n'
  assert.deepEqual(textsFor(src, '.js'), ['comment'])
})
