import { loadConfig } from "./config";
import { fetchItems, type P2000Item } from "./feed";
import { inferDiscipline, matchesArea, matchesDiscipline } from "./filter";
import { SeenStore } from "./state";
import { sendTelegram } from "./telegram";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || process.env.DRY_RUN === "true";
const debug = args.includes("--debug") || process.env.DEBUG === "true";
const configFlagIdx = args.indexOf("--config");
const configPath = configFlagIdx >= 0 ? args[configFlagIdx + 1] : "config.toml";

const config = loadConfig(configPath);
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!dryRun && (!token || !chatId)) {
  console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set (.env) — or use --dry-run");
  process.exit(1);
}

const store = new SeenStore(config.stateFile);
const dedupeWindowMs = config.dedupeWindowSeconds * 1000;
const pruneMs = config.pruneHours * 3_600_000;
let bootstrapPending = !store.existed;

function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

function trailingSequence(message: string): string | undefined {
  const m = message.match(/(\d{4,})\s*$/);
  return m ? m[1] : undefined;
}

function isDuplicate(item: P2000Item): boolean {
  const now = Date.now();
  const message = normalizeMessage(item.message);
  const lastMsg = store.lastSeenMessage(message);
  if (lastMsg !== undefined && now - lastMsg < dedupeWindowMs) return true;
  const seq = trailingSequence(message);
  if (seq) {
    const lastSeq = store.lastSeenSequence(seq);
    if (lastSeq !== undefined && now - lastSeq < dedupeWindowMs) return true;
  }
  return false;
}

function format(item: P2000Item): string {
  const discipline = inferDiscipline(item);
  const prio = item.message.match(/^\s*([ABP])\s?([12])/i);
  const prioText = prio ? `${prio[1].toUpperCase()}${prio[2]}` : "";
  const time = item.pubDate.toLocaleTimeString("nl-NL", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const header = [discipline, prioText, item.regName || "regio onbekend", time].filter(Boolean).join(" · ");
  const lines = [header, item.message];
  if (item.detail) lines.push(item.detail);
  return lines.join("\n");
}

let newestPubDate: Date | null = null;
let staleWarned = false;
const failedSources = new Set<string>();

async function cycle(): Promise<void> {
  const results = await Promise.allSettled(config.sources.map((s) => fetchItems(s)));
  const items: P2000Item[] = [];
  const perSource: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const source = config.sources[i];
    const sourceId = `${source.type}:${source.url}`;
    const result = results[i];
    if (result.status === "fulfilled") {
      items.push(...result.value);
      perSource.push(`${source.type}=${result.value.length}`);
      if (failedSources.has(sourceId)) {
        failedSources.delete(sourceId);
        console.log(`[info] source recovered: ${source.type}`);
      }
    } else {
      if (!failedSources.has(sourceId)) {
        failedSources.add(sourceId);
        console.error(
          `[error] ${source.type} source failed: ${
            result.reason instanceof Error ? result.reason.message : result.reason
          }`,
        );
      }
    }
  }
  if (newestPubDate) {
    const ageMs = Date.now() - newestPubDate.getTime();
    if (ageMs > config.staleAfterMinutes * 60_000) {
      if (!staleWarned) {
        staleWarned = true;
        console.warn(`[warn] feed looks stale: newest item is ${Math.round(ageMs / 60_000)} minutes old`);
      }
    } else {
      staleWarned = false;
    }
  }

  if (items.length > 0) {
    items.sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime());
    for (const item of items) {
      if (!newestPubDate || item.pubDate.getTime() > newestPubDate.getTime()) {
        newestPubDate = new Date(item.pubDate.getTime());
      }
    }
  }

  if (items.length > 0 && bootstrapPending) {
    bootstrapPending = false;
    for (const item of items) store.markSeen(normalizeMessage(item.message), trailingSequence(item.message));
    store.save();
    console.log(`[init] state file created — ${items.length} existing feed items marked seen without notifying`);
    return;
  }

  if (items.length === 0) return;

  const fresh = items.filter(
    (item) =>
      !isDuplicate(item) && matchesArea(item, config.filters) && matchesDiscipline(item, config.filters.disciplines),
  );

  if (debug) {
    console.log(`[debug] cycle: ${perSource.join(", ")} | fresh+relevant=${fresh.length}`);
  }

  for (const item of fresh) {
    if (isDuplicate(item)) continue;
    const text = format(item);
    try {
      if (!dryRun) await sendTelegram(token!, chatId!, text);
      store.markSeen(normalizeMessage(item.message), trailingSequence(item.message));
      console.log(
        dryRun
          ? `[dry-run] (${item.source}) ${text.replace(/\n/g, " | ")}`
          : `[sent] (${item.source}) ${text.replace(/\n/g, " | ")}`,
      );
    } catch (err) {
      console.error(`[error] not delivered, will retry next cycle: ${err instanceof Error ? err.message : err}`);
      break;
    }
    await Bun.sleep(300);
  }

  store.prune(pruneMs);
  store.save();
}

const f = config.filters;
if (f.regions.length + f.postcodes.length + f.keywords.length + (f.radius ? 1 : 0) === 0) {
  console.warn("[warn] no area filters configured — every item passes the area filter");
}
if (f.disciplines.length === 0) {
  console.warn("[warn] no disciplines configured — all disciplines pass");
}
console.log(
  `p2000-chirp: polling ${config.sources.length} source(s) every ${config.pollIntervalSeconds}s` +
    ` (state: ${config.stateFile})${dryRun ? " [dry-run]" : ""}${debug ? " [debug]" : ""}`,
);

while (true) {
  try {
    await cycle();
  } catch (err) {
    console.error(`[error] cycle failed: ${err instanceof Error ? err.message : err}`);
  }
  await Bun.sleep(config.pollIntervalSeconds * 1000);
}
