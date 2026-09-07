import { expect, test } from "bun:test";
import { httpError } from "../feed";

function thrownError(promise: () => never): { status?: number; retryAfterMs?: number; message: string } {
  try {
    promise();
  } catch (err) {
    const e = err as Error & { status?: number; retryAfterMs?: number };
    return { status: e.status, retryAfterMs: e.retryAfterMs, message: e.message };
  }
  throw new Error("expected httpError to throw");
}

test("httpError carries the status and Retry-After seconds as retryAfterMs", () => {
  const res = new Response("rate limited", { status: 429, headers: { "retry-after": "42" } });
  const err = thrownError(() => httpError(res, "https://example.com/f"));
  expect(err.status).toBe(429);
  expect(err.retryAfterMs).toBe(42_000);
  expect(err.message).toContain("HTTP 429");
});

test("httpError without a Retry-After header leaves retryAfterMs undefined", () => {
  const res = new Response("nope", { status: 500 });
  const err = thrownError(() => httpError(res, "https://example.com/f"));
  expect(err.status).toBe(500);
  expect(err.retryAfterMs).toBeUndefined();
});

test("httpError ignores a non-numeric Retry-After header", () => {
  const res = new Response("x", { status: 429, headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" } });
  const err = thrownError(() => httpError(res, "https://example.com/f"));
  expect(err.status).toBe(429);
  expect(err.retryAfterMs).toBeGreaterThan(0);
});

test("httpError parses an HTTP-date Retry-After into a forward delay", () => {
  const future = new Date(Date.now() + 90_000).toUTCString();
  const res = new Response("x", { status: 503, headers: { "retry-after": future } });
  const err = thrownError(() => httpError(res, "https://example.com/f"));
  expect(err.status).toBe(503);
  expect(err.retryAfterMs).toBeGreaterThan(80_000);
  expect(err.retryAfterMs).toBeLessThan(100_000);
});

test("httpError ignores zero and empty Retry-After values", () => {
  const zero = new Response("x", { status: 429, headers: { "retry-after": "0" } });
  expect(thrownError(() => httpError(zero, "https://example.com/f")).retryAfterMs).toBeUndefined();
  const empty = new Response("x", { status: 429, headers: { "retry-after": "" } });
  expect(thrownError(() => httpError(empty, "https://example.com/f")).retryAfterMs).toBeUndefined();
});
