// Logic stays out of the view. The canary replays the fixtures; the branch tests cover the two
// shapes and the exemptions: an embedded PHP tag in a markup file, a query in a view, a
// presentation helper left alone, and PHP in a real PHP file left alone.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import standards from '../core/standards.js'
import canary from '../core/canary.js'
import check from '../standards/placement-php/check.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const definition = standards.loadStandard(ROOT, 'placement-php').definition

const ctxOver = (files) => ({
  list: () => Object.keys(files),
  read: (p) => { if (!(p in files)) throw new Error('no such file'); return files[p] }
})
const run = (files) => check({ standard: definition }, ctxOver(files))
const messages = (result) => result.findings.map((f) => f.message)

test('the committed fixtures answer for the reason declared, not just the verdict', () => {
  const result = canary.replayFixtures(standards.loadStandard(ROOT, 'placement-php'))
  assert.equal(result.ok, true, result.why)
})

test('a PHP tag in a markup file is reported; the same tag in a php file is not', () => {
  assert.deepEqual(messages(run({ 'page.html': '<?php echo 1; ?>' })), ['PHP is embedded in a file that is not a PHP file'])
  assert.equal(run({ 'index.php': '<?php echo 1;' }).findings.length, 0)
})

test('a query, an env read and a superglobal in a view are each reported', () => {
  assert.deepEqual(messages(run({ 'resources/views/a.blade.php': '{{ DB::table("x")->get() }}' })),
    ['a database query belongs in the application, not the view'])
  assert.deepEqual(messages(run({ 'resources/views/a.blade.php': '{{ env("APP_KEY") }}' })),
    ['an env() call belongs in the application, not the view'])
  assert.deepEqual(messages(run({ 'resources/views/a.blade.php': '<?php echo $_GET["q"]; ?>' })),
    ['a raw request superglobal belongs in the application, not the view'])
})

test('a presentation helper in a view is left alone', () => {
  const result = run({ 'resources/views/a.blade.php': '<a href="{{ route("home") }}">{{ __("Home") }}</a>' })
  assert.equal(result.findings.length, 0)
})

test('a view is recognised by a blade name even outside the configured folders', () => {
  const result = run({ 'app/Mail/welcome.blade.php': '{{ DB::table("x")->get() }}' })
  assert.equal(result.findings.length, 1)
})

test('a file mode run reads the given content, never disk', () => {
  const result = check({ standard: definition, mode: 'file', files: [{ path: 'resources/views/a.blade.php', content: '{{ env("X") }}' }] }, {})
  assert.equal(result.findings.length, 1)
})
