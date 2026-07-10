/**
 * Sliding-window rate limiter. Each provider gets one of these with a
 * budget deliberately below the provider's published cap, so bursts from
 * the scanner + detail panel can never push us over a free-tier limit.
 */
export class RateLimiter {
  private stamps: number[] = [];

  constructor(
    public readonly name: string,
    private readonly maxPerWindow: number,
    private readonly windowMs = 60_000,
  ) {}

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.stamps.length && this.stamps[0] < cutoff) this.stamps.shift();
  }

  /** Number of calls still available in the current window. */
  remaining(): number {
    this.prune(Date.now());
    return Math.max(0, this.maxPerWindow - this.stamps.length);
  }

  /** Try to consume a slot immediately. Returns false if over budget. */
  tryAcquire(): boolean {
    const now = Date.now();
    this.prune(now);
    if (this.stamps.length >= this.maxPerWindow) return false;
    this.stamps.push(now);
    return true;
  }

  /** Wait (if needed) until a slot is free, then consume it. */
  async acquire(): Promise<void> {
    for (;;) {
      if (this.tryAcquire()) return;
      const now = Date.now();
      const waitMs = Math.max(50, this.stamps[0] + this.windowMs - now);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}
