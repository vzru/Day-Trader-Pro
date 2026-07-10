export function fmtPrice(n: number | null | undefined, symbol?: string): string {
  if (n == null || !isFinite(n)) return '—';
  const decimals = symbol?.endsWith('=X') ? 4 : 2;
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtPct(n: number | null | undefined, signed = true): string {
  if (n == null || !isFinite(n)) return '—';
  const sign = signed && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

export function fmtCap(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  return `$${(n / 1e6).toFixed(0)}M`;
}

export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
}

const ET_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function fmtEtTime(ts: number): string {
  return `${ET_TIME.format(new Date(ts))} ET`;
}

export function fmtAge(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** CSS class for a signed change: gain / loss / flat. */
export function chgClass(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n === 0) return 'flat';
  return n > 0 ? 'gain' : 'loss';
}
