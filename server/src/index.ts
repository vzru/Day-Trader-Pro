import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config';
import { Push } from './push';
import { buildApi } from './routes/api';
import { Hub } from './services/hub';
import { Router } from './services/router';
import { Scanner } from './services/scanner';
import { TopCompanies } from './services/topCompanies';
import { WatchlistStore } from './services/watchlist';
import { error, log } from './util/log';

// A data hiccup must never take the app down: log and keep serving.
process.on('unhandledRejection', (reason) => error('process', 'unhandled rejection:', reason));
process.on('uncaughtException', (e) => error('process', 'uncaught exception:', e));

async function main(): Promise<void> {
  const router = new Router();
  const watchlist = new WatchlistStore();
  const hub = new Hub(router, watchlist);
  const scanner = new Scanner(router);
  const top = new TopCompanies(router);

  const app = express();
  app.use(express.json());
  app.use('/api', buildApi(hub, scanner, router, top));

  // Serve the built client if it exists (production convenience; in dev the
  // Vite server at :5173 proxies /api and /ws here instead).
  const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    error('http', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  const server = http.createServer(app);
  const push = new Push(
    server,
    () => [...hub.snapshotMessages(), top.message()],
    (msg) => {
      if (msg.type === 'select') void hub.select(msg.symbol);
    },
  );
  hub.broadcast = (msg) => push.broadcast(msg);
  scanner.broadcast = (msg) => push.broadcast(msg);
  top.broadcast = (msg) => push.broadcast(msg);
  // Earnings cover the Top-25 too: let the hub read the live top names, and
  // re-pull earnings whenever that list refreshes.
  hub.topSymbols = () => top.symbols();
  top.onUpdate = () => hub.onTopUpdated();

  // Listen first: data priming can take a while when providers rate-limit,
  // and the UI should be reachable (with placeholders) the whole time.
  server.listen(config.port, () => {
    log('server', `Day Trader Pro backend on http://localhost:${config.port}`);
    log('server', `feeds: us=${config.usFeed} ca=${config.caFeed} news=${config.newsFeed}${config.forceSim ? ' (FORCE_SIM)' : ''}`);
  });

  await hub.start();
  // Top-25 is on-screen, so give it the Yahoo feed before the background scanner.
  void top.start();
  void scanner.start();
}

main().catch((e) => {
  error('server', 'fatal startup error:', e);
  process.exit(1);
});
