// Which environment variable the harness reads a given credential from.
//
// A subscription OAuth token and a console API key share the `sk-ant-` prefix; `oat` and `api`
// tell them apart. Routing the whole prefix to the API-key variable sends a subscription token
// where it is invalid and the session hangs on a login -- a silent, expensive failure, so this
// is a tested pure function, not shell whose arms an edit can reorder.
export function authVarFor (credential) {
  if (!credential) return null
  if (/^sk-ant-oat/.test(credential)) return 'CLAUDE_CODE_OAUTH_TOKEN'
  if (/^sk-ant-/.test(credential)) return 'ANTHROPIC_API_KEY'
  return 'CLAUDE_CODE_OAUTH_TOKEN'
}

// Run by the workflow: the credential arrives in the environment, never argv where a process
// listing would show it; only the variable name is printed back.
import { pathToFileURL } from 'node:url'
if (import.meta.url === pathToFileURL(process.argv[1] || '/').href) {
  const name = authVarFor(process.env.CREDENTIAL)
  if (!name) {
    process.stderr.write('no credential in the environment to route\n')
    process.exit(1)
  }
  process.stdout.write(name)
}
