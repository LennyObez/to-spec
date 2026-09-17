'use strict'

// Refuse to touch a file this repository keeps private that also carries a secret-bearing
// name, and refuse to write credential-shaped content where it would be published.
//
// Two questions, and neither is answered by a hand-kept list of what is secret. Whether a
// file is private is the repository's answer, not this file's: a name that looks secret-
// bearing is submitted to the ignore rules, and only a file the repository ignores is
// withheld, so a tracked template of the same name is untouched. What the list below does
// hold is which names are worth asking about -- environment files, private keys, credential
// files -- because asking the repository about every path would withhold every build and
// vendor directory it ignores, which is not a secret at all. Whether content is a credential
// is decided by issuer shape, never by entropy, which fires on identifiers and base64 assets.
//
// It also reaches where a permission rule cannot: a rule sees the file commands the harness
// knows about, not a subprocess opening the file through an interpreter. This reads the text.
//
// Declared limits, rather than hidden ones:
//
//  - It matches text. A path reached through a variable, a shell glob, or an encoding is not
//    caught. This raises the cost of an accident; it is not a sandbox.
//  - It knows a fixed set of secret-bearing name shapes. A private file with a name outside
//    that set is not recognised, and a credential inside it is caught only by content.
//  - It over-approximates in prose: a secret-bearing name or a credential mentioned in a
//    comment is still refused. An undecidable answer about a secret leans to refusal.
//  - It fails closed. If the project directory is unknown, or the repository cannot answer,
//    the call is refused rather than allowed.
//  - A probe measured that a handler which overruns its deadline renders no decision at all
//    and the action proceeds. That is why the cheap path below comes first: the guard has to
//    reach an answer while anyone is still listening.

const path = require('path')

const ALLOW = 'allow'
const REFUSE = 'refuse'

// Prefixes that are private by construction, so that recognising one is a fact about the
// string rather than a guess about its randomness. Each carries a fixed human name: the
// reason a guard gives is written to the transcript, and a label derived from the matched
// text would, for several of these, be the credential itself. The name is never the value.
const PRIVATE_BY_DESIGN = [
  { re: /\bsk_live_[A-Za-z0-9]{8,}/, name: 'a live secret key' },
  { re: /\bsk_test_[A-Za-z0-9]{8,}/, name: 'a test secret key' },
  { re: /\brk_live_[A-Za-z0-9]{8,}/, name: 'a live restricted key' },
  { re: /\bsk-ant-[A-Za-z0-9_-]{8,}/, name: 'an API secret key' },
  { re: /\bAKIA[0-9A-Z]{12,}/, name: 'a cloud access key id' },
  { re: /\bghp_[A-Za-z0-9]{20,}/, name: 'a personal access token' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/, name: 'a personal access token' },
  { re: /\bglpat-[A-Za-z0-9_-]{16,}/, name: 'a personal access token' },
  { re: /\bxox[bpsa]-[A-Za-z0-9-]{10,}/, name: 'a workspace token' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, name: 'a private key' }
]

// Names worth asking the repository about: environment files, private keys, credential files.
// The set is what to interrogate, not what is secret -- the ignore rules decide that. A file
// whose name is outside this set is not submitted, so an ignored build or vendor directory is
// never mistaken for a secret.
const SECRET_BASENAME = /^(\.env(\.[A-Za-z0-9_.-]+)?|\.npmrc|\.pypirc|\.netrc|\.pgpass|\.dockercfg|id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials\.json|secrets?\.ya?ml)$/i
const SECRET_EXT = /\.(pem|key|p12|pfx|keystore|jks|asc)$/i
// The cheap first pass: does the raw payload mention any secret-bearing name at all.
const MENTIONS_SECRET_NAME = /\.env|\.npmrc|\.pypirc|\.netrc|\.pgpass|\.dockercfg|id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials\.json|secrets?\.ya?ml|\.pem|\.p12|\.pfx|\.keystore|\.jks|\.asc|[A-Za-z0-9_./~-]+\.key\b/i

// Counterparts that are public by construction. Listing them explicitly is what lets the
// guard stay quiet on the keys a page is supposed to carry.
const PUBLIC_BY_DESIGN = [
  /\bpk_live_/, /\bpk_test_/, /\bAIza/,
  /\bNEXT_PUBLIC_/, /\bVITE_/, /\bPUBLIC_/
]

// A token that is visibly a stand-in rather than a credential. Applied to the matched token
// and not to the whole line: a real key sitting next to the word "example" is still a real
// key, and testing the line would have exempted it.
const STAND_IN = /(x{4,}|<[^>]*>|your[_-]?|placeholder|changeme|\.\.\.)/i

const ASSIGNMENT = /\b(password|passwd|secret|api[_-]?key|token|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["'][^"'\s]{8,}["']/i

// Windows separators arrive escaped, so one separator reaches us as two characters. Folding
// every run of separators to a single forward slash makes a Windows path and a POSIX path
// the same shape to everything that follows.
function normalise (text) {
  return String(text).replace(/\\+/g, '/').replace(/\/{2,}/g, '/')
}

// A candidate keeps the spelling the call used. The harness sends absolute paths and a person
// types relative ones, and only the second kind is resolved against the project: joining an
// absolute path onto a directory yields a path that exists nowhere, which reads as "not there
// yet" and would wave the write through.
function resolveAgainst (projectDir, candidate) {
  const text = normalise(candidate)
  if (text.startsWith('/') || /^[A-Za-z]:\//.test(text)) return text
  return normalise(path.join(projectDir, text))
}

// Windows drops trailing dots and spaces from a filename, so ".env." and ".env " both open
// the file named ".env". A guard that tested only the literal spelling would be walked around
// by the alias, so the final component is folded that way before it is matched.
function foldWin32 (base) {
  return base.replace(/[. ]+$/, '')
}

// True when a path's own name is one worth asking the repository about, by its literal name or
// by the name Windows would resolve it to.
function looksSecretName (candidate) {
  const base = normalise(candidate).split('/').pop() || ''
  const folded = foldWin32(base)
  return SECRET_BASENAME.test(base) || SECRET_EXT.test(base) ||
    SECRET_BASENAME.test(folded) || SECRET_EXT.test(folded)
}

function candidatePaths (rawInput) {
  // Every path-like run in the payload, then only those whose name is secret-bearing. An
  // optional drive prefix is kept, so an absolute path from the other platform is asked about
  // whole rather than beheaded at the colon. Matched without regard to case, because two of
  // the three platforms this runs on treat .ENV and .env as the same file, and the guard would
  // otherwise be absent exactly where the filesystem is most forgiving.
  const found = (normalise(rawInput).match(/(?:[A-Za-z]:)?[A-Za-z0-9_./~-]+/gi) || []).filter(looksSecretName)
  // The literal token and, where they differ, the name Windows would resolve it to, so an
  // ignore rule on ".env" is asked about even when the payload spelled it ".env.".
  const withAliases = found.flatMap((p) => {
    const base = p.split('/').pop() || ''
    const folded = p.slice(0, p.length - base.length) + foldWin32(base)
    return folded !== p ? [p, folded] : [p]
  })
  return [...new Set(withAliases)].sort()
}

// Precedence matters here, and it is the opposite of what reads naturally. A prefix that is
// private by construction is a fact about the string; "this line mentions the word example"
// is a guess about intent. The fact wins, and the guess only ever exempts the token it is
// looking at.
// What comes back names the kind and the place, never the value.
//
// The reason a guard gives is read by the model and written to the transcript, so a guard
// that quotes what it just stopped has moved the credential rather than withheld it, into a
// place that is kept, searched and often shared. Naming the line is enough to find it; the
// person already has the file open.
function looksSecret (text) {
  const lines = String(text).split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    for (const entry of PRIVATE_BY_DESIGN) {
      const match = line.match(entry.re)
      if (match && !STAND_IN.test(match[0])) {
        // The fixed human name, never a slice of the matched token.
        return { kind: entry.name, line: index + 1 }
      }
    }
    if (PUBLIC_BY_DESIGN.some((pattern) => pattern.test(line))) continue
    // The looser rule, where a stand-in anywhere on the line is enough to stay quiet: this
    // one recognises a shape rather than an issuer, so it errs towards silence.
    if (ASSIGNMENT.test(line) && !STAND_IN.test(line)) {
      const named = (line.match(ASSIGNMENT) || [])[1] || 'a credential'
      return { kind: named, line: index + 1 }
    }
  }
  return null
}

// The path-bearing fields, which name where a write goes rather than what it contains. They
// are checked as paths and must never be scanned as content, or a write to `config/.env`
// would be read as "the text says .env" instead of "the destination is .env".
const PATH_FIELDS = new Set(['file_path', 'notebook_path', 'path', 'filePath', 'cwd', 'directory'])

// Every string a tool would write, at any depth, except the path-bearing fields. A three-name
// list catches Write and Edit and a Bash command; it misses a nested edit or the next tool.
function writtenText (toolInput) {
  const parts = []
  const walk = (node, key) => {
    if (typeof node === 'string') {
      if (!PATH_FIELDS.has(key)) parts.push(node)
    } else if (Array.isArray(node)) {
      for (const item of node) walk(item, key)
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, k)
    }
  }
  walk(toolInput, null)
  return parts.join('\n')
}

// `deps.checkIgnore(path)` answers the way the underlying command does: 0 when the path is
// ignored, 1 when it is not, anything else when it could not decide. It is called once per
// path, never with a list, because a list answers "is any of these ignored" and a single
// private file would then condemn every other path in the same call.
// `deps.exists(path)` tells a file that is there from one that is about to be created.
function inspect (payload, deps) {
  const raw = JSON.stringify(payload || {})

  // The cheap path. The overwhelming majority of calls mention no secret-bearing file and no
  // credential, and a guard on every call has to cost nothing when it has nothing to say.
  const mentionsSecretName = MENTIONS_SECRET_NAME.test(raw)
  const toolInput = (payload && payload.tool_input) || {}
  // Every string a tool would write, whatever the field is called, rather than three fields by
  // name: a new writing tool, or a nested edit, would otherwise slip a credential past. Path-
  // bearing fields are excluded, because a path is checked as a path, not scanned as content.
  const written = writtenText(toolInput)
  const secretLine = written ? looksSecret(written) : null

  if (!mentionsSecretName && !secretLine) return { decision: ALLOW, reason: null }

  if (!deps.projectDir) {
    return {
      decision: REFUSE,
      key: 'secrets.cannot_check',
      reason: 'The project directory is unknown, so the repository cannot be asked whether these files are private. Refusing rather than guessing.'
    }
  }

  const toolName = (payload && payload.tool_name) || ''

  for (const candidate of candidatePaths(raw)) {
    const status = deps.checkIgnore(candidate)

    if (status === 1) continue // tracked template, or outside every ignore rule

    if (status !== 0) {
      return {
        decision: REFUSE,
        key: 'secrets.cannot_check',
        reason: `The repository could not decide whether '${candidate}' is private. An undecidable answer about a secret leans to refusal.`
      }
    }

    // Ignored, therefore private. Creating one is legitimate, since that is where a secret
    // is supposed to go, so a write to a path that does not exist yet is allowed. A write
    // over one that does, and every read of one, is not.
    if (toolName === 'Write' && !deps.exists(candidate)) continue

    return {
      decision: REFUSE,
      key: toolName === 'Write' || toolName === 'Edit' ? 'secrets.withheld_write' : 'secrets.withheld_read',
      reason: `'${candidate}' is ignored by this repository, which is its definition of private. Read it yourself if you need it; the tracked templates are unaffected.`
    }
  }

  // A credential in the text being written matters only by where it is going. The same line
  // is correct in a private file and a disclosure in a tracked one.
  if (secretLine) {
    const target = toolInput.file_path || toolInput.notebook_path || null
    if (!target) {
      return {
        decision: REFUSE,
        key: 'secrets.withheld_write',
        reason: `Line ${secretLine.line} of what is being written looks like a credential (${secretLine.kind}), and there is no file path to check it against.`
      }
    }
    const status = deps.checkIgnore(target)
    if (status === 0) return { decision: ALLOW, reason: null } // going somewhere private already
    if (status !== 0 && status !== 1) {
      return {
        decision: REFUSE,
        key: 'secrets.cannot_check',
        reason: `The repository could not decide whether '${target}' is private, and a credential is being written to it.`
      }
    }
    return {
      decision: REFUSE,
      key: 'secrets.withheld_write',
      reason: `Line ${secretLine.line} carries what looks like a credential (${secretLine.kind}), and '${target}' is published by this repository. Put the value in a file the repository ignores and read it from there.`
    }
  }

  return { decision: ALLOW, reason: null }
}

module.exports = {
  ALLOW,
  REFUSE,
  inspect,
  normalise,
  resolveAgainst,
  candidatePaths,
  looksSecret,
  PRIVATE_BY_DESIGN,
  PUBLIC_BY_DESIGN
}
