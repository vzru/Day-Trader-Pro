import type { TickMap } from '../App';
import { chgClass, fmtCap, fmtCompact, fmtPct, fmtPrice } from '../format';
import type { Bar, TickerDetail as Detail } from '../types';
import Chart from './Chart';
import FactorGrid from './FactorGrid';
import SetupScoreBar from './SetupScoreBar';

export default function TickerDetail({
  symbol,
  detail,
  tick,
  bars,
}: {
  symbol: string | null;
  detail: Detail | null;
  tick: TickMap[string] | undefined;
  bars: Bar[];
}) {
  if (!symbol) {
    return (
      <section className="panel detail">
        <h2 className="panel-title">TICKER DETAIL</h2>
        <p className="empty">Select a symbol from the watchlist.</p>
      </section>
    );
  }

  // live tick wins for the header numbers; detail payload fills the rest
  const q = tick?.quote ?? detail?.quote ?? null;
  const f = detail?.fundamentals ?? null;

  return (
    <section className="panel detail">
      <div className="detail-header">
        <div className="detail-ident">
          <h2 className="detail-symbol">{symbol}</h2>
          {q?.name && <span className="detail-name">{q.name}</span>}
          {q && (
            <span className={`src-tag ${q.delayed ? 'src-delayed' : ''}`}>
              {q.delayed ? 'DELAYED ~15 MIN · ' : ''}
              {q.source}
            </span>
          )}
        </div>
        <div className="detail-price">
          <span className={`big-price ${chgClass(q?.changePct)}`}>{fmtPrice(q?.price ?? null, symbol)}</span>
          <span className={`big-chg ${chgClass(q?.changePct)}`}>{fmtPct(q?.changePct)}</span>
        </div>
      </div>

      <div className="stat-row">
        <Stat label="BID" value={fmtPrice(q?.bid ?? null, symbol)} />
        <Stat label="ASK" value={fmtPrice(q?.ask ?? null, symbol)} />
        <Stat label="SPREAD" value={detail?.spreadPct != null ? `${detail.spreadPct.toFixed(3)}%` : '—'} />
        <Stat label="OPEN" value={fmtPrice(q?.open ?? null, symbol)} />
        <Stat label="HIGH" value={fmtPrice(q?.high ?? null, symbol)} />
        <Stat label="LOW" value={fmtPrice(q?.low ?? null, symbol)} />
        <Stat label="PREV CLOSE" value={fmtPrice(q?.prevClose ?? null, symbol)} />
        <Stat label="VOLUME" value={fmtCompact(q?.volume ?? null)} />
        <Stat label="VWAP" value={fmtPrice(detail?.vwap ?? null, symbol)} />
        <Stat label="MKT CAP" value={fmtCap(f?.marketCap ?? null)} />
      </div>

      {q?.source.includes('IEX') && (
        <p className="feed-note">
          Free Alpaca data is IEX-exchange-only (~2% of US volume) — volume-based metrics are partial.
        </p>
      )}

      <Chart bars={bars} open={q?.open ?? null} prevClose={q?.prevClose ?? null} symbol={symbol} />

      {detail ? (
        <>
          <h3 className="sub-title">SETUP FACTORS</h3>
          <FactorGrid factors={detail.factors} />
          <h3 className="sub-title">SETUP SCORE</h3>
          <SetupScoreBar setup={detail.setup} />
        </>
      ) : (
        <p className="empty">Computing factors…</p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
