import type { TickMap } from '../App';
import { brandName, chgClass, fmtCap, fmtPct, fmtPrice } from '../format';
import type { TopRow } from '../types';

export default function TopCompanies({
  rows,
  ticks,
  selected,
  watchSymbols,
  onSelect,
  onAdd,
}: {
  rows: TopRow[];
  ticks: TickMap;
  selected: string | null;
  watchSymbols: string[];
  onSelect: (symbol: string) => void;
  onAdd: (symbol: string) => void;
}) {
  const watched = new Set(watchSymbols);

  return (
    <section className="panel top-companies">
      <h2 className="panel-title">TOP 25 · MKT CAP</h2>
      {rows.length === 0 && <p className="empty">Loading market caps…</p>}
      <div className="watch-rows">
        {rows.map((row) => {
          // live tick beats the periodic snapshot the server sends
          const t = ticks[row.symbol];
          const price = t?.quote.price ?? row.price;
          const chg = t?.quote.changePct ?? row.changePct;
          const brand = brandName(row.symbol, row.name ?? null);
          return (
            <div
              key={row.symbol}
              className={`watch-row ${selected === row.symbol ? 'is-selected' : ''}`}
              onClick={() => onSelect(row.symbol)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(row.symbol)}
              role="button"
              tabIndex={0}
              aria-pressed={selected === row.symbol}
              title={row.name ?? row.symbol}
            >
              <div className="watch-top">
                <span className="watch-rank">{row.rank}</span>
                <span className="watch-symbol">{row.symbol}</span>
                <span className="top-meta">
                  {!watched.has(row.symbol) && (
                    <button
                      className="top-add"
                      aria-label={`Add ${row.symbol} to watchlist`}
                      title="Add to watchlist"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAdd(row.symbol);
                      }}
                    >
                      +
                    </button>
                  )}
                  <span className="top-cap">{fmtCap(row.marketCap)}</span>
                </span>
              </div>
              <div className="watch-top top-sub">
                {brand && <span className="top-name">{brand}</span>}
                <span className="watch-price">{fmtPrice(price, row.symbol)}</span>
                <span className={`watch-chg ${chgClass(chg)}`}>{fmtPct(chg)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
