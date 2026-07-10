import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import CalendarPanel from './components/CalendarPanel';
import ContextStrip from './components/ContextStrip';
import FooterBar from './components/FooterBar';
import Header from './components/Header';
import NewsTape from './components/NewsTape';
import PositionCalc from './components/PositionCalc';
import Scanner from './components/Scanner';
import TickerDetail from './components/TickerDetail';
import Watchlist from './components/Watchlist';
import type {
  Bar, CalendarEvent, FeedStatus, NewsItem, Quote, ScannerState, ServerMessage,
  SessionInfo, TickerDetail as Detail, WatchRow,
} from './types';
import { connectWS, type WSHandle, type WSStatus } from './ws';

export interface TickMap {
  [symbol: string]: { quote: Quote; relVol: number | null };
}

export default function App() {
  const [wsStatus, setWsStatus] = useState<WSStatus>('connecting');
  const [feeds, setFeeds] = useState<FeedStatus[]>([]);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [ticks, setTicks] = useState<TickMap>({});
  const [watchRows, setWatchRows] = useState<WatchRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [barsSymbol, setBarsSymbol] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [scanner, setScanner] = useState<ScannerState | null>(null);
  const [newsEnabled, setNewsEnabled] = useState(false);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const wsRef = useRef<WSHandle | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'hello':
        setFeeds(msg.feeds);
        setSession(msg.session);
        setWatchRows(msg.watchlist);
        setSelected((cur) => cur ?? msg.selected);
        break;
      case 'status':
        setFeeds(msg.feeds);
        setSession(msg.session);
        break;
      case 'tick':
        setTicks((t) => ({ ...t, [msg.quote.symbol]: { quote: msg.quote, relVol: msg.relVol } }));
        break;
      case 'bars':
        if (!selectedRef.current || msg.symbol === selectedRef.current) {
          setBars(msg.bars);
          setBarsSymbol(msg.symbol);
        }
        break;
      case 'bar':
        if (msg.symbol === selectedRef.current) {
          setBars((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.t === msg.bar.t) return [...prev.slice(0, -1), msg.bar];
            return [...prev, msg.bar];
          });
        }
        break;
      case 'detail':
        if (!selectedRef.current || msg.detail.symbol === selectedRef.current) setDetail(msg.detail);
        break;
      case 'watchlist':
        setWatchRows(msg.rows);
        break;
      case 'scanner':
        setScanner({ results: msg.results, universeSize: msg.universeSize, eligible: msg.eligible, updatedAt: msg.updatedAt });
        break;
      case 'news':
        setNews(msg.items);
        setNewsEnabled(true);
        break;
      case 'error':
        setToast(msg.message);
        break;
    }
  }, []);

  useEffect(() => {
    const ws = connectWS(handleMessage, setWsStatus);
    wsRef.current = ws;
    api.getNews().then((r) => {
      setNewsEnabled(r.enabled);
      if (r.items.length) setNews(r.items);
    }).catch(() => setNewsEnabled(false));
    api.getCalendar().then((r) => setCalendar(r.events)).catch(() => setCalendar([]));
    return () => ws.close();
  }, [handleMessage]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const select = useCallback((symbol: string) => {
    setSelected(symbol);
    setDetail(null);
    setBars([]);
    setBarsSymbol(null);
    wsRef.current?.send({ type: 'select', symbol });
  }, []);

  const addSymbol = useCallback(async (symbol: string) => {
    try {
      const r = await api.addToWatchlist(symbol);
      setWatchRows(r.rows);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not add symbol');
    }
  }, []);

  const removeSymbol = useCallback(async (symbol: string) => {
    try {
      const r = await api.removeFromWatchlist(symbol);
      setWatchRows(r.rows);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not remove symbol');
    }
  }, []);

  const selectedTick = selected ? ticks[selected] : undefined;
  const watchSymbols = watchRows.map((r) => r.symbol);

  return (
    <div className="app">
      <Header feeds={feeds} session={session} wsStatus={wsStatus} />
      <ContextStrip ticks={ticks} />

      <div className="layout">
        <aside className="rail-left">
          <Watchlist
            rows={watchRows}
            ticks={ticks}
            selected={selected}
            onSelect={select}
            onAdd={addSymbol}
            onRemove={removeSymbol}
          />
        </aside>

        <main className="center">
          <TickerDetail
            symbol={selected}
            detail={detail}
            tick={selectedTick}
            bars={barsSymbol === selected ? bars : []}
          />
          <Scanner
            state={scanner}
            watchSymbols={watchSymbols}
            onAdd={addSymbol}
            onSelect={select}
          />
        </main>

        <aside className="rail-right">
          {newsEnabled && <NewsTape items={news} />}
          <PositionCalc symbol={selected} livePrice={selectedTick?.quote.price ?? null} />
          <CalendarPanel events={calendar} />
        </aside>
      </div>

      <FooterBar />
      {toast && <div className="toast" role="alert">{toast}</div>}
    </div>
  );
}
