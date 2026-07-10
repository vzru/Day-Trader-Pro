import { config } from '../config';
import { AlpacaSource } from '../datasources/alpaca';
import type { DataSource, EarningsSource, NewsSource } from '../datasources/DataSource';
import { FinnhubSource } from '../datasources/finnhub';
import { SimSource } from '../datasources/sim';
import { YahooSource } from '../datasources/yahoo';
import { isCaSymbol } from '../util/symbols';
import type { FeedId, FeedState, FeedStatus } from '../types';
import { log } from '../util/log';

export { exchangeOf, isCaSymbol } from '../util/symbols';

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
  /** Earnings calendar (Finnhub, when a key is configured). */
  readonly earnings: EarningsSource | null;

  private statuses = new Map<FeedId, FeedStatus>();
  onStatusChange: (() => void) | null = null;

  constructor() {
    const simUs = new SimSource('us');
    const simCa = new SimSource('ca');

    this.us =
      config.usFeed === 'alpaca' && config.alpacaKeyId && config.alpacaSecret
        ? new AlpacaSource(config.alpacaKeyId, config.alpacaSecret)
        : simUs;
    this.ca = config.caFeed === 'yahoo' ? new YahooSource() : simCa;
    // Yahoo serves market cap / float / short interest for US symbols too;
    // Alpaca's free data API has no fundamentals.
    this.fundamentals = this.ca instanceof YahooSource ? this.ca : simCa;
    // One Finnhub instance backs both news and the earnings calendar.
    const finnhub = config.finnhubKey ? new FinnhubSource(config.finnhubKey) : null;
    this.news =
      config.newsFeed === 'finnhub' && finnhub
        ? finnhub
        : config.newsFeed === 'sim'
          ? simUs
          : null;
    this.earnings = finnhub;

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
