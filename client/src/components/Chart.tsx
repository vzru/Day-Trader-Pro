import { useMemo, useRef, useState } from 'react';
import { fmtEtTime, fmtPrice } from '../format';
import type { Bar } from '../types';

const W = 760;
const H = 240;
const PAD = { top: 12, right: 58, bottom: 20, left: 8 };

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
  open,
  prevClose,
  symbol,
}: {
  bars: Bar[];
  open: number | null;
  prevClose: number | null;
  symbol: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const model = useMemo(() => {
    if (bars.length < 2) return null;
    const closes = bars.map((b) => b.c);
    const vw = vwapSeries(bars);
    const values = [...closes, ...vw.filter((v): v is number => v != null)];
    if (open != null) values.push(open);
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
  }, [bars, open]);

  if (!model) {
    return <div className="chart chart-empty">Waiting for intraday bars…</div>;
  }

  const last = model.closes[model.closes.length - 1];
  const ref = prevClose ?? open;
  const dirClass = ref != null && last < ref ? 'loss' : 'gain';
  const lastVwap = [...model.vw].reverse().find((v) => v != null) ?? null;

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
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Intraday 1-minute chart for ${symbol} with VWAP overlay`}
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

        {/* open-price reference line */}
        {open != null && open > model.min && open < model.max && (
          <g>
            <line className="open-line" x1={PAD.left} x2={W - PAD.right} y1={model.y(open)} y2={model.y(open)} />
            <text className="axis-label open-label" x={W - PAD.right + 6} y={model.y(open) + 3}>
              OPEN
            </text>
          </g>
        )}

        <polyline className="vwap-line" points={model.vwapPts} fill="none" />
        <polyline className={`price-line ${dirClass}`} points={model.pricePts} fill="none" />

        {/* direct labels at line ends (identity is never color-alone) */}
        <text className={`series-label ${dirClass}`} x={W - PAD.right + 6} y={model.y(last) - 6}>
          PX
        </text>
        {lastVwap != null && (
          <text className="series-label vwap" x={W - PAD.right + 6} y={model.y(lastVwap) + 12}>
            VWAP
          </text>
        )}

        {/* time axis: first and last bar */}
        <text className="axis-label" x={PAD.left} y={H - 6}>{fmtEtTime(bars[0].t)}</text>
        <text className="axis-label" x={W - PAD.right} y={H - 6} textAnchor="end">
          {fmtEtTime(bars[bars.length - 1].t)}
        </text>

        {/* hover crosshair + tooltip */}
        {hover && hoverIdx != null && (
          <g className="hover-layer">
            <line className="crosshair" x1={model.x(hoverIdx)} x2={model.x(hoverIdx)} y1={PAD.top} y2={H - PAD.bottom} />
            <circle className={`hover-dot ${dirClass}`} cx={model.x(hoverIdx)} cy={model.y(hover.c)} r={3.5} />
            <g transform={`translate(${tooltipLeft ? model.x(hoverIdx) + 10 : model.x(hoverIdx) - 150}, ${PAD.top + 4})`}>
              <rect className="tooltip-box" width={140} height={hoverVwap != null ? 52 : 38} rx={4} />
              <text className="tooltip-text" x={8} y={15}>{fmtEtTime(hover.t)}</text>
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
