'use strict'

// A file's comments, with line numbers, and nothing else. A standard that looks for a token
// left in a comment must not find one written in a string or in ordinary code, so this is where
// the line between the two is drawn, once, for every standard that needs it.
//
// It is a scan, not a parser: it tracks strings so a comment marker inside one is not a comment,
// and it recognises the line and block comment shapes of a language family by file extension. It
// does not understand a language's grammar, and it says so -- a comment marker inside a template
// expression, or a heredoc it does not know, is out of its reach.

// Comment and string shapes by family. `line` markers run to end of line; `block` pairs run to
// their close; `strings` open and close a span in which no comment is recognised.
const FAMILIES = [
  {
    line: ['//'],
    block: [['/*', '*/']],
    strings: ['"', "'", '`'],
    ext: ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.css', '.scss', '.less',
      '.java', '.cs', '.go', '.rs', '.php', '.c', '.h', '.cc', '.cpp', '.hpp', '.swift', '.kt',
      '.kts', '.scala', '.dart', '.gd', '.gradle', '.groovy']
  },
  {
    line: ['#'],
    block: [],
    strings: ['"', "'"],
    ext: ['.py', '.rb', '.sh', '.bash', '.zsh', '.yaml', '.yml', '.toml', '.pl', '.r', '.ex', '.exs', '.tf']
  },
  {
    line: [],
    block: [['<!--', '-->']],
    strings: [],
    ext: ['.html', '.htm', '.xml', '.svg', '.vue', '.svelte', '.njk', '.liquid', '.md', '.markdown']
  },
  {
    line: ['--'],
    block: [['/*', '*/']],
    strings: ['"', "'"],
    ext: ['.sql', '.lua', '.hs', '.elm', '.adb']
  }
]

function syntaxFor (ext) {
  const lower = String(ext || '').toLowerCase()
  return FAMILIES.find((family) => family.ext.includes(lower)) || null
}

// The comment spans of a source, each with the 1-based line it opens on. A file whose extension
// carries no known comment syntax returns none, rather than guessing.
function spans (source, syntax) {
  if (!syntax) return []
  const text = String(source)
  const n = text.length
  const out = []
  let i = 0
  let line = 1
  const adv = () => { if (text[i] === '\n') line++; i++ }
  const at = (marker) => text.startsWith(marker, i)

  while (i < n) {
    const quote = (syntax.strings || []).find((q) => text[i] === q)
    if (quote) {
      adv()
      while (i < n && text[i] !== quote) { if (text[i] === '\\') adv(); adv() }
      if (i < n) adv()
      continue
    }

    const block = (syntax.block || []).find(([open]) => at(open))
    if (block) {
      const [open, close] = block
      const startLine = line
      for (let k = 0; k < open.length; k++) adv()
      let buf = ''
      while (i < n && !at(close)) { buf += text[i]; adv() }
      for (let k = 0; k < close.length && i < n; k++) adv()
      out.push({ text: buf, line: startLine })
      continue
    }

    const marker = (syntax.line || []).find((m) => at(m))
    if (marker) {
      const startLine = line
      for (let k = 0; k < marker.length; k++) adv()
      let buf = ''
      while (i < n && text[i] !== '\n') { buf += text[i]; adv() }
      out.push({ text: buf, line: startLine })
      continue
    }

    adv()
  }
  return out
}

module.exports = { syntaxFor, spans, FAMILIES }
