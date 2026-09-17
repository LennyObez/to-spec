# The second marker standard

## Why

This standard checks nothing anyone needs. It exists to demonstrate a property of the design,
and the property is the load-bearing one: **a standard is a directory**.

Everything this plugin will eventually do, every placement rule, every archetype, every
family of checks, is meant to arrive as data rather than as code. If adding one required
editing the handler definitions, or the entry point, or the code that runs checks, then the
catalogue would grow only as fast as someone could safely edit a dispatcher, and each addition
would carry a chance of breaking every existing guard.

So the test that matters is not what this standard checks. It is that its arrival left the
handler definitions byte-identical.

## Rejected alternative

Asserting the property in prose, "adding a standard requires no code change", was the
obvious cheaper option. It is also the exact shape of claim that stops being true without
anyone noticing, because nothing goes red when it does. A second standard that exists, runs,
and is replayed by the canary costs one directory and cannot quietly become false.

## What to do

Nothing. If this standard fails in a real project, the project is a fixture and something has
gone wrong upstream. If it disappears, the guarantee it demonstrates goes with it.
