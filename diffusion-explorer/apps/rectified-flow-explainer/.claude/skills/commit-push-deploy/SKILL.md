---
name: commit-push-deploy
description: Commit relevant changes, push to remote, and deploy the site. Use when finished with changes and ready to ship.
---

# Commit, Push, and Deploy

## Steps

1. Run `git status` and `git diff` to understand what changed
2. Stage only the relevant files for the current work (avoid unrelated changes)
3. Draft a clear commit message summarizing the changes
4. Ask the user to confirm the commit message before proceeding
5. Create the commit
6. Run `git push` to push to remote
7. Run the /deploy skill to build and deploy the site
