'use strict'

// A tidy root: a few files a reader expects and one directory the work lives in, well under the
// limit, so nothing is reported.

const fs = require('fs')
const path = require('path')

module.exports = (dir) => {
  fs.writeFileSync(path.join(dir, 'README.md'), '# project\n')
  fs.writeFileSync(path.join(dir, 'package.json'), '{}\n')
  fs.writeFileSync(path.join(dir, 'LICENSE'), 'Apache-2.0\n')
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), '')
}
