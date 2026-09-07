# AGENTS.md — working notes for LLM agents on p2000-chirp

A Bun/TypeScript daemon: polls free P2000 (Dutch emergency services paging)
feeds, deduplicates incidents, filters to user-defined areas, pushes Telegram
bot DMs. Single-user personal tool. Keep it simple — no framework, no build
step, small dependency count on purpose.

## Verification workflow (run before declaring work done)

```bash
bun install                # once
bunx tsc --noEmit         # typecheck — ALWAYS run after any code change
bun test                   # unit tests (43: tz/DST, parsers, filters, config, state)
bun start --dry-run --debug --config config.toml   # live smoke test
```

The unit tests cover the pure logic and a saved p2000alarm fixture; the smoke
test runs against the real feeds (they are always live). For a quick pipeline
check use a permissive config (`postcodes = []`, `keywords = []`, `regions =
[]`) and watch `[debug] cycle:` lines plus `[dry-run]` notifications. The
example config itself is covered by a regression test (it once shipped
broken). Docker: `docker build -t p2000-chirp .` then run with `-e
DRY_RUN=true` and the volume mounts from `docker-compose.yaml`.

## Layout

| Path | Responsibility |
|------|----------------|
| `src/index.ts` | Entry point: poll loop, bootstrap, dedupe wiring, notification formatting, logging policy |
| `src/config.ts` | TOML loading + validation (`config.toml`; knobs in `config.example.toml`) |
| `src/feed.ts` | `P2000Item` type, source-type dispatch |
| `src/sources/rss.ts` | Berkel-Enschot RSS adapter |
| `src/sources/p2000alarm.ts` | p2000alarm monitor-backend adapter |
| `src/filter.ts` | Area (OR across axes) + discipline (AND) matching, discipline inference, message/sequence utils |
| `src/schedule.ts` | Poll pacing math: per-source interval (stagger x N, 15s floor), 1-3s jitter, exponential backoff (10 min cap) |
| `src/state.ts` | Persistent seen-store: message text → ts, trailing sequence → ts |
| `src/tz.ts` | Europe/Amsterdam wall-clock → UTC parsing (DST-correct, null on garbage) |
| `src/telegram.ts` | sendMessage call (timeout, 429 retry_after, token redaction) |
| `src/test/` | bun test suite: tz, filter, config (incl. example-config regression), state, source parsers |

Adding a feed type = implement `async function(url): Promise<P2000Item[]>` in
`src/sources/`, add the type to `SourceType` and the dispatch in `feed.ts`,
and to `SOURCE_TYPES` in `config.ts`.

## Hard-won feed knowledge (do not re-derive, do not assume)

- **Berkel-Enschot RSS** (`p2000.brandweer-berkel-enschot.nl/homeassistant/rss.asp`):
  - `?regio=` and similar params are IGNORED server-side — the feed is always
    national. All filtering is client-side, by design here.
  - pubDates are NL wall-clock strings labeled `+0100` year-round, which is
    wrong under CEST. Re-interpret the wall clock via `parseWallAmsterdam`
    (see `rss.ts`). Never `new Date(pubDate)` directly.
  - One incident = multiple items (several capcodes + a `Gereserveerd` copy
    with the same message/timestamp). ~75% of items carry lat/lon; some
    coordinates are garbage (other continents) — harmless for radius checks.
  - Politie items usually have empty `RegName`/`Dienst` fields — but so do
    some brandweer copies. See "Discipline protocol facts" below before
    touching inference.

**Discipline protocol facts (verified empirically 2026-09 — do not trust the
naive A/B/P mapping):**

- The source metadata is authoritative when present: RSS `Dienst`
  ("Ambulancediensten"/"Brandweerdiensten"/"Politiediensten") and the
  p2000alarm `pDis[A|B|P|N]` class (`B` = Brandweer there!). Inference from
  the message prefix is only a fallback for empty/`Gereserveerd` metadata.
- Message-prefix fallback meanings, verified against both live feeds:
  `A1/A2` = Ambulance (spoed), `B1/B2` = **Ambulance** B-rit (geen spoed,
  e.g. "B2 AMBU 17205 … bon 138437" — NOT brandweer), `P 1/P 2` =
  **Brandweer** prioriteitsmelding (e.g. "P 2 BDH-02 BR container" is
  p2000alarm-class Brandweer — NOT politie). Politie messages carry NO
  letter prefix ("Aanrijding letsel …", "… ICnum 528309"); the word "Prio"
  is also not a prefix match.
- The `N` class/prefix is ambiguous: likely the "Groepsoproep" (group-call)
  copies rather than KNRM; harmless because those copies dedupe against the
  discipline-labeled originals.
- **p2000alarm backend** (`monitor.p2000alarm.nl/ReadMonitor.php`):
  - Requires a `Referer: <origin>/` header or returns `Error 36`. No cookies
    needed. Region/discipline query params are not applied server-side (their
    monitor filters client-side) — just fetch `?LastID=0` and filter locally.
  - Response: `<M>`-separated records, sections split by `<D>`; the whole
    thing is HTML fragments, not JSON. Message text is in
    `class="cell pDis[A|B|P|N]"` (A=Ambulance, B=Brandweer, P=Politie,
    N=KNRM), datetime in `class="cell pDate vm"` as `DD-MM-YYYY HH:MM:SS`
    Europe/Amsterdam wall clock, capcode descriptions in
    `class="pOms<X> dl"`.
  - Region spelling differs from Berkel (`Amsterdam-Amstelland` vs
    `Amsterdam Amstelland`) — region matching normalizes case/hyphens/spaces
    and matches by substring. No lat/lon in this source.
- **Dedupe design**: identity is message TEXT + trailing sequence number
  (5+ digits) within a time window, NOT timestamps — mirrors stamp times
  differently and radio frames arrive corrupted (same `bon 138437`, garbled
  text). The window (default 3600 s) must EXCEED how long a feed retains old
  items (~15–25 min for these sources), or retained items re-notify every
  window; genuinely new dispatches still pass because their trailing
  bon/rit/sequence numbers differ. Do not "fix" dedupe to use timestamps; it
  was tried and it double-notifies.
- Dead/gated sources (surveyed 2026-09): livep2000 RSS defunct since 2021;
  112-nu RSS requires an account; p2000-online.net is 1.5–2 min delayed. No
  official API, no websockets exist.

## Privacy rules (binding)

- `config.toml`, `.env`, `state/` are the owner's PERSONAL files — never
  commit them, never log their contents (bot token especially).
- The repo must stay generic: when touching `config.example.toml`, README
  examples or docs, use neutral sample values (e.g. Utrecht postcodes/coords)
  — never the owner's actual postcodes, coordinates or neighborhood names.
- Notification payloads contain incident addresses; logs only carry message
  text already present in public feeds. Keep it that way.

## Logging policy

Quiet by default: one startup line, one line per delivered notification,
one-time warnings (stale feed, per-source failure with recovery logging).
`--debug` / `DEBUG=true` adds per-cycle item counts. Do not add per-cycle
logging to the default path.

## Git workflow

After changes: run `bunx tsc --noEmit`, smoke-test if feasible, then commit
with a concise conventional message. Push to the remote when the user asks
(or immediately after committing, if a remote is configured and the user has
asked for push in the session). Never commit `config.toml`, `.env`,
`state/`, or anything containing the owner's personal data — verify with
`git status` / `git diff --cached` before committing.

Releases: cut one when changes land on `main` — `scripts/release.sh vX.Y.Z`
verifies, bumps `package.json`, commits, creates an annotated tag, pushes,
waits for CI and publishes the GitHub release. Major = breaking
config/state/CLI changes, minor = features, patch = fixes. Never move a
published tag. See CLAUDE.md for the agent-facing summary.
