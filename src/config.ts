import { readFileSync } from "node:fs";
import type { SourceConfig, SourceType } from "./feed";

export interface RadiusFilter {
  lat: number;
  lon: number;
  km: number;
}

export interface AreaFilters {
  regions: string[];
  postcodes: string[];
  keywords: string[];
  disciplines: string[];
  radius: RadiusFilter | null;
}

export interface P2000Config {
  pollIntervalSeconds: number;
  staleAfterMinutes: number;
  stateFile: string;
  pruneHours: number;
  dedupeWindowSeconds: number;
  sources: SourceConfig[];
  filters: AreaFilters;
}

const SOURCE_TYPES: SourceType[] = ["rss", "p2000alarm"];

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

function parseSources(value: unknown, configPath: string): SourceConfig[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`config "${configPath}" requires at least one [[sources]] entry`);
  }
  return value.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`sources[${i}] must be a table`);
    }
    const obj = entry as Record<string, unknown>;
    const url = typeof obj.url === "string" ? obj.url.trim() : "";
    const type = typeof obj.type === "string" ? (obj.type.trim() as SourceType) : "rss";
    if (url === "") throw new Error(`sources[${i}] requires a "url" string`);
    if (!SOURCE_TYPES.includes(type)) {
      throw new Error(`sources[${i}] has unknown type "${type}" (expected one of ${SOURCE_TYPES.join(", ")})`);
    }
    return { type, url };
  });
}

export function loadConfig(path: string): P2000Config {
  let rawText: string;
  try {
    rawText = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`cannot read config file "${path}": ${(err as Error).message}`);
  }
  let raw: Record<string, unknown>;
  try {
    raw = Bun.TOML.parse(rawText) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`cannot parse TOML in "${path}": ${(err as Error).message}`);
  }
  const obj = raw ?? {};
  const filtersRaw = (obj.filters ?? {}) as Record<string, unknown>;
  const radiusRaw = (filtersRaw.radius ?? null) as Record<string, unknown> | null;
  let radius: RadiusFilter | null = null;
  if (radiusRaw && typeof radiusRaw === "object") {
    const lat = Number(radiusRaw.lat);
    const lon = Number(radiusRaw.lon);
    const km = Number(radiusRaw.km);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(km) && km > 0) {
      radius = { lat, lon, km };
    } else {
      throw new Error(`filters.radius requires numeric "lat", "lon" and "km" > 0`);
    }
  }
  const filters: AreaFilters = {
    regions: stringList(filtersRaw.regions),
    postcodes: stringList(filtersRaw.postcodes),
    keywords: stringList(filtersRaw.keywords),
    disciplines: stringList(filtersRaw.disciplines),
    radius,
  };
  const num = (key: string, def: number, min: number): number => {
    const v = Number(obj[key]);
    return Number.isFinite(v) ? Math.max(min, v) : def;
  };
  return {
    pollIntervalSeconds: num("poll_interval_seconds", 10, 5),
    staleAfterMinutes: num("stale_after_minutes", 15, 1),
    stateFile:
      typeof obj.state_file === "string" && obj.state_file.trim() !== ""
        ? obj.state_file.trim()
        : "state/state.json",
    pruneHours: num("prune_hours", 24, 1),
    dedupeWindowSeconds: num("dedupe_window_seconds", 300, 0),
    sources: parseSources(obj.sources, path),
    filters,
  };
}
