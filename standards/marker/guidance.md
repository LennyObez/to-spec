# The marker standard

## Why

Every mechanism in this plugin that decides something, the finish gate, the canary and the
bench, needs one thing whose answer is already known, or there is no way to tell a working
decision from a broken one. That is what this standard is. It checks something trivial on
purpose: a project either carries `MARKER.md` with the word `MARKER` on a line of its own, or
it does not.

The value is in what it does *not* depend on. No tool, no version, no network, no platform.
A fixture that can report itself unavailable is useless for distinguishing a gate that works
from a gate that never ran, and that distinction is the entire point.

## Rejected alternative

Testing the gate against a real standard was considered and dropped. A real standard depends
on a tool, and a tool can be absent, out of range, or newly changed. When such a test fails,
two explanations fit, the gate broke or the tool did, and the one that gets investigated is
whichever is cheaper to blame. A fixture with no dependencies leaves one explanation.

## What to do

Create `MARKER.md` at the project root with `MARKER` on a line of its own. Nothing else is
required, and nothing else is inspected.

If the file exists but cannot be read, the standard reports that it could not check rather
than reporting the file as missing. The two are different, and sending someone to create a
file that already exists wastes the one interruption a person will tolerate.
