import { config } from '../config';
import type { DataSource } from '../datasources/DataSource';
import type {
  Bar, CalendarEvent, Fundamentals, NewsItem, Quote, ServerMessage, TickerDetail, WatchRow,
} from '../types';
import { error, log, warn } from '../util/log';
import { etDateStr, getSession, sessionElapsedFraction } from '../util/session';
import { gapPct, rangePct, relativeVolume, rsi14, spreadPct, vwap } from './indicators';
import { computeFactors, setupScore } from './score';
import { exchangeOf, isCaSymbol, Router } from './router';
import type { WatchlistStore } from './watchlist';

/** Chart ranges the UI can request. 1D is intraday (1-min), 1W/1M use hourly, rest daily. */
export type ChartRange = '1D' | '1W' | '1M' | '6M' | '1Y' | '5Y' | '10Y';
const RANGE_LOOKBACK: Record<'6M' | '1Y' | '5Y' | '10Y', number> = {
  '6M': 126, '1Y': 252, '5Y': 1260, '10Y': 2520,
};
/** ~5 trading days of regular-hours hourly bars. */
const WEEK_HOURLY_LOOKBACK = 40;
/** ~22 trading days of regular-hours hourly bars (downsampled to open/mid/close). */
const MONTH_HOURLY_LOOKBACK = 170;

/**
 * Reduce intraday hourly bars to three points per trading day — the opening
 * price, a midday price, and the closing price — for the 1-month chart.
 */
function dailyOpenMidClose(hourly: Bar[]): Bar[] {
  const byDay = new Map<string, Bar[]>();
  for (const b of hourly) {
    const day = etDateStr(b.t);
    const arr = byDay.get(day);
    if (arr) arr.push(b);
    else byDay.set(day, [b]);
  }
  const out: Bar[] = [];
  for (const bars of byDay.values()) {
    bars.sort((a, b) => a.t - b.t);
    const first = bars[0];
    const last = bars[bars.length - 1];
    const mid = bars[Math.floor((bars.length - 1) / 2)];
    const pt = (t: number, price: number, v = 0): Bar => ({ t, o: price, h: price, l: price, c: price, v });
    out.push(pt(first.t, first.o)); // start of day (open)
    if (bars.length > 2) out.push(pt(mid.t, mid.c)); // midday
    out.push(pt(last.t, last.c, last.v)); // end of day (close)
  }
  return out.sort((a, b) => a.t - b.t);
}

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
const EARNINGS_LOOKAHEAD_MS = 90 * 86_400_000; // ~one quarter ahead
// Sparklines are decorative — seed them after the on-screen watchlist / detail /
// top list have had first crack at the (rate-limited) Yahoo feed.
const CONTEXT_SEED_DELAY_MS = 6_000;

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
  /** Symbols whose slow fields (float / short interest) have been fetched. */
  private enriched = new Set<string>();
  private newsItems: NewsItem[] = [];
  private earnings: CalendarEvent[] = [];
  private earningsSig = '';
  private latestNewsTs = new Map<string, number>();
  /** Supplies the current Top-25 symbols so their earnings are included. Set in index.ts. */
  topSymbols: () => string[] = () => [];
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
    // Fundamentals (Yahoo) and the chart bars (Alpaca for a US pick) hit
    // different providers, so fetch them in parallel.
    await Promise.all([this.refreshTracked(), this.ensureBars(this.selected)]);
    // Slow float/short-interest lookup for the selected stock only — don't
    // block startup on it; the detail repaints when it lands.
    void this.enrichSelected(this.selected);
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
    // daily-movement sparkline. Deferred so the watchlist / detail / top list
    // get the rate-limited Yahoo feed first; the poll keeps them current after.
    setTimeout(() => void this.seedContextBars(), CONTEXT_SEED_DELAY_MS).unref?.();
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
      // Fast path: batched cheap fields only (cap / avg vol / P/E / dividend).
      // The slow per-symbol float+short lookup is done lazily for the selected
      // stock via enrichSelected(), not for the whole watchlist up front.
      const funds = await this.router.fundamentals.getFundamentals(symbols, { enrich: false });
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
   * Fetch the slow fields (float / short interest) for one symbol — the
   * selected one. Runs in the background and repaints the detail when it lands.
   */
  private async enrichSelected(symbol: string): Promise<void> {
    if (this.enriched.has(symbol)) return;
    this.enriched.add(symbol); // guard against duplicate in-flight fetches
    try {
      const [f] = await this.router.fundamentals.getFundamentals([symbol], { enrich: true });
      if (f) {
        this.funds.set(symbol, f);
        if (f.avgVolume30d) this.avgVol.set(symbol, f.avgVolume30d);
      }
      if (this.selected === symbol) this.pushDetail();
    } catch (e) {
      this.enriched.delete(symbol); // let a later selection retry
      warn('hub', `enrich failed for ${symbol}:`, e instanceof Error ? e.message : e);
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
    // Fill in float / short interest for the newly selected stock (lazy).
    void this.enrichSelected(symbol);
    // Pull the selected stock's news so the (selected-scoped) news panel fills in.
    void this.refreshNews();
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
    if (range === '1W') return provider.getBars(symbol, '1Hour', WEEK_HOURLY_LOOKBACK);
    if (range === '1M') {
      const hourly = await provider.getBars(symbol, '1Hour', MONTH_HOURLY_LOOKBACK);
      return dailyOpenMidClose(hourly);
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
      const symbols = [...new Set([...this.watchlist.list(), ...this.topSymbols(), ...(this.selected ? [this.selected] : [])])]
        .filter((s) => !isCaSymbol(s));
      const now = Date.now();
      let events = (await this.router.earnings.getEarnings(symbols, now, now + EARNINGS_LOOKAHEAD_MS))
        .filter((e) => e.date >= new Date(now).toISOString().slice(0, 10)) // upcoming only
        .sort((a, b) => a.date.localeCompare(b.date));
      // Attach company names from the fundamentals cache (Top-25 / watchlist are
      // already fetched, so this is a cache hit, not a network call).
      if (events.length) {
        const es = [...new Set(events.map((e) => e.symbol).filter((s): s is string => !!s))];
        try {
          const funds = await this.router.fundamentals.getFundamentals(es, { enrich: false });
          const nameBy = new Map(funds.map((f) => [f.symbol, f.name]));
          events = events.map((e) => (e.symbol && nameBy.get(e.symbol) ? { ...e, name: nameBy.get(e.symbol) } : e));
        } catch {
          /* names are optional decoration */
        }
      }
      const sig = events.map((e) => `${e.symbol}@${e.date}@${e.name ?? ''}`).join('|');
      if (sig === this.earningsSig) return; // unchanged — don't re-broadcast
      this.earningsSig = sig;
      this.earnings = events;
      this.broadcast({ type: 'earnings', events });
    } catch (e) {
      warn('hub', 'earnings refresh failed (continuing without):', e instanceof Error ? e.message : e);
    }
  }

  /** Called when the Top-25 list changes so their earnings get pulled in. */
  onTopUpdated(): void {
    void this.refreshEarnings();
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
    if (this.earnings.length) msgs.push({ type: 'earnings', events: this.earnings });
    return msgs;
  }

  private broadcastStatus(): void {
    this.broadcast({ type: 'status', feeds: this.router.getStatuses(), session: getSession() });
  }
}
