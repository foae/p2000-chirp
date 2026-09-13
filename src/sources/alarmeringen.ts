import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { P2000Item } from "../feed";
import { httpError } from "../feed";

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
const ATTRIBUTION = "Bron: Alarmeringen.nl (CC BY-NC-ND 3.0)";
const DISCIPLINES: Record<string, string> = {
  brandweer: "Brandweer",
  ambulance: "Ambulance",
  politie: "Politie",
  knrm: "KNRM",
};
const RFC_UTC_DATE = /^(?:[A-Za-z]{3},\s*)?\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}(?::\d{2})?\s+(?:GMT|UTC|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/i;

function parsePubDate(raw: string): Date {
  if (!RFC_UTC_DATE.test(raw)) throw new Error(`invalid Alarmeringen pubDate "${raw}"`);
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) throw new Error(`invalid Alarmeringen pubDate "${raw}"`);
  return new Date(timestamp);
}

function parseItem(raw: unknown): P2000Item {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("invalid Alarmeringen RSS item");
  }
  const title = "title" in raw ? raw.title : undefined;
  const link = "link" in raw ? raw.link : undefined;
  const pubDate = "pubDate" in raw ? raw.pubDate : undefined;
  const description = "description" in raw ? raw.description : undefined;
  if (typeof title !== "string" || title === "") throw new Error("Alarmeringen RSS item is missing a title");
  if (typeof link !== "string" || link === "") throw new Error("Alarmeringen RSS item is missing a link");
  let itemUrl: URL;
  try {
    itemUrl = new URL(link);
  } catch {
    throw new Error(`invalid Alarmeringen item link "${link}"`);
  }
  if ((itemUrl.protocol !== "http:" && itemUrl.protocol !== "https:") || itemUrl.hostname !== "alarmeringen.nl") {
    throw new Error(`invalid Alarmeringen item link "${link}"`);
  }

  if (typeof pubDate !== "string" || pubDate === "") throw new Error("Alarmeringen RSS item is missing a pubDate");

  const headline = typeof description === "string" ? description : "";
  const discipline = /^(Brandweer|Ambulance|Politie|KNRM)\b/i.exec(headline)?.[1].toLowerCase();
  return {
    source: "alarmeringen",
    capcode: "",
    message: title,
    regName: "",
    dienst: discipline ? DISCIPLINES[discipline] : "",
    lat: null,
    lon: null,
    pubDate: parsePubDate(pubDate),
    detail: `${ATTRIBUTION}\n${link}`,
  };
}

export function parseAlarmeringenRss(xml: string): P2000Item[] {
  if (XMLValidator.validate(xml) !== true) throw new Error("invalid Alarmeringen RSS XML");

  const doc: unknown = parser.parse(xml);
  if (typeof doc !== "object" || doc === null || Array.isArray(doc) || !("rss" in doc)) {
    throw new Error("invalid Alarmeringen RSS channel");
  }
  const rss = doc.rss;
  if (typeof rss !== "object" || rss === null || Array.isArray(rss) || !("channel" in rss)) {
    throw new Error("invalid Alarmeringen RSS channel");
  }

  const channel = rss.channel;
  if (channel === "" || channel === undefined || channel === null) return [];
  if (typeof channel !== "object" || Array.isArray(channel)) throw new Error("invalid Alarmeringen RSS channel");
  const rawItems = "item" in channel ? channel.item : undefined;
  if (rawItems === undefined || rawItems === null) return [];
  return (Array.isArray(rawItems) ? rawItems : [rawItems]).map(parseItem);
}

export async function fetchAlarmeringen(url: string): Promise<P2000Item[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "p2000-chirp/0.1 (personal P2000 notifier)" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) httpError(res, url);
  return parseAlarmeringenRss(await res.text());
}
