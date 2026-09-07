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
