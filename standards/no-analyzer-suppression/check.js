'use strict'

// A static check is there to be answered, not switched off. This finds the directives that
// silence one: the comment-borne ones (eslint-disable, @ts-ignore, a noqa, and their kin), read
// from a file's comments so a directive named in a string or in prose is not mistaken for one in
// force, and the Rust allow attribute, which is code rather than a comment and so is read from
// the source itself.

const path = require('path')
const { matchesAny } = require('../../lib/glob')
const comments = require('../../lib/comments')

// Directives that live in a comment. Each carries the label the finding names.
const IN_COMMENTS = [
  { re: /eslint-disable/, label: 'eslint-disable' },
  { re: /@ts-ignore\b/, label: '@ts-ignore' },
  { re: /@ts-expect-error\b/, label: '@ts-expect-error' },
  { re: /@phpstan-ignore/, label: '@phpstan-ignore' },
  { re: /@psalm-suppress/, label: '@psalm-suppress' },
  { re: /\bnoqa\b/, label: 'noqa' },
  { re: /type:\s*ignore/, label: 'type: ignore' },
  { re: /nosemgrep/, label: 'nosemgrep' },
  { re: /gdlint:ignore/, label: 'gdlint:ignore' }
]

// The Rust allow attribute is a statement, not a comment, so it is matched in the source.
const RUST_ALLOW = /#!?\[\s*allow\s*\(/

module.exports = function check (input, ctx) {
  const std = input.standard || {}
  const include = (std.paths && std.paths.include) || []
  const exclude = (std.paths && std.paths.exclude) || []
  const inScope = (p) => matchesAny(include, p) && !matchesAny(exclude, p)

  const findings = []
  const scan = (file, content) => {
    const syntax = comments.syntaxFor(path.extname(file))
    if (syntax) {
      for (const span of comments.spans(content, syntax)) {
        for (const directive of IN_COMMENTS) {
          if (directive.re.test(span.text)) {
            findings.push({ path: file, line: span.line, message: `${directive.label} switches off a check` })
          }
        }
      }
    }
    if (path.extname(file).toLowerCase() === '.rs') {
      const lines = content.split(/\r?\n/)
      lines.forEach((text, index) => {
        if (RUST_ALLOW.test(text)) {
          findings.push({ path: file, line: index + 1, message: 'an allow attribute switches off a check' })
        }
      })
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
