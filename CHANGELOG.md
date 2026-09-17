# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The runtime: one entry point per lifecycle event, launched directly with no shell, loaded
  from the plugin directory rather than a bundle.
- The finish gate, a pure function that decides when a turn may end. It arms only on turns
  that changed something, holds the turn while agent-fixable work is outstanding, and gives
  way rather than arguing once its budget is spent.
- Guards that run before a tool: one that withholds a private file and a credential headed
  where it would be published, and one that takes a copy before a command that cannot be
  undone.
- The canary, which replays every check against its fixtures at session start and reports
  when a guard has stopped working on this machine.
- The state file, written from the record the gate keeps rather than asked about, which never
  declares the work finished.
- Message catalogues in English and French, with the checks that keep them consistent.
- The out-of-runtime test suite and the probe bench that established the runtime contracts.
- Continuous integration across Linux, macOS, and Windows with and without a POSIX shell.

[Unreleased]: https://github.com/LennyObez/to-spec
