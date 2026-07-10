import { useEffect, useState } from 'react';
import type { TickMap } from '../App';
import { api } from '../api';
import { chgClass, fmtPct, fmtPrice } from '../format';

const CONTEXT: { symbol: string; label: string }[] = [
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^IXIC', label: 'NASDAQ' },
  { symbol: '^DJI', label: 'DOW' },
  { symbol: '^GSPTSE', label: 'S&P/TSX' },
  { symbol: '^VIX', label: 'VIX' },
  { symbol: 'CAD=X', label: 'USD/CAD' },
];

const SPARK_REFRESH_MS = 60_000;

export default function ContextStrip({ ticks }: { ticks: TickMap }) {
  const [series, setSeries] = useState<Record<string, number[]>>({});

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .getContext()
        .then((r) => {
          if (cancelled) return;
          const map: Record<string, number[]> = {};
          for (const s of r.series) map[s.symbol] = s.points;
          setSeries(map);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, SPARK_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="context-strip" role="list" aria-label="Market context">
      {CONTEXT.map(({ symbol, label }) => {
        const t = ticks[symbol];
        const q = t?.quote;
        const cls = chgClass(q?.changePct);
        return (
          <div key={symbol} className="context-cell" role="listitem">
            <Sparkline points={series[symbol]} dirClass={cls} label={label} />
            <div className="context-info">
              <span className="context-label">{label}</span>
              <span className="context-price">{fmtPrice(q?.price ?? null, symbol)}</span>
              <span className={`context-chg ${cls}`}>{fmtPct(q?.changePct)}</span>
              {q?.delayed && <span className="delay-tag" title="Yahoo data is delayed ~15 minutes">DELAYED</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const SW = 120;
const SH = 22;

function Sparkline({ points, dirClass, label }: { points: number[] | undefined; dirClass: string; label: string }) {
  if (!points || points.length < 2) {
    return <svg className="context-spark" viewBox={`0 0 ${SW} ${SH}`} aria-hidden="true" />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * (SW - 2) + 1;
  const y = (v: number) => SH - 2 - ((v - min) / span) * (SH - 4);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${SH} ${line} ${x(points.length - 1).toFixed(1)},${SH}`;
  return (
    <svg
      className="context-spark"
      viewBox={`0 0 ${SW} ${SH}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label} intraday movement`}
    >
      <polygon className={`spark-fill ${dirClass}`} points={area} />
      <polyline className={`spark-line ${dirClass}`} points={line} fill="none" />
    </svg>
  );
}
