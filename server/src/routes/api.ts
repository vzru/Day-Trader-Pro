import fs from 'node:fs';
import path from 'node:path';
import { Router as ExpressRouter } from 'express';
import { config } from '../config';
import type { Hub } from '../services/hub';
import type { Scanner } from '../services/scanner';
import type { Router } from '../services/router';
import type { CalendarEvent } from '../types';
import { warn } from '../util/log';
import { getSession } from '../util/session';

export function buildApi(hub: Hub, scanner: Scanner, router: Router): ExpressRouter {
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

  api.get('/news', (_req, res) => {
    res.json({ enabled: config.newsFeed !== 'off', items: hub.getNews() });
  });

  api.get('/calendar', (_req, res) => {
    const file = path.join(config.dataDir, 'calendar.json');
    try {
      const events = JSON.parse(fs.readFileSync(file, 'utf8')) as CalendarEvent[];
      res.json({ events });
    } catch (e) {
      warn('api', 'could not read calendar.json:', e);
      res.json({ events: [] });
    }
  });

  return api;
}
