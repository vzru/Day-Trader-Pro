import type { TickMap } from '../App';
import { chgClass, fmtPct, fmtPrice } from '../format';

const CONTEXT: { symbol: string; label: string }[] = [
  { symbol: 'SPY', label: 'SPY' },
  { symbol: 'QQQ', label: 'QQQ' },
  { symbol: 'XIC.TO', label: 'XIC·TSX' },
  { symbol: '^VIX', label: 'VIX' },
  { symbol: 'CAD=X', label: 'USD/CAD' },
];

export default function ContextStrip({ ticks }: { ticks: TickMap }) {
  return (
    <div className="context-strip" role="list" aria-label="Market context">
      {CONTEXT.map(({ symbol, label }) => {
        const t = ticks[symbol];
        const q = t?.quote;
        return (
          <div key={symbol} className="context-cell" role="listitem">
            <span className="context-label">{label}</span>
            <span className="context-price">{fmtPrice(q?.price ?? null, symbol)}</span>
            <span className={`context-chg ${chgClass(q?.changePct)}`}>{fmtPct(q?.changePct)}</span>
            {q?.delayed && <span className="delay-tag" title="Yahoo data is delayed ~15 minutes">DELAYED</span>}
          </div>
        );
      })}
    </div>
  );
}
