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
}

export interface SessionInfo {
  state: 'pre' | 'regular' | 'after' | 'closed';
  label: string;
  etTime: string;
}

export interface CalendarEvent {
  id: string;
  date: string;
  time?: string;
  title: string;
  country: string;
  importance: 'high' | 'medium' | 'low';
}

export interface ScannerState {
  results: ScannerResult[];
  universeSize: number;
  eligible: number;
  updatedAt: number;
}

export type ServerMessage =
  | { type: 'hello'; feeds: FeedStatus[]; session: SessionInfo; watchlist: WatchRow[]; selected: string | null }
  | { type: 'status'; feeds: FeedStatus[]; session: SessionInfo }
  | { type: 'tick'; quote: Quote; relVol: number | null }
  | { type: 'bars'; symbol: string; bars: Bar[] }
  | { type: 'bar'; symbol: string; bar: Bar }
  | { type: 'detail'; detail: TickerDetail }
  | { type: 'watchlist'; rows: WatchRow[] }
  | ({ type: 'scanner' } & ScannerState)
  | { type: 'news'; items: NewsItem[] }
  | { type: 'error'; message: string };

export type ClientMessage = { type: 'select'; symbol: string };
