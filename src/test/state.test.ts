import { expect, test } from "bun:test";
import { SeenStore } from "../state";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function freshPath(): string {
  return join(mkdtempSync(join(tmpdir(), "p2000-state-")), "state.json");
}

test("markSeen records message and sequence with injected clock", () => {
  const store = new SeenStore(freshPath());
  const t0 = 1_000_000;
  store.markSeen("msg A", "138437", t0);
  expect(store.lastSeenMessage("msg A")).toBe(t0);
  expect(store.lastSeenSequence("138437")).toBe(t0);
  expect(store.lastSeenMessage("msg B")).toBeUndefined();
  expect(store.lastSeenSequence("999999")).toBeUndefined();
});

test("markSeen refresh overrides earlier timestamp", () => {
  const store = new SeenStore(freshPath());
  store.markSeen("msg", undefined, 1_000);
  store.markSeen("msg", undefined, 60_000);
  expect(store.lastSeenMessage("msg")).toBe(60_000);
});

test("prune removes expired entries and reports the count", () => {
  const store = new SeenStore(freshPath());
  store.markSeen("old", "111111", 0);
  store.markSeen("new", "222222", 100_000);
  expect(store.prune(50_000, 100_000)).toBe(2);
  expect(store.lastSeenMessage("old")).toBeUndefined();
  expect(store.lastSeenSequence("111111")).toBeUndefined();
  expect(store.lastSeenMessage("new")).toBe(100_000);
});

test("save persists and reloads atomically", () => {
  const path = freshPath();
  const store = new SeenStore(path);
  store.markSeen("m", "123456", 5);
  store.save();
  const raw = JSON.parse(readFileSync(path, "utf8"));
  expect(raw.messages.m).toBe(5);
  expect(raw.sequences["123456"]).toBe(5);
  const reloaded = new SeenStore(path);
  expect(reloaded.existed).toBe(true);
  expect(reloaded.lastSeenMessage("m")).toBe(5);
});

test("save is a no-op when nothing changed (dirty flag)", () => {
  const path = freshPath();
  const store = new SeenStore(path);
  store.save();
  expect(existsSync(path)).toBe(false);
});

test("corrupt state file warns and starts empty", () => {
  const path = freshPath();
  writeFileSync(path, "{ this is not json");
  const store = new SeenStore(path);
  expect(store.existed).toBe(false);
  expect(store.lastSeenMessage("anything")).toBeUndefined();
});

test("a truncated message is a duplicate of a longer message delivered in the window", () => {
  const store = new SeenStore(freshPath());
  const t0 = 1_000_000;
  store.markSeen("A2 Ambu 08123 DIA Groesbeek Rit 276252", "276252", t0);
  expect(store.hasSeenExtension("A2 Ambu 08123", 3_600_000, t0 + 5_000)).toBe(true);
  expect(store.hasSeenExtension("A2 Ambu 07118 Rit 275920", 3_600_000, t0 + 5_000)).toBe(false);
});

test("prefix dedupe is one-directional: a longer new message is never suppressed", () => {
  const store = new SeenStore(freshPath());
  const t0 = 1_000_000;
  store.markSeen("A2 Ambu 08123", undefined, t0);
  expect(store.hasSeenExtension("A2 Ambu 08123 DIA Groesbeek Rit 276252", 3_600_000, t0 + 5_000)).toBe(false);
});

test("prefix dedupe respects the window", () => {
  const store = new SeenStore(freshPath());
  const t0 = 1_000_000;
  store.markSeen("A2 Ambu 08123 DIA Groesbeek Rit 276252", "276252", t0);
  expect(store.hasSeenExtension("A2 Ambu 08123", 3_600_000, t0 + 3_600_001)).toBe(false);
});

test("bootstrap markers persist per source and survive reloads", () => {
  const path = freshPath();
  const store = new SeenStore(path);
  expect(store.isSourceBootstrapped("rss:https://a.example/f")).toBe(false);
  expect(store.isSourceBootstrapped("p2000alarm:https://b.example/r")).toBe(false);
  store.markSourceBootstrapped("rss:https://a.example/f");
  store.save();
  const reloaded = new SeenStore(path);
  expect(reloaded.isSourceBootstrapped("rss:https://a.example/f")).toBe(true);
  expect(reloaded.isSourceBootstrapped("p2000alarm:https://b.example/r")).toBe(false);
  reloaded.markSourceBootstrapped("p2000alarm:https://b.example/r");
  reloaded.save();
  const again = new SeenStore(path);
  expect(again.isSourceBootstrapped("rss:https://a.example/f")).toBe(true);
  expect(again.isSourceBootstrapped("p2000alarm:https://b.example/r")).toBe(true);
});
