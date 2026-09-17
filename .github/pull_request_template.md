## What changed

<!-- One or two sentences. What a reader needs before looking at the diff. -->

## What proves it

<!-- The test that fails without this change, and the command that runs it. A result without the command that
     produced it is not a result. -->

## Checklist

- [ ] A test fails without this change, and I ran it in the failing state first
- [ ] The test asserts observable behaviour, not the steps taken
- [ ] The whole out-of-runtime suite passed locally, not a scoped run
- [ ] No finding was silenced with an ignore comment, a file exclusion or a baseline entry
- [ ] A check that cannot run reports itself unavailable; nothing absent is read as a pass
- [ ] Every user-facing string goes through the message catalogue, in English and French
- [ ] A standard added is a directory, and the handler definitions are byte-identical
- [ ] Any probe this change relies on has a verdict in `docs/evidence.md`
- [ ] No tracked file names a competing product where a generic description would do
- [ ] No tracked file carries a path, a host or a tool from a development environment
- [ ] No tracked file names a past defect, counts what was broken, or reads as denigrating the product
- [ ] No em dash and no carriage return in any tracked file
- [ ] The commit is signed and carries no attribution beyond its author
