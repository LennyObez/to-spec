# Behaviour out of the markup

## Why

A page is easier to read, to test and to secure when its behaviour lives in a script rather
than in the markup. Behaviour written into the page, a `<script>` whose body runs from inside
it, an `on*` attribute, a `javascript:` URI, scatters logic through the structure where it
cannot be reused, cannot be tested on its own, and cannot be covered by a content-security
policy that forbids what runs from the page itself. Moving it into a script the page references,
and binding events there, keeps structure and behaviour apart, the same separation the web
platform is built around.

## Rejected alternative

Flagging every `<script>` was considered and dropped. A `<script>` with a `src` runs an
external file, which is exactly where behaviour belongs, and a `<script>` whose `type` is a data
or config type carries data, not behaviour: a block of structured data, an import map, a set of
speculation rules. Reporting those would flag the correct shape and train the reader to ignore
the standard. The allowed types are declared and bounded rather than left to judgement.

## What to do

Move the behaviour into a script the page references. An inline `<script>` becomes an external
file loaded with `src`. An `on*` attribute becomes an event bound in that script. A
`javascript:` URI becomes a real control with a bound handler. Keep only what the allowance
covers: an external script, and a `<script>` carrying data under one of the allowed types.
Component files that legitimately co-locate their behaviour are outside this standard by their
paths, not by an exception in the markup.
