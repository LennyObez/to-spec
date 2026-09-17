'use strict'

// A repository with one unsigned commit: git reports %G? as N, which the standard reports.

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

module.exports = (dir) => {
  const git = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git(['init', '-q'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'test'])
  git(['config', 'commit.gpgsign', 'false'])
  fs.writeFileSync(path.join(dir, 'README.md'), '# project\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'first'])
}
