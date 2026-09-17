'use strict'

// Loading an archetype and reading which standards it composes.
//
// An archetype is a directory of data, the same as a standard: it names the standards a project
// of its kind is held to, in order, and nothing about how they run. The gate reads a project's
// archetype and holds the project to those standards alone, so a rule for one kind of project
// never fires on another. A standard exists on its own; an archetype is what puts it to work.
//
// Malformations are reported, not thrown, so one broken archetype names itself rather than
// taking a run down with it, exactly as a broken standard does.

const fs = require('fs')
const path = require('path')

function archetypesRoot (pluginRoot) {
  return path.join(pluginRoot, 'archetypes')
}

function loadDefinition (pluginRoot, id) {
  const file = path.join(archetypesRoot(pluginRoot), id, 'archetype.json')
  let raw = fs.readFileSync(file, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  return JSON.parse(raw)
}

function describeProblems (definition, id) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return ['its archetype.json is not a JSON object']
  }

  const problems = []
  const need = (cond, what) => { if (!cond) problems.push(what) }

  need(definition.schemaVersion === 1, 'schemaVersion must be 1')
  need(definition.id === id, `id is "${definition.id}" but the directory is "${id}"`)
  need(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(definition.id)), 'id must be lowercase with hyphens')

  need(Array.isArray(definition.standards) && definition.standards.length > 0, 'standards must be a non-empty list')
  const seen = new Set()
  for (const entry of definition.standards || []) {
    const ok = entry && typeof entry === 'object' && typeof entry.id === 'string' &&
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.id)
    need(ok, 'each standards entry must be an object with a lowercase-with-hyphens id')
    if (ok) {
      need(!seen.has(entry.id), `standard ${entry.id} is composed twice`)
      seen.add(entry.id)
    }
  }

  const KNOWN = new Set(['schemaVersion', 'id', 'standards', 'stages', 'adapters'])
  for (const key of Object.keys(definition)) {
    need(key.startsWith('$') || KNOWN.has(key), `unknown key "${key}": an archetype.json holds no configuration the runtime does not read`)
  }

  return problems
}

function loadArchetype (pluginRoot, id) {
  const dir = path.join(archetypesRoot(pluginRoot), id)
  let definition
  try {
    definition = loadDefinition(pluginRoot, id)
  } catch (err) {
    return { id, dir, broken: `its definition could not be read: ${err.message}` }
  }
  const problems = describeProblems(definition, id)
  if (problems.length) return { id, dir, definition, broken: problems.join('; ') }
  return { id, dir, definition }
}

function listArchetypeIds (pluginRoot) {
  let entries
  try {
    entries = fs.readdirSync(archetypesRoot(pluginRoot))
  } catch (_) {
    return []
  }
  const ids = []
  for (const entry of entries) {
    try {
      if (fs.statSync(path.join(archetypesRoot(pluginRoot), entry)).isDirectory()) ids.push(entry)
    } catch (_) {
      ids.push(entry)
    }
  }
  return ids.sort()
}

// The composed standard ids, in the order the archetype lists them. Whether each one exists is
// the caller's to check, so this stays a pure read of the data.
function composedStandardIds (archetype) {
  if (archetype.broken || !archetype.definition) return []
  return archetype.definition.standards.map((entry) => entry.id)
}

module.exports = {
  archetypesRoot,
  loadDefinition,
  describeProblems,
  loadArchetype,
  listArchetypeIds,
  composedStandardIds
}
