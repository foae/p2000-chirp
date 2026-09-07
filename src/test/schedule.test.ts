import { expect, test } from "bun:test";
import { backoffMs, failureWaitMs, jitterMs, nextSlotMs, perSourceIntervalMs } from "../schedule";

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

test("slot scheduling keeps each source on its own staggered residue", () => {
  const epoch = 0;
  const period = 10_000;
  expect(nextSlotMs(epoch, 0, period, 0)).toBe(0);
  expect(nextSlotMs(epoch, 5_000, period, 0)).toBe(5_000);
  expect(nextSlotMs(epoch, 0, period, 7_000)).toBe(10_000);
  expect(nextSlotMs(epoch, 5_000, period, 7_000)).toBe(15_000);
  expect(nextSlotMs(epoch, 5_000, period, 15_000)).toBe(15_000);
  expect(nextSlotMs(epoch, 5_000, period, 26_000)).toBe(35_000);
  expect(nextSlotMs(epoch, 0, period, -1)).toBe(0);
});

test("failure policy: Retry-After honored but capped; 429s escalate; plain failures double", () => {
  expect(failureWaitMs({ retryAfterMs: 42_000 }, 10_000, 1)).toBe(42_000);
  expect(failureWaitMs({ retryAfterMs: 999_999_999 * 1000 }, 10_000, 1)).toBe(600_000);
  expect(failureWaitMs({ status: 429 }, 10_000, 1)).toBe(60_000);
  expect(failureWaitMs({ status: 429 }, 10_000, 3)).toBe(60_000);
  expect(failureWaitMs({ status: 429 }, 10_000, 6)).toBe(320_000);
  expect(failureWaitMs({ status: 429 }, 10_000, 12)).toBe(600_000);
  expect(failureWaitMs({ status: 500 }, 10_000, 1)).toBe(10_000);
  expect(failureWaitMs({ status: 503 }, 10_000, 4)).toBe(80_000);
  expect(failureWaitMs({}, 10_000, 2)).toBe(20_000);
});
