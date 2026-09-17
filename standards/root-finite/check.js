'use strict'

// A project's root is the first thing a reader sees, and a state-of-the-art one holds a few
// entries: the files a reader expects and the directories the work lives in. A root that fills
// with loose files buries the structure. This counts the distinct top-level entries and reports
// a root that has grown past the configured limit. It reports rather than blocks: the right
// number depends on the kind of project, so the archetype sets the limit and the person decides.

module.exports = function check (input, ctx) {
  const std = input.standard || {}
  const limit = (std.params && Number(std.params.max_root_entries)) || 0

  const topLevel = new Set(ctx.list().map((file) => file.split('/')[0]))
  if (limit > 0 && topLevel.size > limit) {
    return {
      findings: [{ path: '.', message: 'the project root holds too many entries; group loose files into directories' }],
      facts: { rootEntries: topLevel.size, limit }
    }
  }
  return { findings: [], facts: { rootEntries: topLevel.size, limit } }
}
