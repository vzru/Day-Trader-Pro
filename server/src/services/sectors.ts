import type { SectorRow, ServerMessage } from '../types';
import { warn } from '../util/log';
import type { Router } from './router';

/** SPDR sector ETFs as live proxies for "which sectors are moving today". */
const SECTOR_ETFS: { symbol: string; name: string }[] = [
  { symbol: 'XLK', name: 'Technology' },
  { symbol: 'XLC', name: 'Communications' },
  { symbol: 'XLY', name: 'Cons. Discretionary' },
  { symbol: 'XLP', name: 'Cons. Staples' },
  { symbol: 'XLV', name: 'Health Care' },
  { symbol: 'XLF', name: 'Financials' },
  { symbol: 'XLI', name: 'Industrials' },
  { symbol: 'XLE', name: 'Energy' },
  { symbol: 'XLB', name: 'Materials' },
  { symbol: 'XLU', name: 'Utilities' },
  { symbol: 'XLRE', name: 'Real Estate' },
];

const REFRESH_MS = 60_000;

/** Publishes the sector ETF heat strip, hottest first. */
export class Sectors {
  private rows: SectorRow[] = [];
  private timer: NodeJS.Timeout | null = null;

  broadcast: (msg: ServerMessage) => void = () => {};

  constructor(private router: Router) {}

  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  message(): ServerMessage {
    return { type: 'sectors', rows: this.rows };
  }

  private async refresh(): Promise<void> {
    try {
      const quotes = await this.router.us.getSnapshot(SECTOR_ETFS.map((s) => s.symbol));
      const byQuote = new Map(quotes.map((q) => [q.symbol, q]));
      this.rows = SECTOR_ETFS
        .map(({ symbol, name }) => {
          const q = byQuote.get(symbol);
          return { symbol, name, price: q?.price ?? null, changePct: q?.changePct ?? null };
        })
        .sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
      this.broadcast(this.message());
    } catch (e) {
      warn('sectors', 'refresh failed (continuing):', e instanceof Error ? e.message : e);
    }
  }
}
