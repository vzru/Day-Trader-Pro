// Shared domain types. The client keeps a mirrored copy in client/src/types.ts —
// if you change a wire-facing shape here, change it there too.

export type FeedId = 'us' | 'ca' | 'news';

export type FeedState = 'live' | 'delayed' | 'sim' | 'off' | 'error';

export interface FeedStatus {
  id: FeedId;
  state: FeedState;
  /** Badge text shown in the header, e.g. "LIVE · IEX" */
  label: string;
  detail?: string;
}

export interface Quote {
  symbol: string;
  price: number | null;
  bid: number | null;
  ask: number | null;
  prevClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  /** Cumulative volume today (IEX-only for free Alpaca; see README). */
  volume: number | null;
  changePct: number | null;
  ts: number;
  source: string;
  delayed: boolean;
  name?: string;
}

export interface Bar {
  t: number; // epoch ms, start of bar
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Fundamentals {
  symbol: string;
  name?: string;
  exchange?: string;
  currency?: string;
  marketCap?: number | null;
  floatShares?: number | null;
  shortPctFloat?: number | null; // percent, e.g. 12.4
  avgVolume30d?: number | null;
  peRatio?: number | null; // trailing P/E
  dividendYield?: number | null; // percent, e.g. 0.65
}

export interface NewsItem {
  id: string;
  symbol: string;
  headline: string;
  source: string;
  url?: string;
  ts: number; // epoch ms
}

export type FactorStatus = 'pass' | 'warn' | 'fail' | 'na';

export interface Factor {
  key: string;
  label: string;
  /** Formatted current value for display, e.g. "2.4x" */
  display: string;
  /** Human-readable threshold, e.g. ">= 2.0x" */
  threshold: string;
  status: FactorStatus;
  /** 0..1 sub-score */
  score: number;
  weight: number;
}

export interface SetupScore {
  score: number; // 0..100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  verdict: string;
  /** filled blocks out of 12 for the amber ladder */
  blocks: number;
}

export interface TickerDetail {
  symbol: string;
  quote: Quote;
  vwap: number | null;
  spreadPct: number | null;
  factors: Factor[];
  setup: SetupScore;
  fundamentals: Fundamentals | null;
}

export interface WatchRow {
  symbol: string;
  exchange: string;
  price: number | null;
  changePct: number | null;
  relVol: number | null;
  source: string;
  delayed: boolean;
}

/** One row of the market-cap-ranked "Top US companies" list. */
export interface TopRow {
  rank: number;
  symbol: string;
  name?: string;
  marketCap: number | null;
  price: number | null;
  changePct: number | null;
  source: string;
  delayed: boolean;
}

export interface ScannerResult {
  symbol: string;
  name: string;
  exchange: string;
  marketCap: number | null;
  price: number | null;
  changePct: number | null;
  score: number;
  grade: string;
  /** the two strongest factors driving the rank */
  topFactors: { label: string; display: string }[];
  source: string;
  delayed: boolean;
}

export interface SessionInfo {
  state: 'pre' | 'regular' | 'after' | 'closed';
  label: string;
  etTime: string;
}

export type CalendarCategory =
  | 'earnings'
  | 'rates'
  | 'inflation'
  | 'jobs'
  | 'growth'
  | 'energy'
  | 'other';

export interface CalendarEvent {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // "08:30 ET"
  title: string;
  country: string; // "US" | "CA" | ...
  importance: 'high' | 'medium' | 'low';
  /** Grouping bucket for the calendar UI. Defaults to 'other' when absent. */
  category?: CalendarCategory;
  /** Ticker an earnings event applies to, e.g. "NVDA". */
  symbol?: string;
}

// ---- websocket protocol (server -> client) ----

export type ServerMessage =
  | { type: 'hello'; feeds: FeedStatus[]; session: SessionInfo; watchlist: WatchRow[]; selected: string | null }
  | { type: 'status'; feeds: FeedStatus[]; session: SessionInfo }
  | { type: 'tick'; quote: Quote; relVol: number | null }
  | { type: 'bars'; symbol: string; bars: Bar[] }
  | { type: 'bar'; symbol: string; bar: Bar }
  | { type: 'detail'; detail: TickerDetail }
  | { type: 'watchlist'; rows: WatchRow[] }
  | { type: 'top'; rows: TopRow[] }
  | { type: 'scanner'; results: ScannerResult[]; universeSize: number; eligible: number; updatedAt: number }
  | { type: 'news'; items: NewsItem[] }
  | { type: 'error'; message: string };

// ---- websocket protocol (client -> server) ----

export type ClientMessage = { type: 'select'; symbol: string };
