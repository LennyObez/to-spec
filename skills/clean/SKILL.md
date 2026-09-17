---
name: clean
description: The transversal audit and cleanup for a to-spec project. Invoke it after the archetype skill, and whenever the person asks to tidy, finish, or bring a project up to standard. It names the dimensions a state-of-the-art codebase is held to, the questions to ask where nothing points, and the way to work through them without regressing what is already done.
---

# Clean

Bring the project to a state-of-the-art standard, without compromise. Work one dimension at a
time; each change is complete and runnable, carries its own test, and is verified before the next
is started. A dimension is not "better" until the check that covers it passes.

## The dimensions

Each is measurable here, on this machine, unless it says otherwise.

1. **Placement.** Presentation, behaviour, logic and content each live in their own file, out of
   the markup and out of the views. (`placement-css`, `placement-js`, `placement-php`, `placement-content`)
2. **Typed source.** A typed project's source is typed; generated output is not hand-edited. (`typed-source-only`)
3. **No leftovers.** No `TODO`, `FIXME`, `XXX` or unfinished-content marker left in a comment; every delivered file is complete. (`no-placeholder-tokens`)
4. **No silenced checks.** No suppression that switches a static check off in place; a finding is resolved, not hidden. (`no-analyzer-suppression`)
5. **Structure.** A small, finite, legible root; related files grouped into directories, not piled at the top. (`root-finite`)
6. **Signed history.** Commits carry a signature, so who made each change can be verified. (`git-signed-commits`)
7. **No secret published.** No credential written where it would be shared; secrets stay in files the repository ignores. (secret guard)
8. **No false green.** Every check returns pass, fail or unavailable; an unavailable check is never read as a pass, and a tool that exits zero without the report it promised is not a pass.
9. **Tests prove properties.** A convention a test could verify is a test; every test fails without the fix it guards, and a green suite on one machine measures that machine.
10. **OS parity.** What is claimed to work is proven by a matrix across the platforms the project targets, not by one developer's machine.
11. **Accessibility, security, privacy.** Verified where they can be, by serving the project locally and reading the rendered result; declared plainly where they genuinely need a deployed URL, an account or a device.
12. **Honest documentation.** The documentation describes what the code guarantees; nothing is called ready, done, compliant or secure that is not, and no past defect is recorded in a tracked file.

## Look where nothing points

Before writing "fixed", "up to standard" or "no compromise" about any dimension, answer all four.
If one is missing, the sentence is not earned.

> 1. **What are the other entry points into this component?** List them; check each holds the same posture.
> 2. **What aliases of the same object exist?** `..`, symlinks, short names, case, separators, encodings, units, time zones. A guard covering one is walked around by the others.
> 3. **On which platform or configuration has this never run?** Go there.
> 4. **What properties does the code assert that no test proves?** Test them.

An honest answer to "is it up to standard?" is almost always **no** on the first pass. Saying so
early, with what remains listed, beats conceding it to the next question.

## How to work

- **One concern at a time.** Take a single dimension, make the whole of it right, verify it with
  the check that covers it, then move on. A batch of half-changes hides which one broke something.
- **Every file complete.** No leftover marker, no gap "to be done later". If a decision truly
  belongs to the person, raise it as a question rather than leaving something no one will see.
- **The gate is the judge, not a claim.** Run the project's own checks and read their exit codes
  before saying a thing is done; never announce a result without the command that proves it.

## Do not regress

Before acting on any request, check that it does not undo a quality the project has already
reached. Adding a feature is no reason to reintroduce a leftover marker, a silenced check, styling
mixed back into the markup, or an unsigned commit. What was made right stays right.
