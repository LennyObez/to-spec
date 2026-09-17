# Contributing

## Building and testing

There is no build step. The plugin ships as a directory and the runtime loads it from there.

```
node --test            # the whole out-of-runtime suite
node bench/probes/run.mjs F8   # the one probe that needs only version control
```

The suite needs no dependencies and no network. It runs on Node 20 and newer, on Linux,
macOS, and Windows. A change is not finished until it is green on the platforms it touches;
the continuous-integration matrix is what proves portability, never one machine.

## How the plugin is shaped

A standard is a directory, never a branch in the code that runs. Adding one is a folder under
`standards/` with its rule, its check, its guidance, and a pair of fixtures (one the check
must reject and one it must accept) plus their declared expectations. Nothing in the runtime
learns its name. An out-of-runtime test asserts exactly that: adding a standard changes no
handler code.

Every guard carries fixtures, and the canary replays them at the start of each session, so a
guard that quietly stops catching anything turns the canary red rather than passing unnoticed.

## What the code must hold to

- **A convention a test can verify is a test.** A rule that lives only in a comment is a rule
  that stops being true without anyone noticing.
- **No lazy suppression.** A finding is fixed at its cause, never silenced by an ignore
  comment, a file exclusion, or a baseline entry.
- **A check returns one of three answers: pass, fail, or unavailable.** A tool that is absent,
  a version out of range, an output that will not parse: these are unavailable, and an
  unavailable check is never folded into a pass.
- **A comment documents what the code guarantees**, in general terms, never what once went
  wrong. The reasoning belongs in the repository; the incident does not.

## Commits

Commits are signed. Messages follow Conventional Commits and are concise. The changelog keeps
an `Unreleased` section; a change that a user would notice adds a line to it.

## Reporting a problem

A security issue goes through the process in [SECURITY.md](SECURITY.md), privately. Anything
else is welcome as an issue.
