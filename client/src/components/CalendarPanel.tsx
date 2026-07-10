import type { CalendarEvent } from '../types';

export default function CalendarPanel({ events }: { events: CalendarEvent[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <section className="panel calendar">
      <h2 className="panel-title">ECONOMIC CALENDAR</h2>
      {sorted.length === 0 && <p className="empty">No events. Edit server/data/calendar.json.</p>}
      <div className="cal-rows">
        {sorted.map((ev) => {
          const past = ev.date < today;
          return (
            <div key={ev.id} className={`cal-row ${past ? 'is-past' : ''} ${ev.date === today ? 'is-today' : ''}`}>
              <span className={`dot dot-${ev.importance === 'high' ? 'warn' : ev.importance === 'medium' ? 'pass' : 'na'}`}
                title={`${ev.importance} importance`} aria-label={`${ev.importance} importance`} />
              <span className="cal-date">
                {ev.date.slice(5)}
                {ev.time ? ` ${ev.time}` : ''}
              </span>
              <span className="chip">{ev.country}</span>
              <span className="cal-title">{ev.title}</span>
            </div>
          );
        })}
      </div>
      <p className="cal-note">Seeded from server/data/calendar.json — edit it to add events.</p>
    </section>
  );
}
