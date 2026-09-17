# to-spec

Keeps a coding session on rails so it delivers a complete, clean, evolvable codebase.

to-spec is a plugin for Claude Code. It watches a coding session and does three things, in
order of how often each should happen: it lets ordinary work through at no cost, it steps in
before a small number of irreversible mistakes, and at the end of a turn it says plainly what
is left to do. It never reports that the work is finished, safe, or correct: a guard can
observe that it found nothing, never that there is nothing to find.

The plugin is for the person who describes what they want and lets an agent build it, as much
as for the expert reading every diff. The rails are the same for both.

## Principle

Prevent where you can, repair where you cannot, and never accept a mistake in silence. A
command that would delete work is copied first, behind a private reference, before it runs. A
credential about to be written where it would be published is held back. What a guard could
not stop before the fact is caught at the end of the turn and named. A check that cannot run
says so; it is never counted as a check that passed.

## Install

Two commands in Claude Code:

```
/plugin marketplace add LennyObez/to-spec
/plugin install to-spec@to-spec
```

It needs Node 20 or newer and Git 2.5 or newer. Without Node, no part of it runs, and it
cannot warn you of its own absence. See [docs/installation.md](docs/installation.md) for the
one-command setup of each prerequisite.

## State

This is the foundation milestone. What is built and tested: the runtime that dispatches every
lifecycle event, the finish gate that decides when a turn may end, the guards for secrets and
for irreversible commands, the canary that checks the guards still work on your machine, and
the state file the plugin keeps for you. The archetypes and the `/to-spec:new` and
`/to-spec:onboard` commands are on the [roadmap](docs/roadmap.md); nothing here claims a
feature it does not carry.

Every runtime contract the plugin relies on was established by measurement, not by
documentation. Those measurements are recorded in [docs/evidence.md](docs/evidence.md).

## Repository

- [docs/installation.md](docs/installation.md): prerequisites and the two-command install
- [docs/roadmap.md](docs/roadmap.md): the phases, and what each one must demonstrate to be done
- [docs/evidence.md](docs/evidence.md): the runtime facts, each with the probe that established it
- [docs/repair.md](docs/repair.md): what to do if the guards stop answering
- [CONTRIBUTING.md](CONTRIBUTING.md): how the code is built, tested, and extended

## Licence

Apache-2.0. See [LICENSE](LICENSE).
