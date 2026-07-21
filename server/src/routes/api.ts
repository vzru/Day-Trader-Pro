import fs from 'node:fs';
import path from 'node:path';
import { Router as ExpressRouter } from 'express';
import { config } from '../config';
import type { AlertEngine } from '../services/alerts';
import type { Backtest } from '../services/backtest';
import type { ChartRange, Hub } from '../services/hub';
import type { JournalStore } from '../services/journal';
import type { Scanner } from '../services/scanner';
import type { Sectors } from '../services/sectors';
import type { SettingsStore } from '../services/settings';
import type { Router } from '../services/router';
import type { TopCompanies } from '../services/topCompanies';
import type { CalendarEvent } from '../types';
import { warn } from '../util/log';
import { getSession } from '../util/session';

const CHART_RANGES: ChartRange[] = ['1D', '1W', '1M', '6M', '1Y', '2Y', '3Y', '5Y', '10Y'];

export interface ApiServices {
  alerts: AlertEngine;
  journal: JournalStore;
  backtest: Backtest;
  sectors: Sectors;
  settings: SettingsStore;
}

export function buildApi(hub: Hub, scanner: Scanner, router: Router, top: TopCompanies, svc: ApiServices): ExpressRouter {
  const api = ExpressRouter();

  api.get('/health', (_req, res) => {
    res.json({
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      session: getSession(),
      feeds: router.getStatuses(),
    });
  });

  api.get('/watchlist', (_req, res) => {
    res.json({ rows: hub.watchRows() });
  });

  api.post('/watchlist', async (req, res) => {
    const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol : '';
    const result = await hub.addSymbol(symbol);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, rows: hub.watchRows() });
  });

  api.delete('/watchlist/:symbol', async (req, res) => {
    const removed = await hub.removeSymbol(req.params.symbol);
    if (!removed) return res.status(404).json({ error: 'Symbol not on watchlist' });
    res.json({ ok: true, rows: hub.watchRows() });
  });

  api.get('/scanner', (_req, res) => {
    res.json(scanner.message());
  });

  api.get('/alerts', (_req, res) => {
    res.json(svc.alerts.message());
  });

  api.put('/alerts/settings', (req, res) => {
    const scope = typeof req.body?.scope === 'string' ? req.body.scope : '';
    const result = svc.settings.setAlertScope(scope);
    if (!result.ok) return res.status(400).json({ error: result.error });
    svc.alerts.onSettingsChanged();
    res.json({ ok: true, settings: svc.settings.alerts() });
  });

  api.get('/sectors', (_req, res) => {
    res.json(svc.sectors.message());
  });

  api.get('/journal', async (_req, res) => {
    res.json({ entries: await svc.journal.list() });
  });

  api.post('/journal', (req, res) => {
    const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol.trim().toUpperCase() : '';
    const note = typeof req.body?.note === 'string' ? req.body.note : '';
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' });
    const detail = hub.computeDetail(symbol);
    if (!detail) {
      return res.status(400).json({ error: `${symbol} is not being tracked — open it in the detail panel first` });
    }
    res.json({ ok: true, entry: svc.journal.add(detail, note) });
  });

  api.delete('/journal/:id', (req, res) => {
    if (!svc.journal.remove(req.params.id)) return res.status(404).json({ error: 'Entry not found' });
    res.json({ ok: true });
  });

  api.get('/backtest', (_req, res) => {
    res.json(svc.backtest.report());
  });

  api.get('/top', (_req, res) => {
    res.json(top.message());
  });

  api.get('/context', (_req, res) => {
    res.json({ series: hub.contextSeries() });
  });

  api.get('/bars/:symbol', async (req, res) => {
    const range = String(req.query.range ?? '1D').toUpperCase() as ChartRange;
    if (!CHART_RANGES.includes(range)) return res.status(400).json({ error: 'Invalid range' });
    try {
      const bars = await hub.rangeBars(req.params.symbol, range);
      res.json({ symbol: req.params.symbol.toUpperCase(), range, bars });
    } catch (e) {
      warn('api', 'bars fetch failed:', e instanceof Error ? e.message : e);
      res.status(502).json({ error: 'Could not fetch bars' });
    }
  });

  api.get('/news', (_req, res) => {
    res.json({ enabled: config.newsFeed !== 'off', items: hub.getNews() });
  });

  api.get('/calendar', (_req, res) => {
    const file = path.join(config.dataDir, 'calendar.json');
    let macro: CalendarEvent[] = [];
    try {
      macro = JSON.parse(fs.readFileSync(file, 'utf8')) as CalendarEvent[];
    } catch (e) {
      warn('api', 'could not read calendar.json:', e);
    }
    // Macro events from the local file. Per-stock earnings are pushed
    // separately over the websocket (they depend on the live Top-25 list).
    res.json({
      events: macro,
      earningsConfigured: router.earnings != null,
    });
  });

  return api;
}
