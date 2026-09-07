import { expect, test } from "bun:test";
import { parseWallAmsterdam } from "../tz";

test("summer time (CEST): Amsterdam wall clock is UTC+2", () => {
  const d = parseWallAmsterdam("2026-06-21", "15:04:05");
  expect(d?.toISOString()).toBe("2026-06-21T13:04:05.000Z");
});

test("winter time (CET): Amsterdam wall clock is UTC+1", () => {
  const d = parseWallAmsterdam("2026-12-21", "15:04:05");
  expect(d?.toISOString()).toBe("2026-12-21T14:04:05.000Z");
});

test("DD-MM-YYYY format (p2000alarm style)", () => {
  const d = parseWallAmsterdam("06-09-2026", "23:47:49");
  expect(d?.toISOString()).toBe("2026-09-06T21:47:49.000Z");
});

test("missing seconds tolerated", () => {
  const d = parseWallAmsterdam("2026-06-21", "15:04");
  expect(d?.toISOString()).toBe("2026-06-21T13:04:00.000Z");
});

test("DST transition hour still yields a valid date", () => {
  const d = parseWallAmsterdam("2026-03-29", "02:30:00");
  expect(d).not.toBeNull();
});

test("garbage and out-of-range inputs return null, never throw", () => {
  expect(parseWallAmsterdam("Vandaag", "22:19:55")).toBeNull();
  expect(parseWallAmsterdam("06-09", "22:19:55")).toBeNull();
  expect(parseWallAmsterdam("", "")).toBeNull();
  expect(parseWallAmsterdam("2026-13-40", "15:04:05")).toBeNull();
  expect(parseWallAmsterdam("2026-06-21", "25:00:00")).toBeNull();
  expect(parseWallAmsterdam("2026-06-21", "15:04:99")).toBeNull();
});
