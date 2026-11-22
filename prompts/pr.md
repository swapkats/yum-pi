---
description: "Branch, commit, and open a PR (never push to main)"
---

Branch, commit, and open a PR for the current work.

1. Inspect `git status` and recent commits (`git log --oneline -8`) to understand the current state.
2. Check the current branch. If on `main` or `master`, create a feature branch first (`feat/<topic>` for features, `fix/<topic>` for fixes).
3. Stage the relevant files and write conventional commit messages (e.g. `feat:`, `fix:`, `docs:`, `chore:`).
4. If the project has checks and they are quick (e.g. `npm test`, `npm run lint`), run them. Skip slow or missing checks.
5. Push with `git push -u origin HEAD`.
6. Create the PR with `gh pr create`, including a summary of the changes and a test plan.
7. Report the PR URL.

Never push directly to `main` or `master`.
