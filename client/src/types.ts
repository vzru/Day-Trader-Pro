// Mirrored from server/src/types.ts — keep the wire-facing shapes in sync.

export type FeedId = 'us' | 'ca' | 'news';
export type FeedState = 'live' | 'delayed' | 'sim' | 'off' | 'error';

export interface FeedStatus {
  id: FeedId;
  state: FeedState;
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
  volume: number | null;
  changePct: number | null;
  ts: number;
  source: string;
  delayed: boolean;
  name?: string;
}

export interface Bar {
  t: number;
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
  shortPctFloat?: number | null;
  avgVolume30d?: number | null;
  peRatio?: number | null;
  dividendYield?: number | null; // percent
  sector?: string | null;
}

export interface NewsItem {
  id: string;
  symbol: string;
  headline: string;
  source: string;
  url?: string;
  ts: number;
}

export type FactorStatus = 'pass' | 'warn' | 'fail' | 'na';

export interface Factor {
  key: string;
  label: string;
  display: string;
  threshold: string;
  status: FactorStatus;
  score: number;
  weight: number;
}

export interface SetupScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  verdict: string;
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
  scoreHist: number[];
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
  topFactors: { label: string; display: string }[];
  source: string;
  delayed: boolean;
  scoreHist: number[];
  haltRisk: boolean;
  sector?: string | null;
}

export type ScannerMode = 'regular' | 'premarket';

// ---- alerts ----

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
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
}

// ---- journal ----

export interface JournalOutcome {
  date: string;
  close: number | null;
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
  outcome?: JournalOutcome | null;
}

// ---- backtest (score honesty report) ----

export interface BacktestBucket {
  label: string;
  count: number;
  avgAbsMovePct: number | null;
  avgRangePct: number | null;
  bigMoveShare: number | null;
}

export interface BacktestReport {
  buckets: BacktestBucket[];
  samples: number;
  days: number;
  pendingToday: number;
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
  date: string;
  time?: string;
  title: string;
  country: string;
  importance: 'high' | 'medium' | 'low';
  category?: CalendarCategory;
  symbol?: string;
  name?: string;
}

export type ChartRange = '1D' | '1W' | '1M' | '6M' | '1Y' | '2Y' | '3Y' | '5Y' | '10Y';

export interface ScannerState {
  results: ScannerResult[];
  universeSize: number;
  eligible: number;
  updatedAt: number;
  mode: ScannerMode;
}

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
  | ({ type: 'scanner' } & ScannerState)
  | { type: 'alerts'; items: AlertItem[]; settings: AlertSettings }
  | { type: 'sectors'; rows: SectorRow[] }
  | { type: 'news'; items: NewsItem[] }
  | { type: 'error'; message: string };

export type ClientMessage = { type: 'select'; symbol: string };
