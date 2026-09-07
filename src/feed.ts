import { fetchRss } from "./sources/rss";
import { fetchP2000Alarm } from "./sources/p2000alarm";

export interface P2000Item {
  source: string;
  capcode: string;
  message: string;
  regName: string;
  dienst: string;
  lat: number | null;
  lon: number | null;
  pubDate: Date;
  detail?: string;
}

export type SourceType = "rss" | "p2000alarm";

export interface SourceConfig {
  type: SourceType;
  url: string;
}

export function httpError(res: Response, url: string): never {
  const err = new Error(`HTTP ${res.status} from ${url}`) as Error & { status: number; retryAfterMs?: number };
  err.status = res.status;
  const header = res.headers.get("retry-after");
  if (header !== null && header.trim() !== "") {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) {
      err.retryAfterMs = seconds * 1000;
    } else {
      const at = Date.parse(header);
      if (Number.isFinite(at) && at > Date.now()) err.retryAfterMs = at - Date.now();
    }
  }
  throw err;
}

export async function fetchItems(source: SourceConfig): Promise<P2000Item[]> {
  if (source.type === "rss") return fetchRss(source.url);
  if (source.type === "p2000alarm") return fetchP2000Alarm(source.url);
  throw new Error(`unknown source type "${source.type}"`);
}
