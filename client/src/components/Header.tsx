import { useEffect, useState } from 'react';
import type { FeedStatus, SessionInfo } from '../types';
import type { WSStatus } from '../ws';

const CLOCK_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const FEED_NAMES: Record<string, string> = { us: 'US', ca: 'CA', news: 'NEWS' };

export default function Header({
  feeds,
  session,
  wsStatus,
}: {
  feeds: FeedStatus[];
  session: SessionInfo | null;
  wsStatus: WSStatus;
}) {
  const [clock, setClock] = useState(() => CLOCK_FMT.format(new Date()));

  useEffect(() => {
    const t = setInterval(() => setClock(CLOCK_FMT.format(new Date())), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-name">DAY TRADER PRO</span>
        <span className="brand-sub">MONITOR / SCREEN — NO ORDERS</span>
      </div>
      <div className="header-right">
        <span className="clock" title="US Eastern Time">{clock} ET</span>
        <span className={`session session-${session?.state ?? 'closed'}`}>
          {session?.label ?? '—'}
        </span>
        <span className="badges">
          {feeds.map((f) => (
            <span key={f.id} className={`badge badge-${f.state}`} title={f.detail ?? f.label}>
              {FEED_NAMES[f.id] ?? f.id.toUpperCase()}&thinsp;·&thinsp;{f.label}
            </span>
          ))}
          {wsStatus !== 'open' && (
            <span className="badge badge-error">
              {wsStatus === 'connecting' ? 'CONNECTING…' : 'RECONNECTING…'}
            </span>
          )}
        </span>
      </div>
    </header>
  );
}
