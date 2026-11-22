# Extensions

> Pi can create extensions. Ask it to build one for your use case.

Extensions are TypeScript modules that extend Pi's behavior. They can subscribe to lifecycle events, register custom tools callable by the LLM, add commands, and more.

An extension runs inside the Pi process with the same operating-system permissions. It can inspect prompts, tool calls, files, credentials, and session history, so load extensions only from sources you trust.

> **Placement for /reload:** Put extensions in `~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project-local) for auto-discovery. Use `pi -e ./path.ts` only for quick tests. Extensions in auto-discovered locations can be hot-reloaded with `/reload`.

**Key capabilities:**

- **Custom tools** - Register tools the LLM can call via `pi.registerTool()`
- **Event interception** - Block or modify tool calls, inject context, customize compaction
- **User interaction** - Prompt users via `ctx.ui` (select, confirm, input, notify)
- **Custom UI components** - Full TUI components with keyboard input via `ctx.ui.custom()` for complex interactions
- **Custom commands** - Register commands like `/mycommand` via `pi.registerCommand()`
- **Session persistence** - Store state that survives restarts via `pi.appendEntry()`
- **Custom rendering** - Control how tool calls/results and messages appear in TUI
- **Providers and MCP servers** - Register model providers, virtual models, and MCP servers

**Example use cases:**

- Permission gates (confirm before `rm -rf`, `sudo`, etc.)
- Git checkpointing (stash at each turn, restore on branch)
- Path protection (block writes to `.env`, `node_modules/`)
- Custom compaction (summarize conversation your way)
- Conversation summaries (see `summarize.ts` example)
- Interactive tools (questions, wizards, custom dialogs)
- Stateful tools (todo lists, connection pools)
- External integrations (file watchers, webhooks, CI triggers)
- Games while you wait (see `snake.ts` example)

See [examples/extensions/](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions) for working implementations.

## Table of Contents

- Quick Start
- Extension Locations
- Available Imports
- Writing an Extension
  - Extension Styles
- Events
  - Lifecycle Overview
  - Handler Composition
  - Startup Events
  - Resource Events
  - Session Events
  - Agent Events
  - Model Events
  - Tool Events
  - User Bash Events
  - Input Events
- ExtensionContext
- ExtensionCommandContext
- ExtensionAPI Methods
- State Management
- Custom Tools
  - Tool Exposure
  - Calling Other Tools
  - Dynamic Tool Loading
- MCP Servers
- Custom UI
- Error Handling
- Mode Behavior
- Examples Reference

## Quick Start

Create `~/.pi/agent/extensions/my-extension.ts`:

```
import { type ExtensionAPI, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // React to events
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });

  pi.on("tool_call", async (event, ctx) => {
    if (isToolCallEventType("bash", event) && event.input.command.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });

  // Register a custom tool
  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone by name",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: {},
      };
    },
  });

  // Register a command
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
```

Test with `--extension` (or `-e`) flag:

```
pi -e ./my-extension.ts
```

## Extension Locations

> **Security:** Extensions run with your full system permissions and can execute arbitrary code. Only install from sources you trust.

Extensions are auto-discovered from trusted locations. Project-local `.pi/extensions` entries load only after the project is trusted.

| Location | Scope |
|---|---|
| `~/.pi/agent/extensions/*.ts` or `*.js` | Global (all projects) |
| `~/.pi/agent/extensions/*/index.ts` or `index.js` | Global (subdirectory) |
| `~/.pi/agent/extensions/*/package.json` with a `pi.extensions` field | Global (subdirectory with manifest) |
| `.pi/extensions/...` | Project-local, same layouts |

Discovery goes one level deep. Larger packages declare their entry points in a `package.json` manifest.

Additional paths via `settings.json`:

```
{
  "packages": [
    "npm:@foo/bar@1.0.0",
    "git:github.com/user/repo@v1"
  ],
  "extensions": [
    "/path/to/local/extension.ts",
    "/path/to/local/extension/dir"
  ]
}
```

Settings also accept built-in extensions as `builtin:<name>` entries; see [Settings](https://pi.dev/latest/settings#resources). To share extensions via npm or git as Pi packages, see [packages.md](https://pi.dev/latest/packages).

## Available Imports

| Package | Purpose |
|---|---|
| `@earendil-works/pi-coding-agent` | Extension types (`ExtensionAPI`, `ExtensionContext`, events) and helpers |
| `@earendil-works/pi-agent-core` | Agent message and tool types |
| `typebox`, `typebox/compile`, `typebox/value` | Schema definitions for tool parameters |
| `@earendil-works/pi-ai` | AI utilities (`StringEnum` for string enums, transcript helpers, model types). Inside Pi it also exports TypeBox's `Type`, `Static` and `TSchema`, which the published package no longer re-exports; import them from `typebox` in new code |
| `@earendil-works/pi-ai/compat`, `/models`, `/oauth`, `/providers/all` | Provider construction, built-in APIs, and OAuth helpers |
| `@earendil-works/pi-tui` | TUI components for custom rendering |

Pi maps these imports to its own copies, so extensions share Pi's classes and registries. The legacy `@mariozechner/*` and `@sinclair/typebox` names map to the same modules.

npm dependencies work too. Add a `package.json` next to your extension (or in a parent directory), run `npm install`, and imports from `node_modules/` are resolved automatically.

For distributed Pi packages installed with `pi install` (npm or git), runtime deps must be in `dependencies`; `devDependencies` are not installed. Do not list the host-provided packages above in `dependencies`. See [Declare dependencies](https://pi.dev/latest/packages#declare-dependencies).

### Tool parameter schemas and TypeBox

Pi validates tool arguments as JSON Schema with `@earendil-works/pi-schema`, whatever built the schema; TypeBox schemas are JSON Schema and work unchanged. Before validation, loosely typed arguments are coerced: numeric strings to numbers, `"true"` to `true`, a single value to a one-item array, `null` in an optional property dropped. TypeBox features outside JSON Schema do not apply to tool arguments:

- `Type.Refine()` refinements are not run. Check such constraints in `execute()`.
- `Type.BigInt()`, `Type.Undefined()` and `Type.Void()` reject every argument, since JSON has no such values. Codecs (`Type.Codec()`) do not decode: `execute()` receives the JSON value.
- Formats registered with TypeBox's `Format.Set()` are not checked. The standard formats are, plus `url` and `json-pointer-uri-fragment`.
- Property names are matched as names, not as regular expressions, and `additionalProperties` applies only to properties the object does not declare.
- A `$ref` that names nothing rejects only arguments at its place.

Validation errors the model sees use pi-schema's messages, such as `- path: missing` or `- limit: expected number, got string`.

Node.js built-ins (`node:fs`, `node:path`, etc.) are also available.

## Writing an Extension

An extension exports a default factory function that receives `ExtensionAPI`. The factory can be synchronous or asynchronous:

```
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Subscribe to events
  pi.on("event_name", async (event, ctx) => {
    // ctx.ui for user interaction
    const ok = await ctx.ui.confirm("Title", "Are you sure?");
    ctx.ui.notify("Done!", "info");
    ctx.ui.setStatus("my-ext", "Processing...");  // Footer status
    ctx.ui.setWidget("my-ext", ["Line 1", "Line 2"]);  // Widget above editor (default)
  });

  // Register tools, commands, shortcuts, flags
  pi.registerTool({ ... });
  pi.registerCommand("name", { ... });
  pi.registerShortcut("ctrl+x", { ... });
  pi.registerFlag("my-flag", { ... });
}
```

Extensions are loaded via [jiti](https://github.com/unjs/jiti), so TypeScript works without compilation.

If the factory returns a `Promise`, Pi awaits it before continuing startup. That means async initialization completes before `session_start`, before `resources_discover`, and before provider registrations queued via `pi.registerProvider()` are flushed.

### Async factory functions

Use an async factory for one-time startup work such as fetching remote configuration or dynamically discovering available models.

```
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function (pi: ExtensionAPI) {
  const response = await fetch("http://localhost:1234/v1/models");
  const payload = (await response.json()) as {
    data: Array<{
      id: string;
      name?: string;
      context_window?: number;
      max_tokens?: number;
    }>;
  };

  pi.registerProvider("local-openai", {
    baseUrl: "http://localhost:1234/v1",
    apiKey: "$LOCAL_OPENAI_API_KEY",
    api: "openai-completions",
    models: payload.data.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.context_window ?? 128000,
      maxTokens: model.max_tokens ?? 4096,
    })),
  });
}
```

This pattern makes the fetched models available during normal startup and to `pi --list-models`. For model lists that change while Pi runs, implement `refreshModels` instead; see pi.registerProvider().

### Long-lived resources and shutdown

Extension factories may run in invocations that never start a session. Do not start background resources such as processes, sockets, file watchers, or timers from the factory.

Defer background resource startup until `session_start` or the command/tool/event that needs the resource. Register an idempotent `session_shutdown` handler to close any session-scoped resources you start.

### Extension Styles

**Single file** - simplest, for small extensions:

```
~/.pi/agent/extensions/
└── my-extension.ts
```

**Directory with index.ts** - for multi-file extensions:

```
~/.pi/agent/extensions/
└── my-extension/
    ├── index.ts        # Entry point (exports default function)
    ├── tools.ts        # Helper module
    └── utils.ts        # Helper module
```

**Package with dependencies** - for extensions that need npm packages:

```
~/.pi/agent/extensions/
└── my-extension/
    ├── package.json    # Declares dependencies and entry points
    ├── package-lock.json
    ├── node_modules/   # After npm install
    └── src/
        └── index.ts
```

```
// package.json
{
  "name": "my-extension",
  "dependencies": {
    "zod": "^3.0.0",
    "chalk": "^5.0.0"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Run `npm install` in the extension directory, then imports from `node_modules/` work automatically.

## Events

### Lifecycle Overview

A prompt starts a run. Input handling comes first:

1. Extension commands (`/name`) run their handler. The `input` event does not fire. Typed and RPC prompts always check for commands; `pi.sendUserMessage()` checks only with `expandPromptTemplates: true`.
2. `input` handlers can intercept, transform, or handle the text.
3. Skill commands (`/skill:name`) and prompt templates (`/template`) expand.
4. `before_agent_start` runs, then the agent loop starts.

The run repeats turns, then checks whether more work starts another low-level agent run:

```
flowchart TD
    Input["input"] --> Before["before_agent_start"]
    Before --> AgentStart["agent_start"]
    AgentStart --> Turns[["turns"]]
    Turns --> AgentEnd["agent_end"]
    AgentEnd --> MoreRuns{"More work?"}
    MoreRuns -->|yes| AgentStart
    MoreRuns -->|no| BeforeSettle["agent_before_settle"]
    BeforeSettle --> Continue{"Continuation requested?"}
    Continue -->|yes| AgentStart
    Continue -->|no| Settled["agent_settled"]
```

More work means a retry, final-attempt recovery, a compaction retry, or queued messages. `agent_end` is therefore not a final-idle signal; use `agent_settled` for that. An aborted run skips `agent_before_settle` and goes from `agent_end` to `agent_settled`. Pi counts as busy while a run starts, including the compaction check and `before_agent_start`, so messages sent meanwhile go into the starting run.

Each turn sends one model request and executes the tool calls in the assistant response:

```
flowchart TD
    TurnStart["turn_start"] --> Request[["model request"]]
    Request --> ToolDecision{"Tool calls?"}
    ToolDecision -->|yes| Tools[["tool execution"]]
    Tools --> TurnEnd["turn_end"]
    ToolDecision -->|no| TurnEnd
    TurnEnd --> MoreTurns{"Another turn?"}
    MoreTurns -->|yes| TurnStart
    MoreTurns -->|no| AgentEnd(["agent_end"])
```

The model request runs these hooks in order:

1. `context` (can modify conversation messages)
2. `context_with_system` (can modify the full transcript)
3. `before_provider_headers` (can mutate headers)
4. `before_provider_request` (can inspect or replace the payload)
5. `after_provider_response` (status and headers, before the stream is consumed)
6. `provider_stream_event` (raw parsed stream events) and `message_start` / `message_update` / `message_end` for the assistant message

A tool call that executes runs these hooks in order:

1. `tool_execution_start`
2. `tool_call` (can block or mutate input)
3. `tool_execution_update` while the tool executes
4. `tool_result` (can modify the result)
5. `tool_execution_end`

Calls that do not execute end early. An unknown tool or invalid arguments skip `tool_call`; a blocked or aborted call skips execution and `tool_result`. Each of these still gets `tool_execution_end` with an error result, so use `tool_execution_end` to observe every finalized call.

`turn_end` can append entries and request a continuation. Threshold compaction runs before a naturally required next turn. Message events also fire for other messages, such as user, tool-result, and custom messages. Provider hooks run only when the transport exposes the corresponding stage.

Session startup and replacement follow a separate lifecycle:

```
flowchart TD
    Startup["Process startup"] --> Trust["project_trust when needed"]
    Trust --> SessionStart["session_start"]
    Switch["/new or /resume"] --> BeforeSwitch["session_before_switch"]
    Fork["/fork or /clone"] --> BeforeFork["session_before_fork"]
    BeforeSwitch --> Shutdown["session_shutdown"]
    BeforeFork --> Shutdown
    Reload["/reload"] --> Shutdown
    Exit["exit"] --> Shutdown
    Shutdown --> Replacing{"Replacing the runtime?"}
    Replacing -->|yes| ReplacementTrust["project_trust when the working directory is new"]
    ReplacementTrust --> Replacement["load replacement extension runtime"]
    Replacement --> SessionStart
    Replacing -->|no| Stop["process exits"]
    SessionStart --> Discover["resources_discover"]
```

`session_start` carries `reason: "startup" | "reload" | "new" | "resume" | "fork"`, and `session_shutdown` carries `reason: "quit" | "reload" | "new" | "resume" | "fork"`. `resources_discover` uses `reason: "reload"` after a reload and `"startup"` otherwise. Exit covers Ctrl+C, Ctrl+D, SIGHUP, and SIGTERM. `project_trust` runs before trusted project resources load and can run again when session replacement enters a new working directory.

Other operations change the current session without replacing the runtime:

| Operation | Events |
|---|---|
| `/compact` or automatic compaction | `session_before_compact` (can cancel or customize), then `session_compact` or `session_compact_failed` |
| `/tree` navigation | `session_before_tree` (can cancel or customize), then `session_tree` |
| `/name` or `pi.setSessionName()` | `session_info_changed` |
| `/model` or model cycling (`Ctrl+P`) | `thinking_level_select` if the level changes or is clamped, then `model_select` |
| Thinking-level change (settings, keybinding, `pi.setThinkingLevel()`) | `thinking_level_select` |
| `!` or `!!` command | `user_bash` (can intercept) |
| Extension dialog or custom screen waits for the user | `ui_prompt_start`, `ui_prompt_end` |
| Idle prompt-cache refresh | `cache_warming_decision` |
| Extension registers or removes an MCP server after startup | `mcp_servers_change` |

### Handler Composition

Handlers run in extension load order, then registration order. Some events notify; others transform data, replace results, or cancel an operation:

| Pattern | Behavior |
|---|---|
| Notification | Return values are ignored. Use the event for observation only. |
| In-place mutation | Later handlers see changes to values such as `before_provider_headers.headers`, `before_agent_start.systemPromptOptions`, and `tool_call.input`. |
| Chained transformation | Later handlers receive the value returned by earlier `input`, `context`, `context_with_system`, `message_end`, `tool_result`, and `before_provider_request` handlers. |
| Gate | A handled input, blocked tool call, cancelled session operation, or handled `user_bash` command stops that operation's normal fallback path. |
| Actionable boundary | Each `turn_end` or `agent_before_settle` handler sees the entries and continuation decision proposed so far. |
| Last override | The last `cache_warming_decision` handler that returns an action wins. |

Notification handlers should not perform slow work on a streaming event. Transform handlers should preserve fields they do not intentionally own, and gate handlers should fail closed when their safety decision cannot be made.

### Startup Events

#### project_trust

Fired before Pi decides whether to trust a project with dynamic configs (`.pi` or `.agents/skills`). It runs during startup and when session replacement (for example `/resume`) enters a cwd whose trust has not been resolved in the current process. Only user/global extensions and CLI `-e` extensions participate; project-local extensions are not loaded until after trust is resolved.

```
pi.on("project_trust", async (event, ctx) => {
  // event.cwd - current working directory
  // ctx has a limited trust context: cwd, mode, hasUI, and select/confirm/input/notify UI helpers
  if (await ctx.ui.confirm("Trust project?", event.cwd)) {
    return { trusted: "yes", remember: true };
  }
  return { trusted: "undecided" };
});
```

A `project_trust` handler must return `{ trusted: "yes" | "no" | "undecided" }`. A user/global or CLI extension that returns `"yes"` or `"no"` owns the decision; the first yes/no decision wins and suppresses the built-in trust prompt. Use `remember: true` to persist a yes/no decision; otherwise it applies only to the current process. Return `"undecided"` to let later handlers or the built-in trust flow decide. Check `ctx.hasUI` before prompting. If no handler returns yes/no, normal trust resolution continues: saved `trust.json` decisions apply first, then `defaultProjectTrust` controls whether Pi asks, trusts, or declines by default.

### Resource Events

#### resources_discover

Fired after `session_start` so extensions can contribute additional skill, prompt, and theme paths. The startup path uses `reason: "startup"`. Reload uses `reason: "reload"`.

```
pi.on("resources_discover", async (event, _ctx) => {
  // event.cwd - current working directory
  // event.reason - "startup" | "reload"
  return {
    skillPaths: ["/path/to/skills"],
    promptPaths: ["/path/to/prompts"],
    themePaths: ["/path/to/themes"],
  };
});
```

#### mcp_servers_change

Fired when an extension registers or unregisters an MCP server after extensions are bound. `event.servers` lists every registered server after the change. Handling this event marks the extension as the one that connects registered servers; see MCP Servers.

### Session Events

See [Session Format](https://pi.dev/latest/session-format) for session storage internals and the SessionManager API.

#### session_start

Fired when a session is started, loaded, or reloaded.

```
pi.on("session_start", async (event, ctx) => {
  // event.reason - "startup" | "reload" | "new" | "resume" | "fork"
  // event.previousSessionFile - present for "new", "resume", and "fork"
  ctx.ui.notify(`Session: ${ctx.sessionManager.getSessionFile() ?? "ephemeral"}`, "info");
});
```

#### session_info_changed

Fired when the current session display name is set via `/name`, RPC, or `pi.setSessionName()`.

```
pi.on("session_info_changed", async (event, ctx) => {
  // event.name - current normalized name, or undefined if cleared
  ctx.ui.notify(`Session renamed: ${event.name ?? "(none)"}`, "info");
});
```

#### session_before_switch

Fired before starting a new session (`/new`) or switching sessions (`/resume`).

```
pi.on("session_before_switch", async (event, ctx) => {
  // event.reason - "new" or "resume"
  // event.targetSessionFile - session we're switching to (only for "resume")

  if (event.reason === "new") {
    const ok = await ctx.ui.confirm("Clear?", "Delete all messages?");
    if (!ok) return { cancel: true };
  }
});
```

After a successful switch or new-session action, Pi emits `session_shutdown` for the old extension instance, reloads and rebinds extensions for the new session, then emits `session_start` with `reason: "new" | "resume"` and `previousSessionFile`. Do cleanup work in `session_shutdown`, then reestablish any in-memory state in `session_start`.

#### session_before_fork

Fired when forking via `/fork` or cloning via `/clone`.

```
pi.on("session_before_fork", async (event, ctx) => {
  // event.entryId - ID of the selected entry
  // event.position - "before" for /fork, "at" for /clone
  return { cancel: true }; // Cancel fork/clone
  // OR
  return { skipConversationRestore: true }; // Reserved for future conversation restore control
});
```

After a successful fork or clone, Pi emits `session_shutdown` for the old extension instance, reloads and rebinds extensions for the new session, then emits `session_start` with `reason: "fork"` and `previousSessionFile`. Do cleanup work in `session_shutdown`, then reestablish any in-memory state in `session_start`.

#### session_before_compact / session_compact / session_compact_failed

Fired on compaction. See [compaction.md](https://pi.dev/latest/compaction) for details.

```
pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, branchEntries, customInstructions, reason, willRetry, signal } = event;

  // reason - "manual" (/compact), "threshold", or "overflow"
  // willRetry - whether the aborted turn is retried after compaction (overflow recovery)

  // Cancel:
  return { cancel: true };

  // Custom summary:
  return {
    compaction: {
      summary: "...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      // usage: summaryResponse.usage, // Optional; included in session totals
    }
  };
});

pi.on("session_compact", async (event, ctx) => {
  // event.compactionEntry - the saved compaction
  // event.fromExtension - whether extension provided it
  // event.reason - "manual" (/compact), "threshold", or "overflow"
  // event.willRetry - whether the aborted turn is retried after compaction (overflow recovery)
});

pi.on("session_compact_failed", async (event, ctx) => {
  // event.reason - "manual" (/compact), "threshold", or "overflow"
  // event.errorMessage - present for non-abort failures
  // event.aborted - true for cancelled/aborted compactions
  // event.willRetry - whether the aborted turn would have retried after compaction
  // event.fromExtension - whether extension-provided compaction content was being used
});
```

#### session_before_tree / session_tree

Fired on `/tree` navigation. See [Sessions](https://pi.dev/latest/sessions) for tree navigation concepts.

```
pi.on("session_before_tree", async (event, ctx) => {
  const { preparation, signal } = event;
  // preparation.targetId, oldLeafId, commonAncestorId, entriesToSummarize,
  // userWantsSummary, customInstructions, replaceInstructions, label
  return { cancel: true };
  // OR provide custom summary (used only when preparation.userWantsSummary is true):
  return {
    summary: {
      summary: "...",
      // usage: summaryResponse.usage, // Optional; included in session totals
      details: {},
    },
  };
  // OR override summarization options: customInstructions, replaceInstructions, label
});

pi.on("session_tree", async (event, ctx) => {
  // event.newLeafId, oldLeafId, summaryEntry, fromExtension
});
```

#### session_shutdown

Fired before a started session runtime is torn down. Use this to clean up resources opened from `session_start` or other session-scoped hooks.

```
pi.on("session_shutdown", async (event, ctx) => {
  // event.reason - "quit" | "reload" | "new" | "resume" | "fork"
  // event.targetSessionFile - destination session for session replacement flows
  // Cleanup, save state, etc.
});
```

### Agent Events

#### before_agent_start

Fired before a run starts, after input handling and expansion. Can inject a message and/or modify the system prompt.

`event.messageType` says what started the run: `"user"` for a prompt or `pi.sendUserMessage()`, with `prompt` and `images`; `"custom"` for `pi.sendMessage(..., { triggerTurn: true })` while idle, with the starting `message` and no `prompt`.

```
pi.on("before_agent_start", async (event, ctx) => {
  // event.messageType - "user" | "custom"
  // event.prompt, event.images - user's prompt text and images (messageType "user")
  // event.message - the custom message that starts the run (messageType "custom")
  // event.systemPrompt - current chained system prompt for this handler
  //   (includes changes from earlier before_agent_start handlers)
  // event.systemPromptOptions - structured options used to build the system prompt
  //   .customPrompt - exact prompt prefix from --system-prompt, SYSTEM.md, or custom templates
  //   .forceSystemPrompt - optional exact replacement for the complete prompt
  //   .selectedTools - tools currently active in the prompt
  //   .hiddenTools - selected tools whose declarations requests leave out
  //   .toolSnippets - one-line descriptions for each tool
  //   .toolGuidelines - rule bullets keyed by tool name
  //   .promptGuidelines - additional custom rule bullets
  //   .sections - custom XML-wrapped sections keyed by tag name
  //   .appendSystemPrompt - text from --append-system-prompt flags
  //   .cwd - working directory
  //   .contextFiles - AGENTS.md files and other loaded context files
  //   .skills - loaded skills

  return {
    // Inject a persistent message (stored in session, sent to LLM)
    message: {
      customType: "my-extension",
      content: "Additional context for the LLM",
      display: true,
    },
    // Replace the system prompt for this turn (chained across extensions)
    systemPrompt: event.systemPrompt + "\n\nExtra instructions for this turn...",
  };
});
```

A returned `message` is added to either kind of run; check `messageType` to skip runs started by custom messages.

The `systemPromptOptions` field gives extensions access to the same structured data Pi uses to build the system prompt. Collections are mutable. Prefer changing `sections`, `selectedTools`, or `promptGuidelines`: Pi diffs the resulting prompt sections against what the model already has and appends one system message patching only the changed sections. Returning `systemPrompt`, or setting `forceSystemPrompt`, replaces the whole prompt for the run: every provider receives the forced text as its leading system prompt (a cache miss when it changes), and the session transcript keeps recording the structured sections. Tool selection changes update both the prompt contributions and executable provider tools; calling `pi.setActiveTools()` inside the handler has the same effect as editing `selectedTools`. Models that accept system messages mid-conversation receive the patch in place and keep their cached prefix; other models get the replayed prompt as their system prompt, which is a cache miss once per change.

Inside `before_agent_start`, `event.systemPrompt` and `ctx.getSystemPrompt()` both reflect the chained system prompt as of the current handler. Later `before_agent_start` handlers can still modify it again.

#### agent_start / agent_end / agent_before_settle / agent_settled

`agent_start` fires when a low-level agent run begins. `agent_end` fires when that run ends, but Pi may still auto-retry, auto-compact and retry, or continue with queued follow-up messages. `agent_before_settle` is the final actionable boundary: it can append session entries and request one continuation. `agent_settled` is final and notification-only; use it for status integrations that need to know Pi will not continue running automatically.

```
pi.on("agent_start", async (_event, ctx) => {});

pi.on("agent_end", async (event, ctx) => {
  // event.messages - messages from this low-level run
});

let addedReviewReminder = false;
pi.on("agent_before_settle", async (event, ctx) => {
  if (addedReviewReminder) return;
  addedReviewReminder = true;
  return {
    entries: [...event.entries, {
      type: "custom_message",
      customType: "review-reminder",
      content: "Review the final diff before replying.",
      display: false,
    }],
    continue: true,
  };
});

pi.on("agent_settled", async (event, ctx) => {
  // event.aborted - true when the run ended because it was aborted, for example with Escape
  // ctx.isIdle() is true; runs requested here start after all settled handlers finish.
});
```

If the run is aborted while `agent_before_settle` handlers are running, valid returned entries are still committed, but requested continuation is suppressed. Work requested from `agent_settled` is deferred until every settled handler completes, so notification dispatch is non-reentrant.

#### ui_prompt_start / ui_prompt_end

Notification-only lifecycle events for blocking user-facing extension UI prompts. They fire around `ctx.ui.select()`, `ctx.ui.confirm()`, `ctx.ui.input()`, `ctx.ui.editor()`, and `ctx.ui.custom()` so host/status integrations can report "waiting for user" instead of just "running".

Nested or overlapping prompts are coalesced into one outer waiting span. Handlers are invoked best-effort and are not awaited before showing or closing the prompt.

```
pi.on("ui_prompt_start", async (event, ctx) => {
  // event.reason === "ui_prompt"
  // event.kind: "select" | "confirm" | "input" | "editor" | "custom"
  // event.title: prompt title when available
});

pi.on("ui_prompt_end", async (event, ctx) => {
  // Pi is no longer waiting on that UI prompt span.
});
```

#### turn_start / turn_end

Fired for each turn (one LLM response + tool calls).

```
pi.on("turn_start", async (event, ctx) => {
  // event.turnIndex, event.timestamp
});

let replacedResponse = false;
pi.on("turn_end", async (event, ctx) => {
  // event.turnIndex, event.message, event.toolResults
  // event.entries contains the structural entries proposed so far.
  if (replacedResponse || event.outcome !== "completed" || event.toolResults.length > 0) return;
  replacedResponse = true;
  return {
    entries: [
      ...event.entries,
      { type: "context_edit", targetId: event.messageEntryId, replacement: null },
      {
        type: "custom_message",
        customType: "replacement-instruction",
        content: "Answer again using the persisted user request.",
        display: false,
      },
    ],
    continue: true,
  };
});
```

`turn_end` runs after the assistant and tool-result messages have been persisted and before the low-level `turn_end` event. Retry backoff and final-attempt recovery still happen after `agent_end`, preserving their existing lifecycle and queue ordering; `agent_before_settle` sees the repaired projection after that work completes. Boundary handlers run in extension load and registration order. Each handler sees prior proposals in `event.entries` and sees `event.context` rebuilt from them. Returning `entries` or `continue` replaces only that field; omitted fields preserve the current proposal. Allowed draft entry types are `custom`, `custom_message`, `context_edit`, and `compaction`. The complete proposal is validated before it is appended in list order after all handlers finish; a handler error is reported and later handlers still run. Validation prevents partially applied semantic errors, but persistence is not transactional.

`continue: true` ensures one next provider request for that boundary invocation. If tool results, steering, or a follow-up already cause that request, they satisfy the decision and no additional request is made; otherwise Pi makes one context-only request. Error and aborted responses remain hard exits. `continue: false` never suppresses natural work. Guard continuation conditions: an unconditional `continue: true` is evaluated again after the next response and can create an endless loop. A `custom_message` draft contributes a user-role model message but is extension-authored: it does not run human input hooks, slash commands, skills, or prompt templates.

Host integrations that construct `TurnEndEvent` values must provide `messageEntryId`, `toolResultEntryIds`, `outcome`, `entries`, `continue`, and `context`. `ExtensionEvent` exhaustive switches must also handle `agent_before_settle`. `ExtensionRunner.emit()` excludes actionable turn boundaries; dispatch `turn_end` and `agent_before_settle` through `emitBoundary(baseEvent, buildContext)` so handlers receive chained previews. Other dedicated runner methods still return results for events such as `session_before_*`.

#### message_start / message_update / message_end

Fired for message lifecycle updates.

- `message_start` and `message_end` fire for every message, including user, assistant, tool-result, and custom messages.
- `message_update` fires for assistant streaming updates.
- `message_end` handlers can return `{ message }` to replace the finalized message. The replacement must keep the same `role`.

```
pi.on("message_start", async (event, ctx) => {
  // event.message
});

pi.on("message_update", async (event, ctx) => {
  // event.message
  // event.assistantMessageEvent (token-by-token stream event)
});

pi.on("message_end", async (event, ctx) => {
  if (event.message.role !== "assistant") return;

  return {
    message: {
      ...event.message,
      usage: {
        ...event.message.usage,
        cost: {
          ...event.message.usage.cost,
          total: 0.123,
        },
      },
    },
  };
});
```

#### tool_execution_start / tool_execution_update / tool_execution_end

Fired for tool execution lifecycle updates.

In parallel tool mode:

- `tool_execution_start` is emitted in assistant source order during the preflight phase
- `tool_execution_update` events may interleave across tools
- `tool_execution_end` is emitted in tool completion order after each tool is finalized
- final `toolResult` message events are still emitted later in assistant source order

```
pi.on("tool_execution_start", async (event, ctx) => {
  // event.toolCallId, event.toolName, event.args
});

pi.on("tool_execution_update", async (event, ctx) => {
  // event.toolCallId, event.toolName, event.args, event.partialResult
});

pi.on("tool_execution_end", async (event, ctx) => {
  // event.toolCallId, event.toolName, event.result, event.isError
  // event.durationMs - milliseconds execute() took; absent when the tool did not run
});
```

All three events, `tool_call`, and `tool_result` carry `parentToolCallId` when another tool made the call; see Calling Other Tools.

#### context

Fired before each LLM call. Modify messages non-destructively. See [Session Format](https://pi.dev/latest/session-format) for message types.

```
pi.on("context", async (event, ctx) => {
  // event.messages - deep copy without system messages, safe to modify
  const filtered = event.messages.filter(m => !shouldPrune(m));
  return { messages: filtered };
});
```

`event.messages` holds the conversation without system messages. The prompt and tool declarations belong to Pi and are not part of this hook: when the handler returns a changed list, Pi replays the current prompt sections and tool declarations into one leading system message ahead of the returned messages. Filtering, windowing, or slicing from a compaction summary therefore cannot drop the prompt or the tools. An unchanged list keeps mid-conversation system messages in place, so models that accept them retain their cached prefix. System messages a handler adds are kept after Pi's head. To change the prompt or the tool set durably, use `before_agent_start` or `pi.setActiveTools()`; to edit system messages for one request, use `context_with_system`.

#### context_with_system

Fired before each LLM call, after every `context` handler has run and Pi has restored the prompt and tool state. `event.messages` is the full transcript, including the leading system message and any mid-conversation prompt or tool patches (see [Session Format](https://pi.dev/latest/session-format#sessionmessageentry)). The returned messages are sent as they are: this hook owns the prompt and tool declarations for the request.

```
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";

pi.on("context_with_system", async (event, ctx) => {
  const cut = findCutIndex(event.messages);
  // Fold the dropped prefix so its prompt and tool state survives as the new head.
  const head = getCurrentSystemMessage(event.messages.slice(0, cut));
  return { messages: head ? [head, ...event.messages.slice(cut)] : event.messages.slice(cut) };
});
```

Rules: keep a system message at index 0 (providers read the prompt and initial tool declarations there; Pi reports an error if a handler drops it). Removing a system message removes the tool declarations and section patches it carries. Check your output with `getCurrentSystemPrompt()` and `getCurrentTools()` from `@earendil-works/pi-ai`. Handlers run in extension load order; a `systemPrompt` forced from `before_agent_start` is still projected onto the request afterwards.

#### before_provider_headers

Fired after the outgoing HTTP headers are assembled. Use it to add, override, or remove request headers.

Handlers mutate `event.headers` in place. Set a key to a string to add or override it, or to `null` to delete it.

```
pi.on("before_provider_headers", (event, ctx) => {
  // Add or override — e.g. a session id for gateway tracing/attribution
  event.headers["x-session-id"] = ctx.sessionManager.getSessionId();

  // Drop a tracking header pi adds for this call
  event.headers["X-OpenRouter-Title"] = null;
});
```

Runs once per provider request; retries reuse the same headers rather than re-firing the hook.

#### before_provider_request

Fired after the provider-specific payload is built, right before the request is sent. Handlers run in extension load order. Returning `undefined` keeps the payload unchanged. Returning any other value replaces the payload for later handlers and for the actual request.

This hook can rewrite provider-level system instructions or remove them entirely. Those payload-level changes are not reflected by `ctx.getSystemPrompt()`, which reports Pi's system prompt string rather than the final serialized provider payload.

```
pi.on("before_provider_request", (event, ctx) => {
  console.log(JSON.stringify(event.payload, null, 2));

  // Optional: replace payload
  // return { ...event.payload, temperature: 0 };
});
```

This is mainly useful for debugging provider serialization and cache behavior.

The payload is the full request. Providers that continue from a previous response (OpenAI Codex over WebSocket, Anthropic message threads) may send only the part that is new since the previous request.

#### after_provider_response

Fired after an HTTP response is received and before its stream body is consumed. Handlers run in extension load order.

```
pi.on("after_provider_response", (event, ctx) => {
  // event.status - HTTP status code
  // event.headers - normalized response headers
  if (event.status === 429) {
    console.log("rate limited", event.headers["retry-after"]);
  }
});
```

Header availability depends on provider and transport. Providers that abstract HTTP responses may not expose headers.

#### provider_stream_event

Fired for each parsed provider stream event before Pi normalizes it. Notification-only and not persisted.

```
pi.on("provider_stream_event", (event, ctx) => {
  // event.provider, event.api, event.model
  // event.data - earliest structured value available to Pi (read-only)
});
```

`event.data` is not necessarily the original HTTP bytes or SSE frame. Treat it as read-only because mutation can affect normalization. Handlers are awaited in stream order, so slow handlers delay stream consumption. Handler errors are reported without changing the provider response. See [`debug-provider.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/debug-provider.ts) for an opt-in viewer that groups raw events by assistant message.

#### cache_warming_decision

Fired before each prompt-cache refresh with Pi's decision filled in. The event carries only Pi's cost estimates; use `ctx.model`, `ctx.isIdle()`, and `ctx.getContextUsage()` for everything else.

```
pi.on("cache_warming_decision", (event, ctx) => {
  // event.warmCost: price of this refresh
  // event.missCost: extra price of the next request if the entry is lost
  // event.continuationProbability: pi's estimate that a request arrives in time
  // event.action: "warm" | "stop", pi's decision

  if (ctx.model?.provider === "my-provider") {
    return { action: "stop" };
  }
});
```

Return `{ action: "warm" }` or `{ action: "stop" }` to override; the last handler that returns an action wins. `"stop"` ends warming until the next real request.

### Model Events

#### model_select

Fired when the model changes via `/model` command, model cycling (`Ctrl+P`), or `pi.setModel()`. Restoring a session does not fire it; read `ctx.model` in `session_start` to initialize model-dependent state.

```
pi.on("model_select", async (event, ctx) => {
  // event.model - newly selected model
  // event.previousModel - previous model (undefined if first selection)
  // event.source - "set" | "cycle"

  const prev = event.previousModel
    ? `${event.previousModel.provider}/${event.previousModel.id}`
    : "none";
  const next = `${event.model.provider}/${event.model.id}`;

  ctx.ui.notify(`Model changed (${event.source}): ${prev} -> ${next}`, "info");
});
```

Use this to update UI elements (status bars, footers) or perform model-specific initialization when the active model changes.

#### thinking_level_select

Fired when the thinking level changes. This is notification-only; handler return values are ignored.

```
pi.on("thinking_level_select", async (event, ctx) => {
  // event.level - newly selected thinking level
  // event.previousLevel - previous thinking level

  ctx.ui.setStatus("thinking", `thinking: ${event.level}`);
});
```

Use this to update extension UI when `pi.setThinkingLevel()`, model changes, or built-in thinking-level controls change the active thinking level.

### Tool Events

#### tool_call

Fired after `tool_execution_start`, before the tool executes. **Can block.** Use `isToolCallEventType` to narrow and get typed inputs.

Before `tool_call` runs, Pi waits for previously emitted Agent events to finish draining through `AgentSession`. This means `ctx.sessionManager` is up to date through the current assistant tool-calling message.

In the default parallel tool execution mode, sibling tool calls from the same assistant message are preflighted sequentially, then executed concurrently. `tool_call` is not guaranteed to see sibling tool results from that same assistant message in `ctx.sessionManager`.

`event.input` is mutable. Mutate it in place to patch tool arguments before execution.

Behavior guarantees:

- Mutations to `event.input` affect the actual tool execution
- Later `tool_call` handlers see mutations made by earlier handlers
- No re-validation is performed after your mutation
- Return values from `tool_call` control blocking via `{ block: true, reason?: string, terminate?: boolean }`
- `terminate` only applies to a blocked call; the agent stops early only when every finalized result in the batch is terminating

```
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

pi.on("tool_call", async (event, ctx) => {
  // event.toolName - "bash", "read", "write", "edit", etc.
  // event.toolCallId
  // event.input - tool parameters (mutable)

  // Built-in tools: no type params needed
  if (isToolCallEventType("bash", event)) {
    // event.input is { command: string; timeout?: number }
    event.input.command = `source ~/.profile\n${event.input.command}`;

    if (event.input.command.includes("rm -rf")) {
      return { block: true, reason: "Dangerous command", terminate: true };
    }
  }

  if (isToolCallEventType("read", event)) {
    // event.input is { path: string; offset?: number; limit?: number }
    console.log(`Reading: ${event.input.path}`);
  }
});
```

#### Typing custom tool input

Custom tools should export their input type:

```
// my-tool.ts
import { type Static, Type } from "typebox";

export const myToolSchema = Type.Object({ action: Type.String() });
export type MyToolInput = Static<typeof myToolSchema>;
```

Use `isToolCallEventType` with explicit type parameters:

```
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { MyToolInput } from "./my-tool.ts";

pi.on("tool_call", (event) => {
  if (isToolCallEventType<"my_tool", MyToolInput>("my_tool", event)) {
    event.input.action;  // typed
  }
});
```

#### tool_result

Fired after tool execution finishes and before `tool_execution_end` plus the final tool result message events are emitted. **Can modify result.**

In parallel tool mode, `tool_result` and `tool_execution_end` may interleave in tool completion order, while final `toolResult` message events are still emitted later in assistant source order.

`tool_result` handlers chain like middleware:

- Handlers run in extension load order
- Each handler sees the latest result after previous handler changes
- Handlers can return partial patches (`content`, `details`, `structuredContent`, `isError`, or `usage`); omitted fields keep their current values
- Replacing `content` without returning `structuredContent` drops the structured content, because it may no longer match

Use `ctx.signal` for nested async work inside the handler. This lets Esc cancel model calls, `fetch()`, and other abort-aware operations started by the extension.

```
import { isBashToolResult } from "@earendil-works/pi-coding-agent";

pi.on("tool_result", async (event, ctx) => {
  // event.toolName, event.toolCallId, event.input, event.parentToolCallId
  // event.content, event.details, event.structuredContent, event.isError, event.usage

  if (isBashToolResult(event)) {
    // event.details is typed as BashToolDetails
  }

  const response = await fetch("https://example.com/summarize", {
    method: "POST",
    body: JSON.stringify({ content: event.content }),
    signal: ctx.signal,
  });

  // Modify result:
  return { content: [...], details: {...}, isError: false, usage: nestedModelUsage };
});
```

### User Bash Events

#### user_bash

Fired when user executes `!` or `!!` commands. **Can intercept.**

```
import { createLocalBashOperations } from "@earendil-works/pi-coding-agent";

pi.on("user_bash", (event, ctx) => {
  // event.command - the bash command
  // event.excludeFromContext - true if !! prefix
  // event.cwd - working directory

  // Option 1: Provide custom operations (e.g., SSH)
  return { operations: remoteBashOps };

  // Option 2: Wrap pi's built-in local bash backend
  const local = createLocalBashOperations();
  return {
    operations: {
      exec(command, cwd, options) {
        return local.exec(`source ~/.profile\n${command}`, cwd, options);
      }
    }
  };

  // Option 3: Full replacement - return result directly
  return { result: { output: "...", exitCode: 0, cancelled: false, truncated: false } };
});
```

Returning `undefined` continues to the next handler, then local execution if none handles the event. A valid result stops propagation: `operations` executes the command through the supplied backend, while `result` records the completed command without executing it.

### Input Events

#### input

Fired when user input is received, after extension commands are checked but before skill and template expansion. The event sees the raw input text, so `/skill:foo` and `/template` are not yet expanded.

**Processing order:**

1. Extension commands (`/cmd`) checked first - if found, handler runs and input event is skipped. Messages from `pi.sendUserMessage()` are checked only with `expandPromptTemplates: true`.
2. `input` event fires - can intercept, transform, or handle
3. If not handled: skill commands (`/skill:name`) expanded to skill content
4. If not handled: prompt templates (`/template`) expanded to template cont...