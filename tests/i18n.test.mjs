// The catalogues, and the language the person is addressed in.
//
// The scope here is narrower than it looks, and the narrowing is the point. The harness adds
// the person's language to the model's instructions, so the model already answers in that
// language and nothing it says needs translating. What passes through these catalogues is
// only what the handlers emit themselves, the strings that never go through the model at
// all. Everything else was scope this plugin does not need.
//
// Eight checks, each guarding a way a catalogue rots without anyone noticing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const i18n = require(join(ROOT, 'core/i18n.js'))

const MESSAGES = join(ROOT, 'messages')

// Discovered, never listed. Adding a language must submit it to every check below without
// anyone remembering to add it here.
const LANGUAGES = readdirSync(MESSAGES)
  .filter((f) => /^[a-z]{2}(-[A-Za-z]+)?\.json$/.test(f))
  .map((f) => f.replace(/\.json$/, ''))

const raw = (lang) => readFileSync(join(MESSAGES, `${lang}.json`), 'utf8')
const load = (lang) => JSON.parse(raw(lang))
const keysOf = (lang) => Object.keys(load(lang)).filter((k) => !k.startsWith('$'))

function sourceFiles (dir, acc = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry)
    if (statSync(join(ROOT, rel)).isDirectory()) sourceFiles(rel, acc)
    else if (rel.endsWith('.js')) acc.push(rel)
  }
  return acc
}
// Comment lines are stripped, so a key named only in a comment does not satisfy "this message
// is emitted somewhere" nor inflate "this key is asked for". Only what the code runs counts.
const SOURCE = ['core', 'harness'].flatMap((d) => sourceFiles(d))
  .map((f) => readFileSync(join(ROOT, f), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))
  .join('\n')

test('there is more than one language, or none of this is being exercised', () => {
  assert.ok(LANGUAGES.length >= 2, `only found ${LANGUAGES.join(', ')}`)
  assert.ok(LANGUAGES.includes(i18n.FALLBACK), 'the fallback language must have a catalogue')
})

test('a. every language carries the same keys, in both directions', () => {
  const reference = new Set(keysOf(i18n.FALLBACK))
  for (const lang of LANGUAGES) {
    if (lang === i18n.FALLBACK) continue
    const theirs = new Set(keysOf(lang))

    // Plural categories differ by language on purpose: one language has two, another three.
    // Comparing the stems rather than the keys is what lets that be true without a hole.
    const stems = (set) => new Set([...set].map((k) => k.replace(/\.(zero|one|two|few|many|other)$/, '')))
    assert.deepEqual([...stems(theirs)].sort(), [...stems(reference)].sort(),
      `${lang} and ${i18n.FALLBACK} do not carry the same messages`)
  }
})

test('b. every key the code asks for exists in every language', () => {
  // The namespaces the catalogue actually uses, so a dotted literal that is a filename
  // (settings.local.json) is not mistaken for a message key.
  const domains = new Set(keysOf(i18n.FALLBACK).map((k) => k.split('.')[0]))
  const asked = new Set([
    ...[...SOURCE.matchAll(/\.get\(\s*'([^']+)'/g)].map((m) => m[1]),
    ...[...SOURCE.matchAll(/\.plural\(\s*'([^']+)'/g)].map((m) => m[1]),
    ...[...SOURCE.matchAll(/key:\s*'([a-z]+\.[a-z_.]+)'/g)].map((m) => m[1]),
    // A key reached through a variable -- `catalogue.get(key, ...)` where key was chosen just
    // above -- is not caught by the call-site patterns. Every dotted literal whose first
    // segment is a catalogue namespace is collected too, so a message named anywhere in the
    // runtime is checked.
    ...[...SOURCE.matchAll(/'([a-z]+\.[a-z][a-z_]*(?:\.[a-z][a-z_]*)+)'/g)].map((m) => m[1])
      .filter((k) => domains.has(k.split('.')[0]))
  ])
  assert.ok(asked.size > 0, 'no key is asked for anywhere, so this check would pass vacuously')

  for (const lang of LANGUAGES) {
    const have = new Set(keysOf(lang))
    for (const key of asked) {
      const present = have.has(key) || [...have].some((k) => k.startsWith(`${key}.`))
      assert.ok(present, `${lang} has no message for ${key}`)
    }
  }
})

test('c. every message in the catalogue is asked for somewhere', () => {
  // A message nobody emits has never been read in context, and it is the one most likely to
  // be wrong when it finally is.
  const stems = new Set(keysOf(i18n.FALLBACK).map((k) => k.replace(/\.(zero|one|two|few|many|other)$/, '')))
  for (const stem of stems) {
    assert.ok(SOURCE.includes(`'${stem}'`), `nothing ever emits ${stem}`)
  }
})

test('d. a message takes the same values in every language', () => {
  const markers = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
  const reference = load(i18n.FALLBACK)
  for (const lang of LANGUAGES) {
    if (lang === i18n.FALLBACK) continue
    const theirs = load(lang)
    for (const [key, value] of Object.entries(reference)) {
      if (key.startsWith('$') || !theirs[key]) continue
      assert.deepEqual(markers(theirs[key]), markers(value),
        `${lang} ${key} takes different values from ${i18n.FALLBACK}`)
    }
  }
})

test('e. every plural category the runtime produces is covered', () => {
  // Stated as coverage rather than as equality: the day a language's data gains a category,
  // equality would go red without a single translation being wrong.
  for (const lang of LANGUAGES) {
    const produced = new Intl.PluralRules(lang).resolvedOptions().pluralCategories
    const have = keysOf(lang)
    const stems = new Set(have.filter((k) => /\.(zero|one|two|few|many|other)$/.test(k))
      .map((k) => k.replace(/\.(zero|one|two|few|many|other)$/, '')))
    for (const stem of stems) {
      for (const category of produced) {
        assert.ok(have.includes(`${stem}.${category}`),
          `${lang} ${stem} has no form for "${category}", which this language produces`)
      }
      assert.ok(have.includes(`${stem}.other`), `${lang} ${stem} has no fallback form`)
    }
  }
})

// Diacritics folded before matching, on both sides, so a forbidden word catches its accented
// spelling: "prêt" must trip the entry written "pret", and a message written "pret" must trip
// it too. Without the fold, restoring the accents a French message needs would quietly walk
// every verdict word out from under the guard.
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

test('f. no message uses a word a person should not have to read', () => {
  for (const lang of LANGUAGES) {
    const forbidden = JSON.parse(readFileSync(join(MESSAGES, `forbidden-words.${lang}.json`), 'utf8'))
    const strings = Object.entries(load(lang))
      .filter(([k]) => !k.startsWith('$'))
      .map(([k, v]) => [k, String(v)])

    for (const [key, text] of strings) {
      const folded = fold(text)
      for (const word of forbidden.jargon) {
        assert.ok(!new RegExp(`\\b${fold(word)}\\b`, 'i').test(folded),
          `${lang} ${key} says "${word}", which is a machine word`)
      }
      for (const word of forbidden.caseSensitive) {
        assert.ok(!new RegExp(`\\b${fold(word)}\\b`).test(folded),
          `${lang} ${key} says "${word}"`)
      }
      for (const verdict of forbidden.verdicts) {
        assert.ok(!new RegExp(`\\b${fold(verdict)}\\b`, 'i').test(folded),
          `${lang} ${key} declares "${verdict}"; a guard can observe that it found nothing, not that there is nothing to find`)
      }
    }
  }
})

test('g. the locale data this runtime carries behaves as the catalogues assume', () => {
  // Formatting and plural selection come from data that ships with the runtime and changes
  // between versions. This ties every catalogue language to its own locale data rather than
  // checking two fixed values: if the runtime carries only a stub for one of them, the tag
  // will not resolve to itself and this says so plainly.
  for (const lang of LANGUAGES) {
    assert.equal(new Intl.PluralRules(lang).resolvedOptions().locale, lang,
      `the runtime has no plural data for ${lang}, so its messages would choose the wrong form`)
    assert.equal(new Intl.NumberFormat(lang).resolvedOptions().locale, lang,
      `the runtime has no number data for ${lang}, so its numbers would not format as written`)
  }
  // The plural categories the catalogues are built around still hold on this runtime.
  assert.equal(new Intl.PluralRules('en').select(1), 'one')
  assert.equal(new Intl.PluralRules('fr').select(1), 'one')
})

test('h. no catalogue opens with a byte-order mark', () => {
  // It is invisible in an editor and it makes the parse throw. The loader strips it; this
  // stops one arriving in the first place.
  for (const lang of LANGUAGES) {
    assert.notEqual(raw(lang).charCodeAt(0), 0xfeff, `${lang}.json begins with a byte-order mark`)
  }
})

test('the language is resolved from the most deliberate signal available', () => {
  const order = [
    [{ CLAUDE_PLUGIN_OPTION_LANGUAGE: 'fr', LANG: 'en_US.UTF-8' }, 'fr', 'plugin option'],
    [{ LANGUAGE: 'fr_FR:fr', LANG: 'en_US.UTF-8' }, 'fr', 'environment'],
    [{ LC_ALL: 'fr_FR.UTF-8' }, 'fr', 'environment'],
    [{ LANG: 'fr_FR.UTF-8' }, 'fr', 'environment']
  ]
  for (const [env, expected, via] of order) {
    const saved = { ...process.env }
    for (const key of ['CLAUDE_PLUGIN_OPTION_LANGUAGE', 'LANGUAGE', 'LC_ALL', 'LC_MESSAGES', 'LANG']) {
      delete process.env[key]
    }
    Object.assign(process.env, env)
    try {
      const out = i18n.resolveLanguage({})
      assert.equal(out.language, expected, `${JSON.stringify(env)} resolved to ${out.language}`)
      assert.equal(out.via, via, 'the link that answered has to be recorded, or a wrong language is unexplainable')
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, saved)
    }
  }
})

test('a locale that expresses no preference is not mistaken for one', () => {
  // These mean "no locale", not "English". Treating them as a preference would silently
  // answer in English to someone who never said so.
  for (const value of ['C', 'POSIX', 'C.UTF-8']) {
    assert.equal(i18n.normalise(value), null, `${value} was read as a preference`)
  }
})

test('a language written the way people write it is recognised', () => {
  for (const spelling of ['fr', 'FR', 'fr-FR', 'fr_FR.UTF-8', 'french', 'français', 'francais']) {
    assert.equal(i18n.normalise(spelling), 'fr', `${spelling} was not recognised`)
  }
})

test('an unknown language falls back rather than failing', () => {
  const catalogue = i18n.catalogue({ language: 'xx' })
  assert.equal(catalogue.language, i18n.FALLBACK)
  assert.ok(catalogue.get('canary.broken').length > 0)
})

test('a missing key comes back as the key, not as an apology', () => {
  // Searchable, and unmistakably wrong. A smooth substitute would hide the fault from the
  // only person able to report it.
  const catalogue = i18n.catalogue({ language: 'en' })
  assert.equal(catalogue.get('nothing.like.this'), 'nothing.like.this')
})

test('values are interpolated, and an unknown one is left visible', () => {
  const catalogue = i18n.catalogue({ language: 'en' })
  assert.match(catalogue.get('gate.stuck', { path: 'reports/gate.json' }), /reports\/gate\.json/)
  assert.match(catalogue.get('gate.stuck', {}), /\{path\}/,
    'a value nobody supplied must stay visible rather than vanish into a sentence that reads fine')
})

test('the status file renders wholly in the addressed language', () => {
  // The defect this closes: the renderer once hard-coded its headings and sentences in English
  // while two lines went through the catalogue, so a French session read a half-English file.
  // Rendered in French, none of the English headings may survive, and the French ones must.
  const statusFile = require(join(ROOT, 'core/status-file.js'))
  const sample = { outstanding: { agent: ['placement-css'], user: ['legal-identity'], unverifiable: ['a11y-live'] } }

  const en = i18n.catalogue({ language: 'en' })
  const fr = i18n.catalogue({ language: 'fr' })
  const rendered = { en: statusFile.render(sample, en, { reportPath: 'r.json' }), fr: statusFile.render(sample, fr, { reportPath: 'r.json' }) }

  for (const english of ['What I can still do', 'What I need from you', 'Not checked here']) {
    assert.match(rendered.en, new RegExp(english))
    assert.ok(!rendered.fr.includes(english), `the French status file still carries the English "${english}"`)
  }
  for (const french of ['Ce que je peux encore faire', 'Ce dont j', 'Non vérifié ici']) {
    assert.ok(rendered.fr.includes(french), `the French status file is missing "${french}"`)
  }
})

test('the status renderer holds no person-facing English literal of its own', () => {
  // A heading or sentence written straight into the renderer would escape the catalogues and
  // their lexicon. Every such string must arrive through catalogue.get; this refuses a bare
  // capitalised sentence in the source, so the previous defect cannot creep back.
  const source = readFileSync(join(ROOT, 'core/status-file.js'), 'utf8')
  const body = source.split('\n')
    .filter((line) => !/^\s*\/\//.test(line)) // strip comment lines, which are for the maintainer
    .join('\n')
  // A double-quoted or backtick string of three or more words starting with a capital letter,
  // outside a catalogue key, is the shape the headings used to take.
  const suspects = body.match(/["`][A-Z][a-z]+ [a-z]+ [a-z]+[^"`]*["`]/g) || []
  assert.deepEqual(suspects, [], `person-facing literals remain in the renderer: ${JSON.stringify(suspects)}`)
})
