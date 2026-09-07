import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

interface StateShape {
  messages: Record<string, number>;
  sequences: Record<string, number>;
}

export class SeenStore {
  private messages = new Map<string, number>();
  private sequences = new Map<string, number>();
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
    } catch {
      this.existed = false;
    }
  }

  lastSeenMessage(message: string): number | undefined {
    return this.messages.get(message);
  }

  lastSeenSequence(seq: string): number | undefined {
    return this.sequences.get(seq);
  }

  markSeen(message: string, seq?: string): void {
    const now = Date.now();
    this.messages.set(message, now);
    if (seq) this.sequences.set(seq, now);
  }

  prune(pruneMs: number): number {
    const cutoff = Date.now() - pruneMs;
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
    return removed;
  }

  save(): void {
    const state: StateShape = {
      messages: Object.fromEntries(this.messages),
      sequences: Object.fromEntries(this.sequences),
    };
    const dir = dirname(this.path);
    if (dir !== "" && dir !== ".") mkdirSync(dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(state));
  }

  get size(): number {
    return this.messages.size;
  }
}
