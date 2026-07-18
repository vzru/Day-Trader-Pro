import { chgClass, fmtPct } from '../format';
import type { SectorRow } from '../types';

/**
 * Sector heat strip (SPDR ETF proxies), hottest first. Answers "is this
 * stock special, or is its whole neighborhood moving?" at a glance.
 */
export default function SectorStrip({
  rows,
  onSelect,
}: {
  rows: SectorRow[];
  onSelect: (symbol: string) => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="sector-strip" role="list" aria-label="Sector performance today">
      {rows.map((r) => (
        <button
          key={r.symbol}
          role="listitem"
          className={`sector-chip ${chgClass(r.changePct)}`}
          title={`${r.name} (${r.symbol}) — open in detail panel`}
          onClick={() => onSelect(r.symbol)}
        >
          <span className="sector-name">{r.name}</span>
          <span className="sector-chg">{fmtPct(r.changePct)}</span>
        </button>
      ))}
    </div>
  );
}
