# yum-pi spec v0.1

yum-pi: a minimal batteries pack for pi (pi.dev). It is a Pi *package*, not a fork: it installs into the existing `~/.pi/agent` config and rides `pi update`. No runtime dependencies, no new binaries, no subagents, no LSP. Keep v0.1 small and readable; total extension code well under ~150 lines.

Reference material: `docs/extensions.md` (full extension API), `docs/confirm-destructive.ts` and `docs/dirty-repo-guard.ts` (official guardrail patterns), `docs/themes.md` (theme JSON format). Read them before writing code and follow their APIs exactly.

## extensions/guardrails.ts

Deterministic `tool_call` interception. **No interactive confirmation anywhere** (no `ctx.ui.confirm`): the same extension must behave identically in interactive TUI mode and in headless `pi -p` print mode, where there is no one to answer a prompt.

Rules, in this order:

1. **bash block**: if the command is a `git push` whose arguments reference `main` or `master` (covers `git push origin main`, `git push origin HEAD:master`, `git push --force origin main`, etc.), return `{ block: true, reason: "yum-pi guardrail: pushes to main/master are blocked. Use a feature branch and open a PR instead." }`.
2. **write/edit block**: if the target file path of a `write` or `edit` tool call resolves outside the session's working directory, block with reason: `"yum-pi guardrail: file writes are limited to the working directory."`. Allowlist (never block): paths under `~/.pi/agent` (pi's own config) and the system temp dir.

When blocking, also call `ctx.ui.notify("yum-pi blocked: <short reason>", "warning")` so interactive users see it. Block nothing else. Use the typed helpers from the docs (e.g. `isToolCallEventType`). Make the main/master regex tolerant of flag positions (`--force`, `-f`, `--tags`) but do not try to resolve the current branch; v0.1 only matches explicit main/master refs in the push arguments.

## prompts/pr.md

Frontmatter: `description: "Branch, commit, and open a PR (never push to main)"`. Body instructs the agent to: inspect git status and recent commits; ensure work is on a feature branch (create one with a `feat/` or `fix/` prefix if currently on main or master); stage the relevant files; write conventional commit messages; run the project's checks quickly if they exist and are fast; push with `git push -u origin HEAD`; create the PR with `gh pr create` including a summary and test plan; report the PR URL. End with: never push directly to main or master.

## prompts/sync-dotfiles.md

Frontmatter: `description: "Sync dirty pi config in ~/dotfiles back to the repo via branch + PR"`. Body: check `git status` in `~/dotfiles`; if dirty, create a feature branch, write conventional commit(s), push with `git push -u origin HEAD`, create the PR with `gh pr create`, and report the PR URL. Commit pi's own normalized output (e.g. pretty-printed `settings.json`) as-is rather than reverting it. Never merge or push to master. If the repo is clean, say so and do nothing else.

## themes/c22-dark.json

A custom pi theme named `c22-dark`, following the JSON format in `docs/themes.md`. Aesthetic: deep black background `#0a0a0f`, electric blue primary accent, violet secondary accent, high-contrast body text, WCAG-readable secondary text. Terminal should look like a dark cinematic console, not a rainbow.

## Non-goals

No subagents, no LSP, no debugger, no custom tools, no MCP, no dependencies. Guardrails are deterministic blocks, not confirmation dialogs.
