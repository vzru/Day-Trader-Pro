import { chgClass, fmtAge, fmtCap, fmtPct, fmtPrice } from '../format';
import type { ScannerState } from '../types';
import ScoreSparkline from './ScoreSparkline';

export default function Scanner({
  state,
  watchSymbols,
  onAdd,
  onSelect,
}: {
  state: ScannerState | null;
  watchSymbols: string[];
  onAdd: (symbol: string) => void;
  onSelect: (symbol: string) => void;
}) {
  const pre = state?.mode === 'premarket';
  return (
    <section className="panel scanner">
      <h2 className="panel-title">
        {pre ? 'PRE-MARKET GAPPERS' : 'MARKET SCANNER'} — ranked by tradeability criteria, not advice.
      </h2>
      <p className="scanner-meta">
        {state
          ? `${state.eligible}/${state.universeSize} universe symbols in the $5B+ cap band · updated ${state.updatedAt ? fmtAge(state.updatedAt) : '—'} · rescans every 60s${pre ? ' · ranked by overnight gap until the 9:30 open' : ''}`
          : 'Waiting for first scan…'}
      </p>
      <div className="scan-grid">
        {state?.results.map((r, i) => {
          const onList = watchSymbols.includes(r.symbol);
          return (
            <div key={r.symbol} className="scan-card">
              <div className="scan-top">
                <span className="scan-rank">#{i + 1}</span>
                <button className="scan-symbol linklike" onClick={() => onSelect(r.symbol)} title="Open in detail panel">
                  {r.symbol}
                </button>
                <span className="scan-exch">{r.exchange}</span>
                <span className="scan-score">
                  {r.score}
                  <span className="scan-grade">{r.grade}</span>
                </span>
              </div>
              <div className="scan-name" title={r.name}>{r.name}</div>
              <div className="scan-nums">
                <span className="scan-cap">{fmtCap(r.marketCap)}</span>
                <span className="scan-price">{fmtPrice(r.price, r.symbol)}</span>
                <span className={`scan-chg ${chgClass(r.changePct)}`}>{fmtPct(r.changePct)}</span>
                <ScoreSparkline points={r.scoreHist} />
              </div>
              <div className="scan-factors">
                {r.haltRisk && (
                  <span className="chip chip-halt" title="Fast move / thin liquidity — possible LULD halt territory (heuristic)">
                    ⚠ HALT RISK
                  </span>
                )}
                {r.topFactors.map((tf) => (
                  <span key={tf.label} className="chip">
                    {tf.label} {tf.display}
                  </span>
                ))}
                {r.sector && <span className="chip chip-sector">{r.sector}</span>}
                {r.delayed && <span className="chip chip-delayed">DELAYED ~15 MIN</span>}
              </div>
              <button className="scan-add" disabled={onList} onClick={() => onAdd(r.symbol)}>
                {onList ? 'ON WATCHLIST' : '+ ADD TO WATCHLIST'}
              </button>
            </div>
          );
        })}
        {state && state.results.length === 0 && (
          <p className="empty">No universe symbols passed the price/cap filters this scan.</p>
        )}
      </div>
      <p className="scanner-foot">
        Screening results from objective liquidity/volatility criteria — not picks, not advice.
      </p>
    </section>
  );
}
