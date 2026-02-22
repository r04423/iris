---
name: release
description: Bump package version, commit, tag, and push to trigger npm publish.
user-invokable: true
argument-hint: "<patch|minor|major|x.y.z>"
---

Bump the version of iris-ecs, commit, tag, and push to trigger the publish workflow.

## Steps

1. Read the current version from `packages/ecs/package.json`
2. Determine the new version from `$ARGUMENTS`:
   - `patch`, `minor`, `major` — increment the corresponding semver segment
   - `x.y.z` — use the exact version provided
   - If no argument, ask the user which bump type they want
3. Update the `version` field in `packages/ecs/package.json`
4. Stage, commit, tag, and push:
   ```
   git add packages/ecs/package.json
   git commit -m "Release v<new-version>"
   git tag -a v<new-version> -m "v<new-version>"
   git push origin main --follow-tags
   ```
5. Confirm the tag was pushed and the publish workflow will be triggered
