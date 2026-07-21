import { useMemo, useRef, useState } from 'react';
import { fmtDate, fmtEtTime, fmtPrice } from '../format';
import type { Bar, ChartRange } from '../types';

const W = 760;
const H = 240;
const PAD = { top: 12, right: 58, bottom: 20, left: 8 };

const RANGES: ChartRange[] = ['1D', '1W', '1M', '6M', '1Y', '2Y', '3Y', '5Y', '10Y'];

// Vertical separators: which time unit divides each range.
type SepUnit = 'hour' | 'day' | 'month' | 'year';
const SEPARATOR_UNIT: Record<ChartRange, SepUnit> = {
  '1D': 'hour', '1W': 'day', '1M': 'day', '6M': 'month', '1Y': 'month',
  '2Y': 'year', '3Y': 'year', '5Y': 'year', '10Y': 'year',
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ET_PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short',
});
interface EtParts { year: string; month: string; day: string; hour: string }
function etParts(ts: number): EtParts {
  const o: Record<string, string> = {};
  for (const p of ET_PARTS_FMT.formatToParts(ts)) o[p.type] = p.value;
  return o as unknown as EtParts;
}
function isNewBucket(unit: SepUnit, cur: EtParts, prev: EtParts): boolean {
  switch (unit) {
    case 'hour': return cur.hour !== prev.hour || cur.day !== prev.day;
    case 'day': return cur.day !== prev.day || cur.month !== prev.month || cur.year !== prev.year;
    case 'month': return cur.month !== prev.month || cur.year !== prev.year;
    case 'year': return cur.year !== prev.year;
  }
}
function sepLabel(unit: SepUnit, cur: EtParts, prev: EtParts): string {
  switch (unit) {
    case 'hour': {
      const h = Number(cur.hour);
      return `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;
    }
    // roll up to the parent unit when it changes: day -> month name, month -> year
    case 'day': return cur.month !== prev.month ? MON[Number(cur.month) - 1] ?? '' : String(Number(cur.day));
    case 'month': return cur.year !== prev.year ? cur.year : MON[Number(cur.month) - 1] ?? '';
    case 'year': return cur.year;
  }
}

/** Running session VWAP per bar (mirrors the server's calculation). */
function vwapSeries(bars: Bar[]): (number | null)[] {
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

/**
 * Centered moving average over closes: each point averages bars on BOTH sides
 * (window [i-half, i+half]), so the line has no trailing-average lag and sits
 * on top of the price trend rather than shifted to the right. The window
 * shrinks toward the edges so the line still spans the full chart. O(n) via a
 * prefix-sum.
 */
function trendAverage(closes: number[], period: number): number[] {
  const half = Math.floor(period / 2);
  const prefix = [0];
  for (let i = 0; i < closes.length; i++) prefix.push(prefix[i] + closes[i]);
  const out: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(closes.length - 1, i + half);
    out.push((prefix[hi + 1] - prefix[lo]) / (hi - lo + 1));
  }
  return out;
}

/** Smoothing window for the trend line: ~1/6 of the visible bars, min 3. */
function trendPeriod(barCount: number): number {
  return Math.max(3, Math.round(barCount / 6));
}

export default function Chart({
  bars,
  range,
  onRangeChange,
  loading,
  error,
  open,
  prevClose,
  symbol,
  showTrend = false,
}: {
  bars: Bar[];
  range: ChartRange;
  onRangeChange: (r: ChartRange) => void;
  loading: boolean;
  error: boolean;
  open: number | null;
  prevClose: number | null;
  symbol: string;
  showTrend?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const isIntraday = range === '1D';
  const longRange = range === '1Y' || range === '2Y' || range === '3Y' || range === '5Y' || range === '10Y';
  // Stale-data guard: on a non-intraday range, a most-recent bar that's weeks
  // old means the symbol likely stopped trading under this ticker (delisted or
  // renamed, e.g. GPS -> GAP). 10 days clears normal weekend/holiday gaps.
  const lastBarT = bars.length ? bars[bars.length - 1].t : null;
  const stale = !isIntraday && lastBarT != null && Date.now() - lastBarT > 10 * 86_400_000;
  // Hover timestamp: intraday ranges (1D/1W/1M) include the time of day.
  const hoverStamp = (t: number) =>
    range === '1D'
      ? fmtEtTime(t)
      : range === '1W' || range === '1M'
        ? `${fmtDate(t, false)} ${fmtEtTime(t)}`
        : fmtDate(t, longRange);

  const model = useMemo(() => {
    if (bars.length < 2) return null;
    const closes = bars.map((b) => b.c);
    const vw = isIntraday ? vwapSeries(bars) : [];
    const values = [...closes, ...vw.filter((v): v is number => v != null)];
    if (isIntraday && open != null) values.push(open);
    let min = Math.min(...values);
    let max = Math.max(...values);
    const pad = (max - min || max * 0.01 || 1) * 0.06;
    min -= pad;
    max += pad;

    const x = (i: number) => PAD.left + (i / (bars.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);

    const pricePts = closes.map((c, i) => `${x(i).toFixed(1)},${y(c).toFixed(1)}`).join(' ');
    const vwapPts = vw
      .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(' ');

    // Moving-average trend line for non-intraday ranges (1W and longer). It's
    // an average of closes, so it always sits inside the price domain above.
    let trendPts = '';
    let lastTrend: number | null = null;
    if (showTrend && !isIntraday && bars.length >= 4) {
      const trend = trendAverage(closes, trendPeriod(bars.length));
      trendPts = trend.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      lastTrend = trend[trend.length - 1];
    }

    const ticks = [0, 1, 2, 3].map((i) => min + ((max - min) * (i + 0.5)) / 4);
    return { closes, vw, min, max, x, y, pricePts, vwapPts, trendPts, lastTrend, ticks };
  }, [bars, open, isIntraday, showTrend]);

  // Indices where a new time unit begins → vertical separators with labels.
  const separators = useMemo(() => {
    const out: { i: number; label: string }[] = [];
    if (bars.length < 2) return out;
    const unit = SEPARATOR_UNIT[range];
    let prev = etParts(bars[0].t);
    for (let i = 1; i < bars.length; i++) {
      const cur = etParts(bars[i].t);
      if (isNewBucket(unit, cur, prev)) out.push({ i, label: sepLabel(unit, cur, prev) });
      prev = cur;
    }
    return out;
  }, [bars, range]);

  const toolbar = (
    <div className="chart-toolbar" role="group" aria-label="Chart time range">
      {RANGES.map((r) => (
        <button
          key={r}
          className={`tf-btn ${range === r ? 'is-active' : ''}`}
          onClick={() => onRangeChange(r)}
          aria-pressed={range === r}
        >
          {r}
        </button>
      ))}
    </div>
  );

  if (!model) {
    const msg = loading
      ? `Loading ${range}…`
      : error
        ? `Couldn't load ${range} data`
        : isIntraday
          ? 'Waiting for intraday bars…'
          : 'No data for this range';
    return (
      <div className="chart">
        {toolbar}
        <div className="chart chart-empty">{msg}</div>
      </div>
    );
  }

  const last = model.closes[model.closes.length - 1];
  const ref = isIntraday ? (prevClose ?? open) : model.closes[0];
  const dirClass = ref != null && last < ref ? 'loss' : 'gain';
  const lastVwap = [...model.vw].reverse().find((v) => v != null) ?? null;
  const showOpenLine = isIntraday && open != null && open > model.min && open < model.max;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (px - PAD.left) / (W - PAD.left - PAD.right);
    const idx = Math.round(frac * (bars.length - 1));
    setHoverIdx(idx >= 0 && idx < bars.length ? idx : null);
  };

  const hover = hoverIdx != null ? bars[hoverIdx] : null;
  const hoverVwap = hoverIdx != null ? model.vw[hoverIdx] : null;
  const tooltipLeft = hover != null && model.x(hoverIdx!) < W / 2;

  return (
    <div className="chart">
      {toolbar}
      {stale && lastBarT != null && (
        <div className="chart-stale" role="note">
          ⚠ Latest data {fmtDate(lastBarT, true)} — this symbol may be delisted or renamed (no recent trading).
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${isIntraday ? 'Intraday 1-minute' : range} chart for ${symbol}${isIntraday ? ' with VWAP overlay' : ''}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* recessive grid + right-side price labels */}
        {model.ticks.map((v) => (
          <g key={v}>
            <line className="grid-line" x1={PAD.left} x2={W - PAD.right} y1={model.y(v)} y2={model.y(v)} />
            <text className="axis-label" x={W - PAD.right + 6} y={model.y(v) + 3}>
              {fmtPrice(v, symbol)}
            </text>
          </g>
        ))}

        {/* vertical time separators + labels (skip labels that would collide with the edge labels) */}
        {separators.map((s) => {
          const sx = model.x(s.i);
          const showLabel = sx > PAD.left + 8 && sx < W - PAD.right - 8;
          return (
            <g key={`sep-${s.i}`}>
              <line className="sep-line" x1={sx} x2={sx} y1={PAD.top} y2={H - PAD.bottom} />
              {showLabel && (
                <text className="sep-label" x={sx} y={H - 6} textAnchor="middle">
                  {s.label}
                </text>
              )}
            </g>
          );
        })}

        {/* open-price reference line (intraday only) */}
        {showOpenLine && open != null && (
          <g>
            <line className="open-line" x1={PAD.left} x2={W - PAD.right} y1={model.y(open)} y2={model.y(open)} />
            <text className="axis-label open-label" x={W - PAD.right + 6} y={model.y(open) + 3}>
              OPEN
            </text>
          </g>
        )}

        {isIntraday && <polyline className="vwap-line" points={model.vwapPts} fill="none" />}
        {!isIntraday && model.trendPts && (
          <polyline className="trend-line" points={model.trendPts} fill="none" />
        )}
        <polyline className={`price-line ${dirClass}`} points={model.pricePts} fill="none" />

        {/* direct labels at line ends (identity is never color-alone) */}
        <text className={`series-label ${dirClass}`} x={W - PAD.right + 6} y={model.y(last) - 6}>
          PX
        </text>
        {isIntraday && lastVwap != null && (
          <text className="series-label vwap" x={W - PAD.right + 6} y={model.y(lastVwap) + 12}>
            VWAP
          </text>
        )}
        {!isIntraday && model.lastTrend != null && (
          <text className="series-label trend" x={W - PAD.right + 6} y={model.y(model.lastTrend) + 12}>
            TREND
          </text>
        )}

        {/* hover crosshair + tooltip */}
        {hover && hoverIdx != null && (
          <g className="hover-layer">
            <line className="crosshair" x1={model.x(hoverIdx)} x2={model.x(hoverIdx)} y1={PAD.top} y2={H - PAD.bottom} />
            <circle className={`hover-dot ${dirClass}`} cx={model.x(hoverIdx)} cy={model.y(hover.c)} r={3.5} />
            <g transform={`translate(${tooltipLeft ? model.x(hoverIdx) + 10 : model.x(hoverIdx) - 150}, ${PAD.top + 4})`}>
              <rect className="tooltip-box" width={140} height={hoverVwap != null ? 52 : 38} rx={4} />
              <text className="tooltip-text" x={8} y={15}>{hoverStamp(hover.t)}</text>
              <text className="tooltip-text strong" x={8} y={31}>PX {fmtPrice(hover.c, symbol)}</text>
              {hoverVwap != null && (
                <text className="tooltip-text" x={8} y={46}>VWAP {fmtPrice(hoverVwap, symbol)}</text>
              )}
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}
