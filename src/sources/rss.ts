import type { P2000Item } from "../feed";
import { parseWallAmsterdam } from "../tz";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, mrt: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7,
  aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12,
};

let warnedBadDate = false;

function warnBadDateOnce(detail: string): void {
  if (warnedBadDate) return;
  warnedBadDate = true;
  console.warn(`[warn] RSS: ${detail} — using current time; investigate whether the feed changed its format`);
}

function asString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function asCoord(value: unknown): number | null {
  const s = asString(value);
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : null;
}

export function parseRssPubDate(raw: string): Date {
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) {
      const parsed = parseWallAmsterdam(
        `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`,
        `${m[4]}:${m[5]}:${m[6]}`,
      );
      if (parsed) return parsed;
    }
  }
  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) return fallback;
  warnBadDateOnce(`unparseable pubDate "${raw}"`);
  return new Date();
}

function toItem(raw: Record<string, unknown>): P2000Item {
  const message = asString(raw.message);
  const pubDateRaw = asString(raw.pubDate);
  return {
    source: "rss",
    capcode: asString(raw.code),
    message,
    regName: asString(raw.RegName),
    dienst: asString(raw.Dienst),
    lat: asCoord(raw.lat),
    lon: asCoord(raw.lon),
    pubDate: pubDateRaw !== "" ? parseRssPubDate(pubDateRaw) : new Date(),
  };
}

export async function fetchRss(url: string): Promise<P2000Item[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "p2000-chirp/0.1 (personal P2000 notifier)" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  const xml = await res.text();
  const doc = parser.parse(xml) as Record<string, any>;
  const rawItems = doc?.rss?.channel?.item;
  const list: Record<string, unknown>[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  if (list.length === 0) {
    throw new Error("no <item> elements parsed — feed layout changed or an HTML error page was served");
  }
  return list.map(toItem).filter((item) => item.message !== "");
}
