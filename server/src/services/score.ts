import type { Factor, FactorStatus, SetupScore } from '../types';
import { clamp01 } from './indicators';

/**
 * Scoring engine. All thresholds here are screening heuristics, not a
 * proven edge — the UI says so explicitly. Weights sum to 1 per scale;
 * missing factors ("na") are excluded and remaining weights renormalized.
 */

export interface FactorInputs {
  relVol: number | null;
  gapPct: number | null;
  price: number | null;
  vwap: number | null;
  rsi: number | null;
  spreadPct: number | null;
  rangePct: number | null;
  floatShares: number | null;
  shortPctFloat: number | null;
  /** ms since the most recent news item, or null when unknown/none */
  newsAgeMs: number | null;
  newsAvailable: boolean;
}

const fmt = {
  x: (n: number) => `${n.toFixed(2)}x`,
  pct: (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`,
  pctAbs: (n: number) => `${n.toFixed(2)}%`,
  num: (n: number) => n.toFixed(1),
  shares: (n: number) =>
    n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(0)}M` : `${Math.round(n / 1e3)}K`,
};

function factor(
  key: string,
  label: string,
  threshold: string,
  weight: number,
  value: { display: string; status: FactorStatus; score: number } | null,
): Factor {
  if (!value) return { key, label, display: '—', threshold, status: 'na', score: 0, weight };
  return { key, label, threshold, weight, ...value };
}

/** The 9-factor grid for the ticker detail panel. */
export function computeFactors(f: FactorInputs): Factor[] {
  const out: Factor[] = [];

  out.push(
    factor('relvol', 'REL VOLUME', '≥ 2.0x', 0.2,
      f.relVol == null ? null : {
        display: fmt.x(f.relVol),
        status: f.relVol >= 2 ? 'pass' : f.relVol >= 1.2 ? 'warn' : 'fail',
        score: clamp01(f.relVol / 3),
      }),
  );

  out.push(
    factor('gap', 'GAP VS PREV CLOSE', '|gap| ≥ 2%', 0.1,
      f.gapPct == null ? null : {
        display: fmt.pct(f.gapPct),
        status: Math.abs(f.gapPct) >= 2 ? 'pass' : Math.abs(f.gapPct) >= 1 ? 'warn' : 'fail',
        score: clamp01(Math.abs(f.gapPct) / 4),
      }),
  );

  out.push(
    factor('vwap', 'PRICE VS VWAP', 'above (long bias)', 0.1,
      f.price == null || f.vwap == null || f.vwap <= 0 ? null : (() => {
        const distPct = ((f.price! - f.vwap!) / f.vwap!) * 100;
        return {
          display: fmt.pct(distPct),
          status: (distPct > 0.2 ? 'pass' : distPct >= -0.2 ? 'warn' : 'fail') as FactorStatus,
          score: distPct > 0.2 ? 1 : distPct >= -0.2 ? 0.5 : 0,
        };
      })()),
  );

  out.push(
    factor('rsi', 'RSI(14) 1-MIN', '40–70 zone', 0.1,
      f.rsi == null ? null : {
        display: fmt.num(f.rsi),
        status: f.rsi >= 40 && f.rsi <= 70 ? 'pass' : f.rsi >= 30 && f.rsi <= 80 ? 'warn' : 'fail',
        score: f.rsi >= 40 && f.rsi <= 70 ? 1 : f.rsi >= 30 && f.rsi <= 80 ? 0.5 : 0,
      }),
  );

  out.push(
    factor('spread', 'BID-ASK SPREAD', '≤ 0.10%', 0.1,
      f.spreadPct == null ? null : {
        display: fmt.pctAbs(f.spreadPct),
        status: f.spreadPct <= 0.1 ? 'pass' : f.spreadPct <= 0.25 ? 'warn' : 'fail',
        score: clamp01(1 - f.spreadPct / 0.5),
      }),
  );

  out.push(
    factor('range', 'INTRADAY RANGE', '≥ 1.5% of price', 0.15,
      f.rangePct == null ? null : {
        display: fmt.pctAbs(f.rangePct),
        status: f.rangePct >= 1.5 ? 'pass' : f.rangePct >= 0.8 ? 'warn' : 'fail',
        score: clamp01(f.rangePct / 3),
      }),
  );

  out.push(
    factor('float', 'FLOAT', '< 50M fast', 0.1,
      f.floatShares == null ? null : {
        display: fmt.shares(f.floatShares),
        status: f.floatShares < 50e6 ? 'pass' : f.floatShares < 150e6 ? 'warn' : 'fail',
        score: clamp01(1 - (f.floatShares - 20e6) / 280e6),
      }),
  );

  out.push(
    factor('short', 'SHORT INTEREST', '≥ 10% of float', 0.05,
      f.shortPctFloat == null ? null : {
        display: fmt.pctAbs(f.shortPctFloat),
        status: f.shortPctFloat >= 10 ? 'pass' : f.shortPctFloat >= 5 ? 'warn' : 'fail',
        score: clamp01(f.shortPctFloat / 20),
      }),
  );

  out.push(
    factor('news', 'NEWS CATALYST', 'within 24h', 0.1,
      !f.newsAvailable ? null : (() => {
        const fresh = f.newsAgeMs != null && f.newsAgeMs <= 24 * 3_600_000;
        const stale = f.newsAgeMs != null && f.newsAgeMs <= 72 * 3_600_000;
        return {
          display: fresh ? 'YES' : stale ? 'STALE' : 'NO',
          status: (fresh ? 'pass' : stale ? 'warn' : 'fail') as FactorStatus,
          score: fresh ? 1 : stale ? 0.5 : 0,
        };
      })()),
  );

  return out;
}

/** Weighted composite 0-100 across available factors. */
export function composite(factors: Factor[]): number {
  const avail = factors.filter((f) => f.status !== 'na');
  const totalWeight = avail.reduce((s, f) => s + f.weight, 0);
  if (totalWeight <= 0) return 0;
  const raw = avail.reduce((s, f) => s + f.score * f.weight, 0) / totalWeight;
  return Math.round(raw * 100);
}

export function setupScore(factors: Factor[]): SetupScore {
  const score = composite(factors);
  const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
  const verdict =
    score >= 80 ? 'High-conviction setup'
    : score >= 65 ? 'Tradeable — size down'
    : score >= 50 ? 'Marginal'
    : 'No edge — stand aside';
  return { score, grade, verdict, blocks: Math.round((score / 100) * 12) };
}

// ---- scanner scoring (objective tradeability only) ----

export interface ScanInputs {
  relVol: number | null;
  gapPct: number | null;
  rangePct: number | null;
  spreadPct: number | null;
  /** today's traded dollar volume (price * shares) */
  dollarVolume: number | null;
}

export function scannerFactors(s: ScanInputs): Factor[] {
  return [
    factor('relvol', 'REL VOLUME', '≥ 2.0x', 0.3,
      s.relVol == null ? null : {
        display: fmt.x(s.relVol),
        status: s.relVol >= 2 ? 'pass' : s.relVol >= 1.2 ? 'warn' : 'fail',
        score: clamp01(s.relVol / 3),
      }),
    factor('gap', 'GAP', '|gap| ≥ 2%', 0.2,
      s.gapPct == null ? null : {
        display: fmt.pct(s.gapPct),
        status: Math.abs(s.gapPct) >= 2 ? 'pass' : Math.abs(s.gapPct) >= 1 ? 'warn' : 'fail',
        score: clamp01(Math.abs(s.gapPct) / 4),
      }),
    factor('range', 'RANGE', '≥ 1.5%', 0.2,
      s.rangePct == null ? null : {
        display: fmt.pctAbs(s.rangePct),
        status: s.rangePct >= 1.5 ? 'pass' : s.rangePct >= 0.8 ? 'warn' : 'fail',
        score: clamp01(s.rangePct / 3),
      }),
    factor('spread', 'SPREAD', '≤ 0.10%', 0.15,
      s.spreadPct == null ? null : {
        display: fmt.pctAbs(s.spreadPct),
        status: s.spreadPct <= 0.1 ? 'pass' : s.spreadPct <= 0.25 ? 'warn' : 'fail',
        score: clamp01(1 - s.spreadPct / 0.5),
      }),
    factor('dollarvol', '$ VOLUME', '≥ $50M/day pace', 0.15,
      s.dollarVolume == null ? null : {
        display: s.dollarVolume >= 1e9 ? `$${(s.dollarVolume / 1e9).toFixed(1)}B` : `$${(s.dollarVolume / 1e6).toFixed(0)}M`,
        status: s.dollarVolume >= 50e6 ? 'pass' : s.dollarVolume >= 10e6 ? 'warn' : 'fail',
        score: clamp01(Math.log10(Math.max(1, s.dollarVolume / 5e6)) / Math.log10(20)),
      }),
  ];
}
