'use strict'

// How to say something, per event, and to whom.
//
// Every shape here was measured rather than read. The measurements are recorded in the
// evidence register, and three of them are counter-intuitive enough that guessing would have
// produced a plugin that talks to nobody:
//
//  - At session start the display field does not surface at all. What reaches the person is
//    standard error together with a non-zero exit, and a non-zero exit there does not stop
//    the session. The canary's warning takes that route and no other.
//  - At a stop, the display field does surface, prefixed by the harness with the event name.
//    The prefix is not ours to remove, so every string is written to read after one.
//  - A blocking decision reaches the model as a user message. It is the model's instruction,
//    so it stays in English while the person's line is translated. Both are emitted together
//    or neither is: a refusal the model understands and the person does not is a mystery, and
//    the reverse is an accusation.
//
// Nothing here calls process.exit. Standard output is a pipe, writes to a pipe are
// asynchronous, and exiting truncates whatever has not drained. It does so intermittently,
// which is the worst way for a decision to be wrong.

// Nothing here writes. Each function returns the shape of an answer and the entry point
// emits it, so that every branch below can be checked by comparing values rather than by
// capturing a stream.

// Session start: silence unless something is wrong, and when something is wrong the person
// hears it on the only channel that reaches them here.
function sessionStart ({ contextForModel = null, warningForPerson = null }) {
  const payload = {}
  if (contextForModel) {
    payload.hookSpecificOutput = {
      hookEventName: 'SessionStart',
      additionalContext: contextForModel
    }
  }
  return {
    stdout: Object.keys(payload).length ? payload : null,
    stderr: warningForPerson,
    // Non-zero only to carry the warning. Measured: the session continues regardless, which
    // is what makes this safe to use for a warning rather than a refusal.
    exitCode: warningForPerson ? 2 : 0
  }
}

// Refusing a tool call. The reason goes to the model, which is the only party that can act
// on it; the person gets the short version of what was withheld and what happens instead.
function refuseTool ({ reasonForModel, lineForPerson = null }) {
  return {
    stdout: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reasonForModel
      },
      ...(lineForPerson ? { systemMessage: lineForPerson } : {})
    },
    stderr: reasonForModel,
    // Both forms of refusal are emitted: the structured one the harness reads today, and the
    // exit code it has always honoured. One of the two surviving a change of field name is
    // the point.
    exitCode: 2
  }
}

function allowTool () {
  return { stdout: null, stderr: null, exitCode: 0 }
}

// Handing the decision to the person. Used when a guard has refused the same write enough times
// that repeating itself is a tax rather than a help: the person is asked, and their answer, not
// the guard's, governs. It is not a refusal, so it carries no failing exit code.
function askTool ({ reasonForModel, lineForPerson = null }) {
  return {
    stdout: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: reasonForModel
      },
      ...(lineForPerson ? { systemMessage: lineForPerson } : {})
    },
    stderr: null,
    exitCode: 0
  }
}

// Refusing to let the turn end. The reason becomes the model's next instruction.
function refuseStop ({ reasonForModel, lineForPerson = null }) {
  return {
    stdout: {
      decision: 'block',
      reason: reasonForModel,
      ...(lineForPerson ? { systemMessage: lineForPerson } : {})
    },
    stderr: reasonForModel,
    exitCode: 2
  }
}

// The way out when the refusal budget is spent. Measured to continue the turn and reach the
// model, without the harness counting it against the consecutive-refusal cap the way a
// blocking decision does.
function nudgeStop ({ contextForModel, lineForPerson = null }) {
  return {
    stdout: {
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: contextForModel
      },
      ...(lineForPerson ? { systemMessage: lineForPerson } : {})
    },
    stderr: null,
    exitCode: 0
  }
}

function letStopThrough ({ lineForPerson = null } = {}) {
  return {
    stdout: lineForPerson ? { systemMessage: lineForPerson } : null,
    stderr: null,
    exitCode: 0
  }
}

// Context added to a prompt as it is submitted. It never blocks: an exit-2 here erases the
// prompt, so this only ever adds, and only when it has something to add.
function promptSubmit ({ contextForModel = null }) {
  return {
    stdout: contextForModel
      ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: contextForModel } }
      : null,
    stderr: null,
    exitCode: 0
  }
}

function silent () {
  return { stdout: null, stderr: null, exitCode: 0 }
}

module.exports = {
  sessionStart,
  refuseTool,
  askTool,
  allowTool,
  promptSubmit,
  refuseStop,
  nudgeStop,
  letStopThrough,
  silent
}
