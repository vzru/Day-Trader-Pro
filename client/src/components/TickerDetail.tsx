import { useEffect, useState } from 'react';
import type { TickMap } from '../App';
import { api } from '../api';
import { brandName, chgClass, fmtCap, fmtCompact, fmtPct, fmtPrice, fmtRatio } from '../format';
import type { Bar, ChartRange, TickerDetail as Detail } from '../types';
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
  // Chart range lives here (not in <Chart>) so it persists as the user switches
  // stocks, and so the header % can reflect the selected timeframe's growth.
  const [range, setRange] = useState<ChartRange>('1D');
  const [hist, setHist] = useState<Bar[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!symbol || range === '1D') {
      setHist([]);
      setErr(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(false);
    setHist([]);
    api
      .getBars(symbol, range)
      .then((r) => {
        if (!cancelled) setHist(r.bars);
      })
      .catch(() => {
        if (!cancelled) setErr(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, range]);

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

  // Legal (registered) name plus the common brand people know, when distinct.
  const legalName = q?.name ?? f?.name ?? null;
  const brand = brandName(symbol, legalName);
  const showBrand = brand && legalName && brand.toLowerCase() !== legalName.toLowerCase() && brand.toUpperCase() !== symbol;

  const isIntraday = range === '1D';
  const activeBars = isIntraday ? bars : hist;

  // Header % reflects the chart's timeframe: live daily change for 1D,
  // otherwise the growth over the selected range (first → last close).
  let headerPct = q?.changePct ?? null;
  let rangeChange = false;
  if (!isIntraday && activeBars.length >= 2) {
    const first = activeBars[0].c;
    const last = activeBars[activeBars.length - 1].c;
    if (first) {
      headerPct = ((last - first) / first) * 100;
      rangeChange = true;
    }
  }

  return (
    <section className="panel detail">
      <div className="detail-header">
        <div className="detail-ident">
          <h2 className="detail-symbol">{symbol}</h2>
          {legalName && <span className="detail-name">{legalName}</span>}
          {showBrand && <span className="detail-brand">({brand})</span>}
          {q && (
            <span className={`src-tag ${q.delayed ? 'src-delayed' : ''}`}>
              {q.delayed ? 'DELAYED ~15 MIN · ' : ''}
              {q.source}
            </span>
          )}
        </div>
        <div className="detail-price">
          <span className={`big-price ${chgClass(q?.changePct)}`}>{fmtPrice(q?.price ?? null, symbol)}</span>
          <span className={`big-chg ${chgClass(headerPct)}`}>{fmtPct(headerPct)}</span>
          {rangeChange && <span className="range-chg-tag">{range}</span>}
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
        <Stat label="P/E" value={fmtRatio(f?.peRatio ?? null)} />
        <Stat label="DIV YIELD" value={f?.dividendYield ? fmtPct(f.dividendYield, false) : '—'} />
      </div>

      {q?.source.includes('IEX') && (
        <p className="feed-note">
          Free Alpaca data is IEX-exchange-only (~2% of US volume) — volume-based metrics are partial.
        </p>
      )}

      <Chart
        bars={activeBars}
        range={range}
        onRangeChange={setRange}
        loading={loading}
        error={err}
        open={q?.open ?? null}
        prevClose={q?.prevClose ?? null}
        symbol={symbol}
      />

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
