import { api } from '../api';
import { fmtAge } from '../format';
import type { AlertItem, AlertScope, AlertSettings } from '../types';

const SCOPE_LABELS: { value: AlertScope; label: string }[] = [
  { value: 'all', label: 'Everything (scanner + lists)' },
  { value: 'watchlist', label: 'Watchlist only' },
  { value: 'top25', label: 'Top 25 only' },
  { value: 'off', label: 'Off' },
];

const KIND_ICON: Record<AlertItem['kind'], string> = {
  score: '★',
  relvol: '▲',
  gap: '↕',
  halt: '⚠',
};

/**
 * Screening alerts: score / rel-volume / gap / halt-risk triggers on the
 * scoped symbol set. Observations about market activity — never advice.
 */
export default function AlertsPanel({
  items,
  settings,
  onScopeChange,
  onSelect,
}: {
  items: AlertItem[];
  settings: AlertSettings | null;
  onScopeChange: (scope: AlertScope) => void;
  onSelect: (symbol: string) => void;
}) {
  const scope = settings?.scope ?? 'all';

  const changeScope = async (next: AlertScope) => {
    try {
      await api.setAlertScope(next);
      onScopeChange(next);
      // Ask for browser-notification permission the moment alerts are enabled.
      if (next !== 'off' && 'Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    } catch {
      /* server rejected — the ws will re-sync the real settings */
    }
  };

  return (
    <section className="panel alerts">
      <div className="alerts-head">
        <h2 className="panel-title">ALERTS</h2>
        <select
          className="alerts-scope"
          value={scope}
          onChange={(e) => void changeScope(e.target.value as AlertScope)}
          aria-label="Alert scope"
          title="Which symbols to watch for alerts"
        >
          {SCOPE_LABELS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
      {scope === 'off' ? (
        <p className="empty">Alerts are off.</p>
      ) : items.length === 0 ? (
        <p className="empty">No alerts yet — triggers: score ≥ 80, rel-vol ≥ 3x, gap ≥ 5%, halt risk.</p>
      ) : (
        <div className="alert-rows">
          {items.slice(0, 12).map((a) => (
            <button
              key={a.id}
              className={`alert-row alert-${a.kind}`}
              onClick={() => onSelect(a.symbol)}
              title="Open in detail panel"
            >
              <span className="alert-icon" aria-hidden>{KIND_ICON[a.kind]}</span>
              <span className="alert-msg">{a.message}</span>
              <span className="alert-age">{fmtAge(a.ts)}</span>
            </button>
          ))}
        </div>
      )}
      <p className="scanner-foot">Activity observations, not trade signals.</p>
    </section>
  );
}
