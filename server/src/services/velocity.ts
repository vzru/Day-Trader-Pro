/**
 * Rolling short-window price memory, for the halt-risk heuristic on symbols
 * we only see as periodic snapshots (scanner / alert engine — no bar stream).
 */

interface Sample {
  t: number;
  price: number;
}

const WINDOW_MS = 6 * 60_000; // keep a hair over 5 minutes

export class VelocityTracker {
  private samples = new Map<string, Sample[]>();

  /** Record the latest price and return the % move over the last ~5 minutes. */
  push(symbol: string, price: number | null, now = Date.now()): number | null {
    if (price == null || price <= 0) return null;
    const arr = this.samples.get(symbol) ?? [];
    arr.push({ t: now, price });
    while (arr.length && arr[0].t < now - WINDOW_MS) arr.shift();
    this.samples.set(symbol, arr);
    const oldest = arr[0];
    if (!oldest || now - oldest.t < 3 * 60_000) return null; // need a real window
    return ((price - oldest.price) / oldest.price) * 100;
  }
}
