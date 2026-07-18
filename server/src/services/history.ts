/**
 * In-memory score history: one point per symbol per minute, pruned after 24h.
 * Two namespaces so the 9-factor setup score (detail panel) and the 5-factor
 * scan score (scanner cards) don't mix in one series.
 */

type HistKind = 'setup' | 'scan';

interface Point {
  t: number;
  score: number;
}

const MAX_AGE_MS = 24 * 3_600_000;
/** Ignore re-records inside the same minute (detail recomputes every 3s). */
const MIN_GAP_MS = 55_000;
const MAX_POINTS = 24 * 60;

class ScoreHistory {
  private series = new Map<string, Point[]>();

  private key(kind: HistKind, symbol: string): string {
    return `${kind}:${symbol}`;
  }

  record(kind: HistKind, symbol: string, score: number, now = Date.now()): void {
    const key = this.key(kind, symbol);
    const arr = this.series.get(key) ?? [];
    const last = arr[arr.length - 1];
    if (last && now - last.t < MIN_GAP_MS) {
      last.score = score; // refresh within the same minute instead of appending
      return;
    }
    arr.push({ t: now, score });
    // prune: age + hard cap
    const cutoff = now - MAX_AGE_MS;
    while (arr.length && (arr[0].t < cutoff || arr.length > MAX_POINTS)) arr.shift();
    this.series.set(key, arr);
  }

  /** Last `n` scores (oldest → newest), for sparklines. */
  points(kind: HistKind, symbol: string, n = 30): number[] {
    const arr = this.series.get(this.key(kind, symbol)) ?? [];
    return arr.slice(-n).map((p) => p.score);
  }
}

/** Module-level singleton — hub and scanner both write into it. */
export const scoreHistory = new ScoreHistory();
