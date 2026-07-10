import { config } from '../config';
import type { DataSource, NewsSource } from '../datasources/DataSource';
import { SimSource } from '../datasources/sim';
import type { FeedId, FeedState, FeedStatus } from '../types';
import { log } from '../util/log';

/** True for symbols served by the Canadian/reference feed (Yahoo). */
export function isCaSymbol(symbol: string): boolean {
  return /\.(TO|V)$/i.test(symbol) || symbol.startsWith('^') || symbol.endsWith('=X');
}

export function exchangeOf(symbol: string): string {
  if (/\.TO$/i.test(symbol)) return 'TSX';
  if (/\.V$/i.test(symbol)) return 'TSXV';
  if (symbol.startsWith('^') || symbol.endsWith('=X')) return 'IDX';
  return 'US';
}

/**
 * Owns the concrete provider instances and routes each symbol to one.
 * To swap in a paid feed later: add a DataSource implementation in
 * src/datasources/, then change the assignments in the constructor below.
 */
export class Router {
  readonly us: DataSource;
  readonly ca: DataSource;
  /** Fundamentals (market cap / float / short interest) for ALL symbols. */
  readonly fundamentals: DataSource;
  readonly news: NewsSource | null;

  private statuses = new Map<FeedId, FeedStatus>();
  onStatusChange: (() => void) | null = null;

  constructor() {
    const simUs = new SimSource('us');
    const simCa = new SimSource('ca');

    // Milestone 2 wires Alpaca here; milestone 3 wires Yahoo.
    this.us = simUs;
    this.ca = simCa;
    this.fundamentals = simCa;
    this.news = config.newsFeed === 'sim' ? simUs : null;

    this.statuses.set('us', {
      id: 'us',
      state: this.us instanceof SimSource ? 'sim' : 'live',
      label: this.us.badge,
    });
    this.statuses.set('ca', {
      id: 'ca',
      state: this.ca instanceof SimSource ? 'sim' : 'delayed',
      label: this.ca.badge,
    });
    this.statuses.set('news', {
      id: 'news',
      state: config.newsFeed === 'off' ? 'off' : config.newsFeed === 'sim' ? 'sim' : 'live',
      label: config.newsFeed === 'off' ? 'NEWS OFF' : config.newsFeed === 'sim' ? 'SIMULATED' : 'FINNHUB',
    });

    log('router', `feeds -> us: ${this.us.id}, ca: ${this.ca.id}, fundamentals: ${this.fundamentals.id}, news: ${config.newsFeed}`);
  }

  providerFor(symbol: string): DataSource {
    return isCaSymbol(symbol) ? this.ca : this.us;
  }

  feedIdFor(provider: DataSource): FeedId {
    return provider === this.ca ? 'ca' : 'us';
  }

  setFeedState(id: FeedId, state: FeedState, detail?: string): void {
    const cur = this.statuses.get(id);
    if (!cur) return;
    if (cur.state === state && cur.detail === detail) return;
    this.statuses.set(id, { ...cur, state, detail });
    this.onStatusChange?.();
  }

  getStatuses(): FeedStatus[] {
    return [...this.statuses.values()];
  }
}
