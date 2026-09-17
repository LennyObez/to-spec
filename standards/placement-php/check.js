'use strict'

// Logic belongs in the application, and a view belongs to what a page shows. Two shapes cross
// that line: PHP embedded in a file that is not a PHP file, and, inside a view, the logic a
// controller should have run first -- a database query, an env() call, a raw request superglobal.
// The view is handed the data it renders; it does not fetch it. Which files are views is a path
// the archetype provides, so this reads it from the standard rather than assuming a framework.

const path = require('path')
const { matchesAny } = require('../../lib/glob')

const EMBEDDED_PHP = /<\?(php|=|\s)/
const LOGIC = [
  { re: /\bDB::/, label: 'a database query' },
  { re: /\b[A-Z]\w*::(where|create|find|firstOrCreate|updateOrCreate|destroy|query|all)\s*\(/, label: 'a model query' },
  { re: /\bnew\s+PDO\b/, label: 'a raw database connection' },
  { re: /\bmysqli_\w+\s*\(/, label: 'a raw database call' },
  { re: /\benv\s*\(/, label: 'an env() call' },
  { re: /\$_(GET|POST|REQUEST|SERVER|COOKIE)\b/, label: 'a raw request superglobal' }
]

module.exports = function check (input, ctx) {
  const std = input.standard || {}
  const include = (std.paths && std.paths.include) || []
  const exclude = (std.paths && std.paths.exclude) || []
  const viewPaths = (std.params && std.params.view_paths) || []
  const inScope = (p) => matchesAny(include, p) && !matchesAny(exclude, p)
  const isView = (p) => p.endsWith('.blade.php') || matchesAny(viewPaths, p)

  const findings = []
  const scan = (file, content) => {
    const ext = path.extname(file).toLowerCase()

    // PHP embedded where it does not belong: a file that is not a PHP file carrying a PHP tag.
    if ((ext === '.html' || ext === '.htm') && EMBEDDED_PHP.test(content)) {
      const line = content.split(/\r?\n/).findIndex((l) => EMBEDDED_PHP.test(l)) + 1
      findings.push({ path: file, line: line || 1, message: 'PHP is embedded in a file that is not a PHP file' })
    }

    // Logic inside a view: a controller's work done in the page it should only render.
    if (isView(file)) {
      content.split(/\r?\n/).forEach((text, index) => {
        for (const rule of LOGIC) {
          if (rule.re.test(text)) {
            findings.push({ path: file, line: index + 1, message: `${rule.label} belongs in the application, not the view` })
          }
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
