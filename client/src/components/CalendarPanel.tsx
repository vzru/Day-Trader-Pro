import type { CalendarCategory, CalendarEvent } from '../types';

/** Display order + headings for the calendar's category sections. */
const CATEGORY_META: { key: CalendarCategory; label: string }[] = [
  { key: 'earnings', label: 'EARNINGS' },
  { key: 'rates', label: 'RATES & CENTRAL BANKS' },
  { key: 'inflation', label: 'INFLATION' },
  { key: 'jobs', label: 'JOBS' },
  { key: 'growth', label: 'GROWTH' },
  { key: 'energy', label: 'ENERGY' },
  { key: 'other', label: 'OTHER' },
];

export default function CalendarPanel({
  events,
  earningsConfigured,
}: {
  events: CalendarEvent[];
  earningsConfigured: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const byCat = new Map<CalendarCategory, CalendarEvent[]>();
  for (const ev of events) {
    const c = ev.category ?? 'other';
    const list = byCat.get(c) ?? [];
    list.push(ev);
    byCat.set(c, list);
  }

  return (
    <section className="panel calendar">
      <h2 className="panel-title">ECONOMIC CALENDAR</h2>
      {events.length === 0 && !earningsConfigured && (
        <p className="empty">No events. Edit server/data/calendar.json.</p>
      )}

      {CATEGORY_META.map(({ key, label }) => {
        const list = (byCat.get(key) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));

        // Always surface the earnings section so the missing-key hint shows.
        if (key === 'earnings' && !list.length) {
          if (earningsConfigured) return null;
          return (
            <div key={key} className="cal-group">
              <h3 className="cal-cat">{label}</h3>
              <p className="cal-hint">Add a FINNHUB_KEY (free) to load per-stock earnings dates.</p>
            </div>
          );
        }
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

      <p className="cal-note">Macro from server/data/calendar.json; earnings via Finnhub.</p>
    </section>
  );
}

function CalRow({ ev, today }: { ev: CalendarEvent; today: string }) {
  const past = ev.date < today;
  const isEarnings = ev.category === 'earnings';
  return (
    <div className={`cal-row ${past ? 'is-past' : ''} ${ev.date === today ? 'is-today' : ''}`}>
      <span
        className={`dot dot-${ev.importance === 'high' ? 'warn' : ev.importance === 'medium' ? 'pass' : 'na'}`}
        title={`${ev.importance} importance`}
        aria-label={`${ev.importance} importance`}
      />
      <span className="cal-date">
        {ev.date.slice(5)}
        {ev.time ? ` ${ev.time}` : ''}
      </span>
      <span className={`chip ${isEarnings ? 'chip-symbol' : ''}`}>{isEarnings ? ev.symbol : ev.country}</span>
      <span className="cal-title">{isEarnings ? 'Earnings call' : ev.title}</span>
    </div>
  );
}
