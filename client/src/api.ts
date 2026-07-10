import type { Bar, CalendarEvent, ChartRange, NewsItem, TopRow, WatchRow } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

export const api = {
  addToWatchlist: (symbol: string) =>
    request<{ ok: boolean; rows: WatchRow[] }>('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify({ symbol }),
    }),
  removeFromWatchlist: (symbol: string) =>
    request<{ ok: boolean; rows: WatchRow[] }>(`/api/watchlist/${encodeURIComponent(symbol)}`, {
      method: 'DELETE',
    }),
  getNews: () => request<{ enabled: boolean; items: NewsItem[] }>('/api/news'),
  getCalendar: () => request<{ events: CalendarEvent[]; earningsConfigured: boolean }>('/api/calendar'),
  getBars: (symbol: string, range: ChartRange) =>
    request<{ symbol: string; range: ChartRange; bars: Bar[] }>(
      `/api/bars/${encodeURIComponent(symbol)}?range=${range}`,
    ),
  getContext: () =>
    request<{ series: { symbol: string; points: number[] }[] }>('/api/context'),
  getTop: () => request<{ rows: TopRow[] }>('/api/top'),
};
