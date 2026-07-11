import type { Bar, CalendarEvent, FeedState, Fundamentals, NewsItem, Quote } from '../types';

export interface StreamHandlers {
  onQuote?: (q: Quote) => void;
  onBar?: (symbol: string, bar: Bar) => void;
  /** Provider connection state changes (connect / reconnect / degraded). */
  onState?: (state: FeedState, detail?: string) => void;
}

/**
 * Common interface every market-data provider implements. The hub and the
 * frontend only ever talk to this shape, so a paid feed can be swapped in
 * later by adding one file here and mapping it in services/router.ts —
 * nothing else changes.
 */
export interface DataSource {
  /** Short id, e.g. "alpaca", "yahoo", "sim-us". */
  readonly id: string;
  /** Badge text for the header, e.g. "LIVE · IEX". */
  readonly badge: string;
  /** True when quotes from this source are delayed (shown in the UI). */
  readonly delayed: boolean;

  /** Latest quote for each symbol. Implementations must batch + rate-limit. */
  getSnapshot(symbols: string[]): Promise<Quote[]>;

  /** Historical bars, newest last. */
  getBars(symbol: string, timeframe: '1Min' | '1Hour' | '1Day', lookback: number): Promise<Bar[]>;

  /**
   * Stream live (or polled) updates for the given symbols. Replaces any
   * previous subscription made through the same source. Returns an
   * unsubscribe function.
   */
  subscribeStream(symbols: string[], handlers: StreamHandlers): () => void;

  /**
   * Fundamentals (market cap, float, short interest, avg volume). Cached.
   * `enrich: false` skips the slow per-symbol lookups (float / short interest)
   * and returns only the cheap batched fields (cap, avg vol, P/E, dividend) —
   * used to keep first-load fast; the expensive fields are fetched lazily for
   * the selected symbol only.
   */
  getFundamentals(symbols: string[], opts?: { enrich?: boolean }): Promise<Fundamentals[]>;
}

/** Optional capability: providers that can serve news implement this. */
export interface NewsSource {
  readonly id: string;
  getNews(symbols: string[], sinceMs: number): Promise<NewsItem[]>;
}

/** Optional capability: providers that can serve an earnings calendar. */
export interface EarningsSource {
  readonly id: string;
  /** Upcoming earnings dates for the given symbols, as calendar events. */
  getEarnings(symbols: string[], fromMs: number, toMs: number): Promise<CalendarEvent[]>;
}
