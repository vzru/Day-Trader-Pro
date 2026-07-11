import { useEffect, useState } from 'react';
import { dayNum, fmtCalDate, monthAbbr, monthLabel } from '../format';
import type { CalendarCategory, CalendarEvent } from '../types';

const SESSION_TAG: Record<string, { short: string; full: string }> = {
  'BEFORE OPEN': { short: 'BMO', full: 'Before market open' },
  'AFTER CLOSE': { short: 'AMC', full: 'After market close' },
  'DURING MKT': { short: 'DMH', full: 'During market hours' },
};

/** Macro sections (earnings is its own pinned section above these). */
const CATEGORY_META: { key: CalendarCategory; label: string }[] = [
  { key: 'rates', label: 'RATES & CENTRAL BANKS' },
  { key: 'inflation', label: 'INFLATION' },
  { key: 'jobs', label: 'JOBS' },
  { key: 'growth', label: 'GROWTH' },
  { key: 'energy', label: 'ENERGY' },
  { key: 'other', label: 'OTHER' },
];

const EARNINGS_PREVIEW = 10;

export default function CalendarPanel({
  macro,
  earnings,
  earningsConfigured,
}: {
  macro: CalendarEvent[];
  earnings: CalendarEvent[]; // sorted soonest-first, upcoming only (server)
  earningsConfigured: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const preview = earnings.slice(0, EARNINGS_PREVIEW);
  const overflow = earnings.length - preview.length;

  const byCat = new Map<CalendarCategory, CalendarEvent[]>();
  for (const ev of macro) {
    const c = ev.category ?? 'other';
    const list = byCat.get(c) ?? [];
    list.push(ev);
    byCat.set(c, list);
  }

  return (
    <section className="panel calendar">
      <h2 className="panel-title">UPCOMING EARNINGS</h2>
      {earnings.length === 0 && (
        <p className={earningsConfigured ? 'empty' : 'cal-hint'}>
          {earningsConfigured
            ? 'No upcoming earnings for the Top-25 or your watchlist.'
            : 'Add a FINNHUB_KEY (free) to load earnings dates.'}
        </p>
      )}
      {preview.length > 0 && (
        <div className="cal-rows">
          {preview.map((ev) => (
            <EarningsRow key={ev.id} ev={ev} today={today} />
          ))}
        </div>
      )}
      {overflow > 0 && (
        <button className="cal-more" onClick={() => setShowAll(true)}>
          More ({overflow}) →
        </button>
      )}

      <h2 className="panel-title cal-econ-title">ECONOMIC CALENDAR</h2>
      {macro.length === 0 && <p className="empty">No events. Edit server/data/calendar.json.</p>}
      {CATEGORY_META.map(({ key, label }) => {
        const list = (byCat.get(key) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
        if (!list.length) return null;
        return (
          <div key={key} className="cal-group">
            <h3 className="cal-cat">{label}</h3>
            <div className="cal-rows">
              {list.map((ev) => (
                <CalRow key={ev.id} ev={ev} today={today} />
              ))}
            </div>
          </div>
        );
      })}
      <p className="cal-note">Macro from server/data/calendar.json; earnings via Finnhub (US-listed).</p>

      {showAll && <EarningsModal earnings={earnings} today={today} onClose={() => setShowAll(false)} />}
    </section>
  );
}

function EarningsRow({ ev, today }: { ev: CalendarEvent; today: string }) {
  return (
    <div className={`cal-earn ${ev.date === today ? 'is-today' : ''}`}>
      <div className="cal-earn-top">
        <span className="chip chip-symbol">{ev.symbol}</span>
        {ev.name && <span className="earn-name">{ev.name}</span>}
      </div>
      <div className="cal-earn-sub">
        <span className="dot dot-warn" aria-hidden="true" />
        <span>
          {fmtCalDate(ev.date)}
          {ev.time ? ` · ${ev.time}` : ''}
        </span>
      </div>
    </div>
  );
}

function CalRow({ ev, today }: { ev: CalendarEvent; today: string }) {
  const past = ev.date < today;
  return (
    <div className={`cal-row ${past ? 'is-past' : ''} ${ev.date === today ? 'is-today' : ''}`}>
      <span
        className={`dot dot-${ev.importance === 'high' ? 'warn' : ev.importance === 'medium' ? 'pass' : 'na'}`}
        title={`${ev.importance} importance`}
        aria-hidden="true"
      />
      <span className="cal-date">
        {fmtCalDate(ev.date)}
        {ev.time ? ` ${ev.time}` : ''}
      </span>
      <span className="chip">{ev.country}</span>
      <span className="cal-title">{ev.title}</span>
    </div>
  );
}

function EarningsModal({
  earnings,
  today,
  onClose,
}: {
  earnings: CalendarEvent[];
  today: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // group by month (earnings arrive sorted soonest-first)
  const groups: { key: string; label: string; items: CalendarEvent[] }[] = [];
  for (const ev of earnings) {
    const key = ev.date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: monthLabel(ev.date), items: [] };
      groups.push(g);
    }
    g.items.push(ev);
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal modal-earn" role="dialog" aria-label="All upcoming earnings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 className="panel-title">UPCOMING EARNINGS · {earnings.length}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {groups.map((g) => (
            <div key={g.key} className="earn-month">
              <h4 className="earn-month-head">{g.label}</h4>
              <div className="earn-grid">
                {g.items.map((ev) => (
                  <EarningsCard key={ev.id} ev={ev} today={today} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EarningsCard({ ev, today }: { ev: CalendarEvent; today: string }) {
  const tag = ev.time ? SESSION_TAG[ev.time] : null;
  return (
    <div className={`earn-card ${ev.date === today ? 'is-today' : ''}`}>
      <div className="earn-badge">
        <span className="earn-badge-mon">{monthAbbr(ev.date)}</span>
        <span className="earn-badge-day">{dayNum(ev.date)}</span>
      </div>
      <div className="earn-card-body">
        <div className="earn-card-top">
          <span className="chip chip-symbol">{ev.symbol}</span>
          {tag && (
            <span className="earn-session" title={tag.full}>
              {tag.short}
            </span>
          )}
        </div>
        {ev.name && <span className="earn-card-name">{ev.name}</span>}
      </div>
    </div>
  );
}
