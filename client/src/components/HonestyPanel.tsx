import { useEffect, useState } from 'react';
import { api } from '../api';
import type { BacktestReport } from '../types';

const REFRESH_MS = 10 * 60_000;

/**
 * Score honesty report: did high morning scores actually move more than low
 * ones? Aggregated from the scanner's own daily captures — the app grading
 * itself. Needs a few trading days (with the app running through the close)
 * before it says anything.
 */
export default function HonestyPanel() {
  const [report, setReport] = useState<BacktestReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.getBacktest()
        .then((r) => { if (!cancelled) setReport(r); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const fmt = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`);

  return (
    <section className="panel honesty">
      <h2 className="panel-title">SCORE HONESTY</h2>
      {!report || report.samples === 0 ? (
        <p className="empty">
          Collecting data — each morning the scanner records its scores, each close it records what
          actually happened. Needs a few trading days with the app running through the close.
          {report && report.pendingToday > 0 && ` (${report.pendingToday} captures pending today.)`}
        </p>
      ) : (
        <>
          <table className="honesty-table">
            <thead>
              <tr>
                <th>Score</th>
                <th title="Samples">n</th>
                <th title="Average |close vs morning price|">avg move</th>
                <th title="Average intraday (high-low)/price">avg range</th>
                <th title="Share that moved more than ±2% after capture">&gt;±2%</th>
              </tr>
            </thead>
            <tbody>
              {report.buckets.map((b) => (
                <tr key={b.label} className={b.count === 0 ? 'is-empty' : ''}>
                  <td>{b.label}</td>
                  <td>{b.count}</td>
                  <td>{fmt(b.avgAbsMovePct)}</td>
                  <td>{fmt(b.avgRangePct)}</td>
                  <td>{fmt(b.bigMoveShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="scanner-foot">
            {report.samples} samples over {report.days} day{report.days === 1 ? '' : 's'} — small samples
            mislead; judge only after many days.
          </p>
        </>
      )}
    </section>
  );
}
