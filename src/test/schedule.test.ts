import { expect, test } from "bun:test";
import { backoffMs, jitterMs, perSourceIntervalMs } from "../schedule";

test("per-source interval: staggered sources, 15s floor for a single source", () => {
  expect(perSourceIntervalMs(5, 1)).toBe(15_000);
  expect(perSourceIntervalMs(5, 2)).toBe(10_000);
  expect(perSourceIntervalMs(5, 3)).toBe(15_000);
  expect(perSourceIntervalMs(5, 4)).toBe(20_000);
  expect(perSourceIntervalMs(10, 2)).toBe(20_000);
  expect(perSourceIntervalMs(10, 1)).toBe(15_000);
  expect(perSourceIntervalMs(30, 1)).toBe(30_000);
});

test("jitter stays within 1-3 seconds", () => {
  expect(jitterMs(() => 0)).toBe(1000);
  expect(jitterMs(() => 0.5)).toBe(2000);
  expect(jitterMs(() => 1)).toBe(3000);
  for (let i = 0; i < 200; i++) {
    const j = jitterMs();
    expect(j).toBeGreaterThanOrEqual(1000);
    expect(j).toBeLessThanOrEqual(3000);
  }
});

test("backoff doubles per consecutive failure and caps at 10 minutes", () => {
  expect(backoffMs(10_000, 1)).toBe(10_000);
  expect(backoffMs(10_000, 2)).toBe(20_000);
  expect(backoffMs(10_000, 3)).toBe(40_000);
  expect(backoffMs(10_000, 4)).toBe(80_000);
  expect(backoffMs(10_000, 7)).toBe(600_000);
  expect(backoffMs(10_000, 12)).toBe(600_000);
});
