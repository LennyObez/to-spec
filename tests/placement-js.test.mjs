// Behaviour stays out of the markup. The canary replays the committed fixtures by finding; the
// branch tests drive the check for the shapes a two-file fixture cannot hold cheaply: a data
// script that is allowed, an executable one that is not, and exclusion by path.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import standards from '../core/standards.js'
import canary from '../core/canary.js'
import check from '../standards/placement-js/check.js'
import htmlScan from '../lib/html-scan.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const definition = standards.loadStandard(ROOT, 'placement-js').definition

const ctxOver = (files) => ({
  list: () => Object.keys(files),
  read: (p) => { if (!(p in files)) throw new Error('no such file'); return files[p] },
  html: { scan: (c) => htmlScan.scan(c) }
})
const run = (files) => check({ standard: definition }, ctxOver(files))
const messages = (result) => result.findings.map((f) => f.message)

test('the committed fixtures answer for the reason declared, not just the verdict', () => {
  const result = canary.replayFixtures(standards.loadStandard(ROOT, 'placement-js'))
  assert.equal(result.ok, true, result.why)
})

test('an external script and a data script are allowed; an executable inline script is not', () => {
  const ok = run({ 'index.html': '<script src="/a.js"></script><script type="application/ld+json">{}</script>' })
  assert.equal(ok.findings.length, 0)

  const bad = run({ 'index.html': '<script>run()</script>' })
  assert.deepEqual(messages(bad), ['a <script> without src runs behaviour from inside the markup'])

  const moduleInline = run({ 'index.html': '<script type="module">import x from "y"</script>' })
  assert.equal(moduleInline.findings.length, 1, 'an inline module is still behaviour in the markup')
})

test('an event-handler attribute and a javascript URI are each reported', () => {
  const handler = run({ 'index.html': '<button onclick="go()">x</button>' })
  assert.deepEqual(messages(handler), ['an onclick handler puts behaviour in the markup'])

  const uri = run({ 'index.html': '<a href="javascript:go()">x</a>' })
  assert.deepEqual(messages(uri), ['a javascript: URI in href puts behaviour in the markup'])
})

test('a plain data attribute beginning with "on" is not mistaken for a handler', () => {
  // The guard matches on* handler names, not any attribute that starts with the letters on.
  const result = run({ 'index.html': '<div once="true" data-online="yes">x</div>' })
  assert.equal(result.findings.length, 0)
})

test('a file outside the standard\'s paths is left alone', () => {
  const result = run({ 'src/App.svelte': '<button onclick="go()">x</button>' })
  assert.equal(result.findings.length, 0)
})

test('a file mode run reads the given content, never disk', () => {
  const result = check({ standard: definition, mode: 'file', files: [{ path: 'page.html', content: '<script>x()</script>' }] },
    { html: { scan: htmlScan.scan } })
  assert.equal(result.findings.length, 1)
})
