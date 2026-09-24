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
`keywords` and `radius` — plus discipline and service-specific code filters.

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

### Ambulance-code filters

```toml
[filters]
disciplines = ["Brandweer", "Ambulance", "Politie"]
ambulance_codes = ["A0", "A1", "A2", "DIA"]
```

These are the defaults when `ambulance_codes` is omitted, including in an
existing config. **v2 migration:** set `ambulance_codes = []` to retain the old
behavior of accepting ambulance messages regardless of code.

Selected codes match with **OR**: an A0, A1 or A2 dispatch passes without DIA;
a DIA dispatch passes without one of those priorities. An A2 VWS relocation
therefore also passes. Ordinary B1/B2 transport without DIA is excluded by
default. Matching is case-insensitive and uses complete tokens, not substrings.
Unknown ambulance codes do not pass a nonempty selection.

This restriction applies **only to items classified as Ambulance**. Police,
firefighters and other disciplines are unaffected by this filter. Every item
must still pass the existing area and discipline filters. Code filtering cannot
recover incidents absent from the public feeds, or missing geographic data.

Each entry accepts either a code or its meaning name from the table below,
e.g. `ambulance_codes = ["emergency", "direct-dispatch"]`. Unknown entries fail
at startup rather than silently suppressing notifications.

### Dispatch-code meanings

Notifications explain recognized codes in Dutch, alongside the unaltered
dispatch text and source attribution. Explanations never change dedupe identity.
Source discipline metadata takes precedence over message prefixes;
`B1/B2` are ambulance codes, while `P 1/P 2` are firefighter priorities.

| Code | Meaning name for filtering | Explanation |
|------|----------------------------|-------------|
| A0 | `highest-urgency` | Highest urgency: immediate response with the greatest possible urgency. |
| A1 | `emergency` | Emergency response: vital functions may be threatened. |
| A2 | `urgent` | Urgent response, without established immediate danger to life. Not routine transport. |
| B1 | `high-complexity-transport` | Non-emergency transport requiring high-complexity care. |
| B2 | `medium-low-complexity-transport` | Non-emergency transport requiring medium/low-complexity care. |
| DIA | `direct-dispatch` | Directe Inzet Ambulance: dispatched while the caller is still being questioned; the response may later be cancelled or changed. `Directe inzet: ja` is recognized too. |
| VWS | `coverage-relocation` | Voorwaardenscheppend: ambulance coverage/repositioning, not necessarily a patient incident. Read the raw text for status, e.g. `Einde VWS`. |

An initial ambulance unit number such as `09123` can be displayed as callsign
`09-123`. Explicit `bon`/`rit` numbers identify a dispatch/trip, not a medical
condition. Unlabelled trailing numbers are left unexplained: they could be
unit numbers or references. Capcodes identify paging recipients/groups, not
diagnoses, and are distinct from vehicle callsigns.

Do not infer patient diagnoses, outcomes, actual arrival times, current vehicle
locations, or station assignments from these codes. Public vehicle directories
can help research a callsign but can become stale. Regional codes such as
`BDH-02` remain verbatim unless their meaning has been verified.

Sources checked 2026-09-24:
- [Ambulancezorg Nederland: current urgency categories, including A0/B1/B2](https://www.ambulancezorg.nl/nieuws/verbeterde-urgentie-indeling-ambulancezorg-geeft-meer-duidelijkheid).
- [AZN Uniform Begrippenkader, 2013: A1/A2, VWS and trip terminology](https://www.ambulancezorg.nl/static/upload/raw/5816145d-51fc-4fc9-ac53-30010ecb90dc/azn-ubk-2013-def.pdf). Its old three-category model is superseded by the current categories above.
- [Ambulance Amsterdam: DIA in practice](https://ambulanceamsterdam.nl/blog/niet-naar-het-ziekenhuis/).
- [Public callsign directory, non-authoritative](https://www.hulpdienstenvoertuigennl.nl/ambulances-amsterdam-amstelland).
- [Rijksoverheid: closed C2000 communications and the P2000 paging layer](https://www.rijksoverheid.nl/themas/recht-veiligheid-en-defensie/communicatie-hulpdiensten-c2000/c2000). P2000 is not a complete incident register.

### Firefighter and police codes

`fire_codes` and `police_codes` work like `ambulance_codes`: code names or
meaning names, case-insensitive, OR within each service, AND with area and
discipline filters. Both default to **`[]` (unrestricted)**. For example:

```toml
[filters]
ambulance_codes = ["A0", "A1", "A2", "DIA"]
fire_codes = ["emergency", "automatic-fire-alarm"]
police_codes = ["highest-urgency", "forensic-investigation"]
```

The example restricts fire/police alerts; leave their arrays empty to keep
receiving all of them. A police message cannot match an ambulance or fire code
just because it contains the same text. Explanations are independent of filter
selection: every recognized code is explained, not just the code that matched.

| Service | Code for filtering | Meaning name | Explanation |
|---------|--------------------|--------------|-------------|
| Fire | P1 | `emergency` | Urgent task; respond as quickly as possible. Message forms `P1`, `P 1`, `Prio 1`. |
| Fire | P2 | `prompt-response` | Respond promptly, without a directly urgent task. Also `P 2`/`Prio 2`. |
| Fire | OMS | `automatic-fire-alarm` | Openbaar Meldsysteem: automatic fire alarm, **not confirmation of fire**. |
| Fire | TS | `fire-engine` | Tankautospuit. |
| Fire | HW | `aerial-platform` | Hoogwerker. |
| Fire | AL | `aerial-ladder` | Autoladder; only recognized as `(AL)` or before a six-digit unit number. |
| Fire | HV | `rescue-vehicle` | Hulpverleningsvoertuig; only `(HV)` or before a six-digit unit number. |
| Fire | WO | `water-incident-or-unit` | Waterongeval **or** waterongevallenvoertuig; context determines which. |
| Fire | OVD | `duty-officer` | Officier van Dienst (brandweer), also message form `OvD-B`, not `OvD-P`. |
| Police | PRIO1 | `highest-urgency` | Highest police dispatch urgency; only explicit initial `Prio 1`/`Prio1`. Not bare `1` or firefighter `P1`. |
| Police | OVD-P | `duty-officer` | Officier van Dienst Politie, also message form `OVDP`. |
| Police | FO | `forensic-investigation` | Forensische Opsporing; also `FO-Verkeer` (traffic investigation). |
| Both | GRIP | `crisis-coordination` | Gecoördineerde Regionale Incidentbestrijdingsprocedure; multi-agency crisis coordination. The raw level is retained, not interpreted as fire severity. |

Short words need context: `al` in ordinary Dutch must not become an autoladder.
`HV`/`WO` can be ambiguous between incident and resource labels; the recognizer
deliberately does not treat arbitrary `HV` text as a vehicle. Full tokens are
required; fragments inside words or identifiers do not match. Priority codes
are recognized only at the start, not as road numbers elsewhere in a message.

**Limits:** the national fire driving guideline removed P3, although local
glossaries still list it as “geen spoed”. It is left unexplained, not presented
as a current national priority. Police Prio 2/3 are also left unexplained:
the GMS priorities cannot simply be mapped to “spoed, nu, later”. Priority
does not prove current lights/siren use; police permission is explicitly
separate from dispatch priority. `BR`, `BNH-xx`, `BDH-xx`, police bare-number
prefixes and `ICnum` remain raw: no authoritative expansion was verified here.
Police role meanings are verified, not their frequency in these feeds.

Sources:
- [Brandweer Nederland/NIPV: driving guideline, priorities and P3 removal](https://archief.nipv.nl/documenten/optische-en-geluidssignalen-brandweer/).
- [Brandweer: automatic fire reporting / OMS](https://www.brandweer.nl/onderwerpen/automatisch-melden-van-brand/).
- [Brandweer Fryslân: TS/HW/WO/HV vehicles](https://www.brandweer.nl/fryslan/voertuigen/).
- [Brandweer Uitgeest: dispatch glossary](https://brandweeruitgeest.nl/betekenis-p2000-meldingen/); useful for resource abbreviations, but its ambulance/P3 priority text is outdated.
- [Brandweer: Officier van Dienst role](https://www.brandweer.nl/nieuws/rob-het-onvoorspelbare-geeft-mij-energie/).
- [Veiligheidsregio IJsselland: GRIP](https://www.vrijsselland.nl/crisisbeheersing-en-rampenbestrijding/).
- [Politie: Prio 1](https://kombijde.politie.nl/blog/meldkamer/werken-in-de-meldkamer-politie), [OvD-P](https://kombijde.politie.nl/blog/agent/docuserie-blauw-may), [FO-Verkeer](https://www.politie.nl/mijn-buurt/politiebureaus/05/fo-verkeer.html).
- [Politie: driving guideline, separate permission for signals](https://www.politie.nl/binaries/content/assets/politie/onderwerpen/verkeershandhaving/79226975-1744-4ed3-afe5-7c16078232da.pdf).
- [Inspectie Noodhulp response: GMS priorities versus spoed/nu/later](https://open.overheid.nl/documenten/ronl-6943c491-ae9d-4119-ba67-cef077cc998b/pdf), p. 4.

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
  `A0/A1/A2` and `B1/B2` are ambulance priorities (B = geen-spoed rit), `P 1`/
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
