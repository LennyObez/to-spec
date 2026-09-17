'use strict'

// A signed commit lets anyone verify who made a change. This reads the signature status of the
// recent commits through git: %G? is N when a commit carries no signature, and anything else
// when it carries one, even if it cannot be verified on this machine, which is not the same as
// absent. A project not yet under version control, or with no commits, has nothing to check.

module.exports = function check (input, ctx) {
  const std = input.standard || {}
  const recent = (std.params && Number(std.params.recent)) || 20

  const head = ctx.git.run(['rev-parse', '--verify', 'HEAD'])
  if (head.status !== 0) return { findings: [], facts: { repository: false } }

  const log = ctx.git.run(['log', `--max-count=${recent}`, '--format=%H %G?'])
  if (log.status !== 0) return { status: 'unavailable', why: 'the commit history could not be read' }

  const findings = []
  const lines = log.stdout.split('\n').filter(Boolean)
  for (const line of lines) {
    const [hash, signature] = line.trim().split(/\s+/)
    if (signature === 'N') {
      findings.push({ path: String(hash || '').slice(0, 12), message: 'a commit in the recent history is not signed' })
    }
  }
  return { findings, facts: { commitsChecked: lines.length } }
}
