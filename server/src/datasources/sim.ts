import type { Bar, Fundamentals, NewsItem, Quote } from '../types';
import type { DataSource, NewsSource, StreamHandlers } from './DataSource';
import { gaussian, hashSeed, mulberry32 } from '../util/prng';

/**
 * Simulated provider: deterministic random-walk ticks so the entire UI is
 * testable with no API keys. Everything it emits is labeled SIMULATED.
 */

interface SimState {
  symbol: string;
  prevClose: number;
  open: number;
  price: number;
  high: number;
  low: number;
  volume: number;
  volPerTick: number;
  volatility: number; // per-tick sigma as a fraction of price
  drift: number;
  bars: Bar[]; // today's 1-min bars
  rand: () => number;
}

const MINUTES_OF_HISTORY = 390; // one full regular session

function basePriceFor(symbol: string, rand: () => number): number {
  if (symbol === '^VIX') return 13 + rand() * 14;
  if (symbol.endsWith('=X')) return 1.3 + rand() * 0.1;
  return 6 + rand() * 180;
}

export class SimSource implements DataSource, NewsSource {
  readonly id: string;
  readonly badge = 'SIMULATED';
  readonly delayed = false;

  private states = new Map<string, SimState>();
  private timer: NodeJS.Timeout | null = null;
  private subscribed: string[] = [];
  private handlers: StreamHandlers | null = null;

  constructor(idSuffix = '') {
    this.id = idSuffix ? `sim-${idSuffix}` : 'sim';
  }

  private state(symbol: string): SimState {
    let s = this.states.get(symbol);
    if (s) return s;
    const rand = mulberry32(hashSeed(symbol));
    const prevClose = basePriceFor(symbol, rand);
    // Some symbols gap hard so the factor grid / scanner have variety.
    const gapPct = (rand() - 0.45) * (rand() < 0.25 ? 8 : 2);
    const open = prevClose * (1 + gapPct / 100);
    const volatility = 0.0004 + rand() * 0.0016;
    s = {
      symbol,
      prevClose,
      open,
      price: open,
      high: open,
      low: open,
      volume: 0,
      volPerTick: Math.round(500 + rand() * 20000),
      volatility,
      drift: (rand() - 0.5) * 0.00005,
      bars: [],
      rand: mulberry32(hashSeed(symbol + ':walk')),
    };
    this.states.set(symbol, s);
    this.backfill(s);
    return s;
  }

  /** Generate intraday history so charts are full on first load. */
  private backfill(s: SimState): void {
    const now = Date.now();
    const start = now - MINUTES_OF_HISTORY * 60_000;
    let price = s.open;
    for (let i = 0; i < MINUTES_OF_HISTORY; i++) {
      const o = price;
      let h = o;
      let l = o;
      for (let j = 0; j < 4; j++) {
        price = Math.max(0.5, price * (1 + s.drift * 15 + s.volatility * 4 * gaussian(s.rand)));
        h = Math.max(h, price);
        l = Math.min(l, price);
      }
      const v = Math.round(s.volPerTick * (5 + s.rand() * 20) * (i < 30 || i > 360 ? 2.2 : 1));
      s.bars.push({ t: start + i * 60_000, o, h, l, c: price, v });
      s.volume += v;
    }
    s.price = price;
    s.high = Math.max(...s.bars.map((b) => b.h));
    s.low = Math.min(...s.bars.map((b) => b.l));
  }

  private tick(): void {
    if (!this.handlers) return;
    const now = Date.now();
    for (const symbol of this.subscribed) {
      const s = this.state(symbol);
      // occasional burst to make momentum factors light up
      const burst = s.rand() < 0.02 ? 6 : 1;
      s.price = Math.max(0.5, s.price * (1 + s.drift + s.volatility * burst * gaussian(s.rand)));
      s.high = Math.max(s.high, s.price);
      s.low = Math.min(s.low, s.price);
      const v = Math.round(s.volPerTick * (0.5 + s.rand()) * burst);
      s.volume += v;

      // roll the current 1-min bar
      const minuteStart = Math.floor(now / 60_000) * 60_000;
      let last = s.bars[s.bars.length - 1];
      if (!last || last.t !== minuteStart) {
        last = { t: minuteStart, o: s.price, h: s.price, l: s.price, c: s.price, v };
        s.bars.push(last);
        if (s.bars.length > MINUTES_OF_HISTORY + 60) s.bars.shift();
        this.handlers.onBar?.(symbol, last);
      } else {
        last.h = Math.max(last.h, s.price);
        last.l = Math.min(last.l, s.price);
        last.c = s.price;
        last.v += v;
      }

      this.handlers.onQuote?.(this.toQuote(s, now));
    }
  }

  private toQuote(s: SimState, ts: number): Quote {
    const spread = s.price * (0.0002 + s.rand() * 0.001);
    return {
      symbol: s.symbol,
      price: round(s.price),
      bid: round(s.price - spread / 2),
      ask: round(s.price + spread / 2),
      prevClose: round(s.prevClose),
      open: round(s.open),
      high: round(s.high),
      low: round(s.low),
      volume: s.volume,
      changePct: round(((s.price - s.prevClose) / s.prevClose) * 100),
      ts,
      source: this.badge,
      delayed: false,
      name: simName(s.symbol),
    };
  }

  // ---- DataSource ----

  async getSnapshot(symbols: string[]): Promise<Quote[]> {
    const now = Date.now();
    return symbols.map((sym) => this.toQuote(this.state(sym), now));
  }

  async getBars(symbol: string, timeframe: '1Min' | '1Day', lookback: number): Promise<Bar[]> {
    const s = this.state(symbol);
    if (timeframe === '1Min') return s.bars.slice(-lookback);
    // synthetic daily bars for average-volume history
    const rand = mulberry32(hashSeed(symbol + ':daily'));
    const out: Bar[] = [];
    let c = s.prevClose;
    const dayStart = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    for (let i = lookback; i >= 1; i--) {
      const o = c * (1 + (rand() - 0.5) * 0.02);
      c = o * (1 + (rand() - 0.5) * 0.04);
      out.push({
        t: dayStart - i * 86_400_000,
        o: round(o),
        h: round(Math.max(o, c) * 1.01),
        l: round(Math.min(o, c) * 0.99),
        c: round(c),
        v: Math.round(s.volPerTick * 390 * (8 + rand() * 10)),
      });
    }
    return out;
  }

  subscribeStream(symbols: string[], handlers: StreamHandlers): () => void {
    this.subscribed = [...symbols];
    this.handlers = handlers;
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), 1000);
      this.timer.unref?.();
    }
    handlers.onState?.('sim', 'simulated random-walk ticks');
    return () => {
      this.subscribed = [];
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  async getFundamentals(symbols: string[]): Promise<Fundamentals[]> {
    return symbols.map((symbol) => {
      const rand = mulberry32(hashSeed(symbol + ':fund'));
      const floatShares = Math.round((20 + rand() * 580) * 1e6);
      return {
        symbol,
        name: simName(symbol),
        exchange: symbol.endsWith('.TO') ? 'TSX' : 'US',
        currency: symbol.endsWith('.TO') ? 'CAD' : 'USD',
        // mostly inside the $2-10B mid-cap band, some outside so the
        // scanner's cap filter visibly drops a few
        marketCap: Math.round((1.2 + rand() * 11) * 1e9),
        floatShares,
        shortPctFloat: round(1 + rand() * 29),
        avgVolume30d: Math.round((0.8 + rand() * 15) * 1e6),
        peRatio: round(8 + rand() * 42),
        dividendYield: rand() < 0.55 ? round(rand() * 3.5) : null,
      };
    });
  }

  // ---- NewsSource (simulated headlines for full-sim mode) ----

  async getNews(symbols: string[], sinceMs: number): Promise<NewsItem[]> {
    const templates = [
      'announces Q2 results ahead of schedule',
      'receives analyst coverage update',
      'files 8-K disclosing material agreement',
      'schedules investor day for next month',
      'reports unusual options activity (simulated)',
      'provides preliminary guidance update',
    ];
    const items: NewsItem[] = [];
    const now = Date.now();
    for (const symbol of symbols) {
      const rand = mulberry32(hashSeed(symbol + ':news') ^ Math.floor(now / 600_000));
      const count = rand() < 0.6 ? 1 + Math.floor(rand() * 2) : 0;
      for (let i = 0; i < count; i++) {
        const ts = now - Math.floor(rand() * 6 * 3_600_000);
        if (ts < sinceMs) continue;
        items.push({
          id: `${symbol}-${ts}`,
          symbol,
          headline: `[SIM] ${symbol} ${templates[Math.floor(rand() * templates.length)]}`,
          source: 'Simulated Wire',
          ts,
        });
      }
    }
    return items.sort((a, b) => b.ts - a.ts);
  }
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function simName(symbol: string): string {
  if (symbol === '^VIX') return 'CBOE Volatility Index';
  if (symbol === 'CAD=X') return 'USD/CAD';
  const base = symbol.replace(/\.(TO|V)$/, '').replace(/[^A-Z]/g, '');
  return `${base.charAt(0)}${base.slice(1).toLowerCase()} ${symbol.endsWith('.TO') ? 'Canada Corp' : 'Holdings Inc'}`;
}
