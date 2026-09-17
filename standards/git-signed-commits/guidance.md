# Commits carry a signature

## Why

A signature on a commit is what lets anyone, a reviewer, a future maintainer, the person
themselves, verify who made a change and that it was not altered afterwards. Without it, a commit
is only as trustworthy as the name typed into its author field, which anyone can type. A project
that signs its commits gives everyone who reads it a way to check its history rather than take it
on faith. Setting signing up once, at the start, means every commit after carries that proof.

## Rejected alternative

Blocking on an unsigned commit was considered and dropped. A project taken over from elsewhere
carries a history made before it was signing anything, and stopping the work until that history
is rewritten would trade a small gain for a large disruption, and rewriting published history is
its own harm. So the standard reports rather than blocks, and reads the signature that is present
rather than requiring it be verifiable here: a signature this machine lacks the key to check is
still a signature, and calling it absent would be false. New commits are what signing is set up
to cover.

## What to do

Set up commit signing: a signing key, `commit.gpgsign` turned on, and, for a signature that
verifies offline, an allowed-signers file. From then on every commit is signed without another
thought. A commit made before signing was in place can be left as it is; what matters is that the
history from here on carries the proof of who wrote it.
