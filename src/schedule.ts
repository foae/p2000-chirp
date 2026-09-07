export function perSourceIntervalMs(staggerSeconds: number, sourceCount: number): number {
  if (sourceCount <= 1) return Math.max(15, staggerSeconds) * 1000;
  return staggerSeconds * sourceCount * 1000;
}

export function jitterMs(rand: () => number = Math.random): number {
  return 1000 + rand() * 2000;
}

export function backoffMs(baseMs: number, failures: number, capMs: number = 600_000): number {
  const exp = Math.max(0, failures - 1);
  return Math.min(baseMs * 2 ** exp, capMs);
}

export function nextSlotMs(epoch: number, offsetMs: number, periodMs: number, afterMs: number): number {
  const base = epoch + offsetMs;
  const k = Math.max(0, Math.ceil((afterMs - base) / periodMs));
  return base + k * periodMs;
}

export function failureWaitMs(
  failure: { status?: number; retryAfterMs?: number },
  baseMs: number,
  failures: number,
  capMs: number = 600_000,
): number {
  let waitMs: number;
  if (failure.retryAfterMs !== undefined) {
    waitMs = failure.retryAfterMs;
  } else if (failure.status === 429) {
    waitMs = Math.max(60_000, backoffMs(baseMs, failures));
  } else {
    waitMs = backoffMs(baseMs, failures);
  }
  return Math.min(waitMs, capMs);
}
