import type { P2000Item } from "./feed";
import type { AreaFilters } from "./config";

export type Discipline = "Brandweer" | "Ambulance" | "Politie" | "KNRM" | "Onbekend";

export function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

export function trailingSequence(message: string): string | undefined {
  const m = message.match(/(\d{5,})\s*$/);
  return m ? m[1] : undefined;
}

export function inferDiscipline(item: P2000Item): Discipline {
  const dienst = item.dienst.trim().toLowerCase();
  if (dienst.startsWith("brandweer")) return "Brandweer";
  if (dienst.startsWith("ambulance")) return "Ambulance";
  if (dienst.startsWith("politie")) return "Politie";
  if (dienst.startsWith("knrm")) return "KNRM";
  if (dienst !== "" && dienst !== "gereserveerd") return "Onbekend";
  const m = item.message.match(/^\s*([ABPN])\s?\d/i);
  if (!m) return "Onbekend";
  if (m[1].toUpperCase() === "A" || m[1].toUpperCase() === "B") return "Ambulance";
  if (m[1].toUpperCase() === "P") return "Brandweer";
  return "KNRM";
}

export function matchesDiscipline(item: P2000Item, disciplines: string[]): boolean {
  if (disciplines.length === 0) return true;
  const d = inferDiscipline(item);
  if (d === "Onbekend") return false;
  return disciplines.some((configured) => d.toLowerCase().startsWith(configured.trim().toLowerCase()));
}

function normalizeRegion(value: string): string {
  return value.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

export function extractPostcodes(message: string): string[] {
  const re = /\b(\d{4})\s?[A-Za-z]{2}\b/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(message)) !== null) out.push(m[1]);
  return out;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function matchesArea(item: P2000Item, filters: AreaFilters): boolean {
  const { regions, postcodes, keywords, radius } = filters;
  if (regions.length + postcodes.length + keywords.length + (radius ? 1 : 0) === 0) return true;
  for (const region of regions) {
    if (normalizeRegion(item.regName).includes(normalizeRegion(region))) return true;
  }
  const message = item.message;
  for (const prefix of postcodes) {
    const digits = prefix.replace(/\D/g, "");
    if (digits !== "" && extractPostcodes(message).some((found) => found.startsWith(digits))) return true;
  }
  for (const keyword of keywords) {
    if (message.toLowerCase().includes(keyword.toLowerCase())) return true;
  }
  if (radius && item.lat !== null && item.lon !== null) {
    if (haversineKm(item.lat, item.lon, radius.lat, radius.lon) <= radius.km) return true;
  }
  return false;
}
