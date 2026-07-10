import { useMemo, useRef, useState } from 'react';
import { fmtDate, fmtEtTime, fmtPrice } from '../format';
import type { Bar, ChartRange } from '../types';

const W = 760;
const H = 240;
const PAD = { top: 12, right: 58, bottom: 20, left: 8 };

const RANGES: ChartRange[] = ['1D', '1M', '6M', '1Y', '5Y'];

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

export default function Chart({
  bars,
  range,
  onRangeChange,
  loading,
  error,
  open,
  prevClose,
  symbol,
}: {
  bars: Bar[];
  range: ChartRange;
  onRangeChange: (r: ChartRange) => void;
  loading: boolean;
  error: boolean;
  open: number | null;
  prevClose: number | null;
  symbol: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const isIntraday = range === '1D';
  const longRange = range === '1Y' || range === '5Y';
  const axisLabel = (t: number) => (isIntraday ? fmtEtTime(t) : fmtDate(t, longRange));

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

    const ticks = [0, 1, 2, 3].map((i) => min + ((max - min) * (i + 0.5)) / 4);
    return { closes, vw, min, max, x, y, pricePts, vwapPts, ticks };
  }, [bars, open, isIntraday]);

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
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${isIntraday ? 'Intraday 1-minute' : `${range} daily`} chart for ${symbol}${isIntraday ? ' with VWAP overlay' : ''}`}
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

        {/* time/date axis: first and last bar */}
        <text className="axis-label" x={PAD.left} y={H - 6}>{axisLabel(bars[0].t)}</text>
        <text className="axis-label" x={W - PAD.right} y={H - 6} textAnchor="end">
          {axisLabel(bars[bars.length - 1].t)}
        </text>

        {/* hover crosshair + tooltip */}
        {hover && hoverIdx != null && (
          <g className="hover-layer">
            <line className="crosshair" x1={model.x(hoverIdx)} x2={model.x(hoverIdx)} y1={PAD.top} y2={H - PAD.bottom} />
            <circle className={`hover-dot ${dirClass}`} cx={model.x(hoverIdx)} cy={model.y(hover.c)} r={3.5} />
            <g transform={`translate(${tooltipLeft ? model.x(hoverIdx) + 10 : model.x(hoverIdx) - 150}, ${PAD.top + 4})`}>
              <rect className="tooltip-box" width={140} height={hoverVwap != null ? 52 : 38} rx={4} />
              <text className="tooltip-text" x={8} y={15}>{isIntraday ? fmtEtTime(hover.t) : fmtDate(hover.t, longRange)}</text>
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
