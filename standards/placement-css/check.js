'use strict'

// Styling belongs in a stylesheet, not in the markup. Two shapes carry it there: a `style`
// attribute on an element, and a `<style>` element in the page. Both are reported, with two
// exemptions that are legitimate rather than lapses: a `style` attribute inside an <svg>
// subtree, where presentation is part of the graphic, and a small `<style data-critical>`
// block, the recognised way to place the few rules a first paint needs.
//
// It runs in two modes. Before a write, it is handed one file's resulting content and looks at
// that alone, so the styling never lands. At the end of a turn it walks the tree, catching what
// reached a file another way. The reading of a file is the same in both.

const { matchesAny } = require('../../lib/glob')

module.exports = function check (input, ctx) {
  const std = input.standard || {}
  const include = (std.paths && std.paths.include) || []
  const exclude = (std.paths && std.paths.exclude) || []
  const criticalMax = (std.allowlist && Number(std.allowlist.critical_style_max_bytes)) || 0
  const inScope = (p) => matchesAny(include, p) && !matchesAny(exclude, p)

  const findings = []
  const scan = (file, content) => {
    for (const el of ctx.html.scan(content).elements) {
      for (const attr of el.attrs) {
        if (attr.name === 'style' && !el.svg) {
          findings.push({ path: file, line: attr.line, message: `a style attribute on <${el.tag}> puts presentation into the markup` })
        }
      }
      if (el.tag === 'style') {
        const critical = el.attrs.some((a) => a.name === 'data-critical')
        const size = Buffer.byteLength(el.raw || '', 'utf8')
        if (!(critical && size <= criticalMax)) {
          findings.push({ path: file, line: el.line, message: 'a <style> element keeps stylesheet rules in the markup' })
        }
      }
    }
  }

  // Before a write: the resulting content is given, so it is read from the input, never from
  // disk. A file out of scope is passed over, not scanned.
  if (input.mode === 'file') {
    for (const file of input.files || []) {
      if (inScope(file.path) && typeof file.content === 'string') scan(file.path, file.content)
    }
    return { findings, facts: { filesScanned: (input.files || []).length } }
  }

  // At the end of a turn: every markup file in the project.
  const files = ctx.list().filter(inScope)
  for (const file of files) {
    let content
    try {
      content = ctx.read(file)
    } catch (err) {
      // A file listed but unreadable is not a clean file. Passing it would read as "looked and
      // found nothing", the fold the whole design refuses.
      return { status: 'unavailable', why: `${file} could not be read: ${err.message}` }
    }
    scan(file, content)
  }
  return { findings, facts: { filesScanned: files.length } }
}
