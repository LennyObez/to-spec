'use strict'

// A forgiving scan of markup, enough for the placement standards and no more.
//
// It reports opening tags and their attributes with line numbers, and does two things a regex
// over the raw text cannot. It ignores what lives inside comments and inside <script>/<style>
// bodies, so a `style=` written in a JavaScript string is never read as an inline style. And it
// tolerates template expressions -- {{ }}, {% %}, a Blade @directive -- rather than choking on
// them, because the markup these standards guard is rarely plain HTML. It is not a parser and
// builds no tree: it reports elements, and a standard decides what an element means. The one
// piece of nesting it tracks is whether an element sits inside an <svg>, which one allowlist
// needs and a flat list cannot answer.

function isNameStart (c) { return c >= 'a' && c <= 'z' }

// Elements that never hold text or children, so they are not put on the open-element stack.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr'])

// Returns { elements: [{ tag, line, svg, attrs: [{ name, value, line, quoted }] }] }.
// `line` is 1-based. `svg` is true when the element is an <svg> or lies within one. Attribute
// names are lowercased; values are verbatim, including any template expression inside them.
function scan (source) {
  const text = String(source)
  const lower = text.toLowerCase()
  const n = text.length
  const elements = []
  // The open elements, so a run of text can be attached to the one that directly contains it.
  const stack = []
  let i = 0
  let line = 1
  let svgDepth = 0

  const adv = () => { if (text[i] === '\n') line++; i++ }
  const skipTo = (marker, offset) => {
    const idx = lower.indexOf(marker, offset === undefined ? i : offset)
    const end = idx === -1 ? n : idx
    while (i < end) adv()
  }
  const skipPast = (marker) => { skipTo(marker); const step = marker.length; for (let k = 0; k < step && i < n; k++) adv() }
  const skipWs = () => { while (i < n && /\s/.test(text[i])) adv() }

  while (i < n) {
    if (text[i] !== '<') {
      if (stack.length) stack[stack.length - 1].text += text[i]
      adv()
      continue
    }

    if (lower.startsWith('<!--', i)) { skipPast('-->'); continue }
    if (text[i + 1] === '!' || text[i + 1] === '?') { skipPast('>'); continue } // doctype, cdata, PI

    if (text[i + 1] === '/') { // a closing tag: read its name so </svg> can close a subtree
      let j = i + 2
      let name = ''
      while (j < n && /[a-z0-9:_-]/i.test(text[j])) { name += text[j]; j++ }
      const closing = name.toLowerCase()
      if (closing === 'svg' && svgDepth > 0) svgDepth--
      // Close the nearest matching open element, dropping any that were left unclosed inside it.
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].tag === closing) { stack.length = s; break }
      }
      skipPast('>')
      continue
    }

    if (!isNameStart(lower[i + 1])) { adv(); continue } // a lone '<' in prose

    const tagLine = line
    adv() // '<'
    let tag = ''
    while (i < n && /[a-z0-9:_-]/i.test(text[i])) { tag += text[i]; adv() }
    tag = tag.toLowerCase()

    const attrs = []
    let selfClose = false
    while (i < n && text[i] !== '>') {
      skipWs()
      if (i >= n || text[i] === '>') break
      if (text[i] === '/') { selfClose = true; adv(); continue }
      if (lower.startsWith('{{', i)) { skipPast('}}'); continue } // {{ expr }}
      if (lower.startsWith('{%', i)) { skipPast('%}'); continue } // {% tag %}
      if (text[i] === '{' || text[i] === '}' || text[i] === '"' || text[i] === "'") { adv(); continue }

      const attrLine = line
      let name = ''
      while (i < n && !/[\s=>/]/.test(text[i])) { name += text[i]; adv() }
      if (!name) { adv(); continue } // guaranteed progress on anything unexpected

      skipWs()
      let value = ''
      let quoted = false
      if (text[i] === '=') {
        adv(); skipWs()
        if (text[i] === '"' || text[i] === "'") {
          quoted = true
          const q = text[i]; adv()
          while (i < n && text[i] !== q) { value += text[i]; adv() }
          if (i < n) adv()
        } else {
          while (i < n && !/[\s>]/.test(text[i])) { value += text[i]; adv() }
        }
      }
      attrs.push({ name: name.toLowerCase(), value, line: attrLine, quoted })
    }
    if (i < n && text[i] === '>') adv()

    const inSvg = svgDepth > 0 || tag === 'svg'
    const element = { tag, line: tagLine, svg: inSvg, attrs, text: '' }
    elements.push(element)
    if (tag === 'svg' && !selfClose) svgDepth++
    const rawText = tag === 'script' || tag === 'style' || tag === 'textarea' || tag === 'title'
    if (!selfClose && !rawText && !VOID.has(tag)) stack.push(element)

    // Raw-text elements: their body is not markup, so it is skipped whole and never scanned.
    // Its text is kept as `raw` -- a standard needs the length of an inlined critical style to
    // decide whether it is small enough to allow. The closing tag is left in place to be read
    // on the next turn, so </svg> nesting still balances and </script> is consumed as a close.
    if (rawText) {
      const bodyStart = i
      skipTo('</' + tag)
      element.raw = text.slice(bodyStart, i)
    }
  }

  return { elements }
}

module.exports = { scan }
