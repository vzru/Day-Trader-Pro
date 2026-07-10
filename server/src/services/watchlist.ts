import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { log, warn } from '../util/log';

const FILE = path.join(config.dataDir, 'watchlist.json');
const DEFAULTS = ['AAPL', 'AMD', 'PLTR', 'RIOT', 'SHOP.TO', 'BTE.TO'];
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-^=]{0,11}$/;
const MAX = 50;

/** Watchlist persisted to a local JSON file the user can also hand-edit. */
export class WatchlistStore {
  private symbols: string[] = [];

  constructor() {
    this.symbols = this.load();
  }

  private load(): string[] {
    try {
      if (fs.existsSync(FILE)) {
        const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        if (Array.isArray(raw)) {
          return raw.map((s) => String(s).toUpperCase()).filter((s) => SYMBOL_RE.test(s)).slice(0, MAX);
        }
      }
    } catch (e) {
      warn('watchlist', `could not read ${FILE}, using defaults:`, e);
    }
    this.persist(DEFAULTS);
    return [...DEFAULTS];
  }

  private persist(symbols: string[]): void {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(symbols, null, 2));
    } catch (e) {
      warn('watchlist', 'could not persist watchlist:', e);
    }
  }

  list(): string[] {
    return [...this.symbols];
  }

  add(symbolRaw: string): { ok: boolean; error?: string } {
    const symbol = symbolRaw.trim().toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return { ok: false, error: `Invalid symbol "${symbolRaw}"` };
    if (this.symbols.includes(symbol)) return { ok: false, error: `${symbol} already on watchlist` };
    if (this.symbols.length >= MAX) return { ok: false, error: `Watchlist is capped at ${MAX} symbols` };
    this.symbols.push(symbol);
    this.persist(this.symbols);
    log('watchlist', `added ${symbol}`);
    return { ok: true };
  }

  remove(symbolRaw: string): boolean {
    const symbol = symbolRaw.trim().toUpperCase();
    const before = this.symbols.length;
    this.symbols = this.symbols.filter((s) => s !== symbol);
    if (this.symbols.length !== before) {
      this.persist(this.symbols);
      log('watchlist', `removed ${symbol}`);
      return true;
    }
    return false;
  }
}
