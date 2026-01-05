---
name: commit-push-deploy
description: Commits code changes, pushes to remote, and deploys to production. Use when the user wants to commit, push, and deploy their changes in one workflow.
---

# Commit, Push, and Deploy

## Instructions

When the user invokes this skill, follow these steps:

### 1. Build first

Run the build to ensure the code compiles without errors before committing:

```bash
cd diffusion-explorer/apps/rectified-flow-explainer && npm run build
```

If the build fails, stop and report the errors to the user.

### 2. Stage and review changes

```bash
git add -A
git status
git diff --staged
```

### 3. Generate commit message and ask for approval

Draft a commit message based on the staged changes. Present the commit message to the user and ask for their approval before proceeding. Use the AskUserQuestion tool to get confirmation.

### 4. Commit

Once approved, commit with the message:

```bash
git commit -m "<approved message>"
```

### 5. Push

Push to the remote repository:

```bash
git push
```

### 6. Deploy

Run the deploy script directly (without rebuilding since we already built in step 1):

```bash
cd diffusion-explorer/apps/rectified-flow-explainer && node scripts/deploy.js
```

This deploys the built files to the production website.

## Notes

- Always build before committing to catch errors early
- Use `node scripts/deploy.js` instead of `npm run deploy` to avoid a redundant rebuild
- The deploy script clones the main website repo, copies the build, and pushes the changes
