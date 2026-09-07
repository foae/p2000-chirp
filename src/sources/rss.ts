import type { P2000Item } from "../feed";
import { parseWallAmsterdam } from "../tz";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, mrt: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7,
  aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12,
};

function parseRssPubDate(raw: string): Date {
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) {
      const dd = m[1].padStart(2, "0");
      const mm = String(month).padStart(2, "0");
      return parseWallAmsterdam(`${m[3]}-${mm}-${dd}`, `${m[4]}:${m[5]}:${m[6]}`);
    }
  }
  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
}

function asString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function asCoord(value: unknown): number | null {
  const s = asString(value);
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : null;
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
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  const xml = await res.text();
  const doc = parser.parse(xml) as Record<string, any>;
  const rawItems = doc?.rss?.channel?.item;
  const list: Record<string, unknown>[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  return list.map(toItem).filter((item) => item.message !== "");
}
