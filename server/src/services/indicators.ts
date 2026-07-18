import type { Bar } from '../types';

/** Session VWAP from 1-min bars (typical price, volume weighted). */
export function vwap(bars: Bar[]): number | null {
  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vol += b.v;
  }
  return vol > 0 ? pv / vol : null;
}

/** Running VWAP value per bar, for the chart overlay. */
export function vwapSeries(bars: Bar[]): (number | null)[] {
  const out: (number | null)[] = [];
  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vol += b.v;
    out.push(vol > 0 ? pv / vol : null);
  }
  return out;
}

/** Wilder RSI(14) on 1-min closes. Needs >= 15 closes. */
export function rsi14(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Relative volume: today's cumulative volume vs the volume you'd expect
 * by this point of the session given the 30-day average daily volume.
 * Heuristic pace model (linear through the session), documented in README.
 */
export function relativeVolume(
  todayVolume: number | null,
  avgDailyVolume: number | null,
  elapsedFraction: number,
): number | null {
  if (!todayVolume || !avgDailyVolume || avgDailyVolume <= 0) return null;
  const expected = avgDailyVolume * Math.max(0.05, Math.min(1, elapsedFraction));
  return todayVolume / expected;
}

export function spreadPct(bid: number | null, ask: number | null): number | null {
  if (bid == null || ask == null || bid <= 0 || ask <= 0 || ask < bid) return null;
  const mid = (bid + ask) / 2;
  return ((ask - bid) / mid) * 100;
}

export function gapPct(open: number | null, prevClose: number | null): number | null {
  if (open == null || prevClose == null || prevClose <= 0) return null;
  return ((open - prevClose) / prevClose) * 100;
}

export function rangePct(high: number | null, low: number | null, price: number | null): number | null {
  if (high == null || low == null || price == null || price <= 0) return null;
  return ((high - low) / price) * 100;
}

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Halt-risk heuristic (free feeds carry no LULD halt flag): a stock moving
 * ~5%+ inside 5 minutes is inside typical LULD band territory, and a
 * blown-out spread on a double-digit day says liquidity is evaporating.
 * A true proxy only — surfaced as a warning, never as a fact.
 */
export function haltRisk(
  move5mPct: number | null,
  spreadPctVal: number | null,
  changePct: number | null,
): boolean {
  if (move5mPct != null && Math.abs(move5mPct) >= 5) return true;
  if (spreadPctVal != null && changePct != null && spreadPctVal >= 1.5 && Math.abs(changePct) >= 10) return true;
  return false;
}
