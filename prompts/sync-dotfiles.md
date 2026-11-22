---
description: "Sync dirty pi config from the dotfiles clone back to the repo via branch + PR"
---

Sync dirty pi config from the dotfiles clone back to the repo via branch + PR.

1. Resolve the clone location without assuming a path: run `readlink ~/.pi/agent/settings.json`. The result points at the repo's `pi/settings.json`; the repo root is that path's parent directory.
2. Check `git status` in that repo.
3. If the repo is clean, say so and do nothing else.
4. If dirty, create a feature branch for the sync.
5. Write conventional commit message(s) for the pi config changes.
6. Commit pi's own normalized output (e.g. pretty-printed `settings.json`) as-is rather than reverting it.
7. Push with `git push -u origin HEAD`.
8. Create the PR with `gh pr create` and report the PR URL.

Never merge or push to `master`.
