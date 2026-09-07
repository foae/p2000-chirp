# p2000-chirp

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

Requires [Bun](https://bun.sh) 1.3+.

```bash
git clone <this repo> && cd p2000-chirp
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
| `poll_interval_seconds` | Poll interval per cycle (min 5). |
| `stale_after_minutes` | One-time warning when the newest feed item gets older than this. |
| `state_file` | Dedupe state (JSON); survives restarts; mount it in Docker. |
| `prune_hours` | Seen-entries older than this are dropped. |
| `dedupe_window_seconds` | Duplicate-suppression window (default 3600, min 60). Keep it larger than how long feeds retain old items (~15–25 min) — see below. |
| `[[sources]]` | Feed list: `type` = `rss` or `p2000alarm`, plus `url`. |

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

# Wider: a 3-digit prefix covers 3511–3519
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

- **Postcodes** match only when the message text contains a `####XX` postcode
  — many messages don't (e.g.
  `P 2 BDH-02 BR container (Ondergronds) Brueghelstraat 's-Gravenhage`).
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
suppressed when either:

1. the exact message text was already delivered within
   `dedupe_window_seconds` (default 3600), or
2. the message's trailing sequence number (`bon 138437`, `Rit 134293` style
   counters most P2000 messages end with) was already delivered within the
   same window — this catches corrupted retransmissions.

The window, not timestamps, drives dedupe: mirrors stamp times differently,
so text is the only reliable identity. The window must exceed how long the
feeds retain old items (~15–25 min); a genuinely new dispatch still passes
because its trailing sequence number differs. Side effect: a recurring
identical status message (e.g. `Einde vws`) notifies at most once per window.

## Feed landscape (surveyed 2026-09)

| Feed | Type | Latency | Status |
|------|------|---------|--------|
| `p2000.brandweer-berkel-enschot.nl/homeassistant/rss.asp` | RSS | ~10 s | used by default; national; has lat/lon |
| `monitor.p2000alarm.nl/ReadMonitor.php` | custom text protocol | ~10 s | used by default; national; unit descriptions |
| `p2000-online.net` | HTML | 1.5–2 min | not implemented — too slow to matter |
| `112-nu.nl` | RSS | n/a | account-gated (401) |
| `feeds.livep2000.nl` | RSS | — | dead since 2021 |

No official API exists and **no public websocket exists**; the two ~10 s
mirrors above are the practical near-real-time ceiling. (Truly instant would
mean a local RTL-SDR receiver decoding P2000 yourself — hardware, not a feed.)

Adapters live in `src/sources/`; adding a feed type is one function returning
`P2000Item[]`.

## Caveats

- Both feeds are free third-party relays with no SLA. The daemon polls
  through source failures (logging one-time warnings) and warns when the
  feed goes stale.
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

See [AGENTS.md](AGENTS.md) for architecture notes, feed protocol details and
contribution conventions.
