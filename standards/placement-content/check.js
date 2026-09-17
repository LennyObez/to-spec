'use strict'

// A layout is the structure a page fills, shared across every page. Content placed in it, a
// paragraph or a list item holding a page's words, shows on every page and cannot differ from
// one to the next. This finds such content in the layout files the archetype names, counting
// only real words: a template expression is data the page supplies, and a short structural label
// is not content, so both are left alone.

const { matchesAny } = require('../../lib/glob')

// Words with a letter in them, once template expressions are removed. A count, not the text, is
// what decides whether an element holds content or a label.
function wordCount (raw) {
  const stripped = String(raw).replace(/\{\{[\s\S]*?\}\}/g, ' ').replace(/\{%[\s\S]*?%\}/g, ' ')
  return stripped.split(/\s+/).filter((word) => /[A-Za-zÀ-ÿ]/.test(word)).length
}

module.exports = function check (input, ctx) {
  const std = input.standard || {}
  const include = (std.paths && std.paths.include) || []
  const exclude = (std.paths && std.paths.exclude) || []
  const contentTags = new Set((std.params && std.params.content_tags) || [])
  const maxWords = (std.params && Number(std.params.max_words)) || 0
  const inScope = (p) => matchesAny(include, p) && !matchesAny(exclude, p)

  const findings = []
  const scan = (file, content) => {
    for (const el of ctx.html.scan(content).elements) {
      if (contentTags.has(el.tag) && wordCount(el.text) > maxWords) {
        findings.push({ path: file, line: el.line, message: `a <${el.tag}> in a layout holds hardcoded content, which belongs in a page` })
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
