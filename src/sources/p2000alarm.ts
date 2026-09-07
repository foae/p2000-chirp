import type { P2000Item } from "../feed";
import { parseWallAmsterdam } from "../tz";

const DISCIPLINE_BY_CLASS: Record<string, string> = {
  A: "Ambulance",
  B: "Brandweer",
  P: "Politie",
  N: "KNRM",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchP2000Alarm(url: string): Promise<P2000Item[]> {
  const referer = new URL(url).origin + "/";
  const res = await fetch(`${url}?LastID=0`, {
    headers: { Referer: referer, "User-Agent": "p2000-chirp/0.1 (personal P2000 notifier)" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  const text = await res.text();
  if (!text.includes("<M>")) {
    throw new Error(`unexpected response from ${url}: ${text.slice(0, 80)}`);
  }
  const items: P2000Item[] = [];
  for (const raw of text.split("<D>")[0].split("<M>")) {
    const dis = raw.match(/class="cell pDis([ABPN])">([^<]*)/);
    if (!dis) continue;
    const message = decodeEntities(dis[2]);
    if (message === "") continue;
    const stamp = (raw.match(/class="cell pDate vm">([^<]*)/)?.[1] ?? "").trim();
    const [dateStr, timeStr] = stamp.split(" ");
    const capcode = (raw.match(/class="pCap[ABPN] dl">([^<]*)/)?.[1] ?? "").trim();
    const regName = (raw.match(/class="pRegio dl">([^<]*)/)?.[1] ?? "").trim();
    const detail = raw.match(new RegExp(`class="pOms${dis[1]} dl">([^<]*)`))?.[1];
    items.push({
      source: "p2000alarm",
      capcode,
      message,
      regName,
      dienst: DISCIPLINE_BY_CLASS[dis[1]] ?? "",
      lat: null,
      lon: null,
      pubDate: dateStr && timeStr ? parseWallAmsterdam(dateStr, timeStr) : new Date(),
      detail: detail ? decodeEntities(detail) : undefined,
    });
  }
  return items;
}
