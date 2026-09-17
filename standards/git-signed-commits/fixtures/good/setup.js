'use strict'

// A repository whose commit is SSH-signed with an ephemeral key, and whose allowed-signers file
// lets git verify it: %G? reads G, so nothing is reported.

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

module.exports = (dir) => {
  const git = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git(['init', '-q'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'test'])

  const key = path.join(dir, 'sign_key')
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'test@example.com', '-f', key], { stdio: 'ignore' })
  const signers = path.join(dir, 'allowed_signers')
  fs.writeFileSync(signers, `test@example.com ${fs.readFileSync(`${key}.pub`, 'utf8')}`)

  git(['config', 'gpg.format', 'ssh'])
  git(['config', 'user.signingkey', `${key}.pub`])
  git(['config', 'commit.gpgsign', 'true'])
  git(['config', 'gpg.ssh.allowedSignersFile', signers])

  fs.writeFileSync(path.join(dir, 'README.md'), '# project\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'first'])
}
