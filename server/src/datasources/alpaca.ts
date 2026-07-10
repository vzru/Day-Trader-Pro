import WebSocket from 'ws';
import type { Bar, Fundamentals, Quote } from '../types';
import { error, log, warn } from '../util/log';
import { RateLimiter } from '../util/rateLimiter';
import { etDateStr } from '../util/session';
import type { DataSource, StreamHandlers } from './DataSource';

const REST_BASE = 'https://data.alpaca.markets/v2';
const STREAM_URL = 'wss://stream.data.alpaca.markets/v2/iex';
/** Free tier allows ~200 REST calls/min; budget well under it. */
const REST_BUDGET_PER_MIN = 120;
const SNAPSHOT_REFRESH_MS = 90_000;
const MAX_BACKOFF_MS = 30_000;

interface AlpacaSnapshot {
  latestTrade?: { p: number; t: string };
  latestQuote?: { bp: number; ap: number; t: string };
  minuteBar?: { o: number; h: number; l: number; c: number; v: number; t: string };
  dailyBar?: { o: number; h: number; l: number; c: number; v: number; t: string };
  prevDailyBar?: { c: number; t: string };
}

interface RawBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface BarsPage {
  bars: RawBar[] | null;
  next_page_token?: string | null;
}

interface SymbolState {
  price: number | null;
  bid: number | null;
  ask: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  prevClose: number | null;
  ts: number;
}

/**
 * Alpaca Basic (free) US market data. IEX exchange only (~2% of US volume),
 * so volume-derived metrics are partial — the UI says so. Real-time via
 * websocket with auto-reconnect + exponential backoff; REST for snapshots
 * and historical bars, kept under a self-imposed 120 calls/min budget.
 */
export class AlpacaSource implements DataSource {
  readonly id = 'alpaca';
  readonly badge = 'LIVE · IEX';
  readonly delayed = false;

  private limiter = new RateLimiter('alpaca-rest', REST_BUDGET_PER_MIN);
  private ws: WebSocket | null = null;
  private wsAuthed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private authFailed = false;
  private symbols: string[] = [];
  /** Symbols currently subscribed on the live socket (for delta updates). */
  private subscribed = new Set<string>();
  private handlers: StreamHandlers | null = null;
  private state = new Map<string, SymbolState>();

  constructor(
    private keyId: string,
    private secret: string,
  ) {}

  // ---- REST ----

  private async rest<T>(path: string, params: Record<string, string>): Promise<T> {
    if (this.authFailed) throw new Error('Alpaca auth failed — REST suspended until restart');
    await this.limiter.acquire();
    const url = new URL(REST_BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': this.keyId,
        'APCA-API-SECRET-KEY': this.secret,
      },
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        this.authFailed = true;
        this.handlers?.onState?.('error', 'Alpaca auth failed — check ALPACA_KEY_ID / ALPACA_SECRET_KEY');
        throw new Error(`Alpaca auth failed (${res.status}) — check keys`);
      }
      const body = (await res.text().catch(() => ''))
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      throw new Error(`Alpaca ${path} -> ${res.status}: ${body.slice(0, 140)}`);
    }
    return (await res.json()) as T;
  }

  async getSnapshot(symbols: string[]): Promise<Quote[]> {
    if (!symbols.length) return [];
    const data = await this.rest<Record<string, AlpacaSnapshot>>('/stocks/snapshots', {
      symbols: symbols.join(','),
      feed: 'iex',
    });
    const out: Quote[] = [];
    for (const sym of symbols) {
      const snap = data[sym];
      if (!snap) continue;
      out.push(this.snapshotToQuote(sym, snap));
    }
    return out;
  }

  private snapshotToQuote(symbol: string, s: AlpacaSnapshot): Quote {
    const price = s.latestTrade?.p ?? s.minuteBar?.c ?? s.dailyBar?.c ?? null;
    const prevClose = s.prevDailyBar?.c ?? null;
    return {
      symbol,
      price,
      bid: s.latestQuote?.bp || null,
      ask: s.latestQuote?.ap || null,
      prevClose,
      open: s.dailyBar?.o ?? null,
      high: s.dailyBar?.h ?? null,
      low: s.dailyBar?.l ?? null,
      volume: s.dailyBar?.v ?? null,
      changePct: price != null && prevClose ? ((price - prevClose) / prevClose) * 100 : null,
      ts: s.latestTrade ? Date.parse(s.latestTrade.t) : Date.now(),
      source: this.badge,
      delayed: false,
    };
  }

  async getBars(symbol: string, timeframe: '1Min' | '1Day', lookback: number): Promise<Bar[]> {
    const now = Date.now();
    const path = `/stocks/${encodeURIComponent(symbol)}/bars`;
    const mapBar = (b: RawBar): Bar => ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });

    if (timeframe === '1Min') {
      const data = await this.rest<BarsPage>(path, {
        timeframe,
        start: new Date(now - 24 * 3_600_000).toISOString(),
        limit: '1000',
        feed: 'iex',
        adjustment: 'raw',
      });
      let bars = (data.bars ?? []).map(mapBar);
      if (bars.length) {
        // keep only the most recent trading day's session
        const lastDay = etDateStr(bars[bars.length - 1].t);
        bars = bars.filter((b) => etDateStr(b.t) === lastDay);
      }
      return bars.slice(-Math.max(lookback, 1));
    }

    // Daily: a page is capped at 1000 bars and Alpaca returns them ascending
    // from `start` with no implicit paging — so for long ranges (5Y ≈ 1260
    // bars) a naive call yields the OLDEST 1000 bars, not the most recent.
    // Fetch newest-first and page back until we have `lookback` bars.
    const startMs = now - lookback * 2 * 86_400_000;
    const collected: Bar[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 6; page++) {
      const params: Record<string, string> = {
        timeframe,
        start: new Date(startMs).toISOString(),
        limit: '1000',
        feed: 'iex',
        adjustment: 'raw',
        sort: 'desc',
      };
      if (pageToken) params.page_token = pageToken;
      const data = await this.rest<BarsPage>(path, params);
      for (const b of data.bars ?? []) collected.push(mapBar(b));
      pageToken = data.next_page_token ?? undefined;
      if (!pageToken || collected.length >= lookback) break;
    }
    collected.reverse(); // newest-first -> chronological
    return collected.slice(-Math.max(lookback, 1));
  }

  async getFundamentals(symbols: string[]): Promise<Fundamentals[]> {
    // Alpaca's free market-data API has no fundamentals; the router sources
    // market cap / float / short interest from Yahoo for US symbols too.
    return symbols.map((symbol) => ({ symbol }));
  }

  // ---- streaming ----

  subscribeStream(symbols: string[], handlers: StreamHandlers): () => void {
    this.symbols = [...new Set(symbols)];
    this.handlers = handlers;
    this.stopped = false;

    if (this.wsAuthed) {
      this.applySubscription();
    } else if (!this.ws) {
      this.connect();
    }
    // else: a connect is already in flight; on auth it subscribes the current set.

    void this.refreshSnapshots();
    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(() => void this.refreshSnapshots(), SNAPSHOT_REFRESH_MS);
      this.refreshTimer.unref?.();
    }

    // Alpaca free allows a single websocket connection, so this source keeps
    // ONE persistent socket for its lifetime and updates its subscription in
    // place. We deliberately do not tear the socket down on unsubscribe —
    // doing that on every watchlist/select change made the closing socket
    // overlap the next one's open and Alpaca rejected it (406 connection
    // limit). Re-subscriptions above are diffed and applied live instead.
    return () => {};
  }

  private connect(): void {
    if (this.stopped || this.authFailed) return;
    this.handlers?.onState?.('error', 'connecting to Alpaca stream…');
    log('alpaca', `connecting websocket (attempt ${this.reconnectAttempts + 1})`);

    const ws = new WebSocket(STREAM_URL);
    this.ws = ws;
    this.wsAuthed = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({ action: 'auth', key: this.keyId, secret: this.secret }));
    });

    ws.on('message', (raw) => {
      let msgs: { T: string; [k: string]: unknown }[];
      try {
        const parsed = JSON.parse(String(raw));
        msgs = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return;
      }
      for (const m of msgs) this.handleStreamMessage(m);
    });

    ws.on('close', () => {
      this.wsAuthed = false;
      if (this.stopped || this.authFailed) return;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.reconnectAttempts) + Math.random() * 500;
      this.reconnectAttempts++;
      warn('alpaca', `stream closed; reconnecting in ${Math.round(delay / 1000)}s`);
      this.handlers?.onState?.('error', 'stream disconnected — reconnecting');
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
      this.reconnectTimer.unref?.();
    });

    ws.on('error', (e) => {
      warn('alpaca', 'stream error:', e.message);
      ws.close();
    });
  }

  private handleStreamMessage(m: { T: string; [k: string]: unknown }): void {
    switch (m.T) {
      case 'success':
        if (m.msg === 'authenticated') {
          this.wsAuthed = true;
          this.reconnectAttempts = 0;
          this.subscribed = new Set(); // fresh socket has no server-side subscriptions
          this.applySubscription();
        }
        break;
      case 'subscription':
        log('alpaca', `subscribed: ${(m.trades as string[])?.length ?? 0} trade streams`);
        this.handlers?.onState?.('live', 'streaming from IEX');
        break;
      case 'error': {
        const code = m.code as number;
        error('alpaca', `stream error ${code}: ${m.msg}`);
        if (code === 401 || code === 402) {
          // bad credentials — do not hammer reconnects
          this.authFailed = true;
          this.handlers?.onState?.('error', 'Alpaca auth failed — check ALPACA_KEY_ID / ALPACA_SECRET_KEY');
          this.ws?.close();
        }
        break;
      }
      case 't': { // trade
        const sym = m.S as string;
        const st = this.stateFor(sym);
        st.price = m.p as number;
        st.ts = Date.parse(m.t as string);
        if (st.high == null || st.price > st.high) st.high = st.price;
        if (st.low == null || st.price < st.low) st.low = st.price;
        this.emitQuote(sym);
        break;
      }
      case 'q': { // NBBO-ish quote (IEX book)
        const sym = m.S as string;
        const st = this.stateFor(sym);
        st.bid = (m.bp as number) || st.bid;
        st.ask = (m.ap as number) || st.ask;
        st.ts = Date.parse(m.t as string);
        this.emitQuote(sym);
        break;
      }
      case 'b': { // minute bar
        const sym = m.S as string;
        const bar: Bar = {
          t: Date.parse(m.t as string),
          o: m.o as number,
          h: m.h as number,
          l: m.l as number,
          c: m.c as number,
          v: m.v as number,
        };
        const st = this.stateFor(sym);
        st.volume = (st.volume ?? 0) + bar.v;
        if (st.high == null || bar.h > st.high) st.high = bar.h;
        if (st.low == null || bar.l < st.low) st.low = bar.l;
        this.handlers?.onBar?.(sym, bar);
        break;
      }
    }
  }

  /** Diff the desired symbol set against what's live and send only the changes. */
  private applySubscription(): void {
    if (!this.ws || !this.wsAuthed) return;
    const next = new Set(this.symbols);
    const toAdd = [...next].filter((s) => !this.subscribed.has(s));
    const toRemove = [...this.subscribed].filter((s) => !next.has(s));
    if (toRemove.length) {
      this.ws.send(JSON.stringify({ action: 'unsubscribe', trades: toRemove, quotes: toRemove, bars: toRemove }));
    }
    if (toAdd.length) {
      this.ws.send(JSON.stringify({ action: 'subscribe', trades: toAdd, quotes: toAdd, bars: toAdd }));
    }
    this.subscribed = next;
  }

  private stateFor(symbol: string): SymbolState {
    let st = this.state.get(symbol);
    if (!st) {
      st = { price: null, bid: null, ask: null, open: null, high: null, low: null, volume: null, prevClose: null, ts: Date.now() };
      this.state.set(symbol, st);
    }
    return st;
  }

  /** Periodic REST true-up: daily OHLC/volume/prevClose for streamed symbols. */
  private async refreshSnapshots(): Promise<void> {
    if (!this.symbols.length || this.authFailed) return;
    try {
      const quotes = await this.getSnapshot(this.symbols);
      for (const q of quotes) {
        const st = this.stateFor(q.symbol);
        st.price = q.price ?? st.price;
        st.bid = q.bid ?? st.bid;
        st.ask = q.ask ?? st.ask;
        st.open = q.open ?? st.open;
        st.high = q.high ?? st.high;
        st.low = q.low ?? st.low;
        st.volume = q.volume ?? st.volume;
        st.prevClose = q.prevClose ?? st.prevClose;
        st.ts = q.ts;
        this.emitQuote(q.symbol);
      }
    } catch (e) {
      warn('alpaca', 'snapshot refresh failed:', e instanceof Error ? e.message : e);
    }
  }

  private emitQuote(symbol: string): void {
    const st = this.state.get(symbol);
    if (!st || st.price == null) return;
    this.handlers?.onQuote?.({
      symbol,
      price: st.price,
      bid: st.bid,
      ask: st.ask,
      prevClose: st.prevClose,
      open: st.open,
      high: st.high,
      low: st.low,
      volume: st.volume,
      changePct: st.prevClose ? ((st.price - st.prevClose) / st.prevClose) * 100 : null,
      ts: st.ts,
      source: this.badge,
      delayed: false,
    });
  }
}
