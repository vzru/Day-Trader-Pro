import { fmtAge, fmtEtTime } from '../format';
import type { NewsItem } from '../types';

export default function NewsTape({ items, selected }: { items: NewsItem[]; selected: string | null }) {
  // Scope the panel to the currently selected stock.
  const rows = selected ? items.filter((n) => n.symbol === selected) : items;

  return (
    <section className="panel news">
      <h2 className="panel-title">{selected ? `NEWS · ${selected}` : 'NEWS / CATALYSTS'}</h2>
      {rows.length === 0 && (
        <p className="empty">
          {selected ? `No recent headlines for ${selected}.` : 'No recent headlines.'}
        </p>
      )}
      <div className="news-rows">
        {rows.map((n) => (
          <div key={n.id} className="news-row">
            <div className="news-meta">
              <span className="news-time" title={new Date(n.ts).toLocaleString()}>
                {fmtEtTime(n.ts)} · {fmtAge(n.ts)}
              </span>
              <span className="chip">{n.symbol}</span>
            </div>
            {n.url ? (
              <a className="news-headline" href={n.url} target="_blank" rel="noreferrer">
                {n.headline}
              </a>
            ) : (
              <span className="news-headline">{n.headline}</span>
            )}
            <span className="news-source">{n.source}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
