# yum-pi 🥧

A minimal batteries pack for the [Pi coding agent](https://pi.dev). Not a fork of pi: a Pi *package* that installs into the standard `~/.pi/agent` config and rides `pi update`.

## What's in the box

- **guardrails** extension — deterministic, headless-safe blocks:
  - `git push` to `main`/`master` is blocked. Feature branch + PR, always.
  - file writes outside the working directory are blocked (except `~/.pi/agent` and the system temp dir).
- **prompts** — `/pr` (branch, commit, open a PR) and `/sync-dotfiles` (sync dirty pi config from `~/dotfiles` back to the repo via branch + PR).
- **c22-dark** theme — deep black `#0a0a0f`, electric blue and violet accents.

## Install

```
pi install git:github.com/swapkats/yum-pi
```

Then set `"theme": "c22-dark"` in `~/.pi/agent/settings.json` if you want the look.

## Design rules

- No forks, no new binaries, no runtime dependencies. yum-pi is extensions, prompts, and a theme inside the standard pi config.
- Guardrails block deterministically instead of asking for confirmation, so unattended `pi -p` runs behave identically to interactive ones.
- Scope stays at what the workflow actually uses. If a feature is worth adding, it earns its line in `SPEC.md` first.

Spec lives in [SPEC.md](SPEC.md).
