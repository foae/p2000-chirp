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
const KNOWN_DISCIPLINES = ["brandweer", "ambulance", "politie", "knrm"];

function filterList(value: unknown, key: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`filters.${key} must be an array of strings (got ${typeof value})`);
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error(`filters.${key} entries must be non-empty strings — quote them (postcodes = ["3511"], not [3511])`);
    }
    return entry;
  });
}

function parseRadius(raw: unknown): RadiusFilter | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const hasAny = obj.lat !== undefined || obj.lon !== undefined || obj.km !== undefined;
  if (!hasAny) return null;
  const lat = Number(obj.lat);
  const lon = Number(obj.lon);
  const km = Number(obj.km);
  if (
    !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(km) || km <= 0 ||
    lat < -90 || lat > 90 || lon < -180 || lon > 180
  ) {
    throw new Error(`filters.radius requires numeric "lat" (-90..90), "lon" (-180..180) and "km" > 0`);
  }
  return { lat, lon, km };
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
    const type = typeof obj.type === "string" ? (obj.type.trim() as SourceType) : "";
    if (type === "") {
      throw new Error(`sources[${i}] requires a "type" ("rss" or "p2000alarm")`);
    }
    if (!SOURCE_TYPES.includes(type)) {
      throw new Error(`sources[${i}] has unknown type "${type}" (expected one of ${SOURCE_TYPES.join(", ")})`);
    }
    const url = typeof obj.url === "string" ? obj.url.trim() : "";
    if (url === "") throw new Error(`sources[${i}] requires a "url" string`);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`sources[${i}] url "${url}" is not a valid URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`sources[${i}] url must be http(s)`);
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
  const disciplines = filterList(filtersRaw.disciplines, "disciplines");
  for (const configured of disciplines) {
    const normalized = configured.trim().toLowerCase();
    if (!KNOWN_DISCIPLINES.some((known) => known.startsWith(normalized))) {
      throw new Error(
        `filters.disciplines entry "${configured}" is not a known discipline or prefix (known: Brandweer, Ambulance, Politie, KNRM)`,
      );
    }
  }
  const filters: AreaFilters = {
    regions: filterList(filtersRaw.regions, "regions"),
    postcodes: filterList(filtersRaw.postcodes, "postcodes"),
    keywords: filterList(filtersRaw.keywords, "keywords"),
    disciplines,
    radius: parseRadius(filtersRaw.radius),
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
    dedupeWindowSeconds: num("dedupe_window_seconds", 3600, 60),
    sources: parseSources(obj.sources, path),
    filters,
  };
}
