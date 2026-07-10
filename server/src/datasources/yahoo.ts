import yahooFinance from 'yahoo-finance2';
import type { Bar, Fundamentals, Quote } from '../types';
import { log, warn } from '../util/log';
import { RateLimiter } from '../util/rateLimiter';
import type { DataSource, StreamHandlers } from './DataSource';

/**
 * Yahoo Finance (unofficial, keyless) — Canadian .TO tickers, ^VIX, CAD=X,
 * and fundamentals (market cap / float / short interest) for all symbols.
 * Quotes are delayed ~15 minutes and labeled as such in the UI.
 *
 * The API is unofficial and can break or rate-limit at any time, so every
 * call is budgeted, cached, and failure-tolerant: on errors we serve the
 * last cached data and flag the feed, never crash.
 */

const POLL_MS = 30_000; // spec: poll no more than once per 30 seconds
const QUOTE_CACHE_MS = 25_000;
const FUNDAMENTALS_CACHE_MS = 12 * 3_600_000;
const BATCH = 50;
/** Self-imposed request budget (no official cap; be a polite client). */
const BUDGET_PER_MIN = 20;
/** Only enrich float/short-interest (1 request per symbol) for small sets. */
const ENRICH_LIMIT = 15;

yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);

/**
 * Yahoo 429s the library's default user-agent on the crumb-authenticated
 * query endpoints; a browser UA passed per-call is accepted. (Verified
 * empirically — without this every quote/chart/quoteSummary call fails.)
 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FETCH_OPTS = { fetchOptions: { headers: { 'User-Agent': BROWSER_UA } } } as const;

interface QuoteCacheEntry {
  quote: Quote;
  fetchedAt: number;
}

export class YahooSource implements DataSource {
  readonly id = 'yahoo';
  readonly badge = 'DELAYED · YAHOO';
  readonly delayed = true;

  /** Space calls out — Yahoo 429s bursts long before it 429s volume. */
  private limiter = new RateLimiter('yahoo', BUDGET_PER_MIN, 60_000, 1500);
  private quoteCache = new Map<string, QuoteCacheEntry>();
  private fundCache = new Map<string, { fund: Fundamentals; fetchedAt: number }>();
  private quoteType = new Map<string, string>();
  private lastVolume = new Map<string, number>();
  private pollTimer: NodeJS.Timeout | null = null;
  private symbols: string[] = [];
  private handlers: StreamHandlers | null = null;
  private consecutiveFailures = 0;
  /** After a 429, stop calling Yahoo entirely for a while. */
  private cooldownUntil = 0;

  private async gate(): Promise<void> {
    if (Date.now() < this.cooldownUntil) {
      throw new Error(`Yahoo cooling down after rate limit (${Math.ceil((this.cooldownUntil - Date.now()) / 1000)}s left)`);
    }
    await this.limiter.acquire();
  }

  // ---- quotes ----

  private mapQuote(raw: Record<string, unknown>): Quote {
    const num = (k: string): number | null => {
      const v = raw[k];
      return typeof v === 'number' && isFinite(v) ? v : null;
    };
    const symbol = String(raw.symbol ?? '');
    return {
      symbol,
      price: num('regularMarketPrice'),
      bid: num('bid'),
      ask: num('ask'),
      prevClose: num('regularMarketPreviousClose'),
      open: num('regularMarketOpen'),
      high: num('regularMarketDayHigh'),
      low: num('regularMarketDayLow'),
      volume: num('regularMarketVolume'),
      changePct: num('regularMarketChangePercent'),
      ts: Date.now(),
      source: this.badge,
      delayed: true,
      name: typeof raw.longName === 'string' ? raw.longName : typeof raw.shortName === 'string' ? raw.shortName : undefined,
    };
  }

  private async fetchQuotes(symbols: string[]): Promise<Quote[]> {
    const out: Quote[] = [];
    for (let i = 0; i < symbols.length; i += BATCH) {
      const batch = symbols.slice(i, i + BATCH);
      await this.gate();
      const raw = (await yahooFinance.quote(batch, {}, FETCH_OPTS)) as unknown as Record<string, unknown>[];
      const arr = Array.isArray(raw) ? raw : [raw];
      for (const r of arr) {
        const q = this.mapQuote(r);
        if (!q.symbol) continue;
        if (typeof r.quoteType === 'string') this.quoteType.set(q.symbol, r.quoteType);
        this.quoteCache.set(q.symbol, { quote: q, fetchedAt: Date.now() });
        // stash quote-level fundamentals so scanner cap checks are batchable
        this.stashQuoteFundamentals(r, q.symbol);
        out.push(q);
      }
    }
    return out;
  }

  private stashQuoteFundamentals(raw: Record<string, unknown>, symbol: string): void {
    const num = (k: string): number | null => {
      const v = raw[k];
      return typeof v === 'number' && isFinite(v) ? v : null;
    };
    const existing = this.fundCache.get(symbol)?.fund;
    this.fundCache.set(symbol, {
      fetchedAt: this.fundCache.get(symbol)?.fetchedAt ?? 0,
      fund: {
        symbol,
        name: (typeof raw.longName === 'string' ? raw.longName : undefined) ?? existing?.name,
        exchange: (typeof raw.fullExchangeName === 'string' ? raw.fullExchangeName : undefined) ?? existing?.exchange,
        currency: (typeof raw.currency === 'string' ? raw.currency : undefined) ?? existing?.currency,
        marketCap: num('marketCap') ?? existing?.marketCap ?? null,
        avgVolume30d: num('averageDailyVolume3Month') ?? existing?.avgVolume30d ?? null,
        floatShares: existing?.floatShares ?? null,
        shortPctFloat: existing?.shortPctFloat ?? null,
      },
    });
  }

  async getSnapshot(symbols: string[]): Promise<Quote[]> {
    const now = Date.now();
    const fresh: Quote[] = [];
    const stale: string[] = [];
    for (const s of symbols) {
      const c = this.quoteCache.get(s);
      if (c && now - c.fetchedAt < QUOTE_CACHE_MS) fresh.push(c.quote);
      else stale.push(s);
    }
    if (stale.length) {
      try {
        fresh.push(...(await this.fetchQuotes(stale)));
        this.noteSuccess();
      } catch (e) {
        this.noteFailure('quote fetch', e);
        // serve whatever cache we have rather than failing the caller
        for (const s of stale) {
          const c = this.quoteCache.get(s);
          if (c) fresh.push(c.quote);
        }
      }
    }
    return fresh;
  }

  // ---- bars ----

  async getBars(symbol: string, timeframe: '1Min' | '1Day', lookback: number): Promise<Bar[]> {
    await this.gate();
    try {
      const result = await yahooFinance.chart(
        symbol,
        {
          period1: new Date(Date.now() - (timeframe === '1Min' ? 24 * 3_600_000 : lookback * 2 * 86_400_000)),
          interval: timeframe === '1Min' ? '1m' : '1d',
        },
        FETCH_OPTS,
      );
      const bars: Bar[] = (result.quotes ?? [])
        .filter((q) => q.close != null && q.open != null)
        .map((q) => ({
          t: new Date(q.date).getTime(),
          o: q.open as number,
          h: (q.high ?? q.close) as number,
          l: (q.low ?? q.close) as number,
          c: q.close as number,
          v: q.volume ?? 0,
        }));
      this.noteSuccess();
      if (timeframe === '1Min' && bars.length) {
        // keep only the latest trading day (chart returns prior sessions too)
        const dayStart = bars[bars.length - 1].t - 16 * 3_600_000;
        const gapIdx = bars.findIndex((b) => b.t >= dayStart);
        return bars.slice(Math.max(gapIdx, 0)).slice(-lookback);
      }
      return bars.slice(-lookback);
    } catch (e) {
      this.noteFailure(`chart(${symbol})`, e);
      return [];
    }
  }

  // ---- fundamentals ----

  async getFundamentals(symbols: string[]): Promise<Fundamentals[]> {
    const now = Date.now();
    const needQuote = symbols.filter((s) => {
      const c = this.fundCache.get(s);
      return !c || (now - c.fetchedAt > FUNDAMENTALS_CACHE_MS && c.fetchedAt !== 0) || (c.fetchedAt === 0 && c.fund.marketCap == null);
    });
    if (needQuote.length) {
      try {
        await this.fetchQuotes(needQuote);
        this.noteSuccess();
      } catch (e) {
        this.noteFailure('fundamentals quote batch', e);
      }
    }

    // float + short interest need one quoteSummary call per symbol — only
    // do that for small sets (watchlist / selected), never the whole
    // universe, and only for actual equities (not indices/ETFs/FX)
    if (symbols.length <= ENRICH_LIMIT) {
      for (const symbol of symbols) {
        if (this.quoteType.get(symbol) !== 'EQUITY') continue;
        const cached = this.fundCache.get(symbol);
        if (cached && cached.fetchedAt !== 0 && now - cached.fetchedAt < FUNDAMENTALS_CACHE_MS) continue;
        try {
          await this.gate();
          const qs = await yahooFinance.quoteSummary(
            symbol,
            { modules: ['defaultKeyStatistics', 'summaryDetail'] },
            FETCH_OPTS,
          );
          const ks = qs.defaultKeyStatistics;
          const base = this.fundCache.get(symbol)?.fund ?? { symbol };
          this.fundCache.set(symbol, {
            fetchedAt: now,
            fund: {
              ...base,
              symbol,
              floatShares: ks?.floatShares ?? base.floatShares ?? null,
              shortPctFloat:
                ks?.shortPercentOfFloat != null ? ks.shortPercentOfFloat * 100 : base.shortPctFloat ?? null,
            },
          });
          this.noteSuccess();
        } catch (e) {
          this.noteFailure(`quoteSummary(${symbol})`, e);
        }
      }
    }

    return symbols.map((s) => this.fundCache.get(s)?.fund ?? { symbol: s });
  }

  // ---- polled "stream" ----

  subscribeStream(symbols: string[], handlers: StreamHandlers): () => void {
    this.symbols = [...new Set(symbols)];
    this.handlers = handlers;
    if (this.pollTimer) clearInterval(this.pollTimer);
    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), POLL_MS);
    this.pollTimer.unref?.();
    return () => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    };
  }

  private async poll(): Promise<void> {
    if (!this.symbols.length || !this.handlers) return;
    try {
      const quotes = await this.fetchQuotes(this.symbols);
      const minuteStart = Math.floor(Date.now() / 60_000) * 60_000;
      for (const q of quotes) {
        this.handlers.onQuote?.(q);
        // synthesize a coarse minute bar so charts/VWAP keep advancing
        // between the real 1m history seeds (yahoo has no push stream)
        if (q.price != null) {
          const prevVol = this.lastVolume.get(q.symbol);
          const dv = q.volume != null && prevVol != null ? Math.max(0, q.volume - prevVol) : 0;
          if (q.volume != null) this.lastVolume.set(q.symbol, q.volume);
          this.handlers.onBar?.(q.symbol, { t: minuteStart, o: q.price, h: q.price, l: q.price, c: q.price, v: dv });
        }
      }
      this.noteSuccess();
    } catch (e) {
      this.noteFailure('poll', e);
    }
  }

  // ---- health ----

  private noteSuccess(): void {
    if (this.consecutiveFailures >= 3) {
      log('yahoo', 'recovered — serving delayed data again');
    }
    this.consecutiveFailures = 0;
    this.handlers?.onState?.('delayed', 'Yahoo quotes are delayed ~15 min');
  }

  private noteFailure(what: string, e: unknown): void {
    this.consecutiveFailures++;
    const msg = e instanceof Error ? e.message : String(e);
    warn('yahoo', `${what} failed (${this.consecutiveFailures} consecutive):`, msg);
    if (/Too Many Requests|429/i.test(msg) && Date.now() >= this.cooldownUntil) {
      this.cooldownUntil = Date.now() + 90_000;
      warn('yahoo', 'rate-limited by Yahoo — pausing all Yahoo requests for 90s');
    }
    if (this.consecutiveFailures >= 3) {
      this.handlers?.onState?.('error', 'Yahoo unreachable or rate-limited — showing last cached data');
    }
  }
}
