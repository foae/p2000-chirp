import { expect, test } from "bun:test";
import { loadConfig } from "../config";
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
    '[[sources]]\ntype = "rss"\nurl = "https://example.com/f"\n[filters.radius]\nlat = 95\nlon = 5\km = 1\n',
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
