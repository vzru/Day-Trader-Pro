import type { Quote, ServerMessage, TopRow } from '../types';
import { warn } from '../util/log';
import type { Router } from './router';

/**
 * A broad candidate pool of the largest US-market-listed companies (incl. big
 * ADRs like TSM). We fetch live market caps for the whole pool from Yahoo,
 * sort descending, and publish the true top N — so the ranking reflects real
 * caps, not a hand-picked order. The pool only needs to be wide enough to
 * contain every plausible top-N name.
 */
const POOL = [
  // mega-cap tech / comm
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'AVGO', 'TSLA', 'ORCL', 'CRM',
  'AMD', 'ADBE', 'NFLX', 'CSCO', 'QCOM', 'TXN', 'INTU', 'IBM', 'NOW', 'AMAT',
  'MU', 'PLTR', 'ANET', 'PANW', 'INTC', 'TSM', 'ASML',
  // financials
  'BRK.B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'AXP', 'SPGI', 'BLK', 'C', 'SCHW',
  // health care
  'LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'TMO', 'ABT', 'DHR', 'ISRG', 'AMGN', 'PFE',
  // consumer
  'WMT', 'COST', 'HD', 'PG', 'KO', 'PEP', 'MCD', 'DIS', 'NKE', 'LOW',
  // energy / industrial / telecom
  'XOM', 'CVX', 'GE', 'CAT', 'LIN', 'RTX', 'HON', 'UNP', 'BA', 'TMUS', 'VZ', 'T',
];

const TOP_N = 25;
const REFRESH_MS = 30_000;

/** Publishes the live market-cap-ranked top-N US companies. */
export class TopCompanies {
  private rows: TopRow[] = [];
  private timer: NodeJS.Timeout | null = null;
  broadcast: (msg: ServerMessage) => void = () => {};
  /** Fired after each refresh (e.g. so the hub can pull the top names' earnings). */
  onUpdate: () => void = () => {};

  constructor(private router: Router) {}

  /** Current Top-25 tickers, ranked. */
  symbols(): string[] {
    return this.rows.map((r) => r.symbol);
  }

  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  message(): ServerMessage {
    return { type: 'top', rows: this.rows };
  }

  private async refresh(): Promise<void> {
    try {
      // Market caps + names for the whole pool (Yahoo, cached 12h so this is
      // one network burst then free).
      const funds = await this.router.fundamentals.getFundamentals(POOL, { enrich: false });
      const ranked = funds
        .filter((f) => typeof f.marketCap === 'number' && f.marketCap! > 0)
        .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
        .slice(0, TOP_N);
      if (!ranked.length) return;

      // Live-ish prices for just the top N (US provider snapshot; one batched call).
      const symbols = ranked.map((f) => f.symbol);
      let quotes: Quote[] = [];
      try {
        quotes = await this.router.us.getSnapshot(symbols);
      } catch (e) {
        warn('top', 'snapshot failed (showing caps only):', e instanceof Error ? e.message : e);
      }
      const byQuote = new Map(quotes.map((q) => [q.symbol, q]));

      this.rows = ranked.map((f, i) => {
        const q = byQuote.get(f.symbol);
        return {
          rank: i + 1,
          symbol: f.symbol,
          name: f.name,
          marketCap: f.marketCap ?? null,
          price: q?.price ?? null,
          changePct: q?.changePct ?? null,
          source: q?.source ?? '—',
          delayed: q?.delayed ?? false,
        };
      });
      this.broadcast(this.message());
      this.onUpdate();
    } catch (e) {
      warn('top', 'refresh failed (continuing):', e instanceof Error ? e.message : e);
    }
  }
}

export { POOL as TOP_POOL };
