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
  /** GICS-style sector name, e.g. "Technology" (Yahoo assetProfile). */
  sector?: string | null;
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
  /** Recent setup-score points (oldest → newest) for the trend sparkline. */
  scoreHist: number[];
  /** Heuristic: fast move / blown-out spread → likely LULD halt territory. */
  haltRisk: boolean;
}

export interface WatchRow {
  symbol: string;
  exchange: string;
  price: number | null;
  changePct: number | null;
  relVol: number | null;
  source: string;
  delayed: boolean;
  haltRisk?: boolean;
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
  /** Recent scan-score points (oldest → newest) for the trend sparkline. */
  scoreHist: number[];
  haltRisk: boolean;
  sector?: string | null;
}

/** In pre-market (4:00–9:30 ET) the scanner ranks by overnight gap instead. */
export type ScannerMode = 'regular' | 'premarket';

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
  /** Company name for an earnings event, e.g. "Cisco Systems, Inc." */
  name?: string;
}

// ---- alerts ----

/** Which symbols the alert engine watches. */
export type AlertScope = 'all' | 'watchlist' | 'top25' | 'off';

export type AlertKind = 'score' | 'relvol' | 'gap' | 'halt';

export interface AlertItem {
  id: string;
  ts: number;
  symbol: string;
  kind: AlertKind;
  message: string;
}

export interface AlertSettings {
  scope: AlertScope;
}

// ---- sector strip ----

export interface SectorRow {
  /** SPDR sector ETF used as the proxy, e.g. XLK. */
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
}

// ---- journal ----

export interface JournalOutcome {
  /** ET date the outcome refers to (the entry's day). */
  date: string;
  close: number | null;
  /** % change from the logged price to that day's close. */
  closePct: number | null;
}

export interface JournalEntry {
  id: string;
  ts: number;
  symbol: string;
  note: string;
  price: number | null;
  score: number;
  grade: string;
  factors: { label: string; display: string; status: FactorStatus }[];
  /** Filled in once the entry's trading day has closed; null = unresolvable. */
  outcome?: JournalOutcome | null;
}

// ---- backtest (score honesty report) ----

export interface BacktestBucket {
  label: string; // e.g. "80–100 (A)"
  count: number;
  /** Average |close vs morning price| %, i.e. how much high scorers moved. */
  avgAbsMovePct: number | null;
  /** Average intraday (high-low)/price % of the captured day. */
  avgRangePct: number | null;
  /** Share of samples that moved more than ±2% after capture. */
  bigMoveShare: number | null;
}

export interface BacktestReport {
  buckets: BacktestBucket[];
  samples: number;
  days: number;
  pendingToday: number;
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
  | { type: 'earnings'; events: CalendarEvent[] }
  | { type: 'scanner'; results: ScannerResult[]; universeSize: number; eligible: number; updatedAt: number; mode: ScannerMode }
  | { type: 'alerts'; items: AlertItem[]; settings: AlertSettings }
  | { type: 'sectors'; rows: SectorRow[] }
  | { type: 'news'; items: NewsItem[] }
  | { type: 'error'; message: string };

// ---- websocket protocol (client -> server) ----

export type ClientMessage = { type: 'select'; symbol: string };
