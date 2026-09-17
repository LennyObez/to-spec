'use strict'

// A root grown past the limit: thirty-one loose files at the top, more than the configured
// thirty, so the standard reports it. Generated rather than committed, so the fixture stays a
// setup and not a wall of empty files.

const fs = require('fs')
const path = require('path')

module.exports = (dir) => {
  for (let i = 0; i < 31; i++) {
    fs.writeFileSync(path.join(dir, `loose-${i}.txt`), '')
  }
}
