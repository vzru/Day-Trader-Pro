import { fmtAge, fmtEtTime } from '../format';
import type { NewsItem } from '../types';

export default function NewsTape({ items }: { items: NewsItem[] }) {
  return (
    <section className="panel news">
      <h2 className="panel-title">NEWS / CATALYSTS</h2>
      {items.length === 0 && <p className="empty">No recent headlines for watchlist symbols.</p>}
      <div className="news-rows">
        {items.map((n) => (
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
