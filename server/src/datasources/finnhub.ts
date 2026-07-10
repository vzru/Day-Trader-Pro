import type { CalendarEvent, NewsItem } from '../types';
import { warn } from '../util/log';
import { RateLimiter } from '../util/rateLimiter';
import { isCaSymbol } from '../util/symbols';
import type { EarningsSource, NewsSource } from './DataSource';

const BASE = 'https://finnhub.io/api/v1';
/** Finnhub free cap is 60 calls/min; budget well under it (spec: < 30). */
const BUDGET_PER_MIN = 25;
/** Per-symbol news cache TTL — catalysts don't need sub-10-min freshness. */
const CACHE_MS = 10 * 60_000;
const MAX_PER_SYMBOL = 6;

interface FinnhubArticle {
  id: number;
  datetime: number; // unix seconds
  headline: string;
  source: string;
  url: string;
}

/**
 * Finnhub company news (optional — only active when FINNHUB_KEY is set).
 * Free tier covers US-listed symbols; .TO symbols are skipped rather than
 * burning budget on empty responses.
 */
export class FinnhubSource implements NewsSource, EarningsSource {
  readonly id = 'finnhub';

  private limiter = new RateLimiter('finnhub', BUDGET_PER_MIN);
  private cache = new Map<string, { items: NewsItem[]; fetchedAt: number }>();
  private earningsCache: { events: CalendarEvent[]; fetchedAt: number } | null = null;
  private authFailed = false;

  constructor(private apiKey: string) {}

  async getNews(symbols: string[], sinceMs: number): Promise<NewsItem[]> {
    if (this.authFailed) throw new Error('Finnhub auth failed — check FINNHUB_KEY');
    const now = Date.now();
    const usEquities = symbols.filter((s) => !isCaSymbol(s));

    for (const symbol of usEquities) {
      const cached = this.cache.get(symbol);
      if (cached && now - cached.fetchedAt < CACHE_MS) continue;
      if (!this.limiter.tryAcquire()) break; // over budget — serve cache, catch up next cycle
      try {
        const from = new Date(sinceMs).toISOString().slice(0, 10);
        const to = new Date().toISOString().slice(0, 10);
        const res = await fetch(
          `${BASE}/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${this.apiKey}`,
        );
        if (res.status === 401 || res.status === 403) {
          this.authFailed = true;
          warn('finnhub', 'auth failed — check FINNHUB_KEY (news paused until restart)');
          break;
        }
        if (res.status === 429) {
          warn('finnhub', 'rate-limited — backing off this cycle');
          break;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const articles = (await res.json()) as FinnhubArticle[];
        const items: NewsItem[] = (Array.isArray(articles) ? articles : [])
          .slice(0, MAX_PER_SYMBOL)
          .map((a) => ({
            id: `${symbol}-${a.id}`,
            symbol,
            headline: a.headline,
            source: a.source,
            url: a.url,
            ts: a.datetime * 1000,
          }));
        this.cache.set(symbol, { items, fetchedAt: now });
      } catch (e) {
        warn('finnhub', `news fetch failed for ${symbol}:`, e instanceof Error ? e.message : e);
        // cache the miss briefly so one bad symbol can't eat the budget
        this.cache.set(symbol, { items: this.cache.get(symbol)?.items ?? [], fetchedAt: now - CACHE_MS / 2 });
      }
    }

    if (this.authFailed) throw new Error('Finnhub auth failed — check FINNHUB_KEY');
    return this.cachedAll(sinceMs);
  }

  private cachedAll(sinceMs: number): NewsItem[] {
    const all: NewsItem[] = [];
    for (const { items } of this.cache.values()) {
      for (const item of items) if (item.ts >= sinceMs) all.push(item);
    }
    return all.sort((a, b) => b.ts - a.ts);
  }

  // ---- earnings calendar ----

  async getEarnings(symbols: string[], fromMs: number, toMs: number): Promise<CalendarEvent[]> {
    if (this.authFailed) return [];
    const wanted = new Set(symbols.filter((s) => !isCaSymbol(s)));
    if (!wanted.size) return [];

    const now = Date.now();
    // Earnings dates move slowly — one range call, cached for the hub's cycle.
    if (this.earningsCache && now - this.earningsCache.fetchedAt < EARNINGS_CACHE_MS) {
      return this.earningsCache.events.filter((e) => e.symbol && wanted.has(e.symbol));
    }
    if (!this.limiter.tryAcquire()) {
      return this.earningsCache?.events.filter((e) => e.symbol && wanted.has(e.symbol)) ?? [];
    }

    try {
      const from = new Date(fromMs).toISOString().slice(0, 10);
      const to = new Date(toMs).toISOString().slice(0, 10);
      const res = await fetch(`${BASE}/calendar/earnings?from=${from}&to=${to}&token=${this.apiKey}`);
      if (res.status === 401 || res.status === 403) {
        this.authFailed = true;
        warn('finnhub', 'auth failed — check FINNHUB_KEY (earnings paused until restart)');
        return [];
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { earningsCalendar?: FinnhubEarning[] };
      const events: CalendarEvent[] = (body.earningsCalendar ?? [])
        .filter((e) => e.symbol && e.date)
        .map((e) => ({
          id: `earn-${e.symbol}-${e.date}`,
          date: e.date,
          time: EARNINGS_HOUR[e.hour ?? ''] ?? undefined,
          title: `${e.symbol} earnings`,
          country: 'US',
          importance: 'high' as const,
          category: 'earnings' as const,
          symbol: e.symbol,
        }));
      this.earningsCache = { events, fetchedAt: now };
      return events.filter((e) => e.symbol && wanted.has(e.symbol));
    } catch (e) {
      warn('finnhub', 'earnings fetch failed:', e instanceof Error ? e.message : e);
      return this.earningsCache?.events.filter((ev) => ev.symbol && wanted.has(ev.symbol)) ?? [];
    }
  }
}

interface FinnhubEarning {
  symbol: string;
  date: string; // YYYY-MM-DD
  hour?: string; // "bmo" | "amc" | "dmh"
}

/** Finnhub earnings-calendar TTL: dates change rarely, so keep it long. */
const EARNINGS_CACHE_MS = 6 * 60 * 60_000;
const EARNINGS_HOUR: Record<string, string> = {
  bmo: 'BEFORE OPEN',
  amc: 'AFTER CLOSE',
  dmh: 'DURING MKT',
};
