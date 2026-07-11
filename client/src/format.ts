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

/** Plain ratio like P/E — one decimal, em-dash when absent or non-positive. */
export function fmtRatio(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n <= 0) return '—';
  return n.toFixed(1);
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

const ET_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric',
});
const ET_MONTH_YEAR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', year: '2-digit',
});

/** Date label for daily-bar charts. `longRange` uses month+year (for 1Y/5Y). */
export function fmtDate(ts: number, longRange = false): string {
  return (longRange ? ET_MONTH_YEAR : ET_DATE).format(new Date(ts));
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
/** "2026-08-11" -> "Aug 11" (parsed as a plain calendar date, no timezone shift). */
export function fmtCalDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return m && d ? `${MONTH_ABBR[m - 1]} ${d}` : iso;
}
/** "2026-08-11" -> "Aug" */
export function monthAbbr(iso: string): string {
  return MONTH_ABBR[Number(iso.split('-')[1]) - 1] ?? '';
}
/** "2026-08-11" -> 11 */
export function dayNum(iso: string): number {
  return Number(iso.split('-')[2]);
}
/** "2026-08-11" -> "August 2026" */
export function monthLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTH_FULL[m - 1] ?? ''} ${y}`;
}

/** Common brand name people know, given a ticker + legal name. Null if none distinct. */
const BRAND_OVERRIDES: Record<string, string> = {
  AAPL: 'Apple', MSFT: 'Microsoft', GOOGL: 'Google', GOOG: 'Google', AMZN: 'Amazon',
  META: 'Meta', NVDA: 'Nvidia', TSLA: 'Tesla', AVGO: 'Broadcom', LLY: 'Eli Lilly',
  JPM: 'JPMorgan', AMD: 'AMD', RIOT: 'Riot Platforms', SHOP: 'Shopify', BRK: 'Berkshire',
};
const CORP_SUFFIX =
  /\s+(?:incorporated|inc|corporation|corp|company|co|holdings?|group|plc|llc|ltd|limited|class\s+[abc]|&\s*co|n\.?v|s\.?a|ag|se)\.?,?$/i;

export function brandName(symbol: string | null | undefined, legalName: string | null | undefined): string | null {
  const key = symbol?.toUpperCase().split('.')[0] ?? '';
  if (BRAND_OVERRIDES[key]) return BRAND_OVERRIDES[key];
  if (!legalName) return null;
  let s = legalName.replace(/[,.]+$/, '').trim();
  let prev = '';
  while (s !== prev && s.length) {
    prev = s;
    s = s.replace(CORP_SUFFIX, '').replace(/[,.\s]+$/, '').trim();
  }
  return s || null;
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
