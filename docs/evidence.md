# Evidence register

What proves a runtime contract is a test against the runtime, never a document. Every
behaviour this plugin relies on is recorded here with the probe that established it and the
constraint it places on the implementation.

Four outcomes, and the distinction between the last two is what keeps a report honest.
`pass` and `fail` describe the system under test. `unavailable` means the probe could not
run here, for want of the right platform, of credentials or of a harness, and never means
that no check exists. `bench-error` means the probe itself is at fault: it threw, or the session it built
never reached the thing it was meant to observe. None of the last three is ever reported as
a pass, and any of them makes the run exit non-zero except `unavailable`, which exits
non-zero only when nothing at all could be established.

**Reproduce:** `node bench/probes/run.mjs` for everything, or
`node bench/probes/run.mjs F1a F6` for named probes. Each probe builds its own project, its
own control file and its own session, and removes them afterwards unless `--keep` is given.

## Environment of record

| Field | Value |
|---|---|
| Date | 2026-09-07 |
| Platform | Linux, x64 |
| Node | v24.15.0 |
| git | 2.55.0 |
| Harness | 2.1.261 |

A green run on one platform measures the platform. The matrix in
`.github/workflows/tests.yml` exists so that portability is claimed only where it has been
observed.

## F1a: refusing to stop, and being obeyed

A stop handler emits, on its first pass only, a non-zero exit together with a root-level
blocking decision.

**Observed.** The turn did not end. The model received the reason, acted on it, and produced
the artefact the reason asked for. On the second pass the payload carried the active-stop
flag and the handler stepped aside.

**Constraint.** The blocking form works, and the active-stop flag is what lets a gate tell
its own continuation from a fresh turn. Blocking must be bounded by the gate itself: a
handler that blocks unconditionally measures the runtime's cap instead of the contract.

## F1b: the soft path

The same handler emits context through the structured output field with a zero exit and no
blocking decision.

**Observed.** The turn continued and the injected token came back in the model's reply.

**Constraint.** The soft path both continues the turn and reaches the model, so it is a
usable route once the gate has spent its blocking budget. It is version-dependent by nature
and therefore recorded in `compat.json` as a probed flag rather than assumed.

## F1c: one turn, one prompt identifier

A session whose prompt causes a write, so that several different events fire within a single
turn.

**Observed.** The prompt identifier is absent from the session-start payload, and every
handler invocation belonging to the turn that follows, from the prompt submission to the
stop by way of the two tool events, carries one and the same identifier. The probe compares every
invocation rather than one sample per event name, because a second invocation carrying a
different identifier is precisely the case a per-name sample would never compare, and it
fails outright if no session-start invocation was recorded, so that an absent event is never
read as an observation about that event.

**Constraint.** The turn ledger is keyed on this field. That is what lets the finish gate
know whether the turn it is about to judge actually wrote anything, without reading the
transcript, whose documented lag would otherwise turn a slow write into a silent pass.
Absence at session start is expected rather than a defect: there is no turn yet, and code
that assumed an identifier there would be reading a field that is legitimately empty.

## F3: where a subagent's verdict can be read

**Observed.** The post-tool handler fires on the agent tool, and what its response contains
depends on how the agent was launched: for an asynchronous launch it describes the launch,
giving a status, an identifier and an output file path, and not the work. The subagent-completion
event carries the agent's type, its identifier, its transcript path, the turn identifier and
the last message the agent produced.

**Constraint.** A review verdict is collected from the subagent-completion event. The
post-tool response is not a dependable place to read it, because nothing in a prompt
guarantees a synchronous agent.

## F5: how far a refusal rule holds

Two rounds, identical but for the rule: the same prompt, the same file, prompting switched
off entirely in both. One round has the refusal rule in place before the session starts; the
other does not.

**Observed.** The control round put the protected content in the transcript. The guarded
round did not.

**Why it is built as a pair.** The absence of a string is not evidence of a refusal: a
session that never reached the file looks exactly like a session that was turned away, and a
probe scoring only the guarded round would go green on a session that did nothing. The
control round supplies the missing half, and the probe reports itself a bench error, never a
pass, if the control round fails to leak, because then nothing was demonstrated.

**Constraint.** A refusal rule survives the flag that waives every prompt: that much is
measured, and only for a rule already in place when the session starts. It is the layer that
binds from the next session onward, while the pre-tool handler is the one that runs on every
call of the session in progress. **The two scopes are different, not ordered.** No round here
armed both, so nothing establishes either as the stronger, and neither is sufficient alone.
The distinction matters, because the layer to arm first will be chosen from this page.

## F6: a handler that overruns its deadline

A pre-tool handler declared with a twenty-second timeout, held for twenty-six seconds ahead
of a read.

**Observed.** The runtime reported the handler as cancelled and **the action proceeded**.

**Constraint.** An overrunning pre-tool handler renders no decision and the action goes
through: the failure is open by construction, and no care inside the handler changes it. The
dispatcher therefore needs its own deadline, shorter than the declared one, so that it can
return "I could not check this" as a decision rather than being timed out into silence. The
secret guard, when it is built, will take its fast paths for this reason and not for speed.

## F7a: session context reaches the model

A session-start handler supplies a token through the structured context field, and the
prompt asks for that token back.

**Observed.** The token came back verbatim in the model's reply, so context supplied at
session start reaches the model rather than merely being recorded.

**Constraint.** This is the channel the plugin uses to tell a session what it is working on:
the archetype, the current worksite, what is outstanding, and which skill to invoke next.
Everything on this route is written for the model and stays in English, and it is separate
from the route that reaches the person, which F7b establishes is not the same one. Nothing
that a person must read may be sent this way, and nothing sent this way may be counted as
having been shown to anyone.

## F7b: which channel reaches the person at session start

Both candidate channels emitted at once from a session-start handler, with a non-zero exit.

**Observed.** The display message did **not** surface. Standard error was recorded, and the
session continued normally despite the non-zero exit.

**Constraint.** The channel that carries a warning to the person at session start is
standard error with a non-zero exit, not the display message field, which does surface for a
stop handler (F10) and therefore cannot be assumed to behave the same everywhere. The
canary's warning takes that route. What is observed here is the record in the transcript;
the harness documents this channel as shown to the person and to no one else, and a non-zero
exit at session start does not stop the session, which is what makes a canary safe to arm.

## F8: snapshotting through a temporary git index

**Observed.** Twelve assertions held. Building a tree through a temporary index leaves the
status and the staging area byte-identical; untracked files and unstaged modifications are
captured; ignored paths are excluded; a commit created this way and pointed at by a private
ref survives an aggressive collection; the ref appears in neither the branch list nor the
default log.

**Constraint, measured.** The temporary index must sit at a path already covered by the
project's ignore rules. The probe carries the forbidden fixture that demonstrates why rather
than asserting it: an index written elsewhere appears in the status, and because the index is
written after the working tree is walked, it escapes the first snapshot and is captured by
the second. A single run does not reveal it.

**Constraint, reasoned and not yet measured.** The path should also be absolute, because git
resolves this variable from the working directory of the invocation rather than from the
repository root, so a relative path would follow the caller. The probe does not vary that
parameter, and this paragraph says so rather than borrowing the authority of the one above.

Signing is disabled explicitly rather than left to the ambient configuration. Two routes do
it: the configuration override belongs to `git` itself and is written before the subcommand,
and the plumbing command also takes its own flag for the purpose. Either is fine; what is not
fine is assuming the ambient setting is off. A snapshot is not the person's commit, and an
interactive signature inside a handler is not possible.

## F9: a handler writing project settings

A session-start handler merges a refusal rule into the project's settings, then the session
asks for the protected file. The control case is F5: the identical rule, present before the
session began, which is always honoured.

**Stable across every run.** The handler is told which project it is starting in, and a write
resolved from that payload lands in that project and nowhere else. That much the probe checks
on every run. Whether the merge preserves an unrelated key the project already declared is a
property of the code that writes it, which is phase-1 work: it is not shipped or measured
yet, and will carry its own out-of-runtime test when it is, rather than being claimed here.

**Not stable, and this is the finding.** Whether the rule binds the session that wrote it
**varies between runs**. Across repeated executions the same probe has observed the rule
being ignored by the session that wrote it, and observed it being honoured, with no change
to the code, the payload, the harness version or the machine.

Two explanations have been tested and eliminated. It is not "the rule never binds": it has
bound in several runs. It is not a race between the session's first tool call and the
harness noticing the file: the probe measures a prompt that reaches the protected file
immediately and one that does other work first, and both outcomes have been observed under
each shape. The governing variable is unknown, and no mechanism is asserted here in place of
one.

The probe therefore runs several sessions per shape and reports the proportions; its pass
condition covers only the part that holds every time.

**Constraint, and it does not depend on resolving the variance.** A rule written by a
handler cannot be relied upon to protect the session that wrote it, and cannot be relied
upon to leave it alone either. What protects the session in progress is the pre-tool
handler, which runs on every call. Rules written into project settings are a second layer
whose effect on the current session is undefined and whose effect on later sessions is not.
Any description of them as an immediate protection would describe something that is
sometimes not there, which is worse than a protection that is never there, because it
tests green.

## A property of the channel itself, not of any one event

A handler's standard output is a pipe, and writes to a pipe are asynchronous. A process that
ends the moment it has written loses whatever has not drained.

**Measured, once, on the environment of record.** With a two-hundred-thousand-character
decision and an immediate exit, the receiving side saw a JSON document that stopped
mid-string, well short of the whole. Where exactly it stops depends on the pipe's buffer and
on timing, so the figure is not a constant and is not quoted here as one. What reproduces is
the property, not the cut: `tests/invariants.test.mjs` asserts that the whole decision
arrives, and was confirmed to fail against an immediate exit before being kept.

**Constraint.** No handler ends with an immediate exit after writing. The loss is
intermittent, a decision whole in testing and cut in half under load, which is why the guard
asserts completeness rather than watching for a symptom.

## F10: which channel reaches whom, at a stop

Three distinguishable tokens emitted from one stop handler, one per channel.

**Observed.** Each token arrived on exactly one route, and on no other.

| Channel | Where it surfaces | Audience |
|---|---|---|
| reason in the blocking decision | injected as a user message, prefixed by the harness | the model |
| display message | an informational record at notice level | the person |
| standard error | the error and output fields of the hook response record | diagnostics |

**Constraint.** The harness prefixes the displayed line with the handler's event name, so the
person reads a machine word before our sentence. The prefix is not ours to remove: the
two-line budget is counted after it, and the wording has to read naturally following it. A
message that opens by restating the situation stutters once prefixed.

**Measurement caveat.** The event stream records some events twice, and a blocking stop
appears both as an error and as a success. Scoring counts handler invocations from the
handler's own log, never stream records. A count taken from the stream is a different number
that looks like the right one.

## F2: the dispatcher on a platform with no POSIX shell

The exec form exists so that no shell is ever required. A dispatcher of the shape the plugin
ships is launched by a Windows interpreter with no POSIX shell in the chain, handed a payload
on standard input, and asked to record what it received. The surface measured is the mirror
dispatcher, which records that it parsed its payload and on which platform; the invocation
form it proves -- one command, an argument vector, no shell -- is byte-identical to the real
plugin's, so a mirror that runs is a plugin that would run. Both spellings of the path are
exercised, native separators and the forward slashes the plugin root expands to.

**Observed.** It ran, parsed its payload and exited zero, with no POSIX shell anywhere in
the chain. Reproduced on every run of the probe, on a Windows runner and on a bridged Linux
run alike.

**Constraint, and the limit of the claim, stated plainly.** What is established is that the
invocation form is portable, on that platform, with both path spellings. **How the harness
itself loads and invokes handler definitions there is not measured by anything in this
repository, and neither is the real dispatcher's cross-module loading.** The matrix runs the
probe, not a session of the harness. Closing that gap needs a session of the harness inside the matrix, which
needs credentials the repository does not hold, and it is carried in the roadmap rather than
implied to be covered. Where no bridge exists the probe reports itself unavailable rather
than passing vacuously.

## F4: protections changed under a running session

The settings files of a running session are rewritten from outside it, five seconds in. The
case worth measuring is someone weakening the protections mid-session, which the session
itself would not do.

**Observed.** Two configuration events reached the handler, one per file. Each carries the
working directory, the file path, the event name, the session
identifier, the transcript path, and a source naming which layer changed, `project_settings`
and `local_settings` respectively.

**Constraint.** The source and the file path are exactly what a journal entry needs, so the
event is usable as a record of tampering. It stays a journal and not a gate: it reports what
changed after the fact, and the session that receives it has already been running under the
new configuration.

Thirteen probes. On the environment of record above, every one of them produced an observed
result, with the reservation that two of them depend on the machine: the platform probe
observes only where a bridge to that platform exists, and reports itself unavailable
elsewhere, and the configuration probe reports itself unavailable when a session ends before
the change it was to observe. Elsewhere, the count is whatever that machine's run reports,
which is why the run prints it rather than this page asserting it.

## What this register does not establish

A page of measurements is read as a page of guarantees unless it says otherwise, so it says
otherwise here.

- **One machine.** Every runtime result above comes from a single platform and a single
  build of the harness. The matrix exists to widen that and has not yet run: nothing here is
  evidence about a second operating system, about the declared runtime floor, or about a
  machine with no runtime at all.
- **The harness's own loading of handler definitions is measured nowhere.** The platform
  probe runs the dispatcher directly. That the harness reads a manifest and invokes what it
  declares has only ever been observed on the machine of record.
- **Two behaviours are not stable and are recorded as distributions, not contracts**: whether
  a rule written by a handler binds the session that wrote it, and, in one run out of
  several, whether a change to the settings files is reported at all. Neither may be
  depended upon in either direction.
- **The floors in `compat.json` are reasoned, not measured, except the runtime floor**, which
  the matrix will exercise once it runs. Each entry says which it is.
- **These entries measure the runtime surface, not the plugin's own behaviour.** Each records
  what the harness does -- which channel reaches whom, what a refusal costs, how a snapshot
  behaves -- so that the plugin is built on observed facts rather than documented ones. How the
  plugin behaves inside a live session is measured by its own tests and by the in-situ job, not
  here. The observations pre-date the implementation and are not re-derived from it.
