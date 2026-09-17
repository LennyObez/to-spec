'use strict'

// A delivered file is complete, not a note about what is left to do. This finds the markers a
// half-finished file carries -- TODO, FIXME, XXX, and unfinished-content markers like lorem
// ipsum -- but only where they belong to a comment, never in a string or in ordinary code, so
// a marker quoted in a string is left alone and one left in a comment is not.

const path = require('path')
const { matchesAny } = require('../../lib/glob')
const comments = require('../../lib/comments')

// TODO, FIXME and XXX are matched as whole words in their exact case; the content markers are
// matched without regard to case. Each carries the label the finding names, never a slice of
// what matched.
const MARKERS = [
  { re: /\bTODO\b/, label: 'TODO' },
  { re: /\bFIXME\b/, label: 'FIXME' },
  { re: /\bXXX\b/, label: 'XXX' },
  { re: /lorem ipsum/i, label: 'lorem ipsum' },
  { re: /à compléter/i, label: 'à compléter' },
  { re: /\[insérer/i, label: 'insérer' },
  { re: /\bchangeme\b/i, label: 'changeme' }
]

module.exports = function check (input, ctx) {
  const std = input.standard || {}
  const include = (std.paths && std.paths.include) || []
  const exclude = (std.paths && std.paths.exclude) || []
  const inScope = (p) => matchesAny(include, p) && !matchesAny(exclude, p)

  const findings = []
  const scan = (file, content) => {
    const syntax = comments.syntaxFor(path.extname(file))
    if (!syntax) return
    for (const span of comments.spans(content, syntax)) {
      for (const marker of MARKERS) {
        if (marker.re.test(span.text)) {
          findings.push({ path: file, line: span.line, message: `a ${marker.label} marker was left in a comment` })
        }
      }
    }
  }

  if (input.mode === 'file') {
    for (const file of input.files || []) {
      if (inScope(file.path) && typeof file.content === 'string') scan(file.path, file.content)
    }
    return { findings, facts: { filesScanned: (input.files || []).length } }
  }

  const files = ctx.list().filter(inScope)
  for (const file of files) {
    let content
    try {
      content = ctx.read(file)
    } catch (err) {
      return { status: 'unavailable', why: `${file} could not be read: ${err.message}` }
    }
    scan(file, content)
  }
  return { findings, facts: { filesScanned: files.length } }
}
