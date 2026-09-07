import type { P2000Item } from "../feed";
import { parseWallAmsterdam } from "../tz";

const DISCIPLINE_BY_CLASS: Record<string, string> = {
  A: "Ambulance",
  B: "Brandweer",
  P: "Politie",
  N: "KNRM",
};

let warnedBadDate = false;

function warnBadDateOnce(detail: string): void {
  if (warnedBadDate) return;
  warnedBadDate = true;
  console.warn(`[warn] p2000alarm: ${detail} — using current time; investigate whether the feed changed its format`);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => {
      try {
        return String.fromCodePoint(Number(code));
      } catch {
        return "&#" + code + ";";
      }
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseP2000AlarmText(text: string): P2000Item[] {
  if (!text.includes("<M>")) {
    throw new Error(`unexpected response: ${text.slice(0, 80)}`);
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
    let pubDate: Date | null = null;
    if (dateStr && timeStr) {
      pubDate = parseWallAmsterdam(dateStr, timeStr);
      if (!pubDate) warnBadDateOnce(`unparseable datetime "${stamp}"`);
    } else {
      warnBadDateOnce(`missing datetime "${stamp}"`);
    }
    items.push({
      source: "p2000alarm",
      capcode,
      message,
      regName,
      dienst: DISCIPLINE_BY_CLASS[dis[1]] ?? "",
      lat: null,
      lon: null,
      pubDate: pubDate ?? new Date(),
      detail: detail ? decodeEntities(detail) : undefined,
    });
  }
  return items;
}

export async function fetchP2000Alarm(url: string): Promise<P2000Item[]> {
  const requestUrl = new URL(url);
  requestUrl.searchParams.set("LastID", "0");
  const res = await fetch(requestUrl, {
    headers: { Referer: new URL(url).origin + "/", "User-Agent": "p2000-chirp/0.1 (personal P2000 notifier)" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return parseP2000AlarmText(await res.text());
}
