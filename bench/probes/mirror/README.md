# The mirror

A minimal plugin whose only purpose is to be measured through.

The probes in this directory answer questions about the harness: which channel reaches whom,
what a blocking decision does, whether a handler that overruns its deadline is heard. Those
answers must not depend on anything to-spec decides, or the measurement would be of the
plugin's judgement rather than of the surface it stands on.

So the mirror does two things and neither of them is a judgement. It records every payload it
receives, and it emits exactly what a control file tells it to. Behaviour lives in that file
rather than in the handler definitions, which keeps those definitions byte-stable across every
probe. A second harness will require that property, since it grants trust against the hash of
a definition and withdraws it the moment one byte changes.

The real plugin is measured differently: by its own tests, which need no session at all.
