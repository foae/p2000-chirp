#!/usr/bin/env bash
# Release p2000-chirp: verify, bump version, commit, tag, push, wait for CI,
# publish the GitHub release.
#
# Usage: scripts/release.sh vX.Y.Z
set -euo pipefail

repo="foae/p2000-chirp"
tag="${1:-}"

if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: scripts/release.sh vX.Y.Z" >&2
  exit 1
fi
version="${tag#v}"

[[ -z "$(git status --porcelain)" ]] || { echo "working tree not clean — commit first" >&2; exit 1; }
[[ -z "$(git tag -l "$tag")" ]] || { echo "tag $tag already exists — never move a published tag; cut a new version" >&2; exit 1; }

echo "==> verifying"
bun run typecheck
bun test

echo "==> bumping package.json to $version"
bun -e "const fs = require('node:fs'); const p = JSON.parse(fs.readFileSync('package.json','utf8')); p.version = '$version'; fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');"

git add package.json
git commit -m "chore: release $tag"
git tag -a "$tag" -m "p2000-chirp $tag"

echo "==> pushing"
git push origin main
git push origin "$tag"

echo "==> waiting for CI on the release commit"
sleep 10
run_id="$(gh run list --repo "$repo" --branch main --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch --repo "$repo" --exit-status "$run_id"

echo "==> publishing release"
gh release create "$tag" --repo "$repo" --verify-tag --title "p2000-chirp $tag" --generate-notes

echo "==> done: https://github.com/$repo/releases/tag/$tag"
