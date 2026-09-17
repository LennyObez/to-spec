# Security policy

## Reporting a vulnerability

Report a suspected vulnerability privately, not as a public issue. Use GitHub's private
vulnerability reporting on this repository (the **Security** tab, **Report a vulnerability**),
which reaches the maintainer directly.

Please include what you were doing, what happened, and the smallest example that reproduces
it. You will get an acknowledgement, and a fix or an explanation once the report has been
looked at.

## Scope

This plugin runs guards inside a coding session. The failures that matter most here are the
ones where a guard reports safety it does not have: a secret written where it would be
published, a destructive command that ran without a copy taken first, a check that passed by
not running. A report that demonstrates any of these is especially valued.

## What the plugin does not promise

It is honest about its own limits, and a limit is not a vulnerability:

- It matches text. A file path reached through a variable, a shell glob, or an encoding is not
  recognised. This raises the cost of an accident; it is not a sandbox.
- The list of destructive commands it copies before is deliberately partial. What it misses
  before the fact is caught at the end of the turn.
- Without Node it does not run at all, and cannot warn you of its own absence.

These are stated in the documentation and in the code, and reporting one as new is welcome but
already known.
