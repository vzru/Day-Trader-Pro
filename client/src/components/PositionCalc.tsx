import { useEffect, useState } from 'react';
import { fmtPrice } from '../format';

/**
 * Position-size calculator. Pure arithmetic on user inputs — it does not
 * place orders and is not a recommendation of any position.
 */
export default function PositionCalc({
  symbol,
  livePrice,
}: {
  symbol: string | null;
  livePrice: number | null;
}) {
  const [account, setAccount] = useState('25000');
  const [riskPct, setRiskPct] = useState('1');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');

  // Prefill entry from the live quote whenever the selected symbol changes.
  useEffect(() => {
    if (livePrice != null) setEntry(livePrice.toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const acct = parseFloat(account);
  const risk = parseFloat(riskPct);
  const entryN = parseFloat(entry);
  const stopN = parseFloat(stop);

  const valid =
    isFinite(acct) && acct > 0 &&
    isFinite(risk) && risk > 0 &&
    isFinite(entryN) && entryN > 0 &&
    isFinite(stopN) && stopN > 0 &&
    entryN !== stopN;

  const riskDollars = valid ? (acct * risk) / 100 : null;
  const perShare = valid ? Math.abs(entryN - stopN) : null;
  const shares = valid && perShare ? Math.floor(riskDollars! / perShare) : null;
  const posValue = shares != null ? shares * entryN : null;
  const target2R = valid ? entryN + 2 * (entryN - stopN) : null;
  const direction = valid ? (entryN > stopN ? 'LONG' : 'SHORT') : null;

  return (
    <section className="panel calc">
      <h2 className="panel-title">POSITION SIZE</h2>
      <div className="calc-inputs">
        <label>
          <span>ACCOUNT $</span>
          <input inputMode="decimal" value={account} onChange={(e) => setAccount(e.target.value)} />
        </label>
        <label>
          <span>RISK %/TRADE</span>
          <input inputMode="decimal" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
        </label>
        <label>
          <span>ENTRY {symbol ? `(${symbol})` : ''}</span>
          <div className="entry-wrap">
            <input inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} />
            <button
              type="button"
              className="sync-btn"
              disabled={livePrice == null}
              title="Sync entry to live price"
              onClick={() => livePrice != null && setEntry(livePrice.toFixed(2))}
            >
              ↺ LIVE
            </button>
          </div>
        </label>
        <label>
          <span>STOP</span>
          <input inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} placeholder="required" />
        </label>
      </div>
      <div className="calc-outputs">
        <Out label="DIRECTION" value={direction ?? '—'} />
        <Out label="SHARES" value={shares != null ? shares.toLocaleString('en-US') : '—'} />
        <Out label="$ AT RISK" value={riskDollars != null ? `$${fmtPrice(riskDollars)}` : '—'} />
        <Out label="POSITION $" value={posValue != null ? `$${fmtPrice(posValue)}` : '—'} />
        <Out label="2R TARGET" value={target2R != null && target2R > 0 ? fmtPrice(target2R) : '—'} />
      </div>
      {entry && stop && entryN === stopN && <p className="calc-warn">Entry and stop cannot be equal.</p>}
    </section>
  );
}

function Out({ label, value }: { label: string; value: string }) {
  return (
    <div className="calc-out">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
