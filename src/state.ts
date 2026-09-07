import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

interface StateShape {
  messages: Record<string, number>;
  sequences: Record<string, number>;
  bootstrapped: Record<string, number>;
}

export class SeenStore {
  private messages = new Map<string, number>();
  private sequences = new Map<string, number>();
  private bootstrappedSources = new Map<string, number>();
  private dirty = false;
  existed: boolean;

  constructor(private readonly path: string) {
    this.existed = existsSync(path);
    if (!this.existed) return;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as StateShape;
      if (parsed && typeof parsed.messages === "object" && parsed.messages !== null) {
        for (const [key, ts] of Object.entries(parsed.messages)) {
          if (typeof ts === "number") this.messages.set(key, ts);
        }
      }
      if (parsed && typeof parsed.sequences === "object" && parsed.sequences !== null) {
        for (const [key, ts] of Object.entries(parsed.sequences)) {
          if (typeof ts === "number") this.sequences.set(key, ts);
        }
      }
      if (parsed && typeof parsed.bootstrapped === "object" && parsed.bootstrapped !== null) {
        for (const [key, ts] of Object.entries(parsed.bootstrapped)) {
          if (typeof ts === "number") this.bootstrappedSources.set(key, ts);
        }
      }
    } catch {
      this.existed = false;
      console.warn(
        `[warn] state file "${path}" is corrupt or unreadable — starting with empty dedupe state (a fresh bootstrap will run)`,
      );
    }
  }

  isSourceBootstrapped(sourceId: string): boolean {
    return this.bootstrappedSources.has(sourceId);
  }

  markSourceBootstrapped(sourceId: string): void {
    this.bootstrappedSources.set(sourceId, Date.now());
    this.dirty = true;
  }

  lastSeenMessage(message: string): number | undefined {
    return this.messages.get(message);
  }

  lastSeenSequence(seq: string): number | undefined {
    return this.sequences.get(seq);
  }

  hasSeenExtension(message: string, windowMs: number, now: number = Date.now()): boolean {
    const cutoff = now - windowMs;
    for (const [seen, ts] of this.messages) {
      if (ts < cutoff) continue;
      if (seen.length > message.length && seen.startsWith(message)) return true;
    }
    return false;
  }

  markSeen(message: string, seq: string | undefined, now: number = Date.now()): void {
    this.messages.set(message, now);
    if (seq) this.sequences.set(seq, now);
    this.dirty = true;
  }

  prune(pruneMs: number, now: number = Date.now()): number {
    const cutoff = now - pruneMs;
    let removed = 0;
    for (const [key, ts] of this.messages) {
      if (ts < cutoff) {
        this.messages.delete(key);
        removed++;
      }
    }
    for (const [key, ts] of this.sequences) {
      if (ts < cutoff) {
        this.sequences.delete(key);
        removed++;
      }
    }
    if (removed > 0) this.dirty = true;
    return removed;
  }

  save(): void {
    if (!this.dirty) return;
    const state: StateShape = {
      messages: Object.fromEntries(this.messages),
      sequences: Object.fromEntries(this.sequences),
      bootstrapped: Object.fromEntries(this.bootstrappedSources),
    };
    const dir = dirname(this.path);
    if (dir !== "" && dir !== ".") mkdirSync(dir, { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    try {
      renameSync(tmp, this.path);
    } catch (err) {
      unlinkSync(tmp);
      throw err;
    }
    this.dirty = false;
  }
}
