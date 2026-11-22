---
description: "Sync dirty pi config in ~/dotfiles back to the repo via branch + PR"
---

Sync dirty pi config in `~/dotfiles` back to the repo via branch + PR.

1. Check `git status` in `~/dotfiles`.
2. If the repo is clean, say so and do nothing else.
3. If dirty, create a feature branch for the sync.
4. Write conventional commit message(s) for the pi config changes.
5. Commit pi's own normalized output (e.g. pretty-printed `settings.json`) as-is rather than reverting it.
6. Push with `git push -u origin HEAD`.
7. Create the PR with `gh pr create` and report the PR URL.

Never merge or push to `master`.
