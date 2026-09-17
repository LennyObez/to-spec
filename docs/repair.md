# When the guards are not answering

If a session opens with a line saying the protections on this project are not answering, this
is what it means and what to do. It is short on purpose: the person reading it has already
been interrupted once.

## What the message means

Before each session, every check this plugin carries is replayed against two small example
projects: one it should object to, one it should accept. If any check gives the wrong answer,
or gives no answer, the plugin says so and steps aside.

It steps aside rather than stopping the session, because a broken guard should not become a
project nobody can work on. That is how guards get removed instead of repaired.

**While the message is showing, nothing is being checked.** Work can continue, and it is worth
knowing that it continues unwatched.

## What to do

Run this from the plugin directory:

```
node bench/probes/run.mjs F8
node --test
```

The first needs nothing but version control and reports whether the copy-before-destruction
machinery still holds. The second runs the whole suite and names what broke; it discovers its
own test files, so it takes no path argument.

Most causes are ordinary:

- **The runtime is missing or too old.** The plugin needs the version named in `compat.json`,
  and nothing here runs without it. This is the one failure the plugin cannot report from
  inside itself: with no runtime, no handler starts, and silence looks exactly like approval.
- **The plugin directory is incomplete.** A partial copy or an interrupted update leaves a
  handler pointing at a file that is not there. Reinstalling replaces it.
- **A check was edited.** If a check was changed and its two examples were not, the replay
  reports the mismatch and names the check.

## Getting back a copy taken before a risky command

Before a command that cannot be undone -- a recursive delete, a hard reset, a database drop --
the plugin takes a copy of everything first, so nothing is lost even if the command goes wrong.
Each copy is a commit kept under `refs/snapshots/`, invisible to `git log` and `git branch` so
it never clutters the history, and it survives garbage collection.

To see the copies:

```
git for-each-ref refs/snapshots
```

To look at what a copy held, or bring a file back from it:

```
git show refs/snapshots/<timestamp>:<path>        # print one file as it was
git restore --source refs/snapshots/<timestamp> <path>   # bring one file back
```

The plugin also records each copy it takes in `.to-spec/state.json` under `snapshots`, with the
time and the command it was guarding, so a copy can be matched to the command that prompted it.

## What not to do

Do not switch the plugin off to make the message stop. The message is the only thing standing
between an unwatched session and one that looks watched, and switching it off removes the
message rather than the cause.

If the guards genuinely cannot run on this machine and the work has to continue, that is a
decision worth making deliberately: say so, and carry on knowing the session is unwatched,
rather than making it quiet and forgetting.
