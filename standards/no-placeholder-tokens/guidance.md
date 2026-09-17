# No leftover markers in the code

## Why

A delivered file is complete and runnable, not a note about what is still to do. A `TODO`, a
`FIXME`, an `XXX`, a block of lorem ipsum, a `changeme` left in a comment all say the same
thing: this was handed over unfinished. For someone who cannot read the code, that unfinished
part is invisible until it fails. Resolving what the marker stands for, and removing the marker,
is what makes the file mean what it appears to mean.

## Rejected alternative

Matching the markers anywhere in the file was considered and dropped. The words appear
legitimately in strings and in ordinary code: a variable holding sample text, a message that
mentions a to-do list, a function that generates placeholder graphics. Only a marker that
belongs to a comment is the leftover this standard is about, so the file's comments are read
apart from its strings and its code, and a marker written outside a comment is left alone.
Documentation, where a to-do list is content rather than a leftover, is outside the standard by
its paths.

## What to do

Resolve what the marker stands for and delete it. A `TODO` becomes the thing done, or an item
in the project's own tracker, not a note buried in a comment. Sample text becomes the real text.
A `changeme` becomes the value it stood in for. If a decision genuinely belongs to the person,
raise it as a question rather than leaving a marker no one will see.
