import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import AlertsPanel from './components/AlertsPanel';
import CalendarPanel from './components/CalendarPanel';
import ContextStrip from './components/ContextStrip';
import FooterBar from './components/FooterBar';
import Header from './components/Header';
import HonestyPanel from './components/HonestyPanel';
import JournalPanel from './components/JournalPanel';
import NewsTape from './components/NewsTape';
import Scanner from './components/Scanner';
import SectorStrip from './components/SectorStrip';
import TickerDetail from './components/TickerDetail';
import TopCompanies from './components/TopCompanies';
import Watchlist from './components/Watchlist';
import type {
  AlertItem, AlertSettings, Bar, CalendarEvent, FeedStatus, NewsItem, Quote, ScannerState,
  SectorRow, ServerMessage, SessionInfo, TickerDetail as Detail, TopRow, WatchRow,
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
  const [topRows, setTopRows] = useState<TopRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [barsSymbol, setBarsSymbol] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [scanner, setScanner] = useState<ScannerState | null>(null);
  const [newsEnabled, setNewsEnabled] = useState(false);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);
  const [earnings, setEarnings] = useState<CalendarEvent[]>([]);
  const [earningsConfigured, setEarningsConfigured] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertSettings, setAlertSettings] = useState<AlertSettings | null>(null);
  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [journalKey, setJournalKey] = useState(0);

  const wsRef = useRef<WSHandle | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  // Track seen alert ids so re-broadcasts don't re-notify.
  const seenAlertsRef = useRef<Set<string>>(new Set());
  const alertsPrimedRef = useRef(false);

  const notifyNewAlerts = useCallback((items: AlertItem[]) => {
    const seen = seenAlertsRef.current;
    const fresh = items.filter((a) => !seen.has(a.id));
    for (const a of items) seen.add(a.id);
    // Don't fire a notification storm for the backlog on first connect.
    if (!alertsPrimedRef.current) {
      alertsPrimedRef.current = true;
      return;
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      for (const a of fresh.slice(0, 3)) {
        try {
          new Notification('Day Trader Pro', { body: a.message, tag: a.id });
        } catch {
          /* notifications are best-effort */
        }
      }
    }
  }, []);

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
      case 'top':
        setTopRows(msg.rows);
        break;
      case 'earnings':
        setEarnings(msg.events);
        break;
      case 'scanner':
        setScanner({ results: msg.results, universeSize: msg.universeSize, eligible: msg.eligible, updatedAt: msg.updatedAt, mode: msg.mode });
        break;
      case 'alerts':
        setAlerts(msg.items);
        setAlertSettings(msg.settings);
        notifyNewAlerts(msg.items);
        break;
      case 'sectors':
        setSectors(msg.rows);
        break;
      case 'news':
        setNews(msg.items);
        setNewsEnabled(true);
        break;
      case 'error':
        setToast(msg.message);
        break;
    }
  }, [notifyNewAlerts]);

  useEffect(() => {
    const ws = connectWS(handleMessage, setWsStatus);
    wsRef.current = ws;
    api.getNews().then((r) => {
      setNewsEnabled(r.enabled);
      if (r.items.length) setNews(r.items);
    }).catch(() => setNewsEnabled(false));
    api.getCalendar().then((r) => {
      setCalendar(r.events);
      setEarningsConfigured(r.earningsConfigured);
    }).catch(() => setCalendar([]));
    api.getTop().then((r) => setTopRows(r.rows)).catch(() => {});
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

  const logToJournal = useCallback(async (symbol: string, note: string): Promise<boolean> => {
    try {
      await api.addJournal(symbol, note);
      setJournalKey((k) => k + 1);
      setToast(`${symbol} logged to journal`);
      return true;
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not log entry');
      return false;
    }
  }, []);

  const selectedTick = selected ? ticks[selected] : undefined;
  const watchSymbols = watchRows.map((r) => r.symbol);

  return (
    <div className="app">
      <Header feeds={feeds} session={session} wsStatus={wsStatus} />
      <ContextStrip ticks={ticks} selected={selected} onSelect={select} />
      <SectorStrip rows={sectors} onSelect={select} />

      <div className="layout">
        <aside className="rail-left">
          <TopCompanies
            rows={topRows}
            ticks={ticks}
            selected={selected}
            watchSymbols={watchSymbols}
            onSelect={select}
            onAdd={addSymbol}
          />
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
            onLog={logToJournal}
          />
          <Scanner
            state={scanner}
            watchSymbols={watchSymbols}
            onAdd={addSymbol}
            onSelect={select}
          />
        </main>

        <aside className="rail-right">
          <AlertsPanel
            items={alerts}
            settings={alertSettings}
            onScopeChange={(scope) => setAlertSettings({ scope })}
            onSelect={select}
          />
          {newsEnabled && <NewsTape items={news} selected={selected} />}
          <CalendarPanel macro={calendar} earnings={earnings} earningsConfigured={earningsConfigured} />
          <JournalPanel refreshKey={journalKey} onSelect={select} />
          <HonestyPanel />
        </aside>
      </div>

      <FooterBar />
      {toast && <div className="toast" role="alert">{toast}</div>}
    </div>
  );
}
