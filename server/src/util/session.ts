import type { SessionInfo } from '../types';

const ET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Current US equity session state in Eastern Time. */
export function getSession(now = new Date()): SessionInfo {
  const parts = ET_FMT.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = get('weekday');
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const mins = hour * 60 + minute;
  const etTime = `${get('hour')}:${get('minute')}:${get('second')} ET`;

  const weekend = weekday === 'Sat' || weekday === 'Sun';
  let state: SessionInfo['state'] = 'closed';
  if (!weekend) {
    if (mins >= 4 * 60 && mins < 9 * 60 + 30) state = 'pre';
    else if (mins >= 9 * 60 + 30 && mins < 16 * 60) state = 'regular';
    else if (mins >= 16 * 60 && mins < 20 * 60) state = 'after';
  }
  const labels: Record<SessionInfo['state'], string> = {
    pre: 'PRE-MARKET',
    regular: 'REGULAR SESSION',
    after: 'AFTER HOURS',
    closed: 'CLOSED',
  };
  return { state, label: labels[state], etTime };
}

const ET_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date (YYYY-MM-DD) of a timestamp in Eastern Time. */
export function etDateStr(ts: number): string {
  return ET_DATE_FMT.format(new Date(ts));
}

/** Minutes since midnight, Eastern Time. */
export function etMinutes(now = new Date()): number {
  const parts = ET_FMT.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return (Number(get('hour')) % 24) * 60 + Number(get('minute'));
}

/**
 * Fraction of the regular session (9:30-16:00 ET) elapsed, clamped to
 * [0.05, 1]. Used to pace "expected volume so far" for relative volume.
 */
export function sessionElapsedFraction(now = new Date()): number {
  const parts = ET_FMT.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const mins = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  if (mins <= open) return 0.05;
  if (mins >= close) return 1;
  return Math.max(0.05, (mins - open) / (close - open));
}
