#!/bin/bash
set -e

# Publish ui and diffusion packages to GitHub Packages
# Usage: ./publish_packages.sh <version>
# Example: ./publish_packages.sh 0.2.0

if [ -z "$1" ]; then
  echo "Usage: ./publish_packages.sh <version>"
  echo "Example: ./publish_packages.sh 0.2.0"
  exit 1
fi

VERSION=$1

# Check if GITHUB_TOKEN is set
if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GITHUB_TOKEN environment variable not set"
  echo "Set it with: export GITHUB_TOKEN=<your-github-pat>"
  exit 1
fi

echo "Publishing packages to GitHub Packages..."

# Update version in both package.json files
npm version "$VERSION" --no-git-tag-v --workspaces

# Commit version bump
git add packages/ui/package.json packages/diffusion/package.json
git commit -m "Bump packages to v$VERSION"

# Tag and push
git tag "v$VERSION"
git push origin main --tags

echo "✓ Published v$VERSION"
echo "The GitHub Action will auto-publish to GitHub Packages on the v$VERSION tag."
