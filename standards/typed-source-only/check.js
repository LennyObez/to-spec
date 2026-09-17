'use strict'

// The source of truth of a typed project is a typed file the compiler checks. A hand-written
// JavaScript file in its source is not checked, so a mistake in it is found only when it runs.
// This holds only a TypeScript project, and only on its own terms: a project that turns on
// allowJs has chosen to accept JavaScript, and its compiled output, kept under the compiler's
// output directory, is not hand-written and is left alone.

const { matchesAny } = require('../../lib/glob')

// A tolerant read of tsconfig.json, which is JSON with comments and trailing commas. A parse
// that fails leaves the standard unable to decide, which it says, rather than guessing.
function parseTsconfig (text) {
  const stripped = String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'])\/\/[^\n]*/g, '$1')
    .replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(stripped)
}

module.exports = function check (input, ctx) {
  const std = input.standard || {}
  const include = (std.paths && std.paths.include) || []
  const exclude = (std.paths && std.paths.exclude) || []
  const inScope = (p) => matchesAny(include, p) && !matchesAny(exclude, p)

  if (!ctx.exists('tsconfig.json')) return { findings: [], facts: { typescript: false } }
  let config
  try {
    config = parseTsconfig(ctx.read('tsconfig.json'))
  } catch (err) {
    return { status: 'unavailable', why: `tsconfig.json could not be read: ${err.message}` }
  }
  const options = (config && config.compilerOptions) || {}
  if (options.allowJs === true) return { findings: [], facts: { allowJs: true } }

  const outDir = typeof options.outDir === 'string' ? options.outDir.replace(/^\.\//, '').replace(/\/+$/, '') : null
  const inOutDir = (p) => outDir !== null && outDir !== '' && (p === outDir || p.startsWith(outDir + '/'))

  const findings = []
  const flag = (file) => {
    if (inScope(file) && !inOutDir(file)) {
      findings.push({ path: file, message: 'a hand-written JavaScript file where the source of truth should be a typed file' })
    }
  }

  if (input.mode === 'file') {
    for (const file of input.files || []) flag(file.path)
    return { findings, facts: { filesScanned: (input.files || []).length } }
  }
  const files = ctx.list()
  for (const file of files) flag(file)
  return { findings, facts: { filesScanned: files.length } }
}
