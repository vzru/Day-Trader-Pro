import { config } from '../config';
import type { DataSource } from '../datasources/DataSource';
import type {
  Bar, CalendarEvent, Fundamentals, NewsItem, Quote, ServerMessage, TickerDetail, WatchRow,
} from '../types';
import { error, log, warn } from '../util/log';
import { getSession, sessionElapsedFraction } from '../util/session';
import { gapPct, rangePct, relativeVolume, rsi14, spreadPct, vwap } from './indicators';
import { computeFactors, setupScore } from './score';
import { exchangeOf, isCaSymbol, Router } from './router';
import type { WatchlistStore } from './watchlist';

/** Chart ranges the UI can request. 1D is intraday (1-min); the rest are daily. */
export type ChartRange = '1D' | '1M' | '6M' | '1Y' | '5Y';
const RANGE_LOOKBACK: Record<Exclude<ChartRange, '1D'>, number> = {
  '1M': 22, '6M': 126, '1Y': 252, '5Y': 1260,
};

/** Evenly pick at most `n` values from a series (keeps first + last). */
function downsample(values: number[], n: number): number[] {
  if (values.length <= n) return values;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(values[Math.round((i / (n - 1)) * (values.length - 1))]);
  }
  return out;
}

// Real major-market indices (all route to the Yahoo/reference feed via isCaSymbol).
export const CONTEXT_SYMBOLS = ['^GSPC', '^IXIC', '^DJI', '^GSPTSE', '^VIX', 'CAD=X'];

const TICK_THROTTLE_MS = 400;
const DETAIL_INTERVAL_MS = 3_000;
const STATUS_INTERVAL_MS = 15_000;
const NEWS_INTERVAL_MS = 120_000;
const NEWS_LOOKBACK_MS = 72 * 3_600_000;
const EARNINGS_INTERVAL_MS = 6 * 3_600_000; // earnings dates move slowly
const EARNINGS_LOOKAHEAD_MS = 60 * 86_400_000;

/**
 * Central state hub: tracks watchlist + context + selected symbols, pumps
 * provider events out to connected frontends, and computes the 9-factor
 * detail for the selected ticker.
 */
export class Hub {
  private quotes = new Map<string, Quote>();
  private bars = new Map<string, Bar[]>();
  private funds = new Map<string, Fundamentals>();
  private avgVol = new Map<string, number>();
  private primed = new Set<string>();
  private newsItems: NewsItem[] = [];
  private earnings: CalendarEvent[] = [];
  private latestNewsTs = new Map<string, number>();
  private lastTickSent = new Map<string, number>();
  private unsubs: (() => void)[] = [];
  private timers: NodeJS.Timeout[] = [];
  private selected: string | null = null;

  broadcast: (msg: ServerMessage) => void = () => {};

  constructor(
    private router: Router,
    private watchlist: WatchlistStore,
  ) {
    router.onStatusChange = () => this.broadcastStatus();
  }

  // ---- lifecycle ----

  async start(): Promise<void> {
    this.selected = this.watchlist.list()[0] ?? 'AAPL';
    await this.refreshTracked();
    await this.ensureBars(this.selected);
    this.timers.push(setInterval(() => this.pushDetail(), DETAIL_INTERVAL_MS));
    this.timers.push(setInterval(() => this.broadcastStatus(), STATUS_INTERVAL_MS));
    if (config.newsFeed !== 'off') {
      void this.refreshNews();
      this.timers.push(setInterval(() => void this.refreshNews(), NEWS_INTERVAL_MS));
    }
    if (this.router.earnings) {
      void this.refreshEarnings();
      this.timers.push(setInterval(() => void this.refreshEarnings(), EARNINGS_INTERVAL_MS));
    }
    // Seed intraday history for the context-strip indices so each gets a
    // daily-movement sparkline (fire-and-forget; the poll keeps them current).
    void this.seedContextBars();
    log('hub', `started; selected=${this.selected}, tracking ${this.trackedSymbols().length} symbols`);
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    for (const u of this.unsubs) u();
  }

  // ---- tracking / subscriptions ----

  trackedSymbols(): string[] {
    const set = new Set<string>([...CONTEXT_SYMBOLS, ...this.watchlist.list()]);
    if (this.selected) set.add(this.selected);
    return [...set];
  }

  private async refreshTracked(): Promise<void> {
    const symbols = this.trackedSymbols();
    const byProvider = new Map<DataSource, string[]>();
    for (const sym of symbols) {
      const p = this.router.providerFor(sym);
      byProvider.set(p, [...(byProvider.get(p) ?? []), sym]);
    }

    for (const u of this.unsubs) u();
    this.unsubs = [];
    for (const [provider, syms] of byProvider) {
      const feedId = this.router.feedIdFor(provider);
      const unsub = provider.subscribeStream(syms, {
        onQuote: (q) => this.handleQuote(q),
        onBar: (sym, bar) => this.handleBar(sym, bar),
        onState: (state, detail) => this.router.setFeedState(feedId, state, detail),
      });
      this.unsubs.push(unsub);
    }

    // Prime fundamentals / avg volume / intraday bars for new symbols.
    const fresh = symbols.filter((s) => !this.primed.has(s));
    if (fresh.length) await this.primeSymbols(fresh);
  }

  private async primeSymbols(symbols: string[]): Promise<void> {
    for (const s of symbols) this.primed.add(s);
    try {
      const funds = await this.router.fundamentals.getFundamentals(symbols);
      for (const f of funds) {
        this.funds.set(f.symbol, f);
        if (f.avgVolume30d) this.avgVol.set(f.symbol, f.avgVolume30d);
      }
    } catch (e) {
      warn('hub', 'fundamentals prime failed:', e instanceof Error ? e.message : e);
    }
    for (const sym of symbols) {
      try {
        if (!this.avgVol.has(sym)) {
          const daily = await this.router.providerFor(sym).getBars(sym, '1Day', 30);
          if (daily.length) {
            this.avgVol.set(sym, daily.reduce((s, b) => s + b.v, 0) / daily.length);
          }
        }
      } catch (e) {
        warn('hub', `prime failed for ${sym}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  /**
   * Seed intraday 1-min history for one symbol (the selected one). Charts
   * only ever show the selected symbol, so this is fetched lazily to keep
   * REST usage low; live minute bars keep accruing via the stream.
   */
  private async ensureBars(symbol: string): Promise<void> {
    if ((this.bars.get(symbol)?.length ?? 0) > 5) return;
    try {
      const intraday = await this.router.providerFor(symbol).getBars(symbol, '1Min', 390);
      if (intraday.length) {
        const live = this.bars.get(symbol) ?? [];
        const merged = [...intraday, ...live.filter((b) => b.t > intraday[intraday.length - 1].t)];
        this.bars.set(symbol, merged);
      }
    } catch (e) {
      warn('hub', `bars seed failed for ${symbol}:`, e instanceof Error ? e.message : e);
    }
  }

  private async seedContextBars(): Promise<void> {
    for (const s of CONTEXT_SYMBOLS) {
      try {
        await this.ensureBars(s);
      } catch {
        /* a missing index sparkline is not worth surfacing */
      }
    }
  }

  /** Downsampled intraday close series per context index, for the header sparklines. */
  contextSeries(): { symbol: string; points: number[] }[] {
    const out: { symbol: string; points: number[] }[] = [];
    for (const s of CONTEXT_SYMBOLS) {
      const bars = this.bars.get(s) ?? [];
      if (bars.length < 2) continue;
      out.push({ symbol: s, points: downsample(bars.map((b) => b.c), 32) });
    }
    return out;
  }

  // ---- provider event handlers ----

  private handleQuote(q: Quote): void {
    this.quotes.set(q.symbol, q);
    const now = Date.now();
    const last = this.lastTickSent.get(q.symbol) ?? 0;
    if (now - last < TICK_THROTTLE_MS) return;
    this.lastTickSent.set(q.symbol, now);
    this.broadcast({ type: 'tick', quote: q, relVol: this.relVolFor(q.symbol) });
  }

  private handleBar(symbol: string, bar: Bar): void {
    const arr = this.bars.get(symbol) ?? [];
    const lastBar = arr[arr.length - 1];
    if (lastBar && lastBar.t === bar.t) arr[arr.length - 1] = bar;
    else arr.push(bar);
    if (arr.length > 600) arr.shift();
    this.bars.set(symbol, arr);
    if (symbol === this.selected) this.broadcast({ type: 'bar', symbol, bar });
  }

  private relVolFor(symbol: string): number | null {
    const q = this.quotes.get(symbol);
    return relativeVolume(q?.volume ?? null, this.avgVol.get(symbol) ?? null, sessionElapsedFraction());
  }

  // ---- selection / detail ----

  async select(symbolRaw: string): Promise<void> {
    const symbol = symbolRaw.trim().toUpperCase();
    if (!symbol) return;
    this.selected = symbol;
    if (!this.primed.has(symbol)) await this.refreshTracked();
    await this.ensureBars(symbol);
    if (this.selected !== symbol) return; // user moved on while we fetched
    this.broadcast({ type: 'bars', symbol, bars: this.bars.get(symbol) ?? [] });
    this.pushDetail();
  }

  getSelected(): string | null {
    return this.selected;
  }

  private pushDetail(): void {
    if (!this.selected) return;
    const detail = this.computeDetail(this.selected);
    if (detail) this.broadcast({ type: 'detail', detail });
  }

  computeDetail(symbol: string): TickerDetail | null {
    const quote = this.quotes.get(symbol);
    if (!quote) return null;
    const bars = this.bars.get(symbol) ?? [];
    const closes = bars.map((b) => b.c);
    const f = this.funds.get(symbol) ?? null;
    const vw = vwap(bars);
    const spread = spreadPct(quote.bid, quote.ask);
    const newsTs = this.latestNewsTs.get(symbol) ?? null;

    const factors = computeFactors({
      relVol: this.relVolFor(symbol),
      gapPct: gapPct(quote.open, quote.prevClose),
      price: quote.price,
      vwap: vw,
      rsi: rsi14(closes.slice(-120)),
      spreadPct: spread,
      rangePct: rangePct(quote.high, quote.low, quote.price),
      floatShares: f?.floatShares ?? null,
      shortPctFloat: f?.shortPctFloat ?? null,
      newsAgeMs: newsTs ? Date.now() - newsTs : null,
      newsAvailable: config.newsFeed !== 'off',
    });

    return { symbol, quote, vwap: vw, spreadPct: spread, factors, setup: setupScore(factors), fundamentals: f };
  }

  // ---- watchlist ----

  watchRows(): WatchRow[] {
    return this.watchlist.list().map((symbol) => {
      const q = this.quotes.get(symbol);
      return {
        symbol,
        exchange: exchangeOf(symbol),
        price: q?.price ?? null,
        changePct: q?.changePct ?? null,
        relVol: this.relVolFor(symbol),
        source: q?.source ?? '—',
        delayed: q?.delayed ?? false,
      };
    });
  }

  /** Bars for a chart range: 1D = live intraday buffer (or fetched), else daily history. */
  async rangeBars(symbolRaw: string, range: ChartRange): Promise<Bar[]> {
    const symbol = symbolRaw.trim().toUpperCase();
    if (!symbol) return [];
    const provider = this.router.providerFor(symbol);
    if (range === '1D') {
      const live = this.bars.get(symbol) ?? [];
      if (live.length > 5) return live;
      return provider.getBars(symbol, '1Min', 390);
    }
    return provider.getBars(symbol, '1Day', RANGE_LOOKBACK[range]);
  }

  async addSymbol(symbol: string): Promise<{ ok: boolean; error?: string }> {
    const res = this.watchlist.add(symbol);
    if (res.ok) {
      await this.refreshTracked();
      this.broadcast({ type: 'watchlist', rows: this.watchRows() });
    }
    return res;
  }

  async removeSymbol(symbol: string): Promise<boolean> {
    const removed = this.watchlist.remove(symbol);
    if (removed) {
      await this.refreshTracked();
      this.broadcast({ type: 'watchlist', rows: this.watchRows() });
    }
    return removed;
  }

  // ---- news ----

  private async refreshNews(): Promise<void> {
    if (!this.router.news) return;
    try {
      const symbols = [...new Set([...this.watchlist.list(), ...(this.selected ? [this.selected] : [])])];
      const items = await this.router.news.getNews(symbols, Date.now() - NEWS_LOOKBACK_MS);
      this.newsItems = items.slice(0, 60);
      for (const item of items) {
        const cur = this.latestNewsTs.get(item.symbol) ?? 0;
        if (item.ts > cur) this.latestNewsTs.set(item.symbol, item.ts);
      }
      this.broadcast({ type: 'news', items: this.newsItems });
      this.router.setFeedState('news', config.newsFeed === 'sim' ? 'sim' : 'live');
    } catch (e) {
      error('hub', 'news refresh failed (continuing without):', e instanceof Error ? e.message : e);
      this.router.setFeedState('news', 'error', 'news fetch failed');
    }
  }

  getNews(): NewsItem[] {
    return this.newsItems;
  }

  // ---- earnings calendar ----

  private async refreshEarnings(): Promise<void> {
    if (!this.router.earnings) return;
    try {
      const symbols = [...new Set([...this.watchlist.list(), ...(this.selected ? [this.selected] : [])])]
        .filter((s) => !isCaSymbol(s));
      const now = Date.now();
      this.earnings = await this.router.earnings.getEarnings(symbols, now, now + EARNINGS_LOOKAHEAD_MS);
    } catch (e) {
      warn('hub', 'earnings refresh failed (continuing without):', e instanceof Error ? e.message : e);
    }
  }

  getEarnings(): CalendarEvent[] {
    return this.earnings;
  }

  // ---- snapshots for new websocket clients ----

  helloMessage(): ServerMessage {
    return {
      type: 'hello',
      feeds: this.router.getStatuses(),
      session: getSession(),
      watchlist: this.watchRows(),
      selected: this.selected,
    };
  }

  /** Everything a freshly connected client needs to paint the screen. */
  snapshotMessages(): ServerMessage[] {
    const msgs: ServerMessage[] = [this.helloMessage()];
    for (const [, q] of this.quotes) {
      msgs.push({ type: 'tick', quote: q, relVol: this.relVolFor(q.symbol) });
    }
    if (this.selected) {
      msgs.push({ type: 'bars', symbol: this.selected, bars: this.bars.get(this.selected) ?? [] });
      const detail = this.computeDetail(this.selected);
      if (detail) msgs.push({ type: 'detail', detail });
    }
    if (this.newsItems.length) msgs.push({ type: 'news', items: this.newsItems });
    return msgs;
  }

  private broadcastStatus(): void {
    this.broadcast({ type: 'status', feeds: this.router.getStatuses(), session: getSession() });
  }
}
