# Installation

Without Node, nothing here runs. The plugin is a set of Node programs the harness launches at
each lifecycle event; on a machine with no runtime, no program starts, and a program that does
not start cannot warn you it is missing. So the runtime comes first.

## Prerequisites

**Node 20 or newer.** Check with `node -v`. If it is missing or older, install it with one
command:

- Windows: `winget install OpenJS.NodeJS.LTS`
- macOS: `brew install node`
- Debian or Ubuntu: `sudo apt install nodejs`

**Git 2.5 or newer.** Check with `git --version`. It is what lets the plugin take a copy
before a command that cannot be undone.

- Windows: `winget install Git.Git`
- macOS: `brew install git`
- Debian or Ubuntu: `sudo apt install git`

The plugin supports Linux, macOS, and Windows with or without a POSIX shell. It needs no shell
of its own: every program is launched directly, with its arguments passed as a list, so
nothing in a path or a filename is ever interpreted.

## Install

Two commands in Claude Code:

```
/plugin marketplace add LennyObez/to-spec
/plugin install to-spec@to-spec
```

The first adds this repository as a plugin source. The second installs the plugin from it. It
installs once per machine and does nothing in a directory that has not opted in, so it is not
a nuisance in every other project.

## Checking it works

When a session opens, the plugin replays its own guards against two small example projects,
one it should object to and one it should accept. If anything answers wrong, it says so and
steps aside rather than stopping the session. If you ever see a line saying the protections
are not answering, [docs/repair.md](repair.md) explains what it means and what to do.
