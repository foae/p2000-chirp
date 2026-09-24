# p2000-chirp

[![CI](https://github.com/foae/p2000-chirp/actions/workflows/ci.yml/badge.svg)](https://github.com/foae/p2000-chirp/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/foae/p2000-chirp)](https://github.com/foae/p2000-chirp/releases)
[![license: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

Telegram notifications for [P2000](https://en.wikipedia.org/wiki/P2000_(network))
emergency dispatches in your area — lightweight, self-hosted, ~10 seconds
after dispatch.

p2000-chirp polls multiple free P2000 feeds, deduplicates incidents (across
capcodes, mirrors and even corrupted radio retransmissions), filters to the
areas you care about, and pushes a Telegram DM per incident.

- **Near real-time** — consumes the two fastest public mirrors (~10 s latency,
  verified ≤1 s apart from each other), with a second mirror as redundancy.
- **One incident, one notification** — P2000 relays every message under several
  capcodes; p2000-chirp collapses them, cross-mirror duplicates, and garbled
  retransmissions.
- **Flexible area filters** — regions, postcode prefixes, keywords, or a
  lat/lon radius, freely combined.
- **Few moving parts** — Bun + TypeScript, one config file, JSON state,
  no framework, no database.
- **Docker-ready** with persistent state.

## Quickstart (local)

Requires [Bun](https://bun.sh) 1.3+; Docker and CI use Bun 1.4.2.

```bash
git clone https://github.com/foae/p2000-chirp.git && cd p2000-chirp
bun install
cp config.example.toml config.toml   # edit: your areas, postcodes, radius
cp .env.example .env                # edit: your bot token + chat ID
bun start --dry-run --debug         # sanity check: prints instead of sending
bun start                           # go live
```

Get a bot token from [@BotFather](https://t.me/BotFather); message your bot
once, then get your numeric chat ID from e.g. [@userinfobot](https://t.me/userinfobot).

On first start it marks everything currently in the feeds as seen without
notifying — you only receive incidents that happen after startup. Notification
timestamps are Europe/Amsterdam regardless of host timezone.

## Quickstart (Docker)

```bash
docker build -t p2000-chirp .
docker run -d --restart unless-stopped \
  --env-file .env \
  -v "$PWD/config.toml:/app/config.toml:ro" \
  -v p2000-state:/app/state \
  p2000-chirp
```

or with the bundled compose file (same mounts, named volume for state):

```bash
docker compose up -d
```

State (the dedupe memory) lives under `/app/state`; mount it as a volume and
restarts/rebuilds won't re-notify old incidents. The container runs as the
non-root `bun` user. `DRY_RUN=true` and `DEBUG=true` environment variables
mirror the CLI flags.

## Configuration

All knobs live in `config.toml` (see `config.example.toml`; the file is
gitignored — keep your personal areas/coords out of any repo). Secrets go in
`.env`:

```
TELEGRAM_BOT_TOKEN=123456789:replace-with-token-from-botfather
TELEGRAM_CHAT_ID=123456789
```

| Key | Meaning |
|-----|---------|
| `poll_interval_seconds` | Poll pacing: seconds between sources (staggered). A single source is polled at least every 15 s; with N sources each is polled every (this × N) seconds — always with 1–3 s random jitter. Rate-limited sources back off. |
| `stale_after_minutes` | One-time warning when the newest feed item gets older than this. |
| `state_file` | Dedupe state (JSON); survives restarts; mount it in Docker. |
| `prune_hours` | Seen-entries older than this are dropped. |
| `dedupe_window_seconds` | Duplicate-suppression quiet window (default 3600, min 60), refreshed whenever a known duplicate appears in a feed. |
| `[[sources]]` | Feed list: `type` = `rss` (Berkel), `p2000alarm`, or `alarmeringen`, plus `url`. |

### Area filters

Under `[filters]` there are four **area axes** — `regions`, `postcodes`,
`keywords` and `radius` — plus one **discipline axis**.

**Area semantics: any configured axis acts as an independent trigger
(logical OR).** An item passes if at least one configured axis matches it;
empty lists are ignored. Consequence: if you set both `regions` and
`postcodes`, the whole region passes — the postcodes merely widen the net.
**To filter narrowly, leave `regions` empty.**

Recipes, narrow to broad (Utrecht examples — swap in your own):

```toml
[filters]
# One postcode area (3511 = Utrecht centre)
postcodes = ["3511"]

# Wider: a 3-digit prefix covers 3510–3519
postcodes = ["351"]

# Multiple areas of interest — just list them
postcodes = ["3511", "1012"]
```

```toml
# Radius instead / additionally: right-click a point in OpenStreetMap
# or Google Maps to get lat/lon
[filters.radius]
lat = 52.0907
lon = 5.1214
km = 1.5
```

Trade-offs:

- **Postcodes** match digit prefixes in full (`3511AB`, `3511 AB`) or bare
  four-digit (`3511`) postcodes in message text. A `3511` filter includes
  every letter suffix in that area. Bare four-digit numbers are ambiguous:
  an unrelated number equal to your postcode can also match.
  Codes embedded in longer letter/digit tokens (including Unicode letters)
  or underscore-delimited identifiers do not match.
  Messages without a postcode still need another area axis to match.
- **Radius** matches items that carry coordinates — only the RSS source
  provides them (~75 % of its items). Items without coordinates fall through
  to the other axes.
- **Keywords** are plain substring matches on the message text (street or
  place names); you maintain the list.

A robust narrow setup combines axes, since they OR together:

```toml
[filters]
postcodes = ["3511"]
keywords = ["Oudegracht"]

[filters.radius]
lat = 52.0907
lon = 5.1214
km = 1.5
```

`disciplines = ["Brandweer", "Ambulance", "Politie"]` is a hard AND filter on
top of the area filter (add `"KNRM"` if you're coastal); short forms work and
typos are rejected at startup.

## How dedupe works

One incident arrives many times over: the same message is repeated under
several capcodes (plus a `Gereserveerd` copy), each mirror relays it
independently, and POCSAG radio transmissions occasionally arrive corrupted
(`B2 AMBU 1720mdKt$i#3g450L ...` for `B2 AMBU 17205 Kleiweg ...`). An item is
suppressed when any of these holds:

1. the message text, ignoring case and repeated whitespace, is still in the
   dedupe window (`dedupe_window_seconds`, default 3600), or
2. the message's trailing sequence number (`bon 138437`, `Rit 134293` style
   counters most P2000 messages end with) is in the same window — this
   catches corrupted retransmissions, or
3. the message is a strict prefix of one in the same window — this catches
   truncated radio retransmissions, which lose their
   trailing sequence (e.g. `A2 Ambu 08123` for
   `A2 Ambu 08123 DIA Groesbeek Rit 276252`). Deliberately one-directional:
   a longer new dispatch is never suppressed by an earlier short one, so a
   genuinely new dispatch can only be swallowed in the rare case that it is
   itself a truncation of an unrelated recently delivered message.

The window, not dispatch timestamps, drives dedupe: mirrors stamp times
differently. Delivery or bootstrap records an identity; each subsequent
duplicate observation refreshes it, including across restarts. Retained
snapshots therefore cannot re-notify hourly (Alarmeringen can retain items
for hours). The identity expires after a full window without observation;
outages longer than that can allow old items through again. A genuinely new
dispatch still passes when its text and sequence differ. Identical recurring
status messages (e.g. `Einde vws`) remain suppressed while continuously present.
Concurrent deliveries use the same text, sequence and one-directional prefix
checks against in-flight messages; failed sends remain retryable.

Existing saved message keys are normalized on load, keeping the newest
timestamp when keys collapse. Notification text and source bootstrap markers
are preserved.

## Feed landscape (surveyed 2026-09)

| Feed | Type | Latency | Status |
|------|------|---------|--------|
| `p2000.brandweer-berkel-enschot.nl/homeassistant/rss.asp` | RSS | ~10 s | used by default; national; has lat/lon |
| `monitor.p2000alarm.nl/ReadMonitor.php` | custom text protocol | ~10 s | used by default; national; unit descriptions |
| `alarmeringen.nl/feeds/all.rss` | RSS | not measured | used by default; national; raw dispatch titles; no coordinates |
| `p2000-online.net` | HTML | 1.5–2 min | not implemented — too slow to matter |
| `112-nu.nl` | RSS | n/a | account-gated (401) |
| `feeds.livep2000.nl` | RSS | — | dead since 2021 |

Alarmeringen preserves dispatch text in RSS titles but lowercases it. Its
timestamps carry real UTC offsets (unlike Berkel's mislabeled timestamps).
Discipline comes from the description's service label, falling back to message
prefixes. It supplies no region metadata or coordinates, so configure postcodes
or keywords to match its items. Notifications include the original item link
and attribution under its [CC BY-NC-ND 3.0 terms](https://alarmeringen.nl/webfeeds.html).
The provider's receiver independence and delivery latency are unverified.

Other documented options include [Zwaailicht's free API](https://zwaailicht.nl/api)
(own receiver, but rewritten text unsuitable for our cross-source dedupe) and
[AlarmeringenP2000's paid API](https://alarmeringenp2000.nl/developers).
These are not implemented. Do not infer delivery latency from snapshot age.

Adapters live in `src/sources/`; adding a feed type is one function returning
`P2000Item[]`.

## Caveats

- The feeds are free third-party relays with no SLA. Sources are polled on
  staggered, jittered slot schedules (one slot per source, never shared);
  failing sources back off exponentially (capped at 10 minutes) and HTTP
  429s are honored via `Retry-After` (also capped at 10 minutes), so the
  daemon stays a polite client even when a mirror is struggling. The daemon
  warns when a feed goes stale.
- Politie items often carry no region metadata; discipline is taken from the
  source's own classification when available (RSS `Dienst` field /
  p2000alarm record class) and otherwise inferred from the message prefix —
  `A1/A2` and `B1/B2` are ambulance priorities (B = geen-spoed rit), `P 1`/
  `P 2` are brandweer priority alerts, politie messages carry no letter
  prefix. Region-less items still match via postcodes/keywords/radius.
- P2000 is the paging layer — it does not represent every incident or police
  operation.
- Messages contain incident addresses (and, for ambulances,
  medical-adjacent text). This is a personal-notification tool; don't
  republish its output.

## Development

```bash
bunx tsc --noEmit                       # typecheck
bun test                                # unit tests (tz/DST, parsers, filters, config, state)
bun start --dry-run --debug --config config.toml
```

Releases are cut with `scripts/release.sh vX.Y.Z` (verify → version bump →
annotated tag → CI → GitHub release); see [CLAUDE.md](CLAUDE.md) for the
versioning policy.

See [AGENTS.md](AGENTS.md) for architecture notes, feed protocol details and
contribution conventions.

## License

[MIT](./LICENSE) — feeds are third-party relays with no SLA; the software
comes without any warranty.
