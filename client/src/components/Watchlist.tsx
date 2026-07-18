import { useState } from 'react';
import type { TickMap } from '../App';
import { chgClass, fmtPct, fmtPrice } from '../format';
import type { WatchRow } from '../types';

export default function Watchlist({
  rows,
  ticks,
  selected,
  onSelect,
  onAdd,
  onRemove,
}: {
  rows: WatchRow[];
  ticks: TickMap;
  selected: string | null;
  onSelect: (symbol: string) => void;
  onAdd: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}) {
  const [input, setInput] = useState('');

  const submit = () => {
    const sym = input.trim().toUpperCase();
    if (!sym) return;
    onAdd(sym);
    setInput('');
  };

  return (
    <section className="panel watchlist">
      <h2 className="panel-title">WATCHLIST</h2>
      <div className="watch-add">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Add symbol (AAPL, BTE.TO)"
          aria-label="Add symbol to watchlist"
          spellCheck={false}
        />
        <button onClick={submit} aria-label="Add to watchlist">+</button>
      </div>
      <div className="watch-rows">
        {rows.length === 0 && <p className="empty">Watchlist is empty — add a ticker above.</p>}
        {rows.map((row) => {
          // live tick beats the row snapshot the server sent at list time
          const t = ticks[row.symbol];
          const price = t?.quote.price ?? row.price;
          const chg = t?.quote.changePct ?? row.changePct;
          const relVol = t?.relVol ?? row.relVol;
          const relW = relVol == null ? 0 : Math.min(1, relVol / 3) * 100;
          return (
            <div
              key={row.symbol}
              className={`watch-row ${selected === row.symbol ? 'is-selected' : ''}`}
              onClick={() => onSelect(row.symbol)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(row.symbol)}
              role="button"
              tabIndex={0}
              aria-pressed={selected === row.symbol}
            >
              <div className="watch-top">
                <span className="watch-symbol">{row.symbol}</span>
                <span className="watch-exch">{row.exchange}</span>
                {row.haltRisk && (
                  <span className="halt-dot" title="Fast move / thin liquidity — possible halt territory (heuristic)">⚠</span>
                )}
                <span className="watch-price">{fmtPrice(price, row.symbol)}</span>
                <span className={`watch-chg ${chgClass(chg)}`}>{fmtPct(chg)}</span>
                <button
                  className="watch-remove"
                  aria-label={`Remove ${row.symbol}`}
                  title="Remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(row.symbol);
                  }}
                >
                  ×
                </button>
              </div>
              <div className="relvol" title={relVol == null ? 'Relative volume unavailable' : `Relative volume ${relVol.toFixed(2)}x (vs 30-day pace)`}>
                <div className="relvol-track">
                  <div className={`relvol-fill ${relVol != null && relVol >= 2 ? 'is-hot' : ''}`} style={{ width: `${relW}%` }} />
                  <div className="relvol-target" />
                </div>
                <span className="relvol-num">{relVol == null ? '—' : `${relVol.toFixed(1)}x`}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
