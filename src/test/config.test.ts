import { expect, test } from "bun:test";
import { loadConfig } from "../config";
import { matchesDispatchCodes } from "../filter";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../..");

function withConfig(toml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "p2000-cfg-"));
  const path = join(dir, "config.toml");
  writeFileSync(path, toml);
  return path;
}

test("the shipped config.example.toml loads as-is (quickstart regression)", () => {
  const cfg = loadConfig(join(repoRoot, "config.example.toml"));
  expect(cfg.sources.length).toBeGreaterThan(0);
  expect(cfg.sources.map((s) => s.type)).toContain("rss");
  expect(cfg.filters.radius).toBeNull();
  expect(cfg.dedupeWindowSeconds).toBe(3600);
});

test("empty [filters.radius] table is treated as not configured", () => {
  const path = withConfig('[[sources]]\ntype = "rss"\nurl = "https://example.com/f"\n[filters]\n[filters.radius]\n');
  const cfg = loadConfig(path);
  expect(cfg.filters.radius).toBeNull();
});

test("partial radius throws with a clear message", () => {
  const path = withConfig('[[sources]]\ntype = "rss"\nurl = "https://example.com/f"\n[filters.radius]\nlat = 52.0\n');
  expect(() => loadConfig(path)).toThrow(/filters\.radius requires/);
});

test("out-of-range radius throws", () => {
  const path = withConfig(
    '[[sources]]\ntype = "rss"\nurl = "https://example.com/f"\n[filters.radius]\nlat = 95\nlon = 5\nkm = 1\n',
  );
  expect(() => loadConfig(path)).toThrow(/filters\.radius requires/);
});

test("numeric filter entries fail closed with a quoting hint", () => {
  const path = withConfig('[[sources]]\ntype = "rss"\nurl = "https://example.com/f"\n[filters]\npostcodes = [3511]\n');
  expect(() => loadConfig(path)).toThrow(/quote them/);
});

test("scalar filter value fails closed", () => {
  const path = withConfig('[[sources]]\ntype = "rss"\nurl = "https://example.com/f"\n[filters]\nregions = "Utrecht"\n');
  expect(() => loadConfig(path)).toThrow(/filters\.regions must be an array/);
});

test("unknown discipline throws instead of silently filtering everything", () => {
  const path = withConfig(
    '[[sources]]\ntype = "rss"\nurl = "https://example.com/f"\n[filters]\ndisciplines = ["Brandwer"]\n',
  );
  expect(() => loadConfig(path)).toThrow(/not a known discipline/);
});

test("known discipline prefixes are accepted", () => {
  const path = withConfig(
    '[[sources]]\ntype = "rss"\nurl = "https://example.com/f"\n[filters]\ndisciplines = ["Brand", "Ambu", "Politie", "KNRM"]\n',
  );
  expect(loadConfig(path).filters.disciplines).toEqual(["Brand", "Ambu", "Politie", "KNRM"]);
});

test("source without type throws", () => {
  const path = withConfig('[[sources]]\nurl = "https://example.com/f"\n');
  expect(() => loadConfig(path)).toThrow(/requires a "type"/);
});

test("source with invalid URL throws", () => {
  const path = withConfig('[[sources]]\ntype = "rss"\nurl = "notaurl"\n');
  expect(() => loadConfig(path)).toThrow(/not a valid URL/);
});

test("non-http source URL throws", () => {
  const path = withConfig('[[sources]]\ntype = "rss"\nurl = "ftp://example.com/f"\n');
  expect(() => loadConfig(path)).toThrow(/must be http/);
});

test("dedupe window is clamped to a sane minimum", () => {
  const path = withConfig(
    'dedupe_window_seconds = 0\n\n[[sources]]\ntype = "rss"\nurl = "https://example.com/f"\n',
  );
  expect(loadConfig(path).dedupeWindowSeconds).toBe(60);
});

test("omitted ambulance selection enables urgency OR DIA; an empty selection opts out", () => {
  const source = '[[sources]]\ntype = "rss"\nurl = "https://example.com/f"\n';
  const defaults = loadConfig(withConfig(source));
  const unrestricted = loadConfig(withConfig(`${source}[filters]\nambulance_codes = []\n`));
  const byMeaning = loadConfig(withConfig(`${source}[filters]\nambulance_codes = ["URGENT", "direct-dispatch"]\n`));
  const incident = {
    source: "rss", capcode: "", message: "", regName: "", dienst: "Ambulance",
    lat: null, lon: null, pubDate: new Date(0),
  };
  expect(matchesDispatchCodes({ ...incident, message: "A0 Utrecht" }, defaults.filters)).toBe(true);
  expect(matchesDispatchCodes({ ...incident, message: "B2 Utrecht" }, defaults.filters)).toBe(false);
  expect(matchesDispatchCodes({ ...incident, message: "B2 (DIA) Utrecht" }, defaults.filters)).toBe(true);
  expect(matchesDispatchCodes({ ...incident, message: "B2 Utrecht" }, unrestricted.filters)).toBe(true);
  expect(matchesDispatchCodes({ ...incident, message: "A2 Utrecht" }, byMeaning.filters)).toBe(true);
  expect(matchesDispatchCodes({ ...incident, message: "A1 Utrecht" }, byMeaning.filters)).toBe(false);
  expect(matchesDispatchCodes({ ...incident, message: "B2 DIA Utrecht" }, byMeaning.filters)).toBe(true);
});

test("invalid ambulance code selections fail at startup", () => {
  const source = '[[sources]]\ntype = "rss"\nurl = "https://example.com/f"\n[filters]\n';
  for (const selection of ['["DIAAA"]', '[""]', '[1]', '"A1"', '["P1"]']) {
    expect(() => loadConfig(withConfig(`${source}ambulance_codes = ${selection}\n`))).toThrow(/filters.ambulance_codes/);
  }
});

test("service code and meaning selections are scoped to their discipline", () => {
  const source = '[[sources]]\ntype = "rss"\nurl = "https://example.com/f"\n[filters]\n';
  const defaults = loadConfig(withConfig(source));
  const selected = loadConfig(withConfig(`${source}fire_codes = ["automatic-fire-alarm"]\npolice_codes = ["forensic-investigation"]\n`));
  const incident = {
    source: "rss", capcode: "", message: "", regName: "", dienst: "",
    lat: null, lon: null, pubDate: new Date(0),
  };
  for (const dienst of ["Brandweer", "Politie"]) {
    expect(matchesDispatchCodes({ ...incident, dienst, message: "Onbekende inzet" }, defaults.filters)).toBe(true);
    expect(matchesDispatchCodes({ ...incident, dienst, message: "Onbekende inzet" }, selected.filters)).toBe(false);
  }
  expect(matchesDispatchCodes({ ...incident, dienst: "Brandweer", message: "P 2 OMS Utrecht" }, selected.filters)).toBe(true);
  expect(matchesDispatchCodes({ ...incident, dienst: "Politie", message: "FO graag contact" }, selected.filters)).toBe(true);
  expect(matchesDispatchCodes({ ...incident, dienst: "Politie", message: "P 2 OMS Utrecht" }, selected.filters)).toBe(false);
  for (const [key, value] of [["fire_codes", "PRIO1"], ["police_codes", "P1"], ["fire_codes", "P3"], ["police_codes", "PRIO2"]]) {
    expect(() => loadConfig(withConfig(`${source}${key} = ["${value}"]\n`))).toThrow(`filters.${key}`);
  }
});
