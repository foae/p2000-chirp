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
  expect(err.retryAfterMs).toBeUndefined();
});
