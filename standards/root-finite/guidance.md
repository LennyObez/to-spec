# A small, finite root

## Why

The root of a project is the map a reader opens first. A state-of-the-art root holds a handful
of entries: the files a reader expects at the top, a licence, a readme, the manifest, and the
directories the work lives in. A root that fills with loose files, dozens of scripts, assets and
one-off documents piled at the top, buries that map, and the reader cannot tell the shape of the
project from its clutter. This is often the first thing wrong with an improperly built codebase:
everything at the root because nothing was ever sorted. Keeping the root small keeps the project
legible.

## Rejected alternative

A fixed limit for every project was considered and dropped. A small library and a large
application do not expect the same number of top-level entries, and a hard number would flag a
project that is simply large or scold one that is genuinely tidy. So the limit is a parameter the
archetype sets for the kind of project it is, and the standard reports rather than blocks: passing
the limit is a signal to look, not a fault to stop over. The count is of distinct top-level
entries, directories included once, so a deep directory does not inflate it.

## What to do

Group related files into directories: scripts under a scripts directory, assets under an assets
one, documents under docs. Keep at the root only what a reader expects to find there. If the
project is genuinely large enough to need more top-level entries, raise the limit in the
archetype deliberately, rather than letting the root grow by accident.
