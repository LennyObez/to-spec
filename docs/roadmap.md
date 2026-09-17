# Roadmap

Ten phases. A phase sequences work; it never reduces scope. Each one ends on a measurable
criterion, not on a judgement call. A phase whose exit criterion cannot be demonstrated is
not finished.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done and demonstrated.

## Phase 0a: probes

Nothing is built until the runtime has answered. A probe that has not run is not evidence.

- [x] F8: snapshot through a temporary git index: status untouched, untracked captured,
      ignored excluded, survives garbage collection, invisible in `branch` and `log`, with
      the forbidden fixture proving the ignored-path constraint
- [x] F1c: `prompt_id` identical across every event of one turn, absent at session start
- [x] F7a: `SessionStart` `additionalContext` reaches the model
- [x] F1a: `Stop` exit 2 with a root-level blocking decision is accepted and the turn continues
- [x] F1b: whether the soft path through `hookSpecificOutput` is honoured on this version
- [x] F2: the dispatcher on a platform with no POSIX shell
- [x] F3: subagent identity, and where a subagent's verdict can actually be read
- [x] F4: what the harness reports when protections change under a running session
- [x] F5: deny honoured in non-interactive modes, including with prompting switched off
- [x] F6: timeouts, including whether a timed-out `PreToolUse` lets the action through
- [x] F7b: which channel reaches the person at session start
- [x] F9: a hook writing project settings, and what that does to the running session
- [x] F10: which output channel reaches the user and which reaches the model, per event
- [x] The continuous-integration matrix exists: four platforms, the declared runtime floor,
      and a runner with no runtime at all
- [x] The matrix has run and is green on all five platforms: Linux on the current runtime and
      on the declared floor, macOS, Windows with and without a POSIX shell, and a machine with
      no runtime at all. Every claim about those platforms is now an observation, not a file
- [x] The harness's own loading is observed. A scheduled and on-demand job installs the plugin
      into a real session and reads what happened to the project afterwards: the installed
      plugin is found and honoured, a turn that changed nothing is left alone, and a secret in a
      private file is not read out into the session. With no credential the job is skipped rather
      than passing over nothing, and a session that cannot authenticate reads as could-not-run
      rather than as a pass
- [x] `compat.json` filled, each floor citing the feature that imposes it
- [x] `docs/evidence.md` carries an observed result for every probe
- [x] The probes are a bench that re-runs on demand, not a sequence of commands
- [x] Out-of-runtime invariants covering the manifests, the exec form, the shell ban, and
      the agreement between roadmap, bench and evidence register

## Phase 0b: foundations

- [x] `plugin.json`, `marketplace.json`, `compat.json`, `hooks.json`
- [x] One entry point, loaded from within the plugin by relative path rather than assembled
      by a build step. A bundle was specified and dropped: it would have added a tool, a
      build, and a second copy of every line able to disagree with the first, in exchange
      for a guarantee an invariant already gives: nothing reachable from the entry point
      loads anything but the runtime, and nothing anywhere reaches a shell
- [x] `project.json` and `state.json` schemas, written atomically under a lock
- [x] Turn ledger written before anything else on every write tool, and before the decision
      to allow or refuse, because a refused write is still an attempt to change the project
- [x] An internal deadline per event, shorter than the declared one: the entry point refuses
      to start a check it cannot finish and report within the budget, and returns "I could not
      check this" instead of being timed out into silence, since F6 showed that an overrun
      renders no decision and the action proceeds. A synchronous check already running is not
      interrupted; a slow one consults the clock through ctx.timeLeft()
- [x] No handler ends with an immediate exit after writing: standard output is a pipe and
      the tail of a decision is lost intermittently, as the regression guard demonstrates
- [x] Human output written to read naturally after the event-name prefix the harness adds,
      which F10 showed is not ours to remove
- [x] Finish gate armed only on turns that wrote, as a function of its inputs and nothing
      else, exercised against fabricated situations rather than a live session
- [x] Two-sided canary: a check that stops finding what it was written for, one that starts
      refusing everything, and one that still fails for a different reason all turn it red
- [x] Secret guard by position, every assertion of its shell predecessor carried over, plus
      credential recognition by issuer prefix rather than by entropy
- [x] Snapshot before destructive commands, with the ignored-path constraint F8 measured
- [x] Status file written from state, never asked for, and never declaring the work finished
- [x] Message catalogues with eight gates over them, and a language resolved from the most
      deliberate signal available rather than guessed
- [x] Out-of-runtime tests, needing no session and no credentials
- [x] Three bench cases that need a session, each proving something no direct call can:
      that the installed plugin is found and honoured, that a conversation is left alone,
      that a credential never reaches the file. The nine cases originally listed folded to
      three: six of them asserted what the out-of-runtime tests now assert faster and more
      deterministically, and spending a session to repeat a unit test buys nothing
- [x] Exit criterion: adding a second standard left the handler definitions byte-identical,
      and an invariant now asserts the property structurally rather than resting on that one
      observation: nothing that runs may name a standard

## Phase 1: interpreter and guards

- [x] `standards/` and `archetypes/` as data, composed by the gate for the project's archetype.
      `adapters/`, the model for a standard that runs an external tool, waits for the first
      standard that needs one: none of the standards below does, so the folder would be a shape
      no fixture exercises until the static-site archetype introduces its tools
- [x] Seven placement and hygiene standards, with markup scanning and per-language comment
      syntax: placement-css, placement-js, placement-php, placement-content, typed-source-only,
      no-placeholder-tokens, no-analyzer-suppression, each with fixtures replayed by the canary
- [x] File reconstruction on partial edits: an edit is judged on the file it would produce
- [x] Escalation to the person on the fourth refusal of the same file
- [x] Three transversal standards plus signed commits: no-placeholder-tokens,
      no-analyzer-suppression, root-finite, git-signed-commits
- [x] Deny rules written into project settings as a second layer, precise rather than coarse
      (only the secret files git actually ignores), whose effect on the current session is
      undefined, F9 having observed it both ways, with the pre-tool handler carrying the
      protection in the session in progress
- [x] Configuration-change journal
- [x] Conditional prompt-submit context, carrying the no-regression rule
- [x] Post-compaction context
- [x] Transversal `clean` skill
- [x] Every model invariant green. A separate case generator is not built: the canary already
      replays every standard's fixtures deterministically and for free, and the bench was folded
      to three real-session cases on purpose, so a per-standard generator would duplicate the
      one or reintroduce the cost of the other

## Phase 2: static site

- [ ] The archetype in data: standards, adapters with proven exit codes, scaffold
- [ ] Legal templates with typed holes and computed facts
- [ ] Maintenance deadlines and dependency updates
- [ ] `/new`: prerequisites, defaults, git identity, signing key, signed first commit
- [ ] Verification-only formatting after writes
- [ ] Tree-hash cache and toolchain flag
- [ ] `/status`
- [ ] Installation documentation
- [ ] Exit criterion: from an empty directory, a site that passes its own gate on three
      operating systems, with no question asked

## Phase 3: onboarding an existing codebase

- [ ] Dated detection signatures as versioned standards
- [ ] Diagnosis without judgement, weighted profile, origin confirmed by the user
- [ ] Git identity and signing key set before anything else
- [ ] Equivalence witness: screenshots, visible text, behaviour inventory, identifier map
- [ ] Extraction in order of least risk, one signed commit per step
- [ ] Ratchet on named baselines
- [ ] Placing the result under the same guards
- [ ] Exit criterion: three fixture codebases restructured with an identical witness before
      and after, and one more diagnosed without a false positive on generated components

## Phase 4: framework archetype and reviewer

- [ ] Framework archetype with its specific standards
- [ ] `/audit` as a skill of that archetype
- [ ] Review subagent, framed to refute, its verdict read from the subagent-completion
      event, since F3 showed the agent tool's response describes the launch, not the work
- [ ] Subagent governance document
- [ ] Source the framework and command-line archetype sheets
- [ ] Exit criterion: a failing review then a passing one, both read back by the gate

## Phase 5: remaining archetypes

In order of local verifiability, not of popularity. Each archetype whose gate mostly
returns "not verifiable here" states what it does not prove before it ships.

- [ ] PHP backend · JavaScript backend · web application · API · command-line tool ·
      game · desktop application
- [ ] Browser extension, Chromium and Firefox targets declared
- [ ] Developer-tool extension, agent plugin, context server
- [ ] Content-management extension
- [ ] Smart contract
- [ ] Data analysis
- [ ] Messaging bot
- [ ] Declarative infrastructure
- [ ] Mobile application
- [ ] Email template
- [ ] Exit criterion: one end-to-end bench case per archetype, hook definitions untouched

## Phase 6: publishing

- [ ] Published flag and its checkpoints
- [ ] Guided remote setup
- [ ] State-of-the-art repository hygiene for the generated project's own remote, fitted to that
      project rather than copied from this one: which tabs, templates, labels, protections and
      health files it needs are decided by what the project is, so a plugin gets no wiki and a
      library documented for a community might
- [ ] Reviews scheduled at publication
- [ ] Computed facts feeding the legal templates
- [ ] Refusal of abrogated clauses
- [ ] Exit criterion: at most two questions, holes listed and never blocking

## Phase 7: release and governance

- [ ] Archive distribution for machines without git
- [ ] Tagged releases, version equal to the manifest
- [ ] English documentation: prerequisites, two-command install, updates
- [ ] Licence, health files, owners, issue and pull-request templates, labels
- [ ] Project board, discussions, milestones per phase
- [ ] Branch rules: signed commits, required checks, linear history
- [ ] Dependency updates, code scanning, supply-chain score, bill of materials
- [ ] Architecture decision records
- [ ] The plugin applied to its own repository in continuous integration
- [ ] Exit criterion: strict manifest validation green, install from scratch on a machine
      without git, community standards at their reachable maximum

## Phase 8: a second agent harness

- [ ] Probes C1 to C8 before a single line of the harness layer
- [ ] Plugin manifest and hook entry point for that harness
- [ ] Patch parser recovering paths from the edit payload
- [ ] Continuation output at stop, with an application-side cap
- [ ] Refusal without escalation, uncertainty resolved as denial with an actionable reason
- [ ] Command refusal rules where their scope is established
- [ ] Generated instruction file, and a canary that lives outside the hooks
- [ ] Documented approval step, and the bypass reserved for automation
- [ ] Exit criterion: the bench cases replayed with the same verdict, or every divergence
      named case by case, with the core untouched
