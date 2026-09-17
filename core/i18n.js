'use strict'

// Which language a person is addressed in, and where the words come from.
//
// The scope is narrower than it looks. The harness adds the person's language setting to the
// model's instructions, so the model already answers in that language and nothing it says
// needs translating. What passes through here is only the strings this plugin's handlers
// emit themselves -- the ones that never go through the model at all.
//
// The chain below is ordered by how deliberate each signal is: an explicit choice beats an
// observation, which beats an environment variable, which beats a guess. The link that
// answered is recorded, because "why is it speaking English at me" is otherwise unanswerable.

const fs = require('fs')
const path = require('path')

const FALLBACK = 'en'

// Names people and tools actually write, mapped to the tags the catalogues use. Deliberately
// tolerant: this table exists because the values it reads are typed by humans and by tools
// that do not agree with each other on how to spell a locale.
const RECOGNISED = new Map([
  ['en', 'en'], ['eng', 'en'], ['english', 'en'], ['anglais', 'en'],
  ['fr', 'fr'], ['fra', 'fr'], ['fre', 'fr'], ['french', 'fr'],
  ['francais', 'fr'], ['français', 'fr']
])

function normalise (raw) {
  if (typeof raw !== 'string') return null
  // POSIX locales carry a codeset and a modifier that a language tag does not.
  const cleaned = raw.trim().toLowerCase().split('.')[0].split('@')[0].replace(/_/g, '-')
  if (!cleaned) return null
  if (cleaned === 'c' || cleaned === 'posix') return null

  if (RECOGNISED.has(cleaned)) return RECOGNISED.get(cleaned)

  // Progressive truncation, as language-tag matching prescribes: a subtag of one letter or
  // digit leaves with the subtag that follows it, so a private-use suffix does not strand
  // the rest of the tag.
  const parts = cleaned.split('-')
  while (parts.length > 0) {
    const candidate = parts.join('-')
    if (RECOGNISED.has(candidate)) return RECOGNISED.get(candidate)
    parts.pop()
    if (parts.length > 0 && parts[parts.length - 1].length <= 1) parts.pop()
  }
  return null
}

function readJson (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (_) {
    return null
  }
}

// Only the settings files a handler can actually open. Three of the five layers the harness
// merges arrive by channels that are not files at all, so this never claims to reproduce the
// harness's own precedence -- it reads what it can and says so.
function languageFromSettings (projectDir) {
  const home = process.env.CLAUDE_CONFIG_DIR ||
    (process.env.HOME ? path.join(process.env.HOME, '.claude') : null) ||
    (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.claude') : null)

  const candidates = []
  if (projectDir) {
    candidates.push(path.join(projectDir, '.claude', 'settings.local.json'))
    candidates.push(path.join(projectDir, '.claude', 'settings.json'))
  }
  if (home) candidates.push(path.join(home, 'settings.json'))

  for (const file of candidates) {
    const settings = readJson(file)
    const tag = settings && normalise(settings.language)
    if (tag) return tag
  }
  return null
}

function languageFromEnvironment () {
  // The messages variable comes first and holds a priority list; the category variables
  // follow. A locale of C or POSIX is an absence of preference, not a preference for English,
  // and normalise() drops it so the next link gets its turn.
  const list = (process.env.LANGUAGE || '').split(':').filter(Boolean)
  for (const entry of list) {
    const tag = normalise(entry)
    if (tag) return tag
  }
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const tag = normalise(process.env[name])
    if (tag) return tag
  }
  return null
}

function languageFromRuntime () {
  try {
    if (typeof navigator !== 'undefined' && navigator.language) {
      const tag = normalise(navigator.language)
      if (tag) return tag
    }
  } catch (_) { /* the global is not present on every supported version */ }
  try {
    return normalise(new Intl.DateTimeFormat().resolvedOptions().locale)
  } catch (_) {
    return null
  }
}

// Returns the tag and the link that decided it. The second half matters as much as the
// first: a person asking why they are being addressed in the wrong language needs to know
// which signal won, and a log that only records the answer cannot say.
function resolveLanguage ({ projectDir = null, project = null, dataDir = null } = {}) {
  const attempts = [
    ['plugin option', () => normalise(process.env.CLAUDE_PLUGIN_OPTION_LANGUAGE)],
    ['observed earlier', () => {
      if (!dataDir) return null
      try {
        return normalise(fs.readFileSync(path.join(dataDir, 'lang'), 'utf8'))
      } catch (_) {
        return null
      }
    }],
    ['project file', () => (project && normalise(project.language)) || null],
    ['settings file', () => languageFromSettings(projectDir)],
    ['environment', () => languageFromEnvironment()],
    ['runtime locale', () => languageFromRuntime()]
  ]

  for (const [via, attempt] of attempts) {
    let tag = null
    try {
      tag = attempt()
    } catch (_) {
      tag = null
    }
    if (tag) return { language: tag, via }
  }
  return { language: FALLBACK, via: 'fallback' }
}

class Catalogue {
  constructor (language, strings, messagesDir) {
    this.language = language
    this.strings = strings
    this.messagesDir = messagesDir
  }

  // A missing key returns the key itself. Not a sentence apologising for its own absence:
  // the key is searchable, and a person seeing one knows something is wrong in a way that a
  // smooth substitute would hide. The build-time test is what stops it happening at all.
  get (key, vars = {}) {
    const template = typeof this.strings[key] === 'string' ? this.strings[key] : key
    return template.replace(/\{(\w+)\}/g, (whole, name) =>
      (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole))
  }

  // Plural categories come from the runtime rather than from a convention of ours, because
  // which categories exist is a property of the language and not of this file.
  plural (baseKey, count, vars = {}) {
    let category = 'other'
    try {
      category = new Intl.PluralRules(this.language).select(count)
    } catch (_) { /* fall through to other */ }
    const key = `${baseKey}.${category}`
    const chosen = Object.prototype.hasOwnProperty.call(this.strings, key) ? key : `${baseKey}.other`
    return this.get(chosen, { ...vars, count: this.number(count) })
  }

  number (value) {
    try {
      return new Intl.NumberFormat(this.language).format(value)
    } catch (_) {
      return String(value)
    }
  }
}

function loadCatalogue (language, messagesDir) {
  const file = path.join(messagesDir, `${language}.json`)
  let raw = null
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (_) {
    raw = null
  }
  if (raw === null) {
    if (language === FALLBACK) return {}
    return loadCatalogue(FALLBACK, messagesDir)
  }
  // A byte-order mark makes the parse throw, and the file looks perfectly normal in an
  // editor. Stripping it here costs nothing; a test refuses catalogues that carry one.
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  try {
    return JSON.parse(raw)
  } catch (_) {
    return language === FALLBACK ? {} : loadCatalogue(FALLBACK, messagesDir)
  }
}

function catalogue (options = {}) {
  const messagesDir = options.messagesDir || path.join(__dirname, '..', 'messages')
  const { language, via } = options.language
    ? { language: normalise(options.language) || FALLBACK, via: 'given' }
    : resolveLanguage(options)

  const strings = { ...loadCatalogue(FALLBACK, messagesDir) }
  if (language !== FALLBACK) Object.assign(strings, loadCatalogue(language, messagesDir))

  const c = new Catalogue(language, strings, messagesDir)
  c.via = via
  return c
}

module.exports = { catalogue, resolveLanguage, normalise, FALLBACK }
