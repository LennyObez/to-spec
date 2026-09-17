'use strict'

// Behaviour belongs in a script the page references, not in the markup. Three shapes carry it
// there: a `<script>` with no `src` (its body runs from inside the page), an `on*` event-handler
// attribute, and a `javascript:` URI. A `<script>` with a `src`, and one whose `type` is a data
// or config type rather than executable, are left alone: they carry data, not behaviour.
//
// It runs in two modes, reading a file the same way in each: one file's resulting content before
// a write, and the whole tree at the end of a turn.

const { matchesAny } = require('../../lib/glob')

// The event-handler content attributes the HTML standard defines, matched exactly rather than by
// an on* pattern that would also catch a word like "once". The list is the authority; a name not
// on it is not a handler.
const EVENT_HANDLERS = new Set([
  'onabort', 'onauxclick', 'onbeforeinput', 'onbeforematch', 'onbeforetoggle', 'onblur', 'oncancel',
  'oncanplay', 'oncanplaythrough', 'onchange', 'onclick', 'onclose', 'oncontextlost', 'oncontextmenu',
  'oncontextrestored', 'oncopy', 'oncuechange', 'oncut', 'ondblclick', 'ondrag', 'ondragend',
  'ondragenter', 'ondragleave', 'ondragover', 'ondragstart', 'ondrop', 'ondurationchange', 'onemptied',
  'onended', 'onerror', 'onfocus', 'onformdata', 'oninput', 'oninvalid', 'onkeydown', 'onkeypress',
  'onkeyup', 'onload', 'onloadeddata', 'onloadedmetadata', 'onloadstart', 'onmousedown', 'onmouseenter',
  'onmouseleave', 'onmousemove', 'onmouseout', 'onmouseover', 'onmouseup', 'onpaste', 'onpause', 'onplay',
  'onplaying', 'onpointercancel', 'onpointerdown', 'onpointerenter', 'onpointerleave', 'onpointermove',
  'onpointerout', 'onpointerover', 'onpointerup', 'onprogress', 'onratechange', 'onreset', 'onresize',
  'onscroll', 'onscrollend', 'onsecuritypolicyviolation', 'onseeked', 'onseeking', 'onselect',
  'onslotchange', 'onstalled', 'onsubmit', 'onsuspend', 'ontimeupdate', 'ontoggle', 'onvolumechange',
  'onwaiting', 'onwheel', 'onafterprint', 'onbeforeprint', 'onbeforeunload', 'onhashchange',
  'onlanguagechange', 'onmessage', 'onmessageerror', 'onoffline', 'ononline', 'onpagehide', 'onpageshow',
  'onpopstate', 'onrejectionhandled', 'onstorage', 'onunhandledrejection', 'onunload'
])
const JS_URI = /^\s*javascript:/i

module.exports = function check (input, ctx) {
  const std = input.standard || {}
  const include = (std.paths && std.paths.include) || []
  const exclude = (std.paths && std.paths.exclude) || []
  const allowedTypes = new Set(((std.allowlist && std.allowlist.script_types) || []).map((t) => String(t).toLowerCase()))
  const inScope = (p) => matchesAny(include, p) && !matchesAny(exclude, p)

  const findings = []
  const scan = (file, content) => {
    for (const el of ctx.html.scan(content).elements) {
      for (const attr of el.attrs) {
        if (EVENT_HANDLERS.has(attr.name)) {
          findings.push({ path: file, line: attr.line, message: `an ${attr.name} handler puts behaviour in the markup` })
        } else if (JS_URI.test(attr.value)) {
          findings.push({ path: file, line: attr.line, message: `a javascript: URI in ${attr.name} puts behaviour in the markup` })
        }
      }
      if (el.tag === 'script') {
        const hasSrc = el.attrs.some((a) => a.name === 'src')
        const type = (el.attrs.find((a) => a.name === 'type') || {}).value
        const dataType = type != null && allowedTypes.has(String(type).toLowerCase())
        if (!hasSrc && !dataType) {
          findings.push({ path: file, line: el.line, message: 'a <script> without src runs behaviour from inside the markup' })
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
