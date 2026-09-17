'use strict'

// Path matching for the `paths` a standard includes and excludes. Small on purpose: it covers
// `*` (a run within one segment), `**` (any number of segments, including none), and `?` (one
// character within a segment), which is the whole of what a standard's include and exclude
// lists use. Brace and bracket expansion are deliberately absent until a standard needs them,
// so there is no grammar here that no fixture exercises.
//
// Paths are compared with forward slashes; a caller on Windows normalises before matching.

function globToRegExp (glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more leading segments; a trailing or bare `**` matches the rest,
        // segment boundaries included.
        if (glob[i + 2] === '/') { re += '(?:[^/]+/)*'; i += 2 } else { re += '.*'; i += 1 }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp('^' + re + '$')
}

const cache = new Map()
function compiled (pattern) {
  let re = cache.get(pattern)
  if (!re) { re = globToRegExp(pattern); cache.set(pattern, re) }
  return re
}

function matches (pattern, filePath) {
  return compiled(pattern).test(filePath)
}

function matchesAny (patterns, filePath) {
  return Array.isArray(patterns) && patterns.some((p) => matches(p, filePath))
}

module.exports = { matches, matchesAny, globToRegExp }
