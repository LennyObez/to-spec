// The forgiving markup scanner the placement standards read.
//
// The discriminating properties are the ones a regex over the raw text gets wrong: a `style=`
// inside a script body is not an inline style, a comment is not markup, and a template
// expression must not derail the scan. Each is exercised, alongside the plain reading of tags,
// attributes and line numbers, and the one nesting fact the scanner tracks -- whether an
// element sits inside an <svg>.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import htmlScan from '../lib/html-scan.js'
const { scan } = htmlScan

const attrsNamed = (result, name) =>
  result.elements.flatMap((el) => el.attrs.filter((a) => a.name === name).map((a) => ({ ...a, tag: el.tag, svg: el.svg })))
const tags = (result, tag) => result.elements.filter((el) => el.tag === tag)

test('an inline style attribute is found, with its line and value', () => {
  const r = scan('<div class="a"\n      style="color: red">hi</div>')
  const styles = attrsNamed(r, 'style')
  assert.equal(styles.length, 1)
  assert.equal(styles[0].value, 'color: red')
  assert.equal(styles[0].line, 2, 'the attribute keeps the line it sits on, not the tag line')
})

test('a style element is found as a tag, distinct from a style attribute', () => {
  const r = scan('<head>\n<style>.a{color:red}</style>\n</head>')
  assert.equal(tags(r, 'style').length, 1)
  assert.equal(attrsNamed(r, 'style').length, 0)
})

test('event-handler and javascript-uri attributes are reported by name and value', () => {
  const r = scan('<a href="javascript:void(0)" onclick="go()">x</a>')
  assert.equal(attrsNamed(r, 'onclick')[0].value, 'go()')
  assert.match(attrsNamed(r, 'href')[0].value, /^javascript:/)
})

test('a script is reported with whether it carries a src', () => {
  const r = scan('<script src="/a.js"></script>\n<script>run()</script>')
  const scripts = tags(r, 'script')
  assert.equal(scripts.length, 2)
  assert.equal(scripts[0].attrs.some((a) => a.name === 'src'), true)
  assert.equal(scripts[1].attrs.some((a) => a.name === 'src'), false)
})

test('a style= written inside a script body is not read as an inline style', () => {
  // The property no regex has: the body of a script is not markup. A string in JavaScript that
  // happens to contain style= must not be reported as an attribute on some phantom element.
  const r = scan('<script>\n  el.setAttribute("style", "color:red");\n  const s = "<div style=\'x\'>";\n</script>')
  assert.equal(attrsNamed(r, 'style').length, 0)
  assert.equal(tags(r, 'div').length, 0, 'markup inside a script string is text, not an element')
})

test('a raw-text element keeps its body, so its length can be judged', () => {
  const r = scan('<style data-critical>.a{color:red}</style>')
  const style = tags(r, 'style')[0]
  assert.equal(style.raw, '.a{color:red}')
  assert.equal(style.attrs.some((a) => a.name === 'data-critical'), true)
})

test('content inside an html comment is not scanned', () => {
  const r = scan('<!-- <div style="x"> commented out --><p>real</p>')
  assert.equal(attrsNamed(r, 'style').length, 0)
  assert.equal(tags(r, 'div').length, 0)
  assert.equal(tags(r, 'p').length, 1)
})

test('template expressions in and around attributes do not derail the scan', () => {
  const r = scan('<a href="{{ url }}" {% if x %}data-on{% endif %} @class(["p"=>true])>t</a>')
  assert.equal(attrsNamed(r, 'href')[0].value, '{{ url }}', 'a templated value is kept verbatim')
  assert.equal(tags(r, 'a').length, 1, 'the tag is still recognised through the template noise')
  assert.equal(attrsNamed(r, 'style').length, 0, 'nothing here is a style attribute')
})

test('a style attribute inside an svg subtree is marked, one outside is not', () => {
  const r = scan('<div style="a">\n<svg><rect style="b"/></svg>\n<span style="c">x</span></div>')
  const styles = attrsNamed(r, 'style')
  const byValue = Object.fromEntries(styles.map((s) => [s.value, s.svg]))
  assert.equal(byValue.a, false)
  assert.equal(byValue.b, true, 'a rect inside svg is within the svg subtree')
  assert.equal(byValue.c, false, 'the span after </svg> is outside it again')
})

test('a self-closed svg does not swallow everything after it', () => {
  const r = scan('<svg/>\n<div style="a">x</div>')
  assert.equal(attrsNamed(r, 'style')[0].svg, false, 'the div is not inside the self-closed svg')
})

test('an unquoted attribute value is read to the next space or angle bracket', () => {
  const r = scan('<input type=text disabled>')
  const el = tags(r, 'input')[0]
  assert.equal(el.attrs.find((a) => a.name === 'type').value, 'text')
  assert.equal(el.attrs.find((a) => a.name === 'disabled').value, '')
})

test('malformed markup terminates rather than looping', () => {
  // A lone angle bracket, an unclosed tag, an unterminated script: each must end the scan, not
  // hang it. The assertion that matters is that scan returns at all.
  for (const bad of ['a < b and c', '<div class="x', '<script>never closed', '<<<', '</>', '<svg>']) {
    assert.doesNotThrow(() => scan(bad))
  }
})

test('an element carries the text directly inside it, not the text of its children', () => {
  const r = scan('<p>Hello <b>world</b> again</p><h1>{{ title }}</h1>')
  const p = tags(r, 'p')[0]
  assert.match(p.text, /Hello/)
  assert.match(p.text, /again/)
  assert.doesNotMatch(p.text, /world/, 'the child <b> holds its own text')
  assert.equal(tags(r, 'b')[0].text.trim(), 'world')
  assert.equal(tags(r, 'h1')[0].text.trim(), '{{ title }}')
})

test('a void element holds no text, and text after it belongs to the parent', () => {
  const r = scan('<p>before<br>after</p>')
  assert.match(tags(r, 'p')[0].text, /before/)
  assert.match(tags(r, 'p')[0].text, /after/, 'a br does not open a scope that swallows the rest')
})

test('line numbers survive blank lines and carriage returns', () => {
  const r = scan('<a>\n\r\n<b style="x">')
  assert.equal(attrsNamed(r, 'style')[0].line, 3)
})
