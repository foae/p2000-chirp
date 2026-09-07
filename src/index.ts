import { loadConfig } from "./config";
import { fetchItems, type P2000Item } from "./feed";
import { inferDiscipline, matchesArea, matchesDiscipline, normalizeMessage, trailingSequence } from "./filter";
import { failureWaitMs, jitterMs, nextSlotMs, perSourceIntervalMs } from "./schedule";
import { SeenStore } from "./state";
import { sendTelegram } from "./telegram";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || process.env.DRY_RUN === "true";
const debug = args.includes("--debug") || process.env.DEBUG === "true";
const configFlagIdx = args.indexOf("--config");
let configPath = "config.toml";
if (configFlagIdx >= 0) {
  configPath = args[configFlagIdx + 1] ?? "";
  if (configPath === "") {
    console.error("--config requires a file path argument");
    process.exit(1);
  }
}

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
const staggerMs = config.pollIntervalSeconds * 1000;
const intervalMs = perSourceIntervalMs(config.pollIntervalSeconds, config.sources.length);
const epoch = Date.now();

process.on("SIGTERM", () => {
  store.save();
  process.exit(0);
});
process.on("SIGINT", () => {
  store.save();
  process.exit(0);
});

const inFlight = new Set<string>();

function isDuplicate(item: P2000Item): boolean {
  const now = Date.now();
  const message = normalizeMessage(item.message);
  if (inFlight.has(message)) return true;
  const lastMsg = store.lastSeenMessage(message);
  if (lastMsg !== undefined && now - lastMsg < dedupeWindowMs) return true;
  const seq = trailingSequence(message);
  if (seq) {
    const lastSeq = store.lastSeenSequence(seq);
    if (lastSeq !== undefined && now - lastSeq < dedupeWindowMs) return true;
  }
  if (store.hasSeenExtension(message, dedupeWindowMs, now)) return true;
  return false;
}

function format(item: P2000Item): string {
  const discipline = inferDiscipline(item);
  const prio = item.message.match(/^\s*([ABPN])\s?([12])/i);
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

function sourceId(index: number): string {
  return `${config.sources[index].type}:${config.sources[index].url}`;
}

function trackNewestAndStale(items: P2000Item[]): void {
  for (const item of items) {
    if (!newestPubDate || item.pubDate.getTime() > newestPubDate.getTime()) {
      newestPubDate = new Date(item.pubDate.getTime());
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
}

async function processItems(label: string, items: P2000Item[]): Promise<void> {
  items.sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime());
  const fresh = items.filter(
    (item) =>
      !isDuplicate(item) && matchesArea(item, config.filters) && matchesDiscipline(item, config.filters.disciplines),
  );
  if (debug) {
    console.log(`[debug] poll ${label}: ${items.length} items, fresh+relevant=${fresh.length}`);
  }
  try {
    for (const item of fresh) {
      const message = normalizeMessage(item.message);
      if (isDuplicate(item) || inFlight.has(message)) continue;
      inFlight.add(message);
      try {
        const text = format(item);
        if (!dryRun) await sendTelegram(token!, chatId!, text);
        store.markSeen(message, trailingSequence(message));
        console.log(
          dryRun
            ? `[dry-run] (${item.source}) ${text.replace(/\n/g, " | ")}`
            : `[sent] (${item.source}) ${text.replace(/\n/g, " | ")}`,
        );
      } catch (err) {
        console.error(`[error] not delivered, will retry next poll: ${err instanceof Error ? err.message : err}`);
        break;
      } finally {
        inFlight.delete(message);
      }
      await Bun.sleep(300);
    }
  } finally {
    store.prune(pruneMs);
    store.save();
  }
}

interface SourceRuntime {
  nextPollAt: number;
  bootstrapped: boolean;
  failures: number;
}

const runtimes: SourceRuntime[] = config.sources.map((_, i) => ({
  nextPollAt: epoch + i * staggerMs + jitterMs(),
  bootstrapped: store.isSourceBootstrapped(sourceId(i)),
  failures: 0,
}));

async function pollSource(i: number): Promise<void> {
  const rt = runtimes[i];
  const source = config.sources[i];
  const id = sourceId(i);
  const slotOffset = i * staggerMs;
  let items: P2000Item[];
  try {
    items = await fetchItems(source);
  } catch (err) {
    rt.failures++;
    const failure = err as { status?: number; retryAfterMs?: number };
    const waitMs = failureWaitMs(failure, intervalMs, rt.failures);
    rt.nextPollAt = nextSlotMs(epoch, slotOffset, intervalMs, Date.now() + waitMs) + jitterMs();
    if (!failedSources.has(id)) {
      failedSources.add(id);
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[error] ${source.type} source failed: ${msg} — next attempt in ~${Math.round(waitMs / 1000)}s`,
      );
    }
    return;
  }
  if (failedSources.has(id)) {
    failedSources.delete(id);
    console.log(`[info] source recovered: ${source.type}`);
  }
  rt.failures = 0;
  rt.nextPollAt = nextSlotMs(epoch, slotOffset, intervalMs, Date.now()) + jitterMs();
  trackNewestAndStale(items);
  if (!rt.bootstrapped) {
    rt.bootstrapped = true;
    for (const item of items) {
      store.markSeen(normalizeMessage(item.message), trailingSequence(normalizeMessage(item.message)));
    }
    store.markSourceBootstrapped(id);
    store.save();
    console.log(
      `[init] ${source.type} bootstrapped — ${items.length} existing feed items marked seen without notifying`,
    );
    return;
  }
  if (items.length === 0) return;
  await processItems(`${source.type}[${i}]`, items);
}

const f = config.filters;
if (f.regions.length + f.postcodes.length + f.keywords.length + (f.radius ? 1 : 0) === 0) {
  console.warn("[warn] no area filters configured — every item passes the area filter");
}
if (f.disciplines.length === 0) {
  console.warn("[warn] no disciplines configured — all disciplines pass");
}
console.log(
  `p2000-chirp: polling ${config.sources.length} source(s) ${config.pollIntervalSeconds}s apart` +
    ` (each source every ${Math.round(intervalMs / 1000)}s + 1-3s jitter)` +
    ` (state: ${config.stateFile})${dryRun ? " [dry-run]" : ""}${debug ? " [debug]" : ""}`,
);

while (true) {
  const now = Date.now();
  const due: number[] = [];
  for (let i = 0; i < runtimes.length; i++) {
    if (runtimes[i].nextPollAt <= now) due.push(i);
  }
  if (due.length > 0) {
    try {
      await Promise.all(due.map((i) => pollSource(i)));
    } catch (err) {
      console.error(`[error] poll failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  const nextAt = Math.min(...runtimes.map((rt) => rt.nextPollAt));
  await Bun.sleep(Math.max(250, nextAt - Date.now()));
}
