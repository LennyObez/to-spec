# A typed project's source stays typed

## Why

The value of a typed project is that the compiler checks the source before it runs. A
hand-written JavaScript file in that source is invisible to that check: a wrong type, a missing
field, a call that cannot succeed, none of them are caught, and the mistake surfaces only when
the code runs, often in front of a person who cannot read it. Writing the source as a typed file
keeps every part of the project under the one guarantee the project was set up to give.

## Rejected alternative

Flagging every JavaScript file was considered and dropped. Compiled output is JavaScript by
definition, and it belongs where the compiler writes it; a configuration file is often
JavaScript and is meant to be. So the standard reads the project's own tsconfig: it holds a
project only when it is a TypeScript project, it leaves a project that turns on `allowJs` alone,
because that project has chosen to accept JavaScript, and it excludes the compiler's output
directory and the configuration files. Where the tsconfig cannot be read, it says it could not
decide rather than guessing.

## What to do

Write the file as a typed file so the compiler checks it. If it is genuinely generated, keep it
under the output directory the tsconfig names, not beside the source. If the project truly means
to accept JavaScript, that is a decision made once in the tsconfig with `allowJs`, in the open,
not file by file in the source.
