import { useEffect, useState } from 'react';
import { api } from '../api';
import { chgClass, fmtAge, fmtPct, fmtPrice } from '../format';
import type { JournalEntry } from '../types';

/**
 * One-click trading journal. Entries snapshot the moment (price / score /
 * factors / note); once that trading day closes the actual outcome fills in.
 * `refreshKey` bumps when a new entry is logged from the detail panel.
 */
export default function JournalPanel({
  refreshKey,
  onSelect,
}: {
  refreshKey: number;
  onSelect: (symbol: string) => void;
}) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getJournal()
      .then((r) => { if (!cancelled) setEntries(r.entries); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [refreshKey]);

  const remove = async (id: string) => {
    try {
      await api.removeJournal(id);
      setEntries((es) => es.filter((e) => e.id !== id));
    } catch {
      /* row stays; next refresh reconciles */
    }
  };

  return (
    <section className="panel journal">
      <h2 className="panel-title">JOURNAL</h2>
      {entries.length === 0 && (
        <p className="empty">Nothing logged yet — use “LOG THIS” on a ticker to snapshot a setup.</p>
      )}
      <div className="journal-rows">
        {entries.slice(0, 20).map((e) => (
          <div key={e.id} className="journal-row">
            <div className="journal-top">
              <button className="scan-symbol linklike" onClick={() => onSelect(e.symbol)} title="Open in detail panel">
                {e.symbol}
              </button>
              <span className="journal-score">{e.score}{e.grade}</span>
              <span className="journal-price">@ {fmtPrice(e.price, e.symbol)}</span>
              <span className="journal-age">{fmtAge(e.ts)}</span>
              <button className="watch-remove" title="Delete entry" aria-label={`Delete ${e.symbol} entry`} onClick={() => void remove(e.id)}>
                ×
              </button>
            </div>
            {e.note && <div className="journal-note" title={e.note}>{e.note}</div>}
            <div className="journal-outcome">
              {e.outcome === undefined ? (
                <span className="journal-pending">outcome pending (after that day’s close)</span>
              ) : e.outcome === null ? (
                <span className="journal-pending">outcome unavailable</span>
              ) : (
                <span>
                  day close {fmtPrice(e.outcome.close, e.symbol)}{' '}
                  <span className={chgClass(e.outcome.closePct)}>{fmtPct(e.outcome.closePct)}</span>
                  {' '}from log
                </span>
              )}
              <button
                className="linklike journal-toggle"
                onClick={() => setExpanded((x) => (x === e.id ? null : e.id))}
              >
                {expanded === e.id ? 'hide factors' : 'factors'}
              </button>
            </div>
            {expanded === e.id && (
              <div className="journal-factors">
                {e.factors.map((f) => (
                  <span key={f.label} className={`chip chip-${f.status}`}>
                    {f.label} {f.display}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
