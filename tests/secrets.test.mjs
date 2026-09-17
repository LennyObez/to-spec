// The secret guard, assertion by assertion.
//
// Every case here is one this guard's shell predecessor was written against, plus the ones
// added when the design was reviewed. They are kept as a list rather than folded together
// because each one is a way a credential has actually escaped, and a merged test tells you
// something broke without telling you which door was left open.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const secrets = require(join(ROOT, 'core/secrets.js'))

// A stand-in for the repository. `ignored` is the set it treats as private; `undecidable`
// makes it answer that it does not know, which must lean to refusal.
const repo = ({ ignored = [], present = [], undecidable = [] } = {}) => ({
  projectDir: '/project',
  checkIgnore (p) {
    if (undecidable.includes(p)) return 128
    return ignored.includes(p) ? 0 : 1
  },
  exists: (p) => present.includes(p)
})

const call = (payload, deps = repo()) => secrets.inspect(payload, deps)

test('a call that mentions nothing private is not slowed down', () => {
  const out = call({ tool_name: 'Read', tool_input: { file_path: 'src/index.js' } })
  assert.equal(out.decision, secrets.ALLOW)
})

test('reading a private environment file is refused', () => {
  const out = call({ tool_name: 'Read', tool_input: { file_path: '.env' } }, repo({ ignored: ['.env'] }))
  assert.equal(out.decision, secrets.REFUSE)
  assert.equal(out.key, 'secrets.withheld_read')
})

test('a tracked template is left alone', () => {
  const out = call({ tool_name: 'Read', tool_input: { file_path: '.env.example' } }, repo({ ignored: ['.env'] }))
  assert.equal(out.decision, secrets.ALLOW)
})

test('a second tracked template is left alone', () => {
  const out = call({ tool_name: 'Edit', tool_input: { file_path: '.env.production.example' } },
    repo({ ignored: ['.env', '.env.local'] }))
  assert.equal(out.decision, secrets.ALLOW)
})

test('a variant nobody listed is still refused, because the repository knows it', () => {
  // The whole reason this is a handler: a hand-written list would never have heard of this
  // name, and the ignore file already covers it by wildcard.
  const out = call({ tool_name: 'Read', tool_input: { file_path: '.env.dev' } }, repo({ ignored: ['.env.dev'] }))
  assert.equal(out.decision, secrets.REFUSE)
})

test('a path written with the other platform\'s separators is recognised', () => {
  const out = call({ tool_name: 'Read', tool_input: { file_path: 'config\\.env' } },
    repo({ ignored: ['config/.env'] }))
  assert.equal(out.decision, secrets.REFUSE)
})

test('a path whose separators arrived doubled is recognised, drive letter and all', () => {
  const out = call({ tool_name: 'Read', tool_input: { file_path: 'C:\\\\app\\\\.env' } },
    repo({ ignored: ['C:/app/.env'] }))
  assert.equal(out.decision, secrets.REFUSE)
})

test('the path asked about is the whole path, not the part after the drive letter', () => {
  const asked = []
  call({ tool_name: 'Read', tool_input: { file_path: 'C:\\\\app\\\\.env' } }, {
    projectDir: '/project',
    checkIgnore (p) { asked.push(p); return 1 },
    exists: () => false
  })
  assert.ok(asked.includes('C:/app/.env'),
    `a beheaded path is a different path, and the answer about it means nothing: asked ${JSON.stringify(asked)}`)
})

test('a private file reached through a shell command is refused', () => {
  const out = call({ tool_name: 'Bash', tool_input: { command: 'cat .env | head -5' } },
    repo({ ignored: ['.env'] }))
  assert.equal(out.decision, secrets.REFUSE)
})

test('a private file reached through an interpreter is refused', () => {
  // The case a permission rule cannot see: the rule recognises file commands, not a
  // subprocess that opens the file itself.
  const out = call({ tool_name: 'Bash', tool_input: { command: "node -e \"console.log(require('fs').readFileSync('.env','utf8'))\"" } },
    repo({ ignored: ['.env'] }))
  assert.equal(out.decision, secrets.REFUSE)
})

test('a mention in prose is refused too, and that is deliberate', () => {
  // Over-approximation in the direction of refusal. The message names the token so the
  // wording can be adjusted rather than the guard switched off.
  const out = call({ tool_name: 'Bash', tool_input: { command: 'git commit -m "document .env handling"' } },
    repo({ ignored: ['.env'] }))
  assert.equal(out.decision, secrets.REFUSE)
  assert.match(out.reason, /\.env/)
})

test('an unknown project directory refuses rather than guesses', () => {
  const out = call({ tool_name: 'Read', tool_input: { file_path: '.env' } },
    { projectDir: null, checkIgnore: () => 0, exists: () => true })
  assert.equal(out.decision, secrets.REFUSE)
  assert.match(out.reason, /Refusing rather than guessing/)
})

test('a repository that cannot decide refuses', () => {
  const out = call({ tool_name: 'Read', tool_input: { file_path: '.env' } },
    repo({ undecidable: ['.env'] }))
  assert.equal(out.decision, secrets.REFUSE)
  assert.match(out.reason, /could not decide/)
})

test('one private path among several is enough to refuse', () => {
  const out = call({ tool_name: 'Bash', tool_input: { command: 'cp .env.example .env' } },
    repo({ ignored: ['.env'], present: ['.env'] }))
  assert.equal(out.decision, secrets.REFUSE)
})

test('each path is asked about on its own', () => {
  // Asking about a list answers "is any of these private", and one private file would then
  // condemn every other path in the same call.
  const asked = []
  const out = call({ tool_name: 'Bash', tool_input: { command: 'diff .env.example .env.other' } }, {
    projectDir: '/project',
    checkIgnore (p) { asked.push(p); return 1 },
    exists: () => false
  })
  assert.equal(out.decision, secrets.ALLOW)
  assert.deepEqual(asked.sort(), ['.env.example', '.env.other'])
})

test('creating a private file for the first time is allowed', () => {
  // That is where a credential is supposed to go. Refusing here would push it somewhere worse.
  const out = call({ tool_name: 'Write', tool_input: { file_path: '.env', content: 'API_KEY=x' } },
    repo({ ignored: ['.env'], present: [] }))
  assert.equal(out.decision, secrets.ALLOW)
})

test('overwriting an existing private file is refused', () => {
  const out = call({ tool_name: 'Write', tool_input: { file_path: '.env', content: 'API_KEY=x' } },
    repo({ ignored: ['.env'], present: ['.env'] }))
  assert.equal(out.decision, secrets.REFUSE)
})

test('a candidate is resolved against the project only when it is relative', () => {
  // Joining an absolute path onto the project directory yields a path that exists nowhere,
  // and "exists nowhere" is the answer that lets an overwrite through.
  assert.equal(secrets.resolveAgainst('/project', '.env'), '/project/.env')
  assert.equal(secrets.resolveAgainst('/project', 'config/.env.local'), '/project/config/.env.local')
  assert.equal(secrets.resolveAgainst('/project', '/project/.env'), '/project/.env')
  assert.equal(secrets.resolveAgainst('/project', '/elsewhere/.env'), '/elsewhere/.env')
  assert.equal(secrets.resolveAgainst('/project', 'C:/app/.env'), 'C:/app/.env')
  assert.equal(secrets.resolveAgainst('C:\\proj', '.env'), 'C:/proj/.env')
})

test('the refusal never repeats the credential it just stopped', () => {
  // A reason is read by the model and written to the transcript. A guard that quotes what it
  // withheld has moved the value into a place that is kept, searched and often shared,
  // rather than kept it out of one file.
  const value = 'sk_live_51H8Qx7RtYuIoP0aZ'
  const out = call({
    tool_name: 'Write',
    tool_input: { file_path: 'src/config.js', content: `const key = '${value}'` }
  }, repo())
  assert.equal(out.decision, secrets.REFUSE)
  assert.ok(!out.reason.includes(value), `the reason repeats the value: ${out.reason}`)
  assert.match(out.reason, /Line 1/, 'it still has to say where to look')
})

test('a private file written in another case is still recognised', () => {
  // Two of the three platforms this runs on treat these as the same file. A case-sensitive
  // guard would be absent exactly where the filesystem is most forgiving.
  const out = call({ tool_name: 'Read', tool_input: { file_path: '.ENV' } },
    repo({ ignored: ['.ENV'] }))
  assert.equal(out.decision, secrets.REFUSE)
})

test('a credential written into a published file is refused', () => {
  const out = call({
    tool_name: 'Write',
    tool_input: { file_path: 'src/config.js', content: "const key = 'sk_live_51H8Qx7RtYuIoP0aZ'" }
  }, repo({ ignored: ['.env'] }))
  assert.equal(out.decision, secrets.REFUSE)
  assert.equal(out.key, 'secrets.withheld_write')
})

test('the same credential written to a destination the repository keeps private is allowed', () => {
  // Deliberately not an environment file, so that this isolates the rule about where a
  // credential is going from the separate rule about which files may be opened at all.
  const out = call({
    tool_name: 'Write',
    tool_input: { file_path: 'secrets/local.json', content: '{ "stripe": "sk_live_51H8Qx7RtYuIoP0aZ" }' }
  }, repo({ ignored: ['secrets/local.json'] }))
  assert.equal(out.decision, secrets.ALLOW)
})

test('a real credential is not excused by the word example sitting next to it', () => {
  // The precedence that matters: a prefix that is private by construction is a fact, and
  // "this line says example" is a guess about intent.
  const out = call({
    tool_name: 'Write',
    tool_input: { file_path: 'docs/example.md', content: "For example: sk_live_51H8Qx7RtYuIoP0aZ" }
  }, repo())
  assert.equal(out.decision, secrets.REFUSE)
})

test('a key that is public by construction is left alone', () => {
  const out = call({
    tool_name: 'Write',
    tool_input: { file_path: 'src/config.js', content: "const key = 'pk_live_51H8sample0000000000'" }
  }, repo())
  assert.equal(out.decision, secrets.ALLOW)
})

test('a line that is visibly an illustration is left alone', () => {
  const out = call({
    tool_name: 'Write',
    tool_input: { file_path: 'README.md', content: "API_KEY=your_key_here\nSTRIPE=sk_live_example" }
  }, repo())
  assert.equal(out.decision, secrets.ALLOW)
})

test('a private key block is recognised wherever it is going', () => {
  const out = call({
    tool_name: 'Write',
    tool_input: { file_path: 'deploy/key.txt', content: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n' }
  }, repo())
  assert.equal(out.decision, secrets.REFUSE)
})

test('a password assigned in source is recognised', () => {
  const out = call({
    tool_name: 'Write',
    tool_input: { file_path: 'src/db.js', content: 'const password = "hunter2hunter2"' }
  }, repo())
  assert.equal(out.decision, secrets.REFUSE)
})

test('identifiers that merely look random are left alone', () => {
  // Entropy scoring is not used, precisely so that this passes: a guard that fires on hashes
  // and asset names is switched off by the person it was protecting.
  const out = call({
    tool_name: 'Write',
    tool_input: { file_path: 'src/build.js', content: "const hash = 'a3f8b2c9d4e7f1a6b8c3d9e2f4a7b1c6'" }
  }, repo())
  assert.equal(out.decision, secrets.ALLOW)
})

test('a private file that is not an environment file is recognised by name', () => {
  // The guard once submitted only .env to the repository, so any other private file -- a
  // private key, a credential file -- was read freely. It now asks about a set of secret-
  // bearing names, and an ignored one is withheld.
  for (const name of ['id_rsa', 'deploy.pem', '.npmrc', 'credentials.json', 'secrets.yml', 'server.key']) {
    const out = call({ tool_name: 'Read', tool_input: { file_path: name } }, repo({ ignored: [name] }))
    assert.equal(out.decision, secrets.REFUSE, `${name} was read freely`)
  }
})

test('a secret-bearing name that the repository tracks is left alone', () => {
  // The ignore rules decide, not a hand-kept list: a committed template of a secret-bearing
  // name is not private, and must not be withheld.
  const out = call({ tool_name: 'Read', tool_input: { file_path: 'id_rsa.pub.example' } },
    repo({ ignored: [] }))
  assert.equal(out.decision, secrets.ALLOW)
})

test('an ignored build directory is not mistaken for a secret', () => {
  // The reason the guard asks about names rather than every path: submitting every ignored
  // path would withhold dist, build and vendor, which carry no secret at all.
  const out = call({ tool_name: 'Read', tool_input: { file_path: 'dist/app.bundle.js' } },
    repo({ ignored: ['dist/app.bundle.js'] }))
  assert.equal(out.decision, secrets.ALLOW)
})

test('the reason names a fixed kind, never the token it matched', () => {
  // A label sliced from the matched text is, for several issuers, the credential in full.
  const out = call({
    tool_name: 'Write',
    tool_input: { file_path: 'src/config.js', content: 'const t = "ghp_ABCDEFGHIJKLMNOPQRST0123"' }
  }, repo())
  assert.equal(out.decision, secrets.REFUSE)
  assert.ok(!out.reason.includes('ghp_ABCDEFGHIJKLMNOPQRST0123'), `reason repeats the token: ${out.reason}`)
  assert.match(out.reason, /personal access token/)
})

test('a credential in a nested edit field is still caught', () => {
  // The scan reads every string a tool would write, at any depth, not three fields by name.
  const out = call({
    tool_name: 'MultiEdit',
    tool_input: { file_path: 'src/config.js', edits: [{ old_string: 'x', new_string: 'sk_live_51H8Qx7RtYuIoP0aZ' }] }
  }, repo())
  assert.equal(out.decision, secrets.REFUSE)
})

test('a private file named with a trailing dot is recognised, as Windows resolves it', () => {
  // ".env." opens the file ".env" on Windows. The guard asks the repository about both the
  // literal spelling and the folded alias, and refuses if either is ignored.
  const asked = []
  const out = call({ tool_name: 'Read', tool_input: { file_path: 'config/.env.' } }, {
    projectDir: '/project',
    checkIgnore (p) { asked.push(p); return p === 'config/.env' ? 0 : 1 },
    exists: () => false
  })
  assert.equal(out.decision, secrets.REFUSE, `the Windows alias was not asked about: ${JSON.stringify(asked)}`)
  assert.ok(asked.includes('config/.env'), `the folded name must be asked about: ${JSON.stringify(asked)}`)
})

test('every issuer prefix and public counterpart carries a covering sample', () => {
  // No prefix may be added, altered or removed without a case here. Each private prefix must
  // trip the guard on a representative token; each public one must leave it silent.
  const privateSamples = {
    'sk_live_': 'sk_live_51H8Qx7RtYuIoP0aZ',
    'sk_test_': 'sk_test_51H8Qx7RtYuIoP0aZ',
    'rk_live_': 'rk_live_51H8Qx7RtYuIoP0aZ',
    'sk-ant-': 'sk-ant-api03-AbCdEfGhIjKl',
    'AKIA': 'AKIAIOSFODNN7EXAMPLE1',
    'ghp_': 'ghp_ABCDEFGHIJKLMNOPQRST0123',
    'github_pat_': 'github_pat_ABCDEFGHIJ_klmnopqrstuvwx',
    'glpat-': 'glpat-ABCDEFGHIJKLMNOPQRST',
    'xox': 'xoxb-123456789012-ABCDEFabcdef',
    'PRIVATE KEY': '-----BEGIN OPENSSH PRIVATE KEY-----'
  }
  // One sample proves each private entry fires; the count ties the table to the array so a new
  // entry with no sample fails here rather than shipping untested.
  assert.equal(Object.keys(privateSamples).length, secrets.PRIVATE_BY_DESIGN.length,
    'a private issuer prefix was added or removed without a covering sample')
  for (const [name, sample] of Object.entries(privateSamples)) {
    const out = call({ tool_name: 'Write', tool_input: { file_path: 'src/x.js', content: `k = "${sample}"` } }, repo())
    assert.equal(out.decision, secrets.REFUSE, `${name} was not recognised in ${sample}`)
  }

  const publicSamples = {
    'pk_live_': 'pk_live_51H8Qx7RtYuIoP0aZ',
    'pk_test_': 'pk_test_51H8Qx7RtYuIoP0aZ',
    'AIza': 'AIzaSyD-EXAMPLE-key-1234567890',
    'NEXT_PUBLIC_': 'NEXT_PUBLIC_TOKEN=abc12345',
    'VITE_': 'VITE_TOKEN=abc12345',
    'PUBLIC_': 'PUBLIC_TOKEN=abc12345'
  }
  assert.equal(Object.keys(publicSamples).length, secrets.PUBLIC_BY_DESIGN.length,
    'a public counterpart was added or removed without a covering sample')
  for (const [name, sample] of Object.entries(publicSamples)) {
    const out = call({ tool_name: 'Write', tool_input: { file_path: 'src/page.js', content: `k = "${sample}"` } }, repo())
    assert.equal(out.decision, secrets.ALLOW, `${name} should be public and left alone: ${sample}`)
  }
})
