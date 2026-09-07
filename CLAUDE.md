# CLAUDE.md

Guidance for Claude Code (and any other agent) working in this repository.

**Read [AGENTS.md](AGENTS.md) first** — it holds the project conventions, the
verification workflow, the hard-won P2000 feed protocol facts and the binding
privacy rules. Do not re-derive feed behavior from assumptions.

After any change: run `bun run typecheck` and `bun test`; run a live
`bun start --dry-run --debug --config config.toml` smoke test when feasible
(the feeds are always live). Keep the logging policy (quiet by default,
`--debug`/`DEBUG=true` for per-cycle counts).

## Releasing

When a change is complete, make a release — do not leave unreleased work
stacking up on `main`:

```bash
scripts/release.sh vX.Y.Z
```

The script verifies (typecheck + tests), bumps `package.json`, commits
`chore: release vX.Y.Z`, creates an **annotated** tag, pushes, waits for CI
to pass on the exact release commit, and publishes the GitHub release with
generated notes.

- Versioning: **major** for breaking config/state/CLI changes, **minor** for
  features or behavior changes, **patch** for fixes and internals.
- Never move or re-point a published tag — cut a new version instead.
