# No static check switched off in place

## Why

A static check exists to be answered, not silenced. A directive that switches one off for a line
or a file, an `eslint-disable`, a `@ts-ignore`, a `noqa`, a Rust allow attribute, does not make
the finding untrue; it hides it, and the next reader trusts a green that no longer means
anything. For someone who cannot read the code, that hidden finding is a fault waiting to
surface. Removing the directive and resolving what the check flagged is what keeps the green
honest.

## Rejected alternative

Allowing a suppression with a written justification was considered and dropped. A justification
turns a hard rule into a judgement call made under the pressure to move on, which is exactly when
a real finding gets waved through. The one place an exception belongs is the analyser's own
configuration, where it is declared once, in the open, and reviewed as configuration; those files
are outside this standard by their paths. Everywhere else, the finding is resolved rather than
silenced.

## What to do

Remove the directive and fix what the check flagged. If a type is wrong, correct the type rather
than ignoring the error; if a rule is genuinely inappropriate for the whole project, turn it off
in the analyser's configuration, in the open, not line by line in the code. A suppression left in
the source is a finding no one will see again.
