# Day Trader Pro

A **personal-use, local-only** day-trading monitoring and screening dashboard for US and
Canadian stocks. A small Node backend pulls free-tier market data and pushes it to a React
frontend over a websocket.

> **Guardrails, up front:** this tool **never places trades** — there is no order code, not
> even a stub. Everything it displays (factor grids, setup scores, scanner ranks) is a
> **screening heuristic, not investment advice and not a proven edge**. Free data tiers have
> real limitations (see below); treat every number as indicative.

![stack](https://img.shields.io/badge/stack-Node%20%2B%20TypeScript%20%2B%20Express%20%2B%20ws%20%2F%20Vite%20%2B%20React-1C2740)

---

## Quick start

```bash
git clone https://github.com/vzru/Day-Trader-Pro.git
cd Day-Trader-Pro
npm install          # installs root + server + client workspaces
cp .env.example .env # optional — fill in whichever keys you have
npm run dev          # backend on :4400, UI on http://localhost:5173
```

**No keys at all?** The app runs fully in **SIMULATED** mode (deterministic random-walk
ticks) so you can explore the entire UI. Every feed's true source is always shown in the
header badges: `LIVE · IEX`, `DELAYED · YAHOO`, or `SIMULATED`.

## Getting free API keys

| Provider | What it powers | Where to sign up | Env vars |
|---|---|---|---|
| **Alpaca Basic** (free) | US real-time quotes/trades/bars | [alpaca.markets](https://alpaca.markets/) → dashboard → *API Keys* (paper-trading keys work for market data) | `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY` |
| **Yahoo Finance** (unofficial, keyless) | Canadian `.TO` quotes, intraday charts, `^VIX`, `CAD=X`, and fundamentals (market cap, float, short interest) for **all** symbols | nothing to sign up for | `DISABLE_YAHOO=1` to turn off |
| **Finnhub** (free, optional) | Company news / catalyst detection | [finnhub.io/register](https://finnhub.io/register) | `FINNHUB_KEY` |

Set `FORCE_SIM=1` to force full simulation even with keys present (useful for UI work).

## Data source limitations (read this)

- **Alpaca free = IEX exchange only.** IEX handles roughly **~2% of US volume**, so volume,
  relative volume, and dollar-volume numbers for US tickers are *partial*. Prices are real-time
  but represent IEX prints, and bid/ask is the IEX book, so spreads can read wider than the
  consolidated NBBO. The UI notes this on US detail views. Upgrading to Alpaca's paid SIP feed
  removes this limitation (see *Swapping in a paid feed*).
- **Yahoo quotes are delayed ~15 minutes** and the API is **unofficial** — it can rate-limit,
  change, or break at any time. The app caches responses, spaces calls out, backs off for 90s
  on any 429, and keeps serving the last cached data instead of crashing. All Yahoo-sourced
  rows are labeled `DELAYED · YAHOO` / `DELAYED ~15 MIN`.
- **Finnhub free tier** news is US-listed symbols only; `.TO` symbols are skipped. If the key
  is absent the news panel hides itself.
- **The economic calendar is a static local file** (`server/data/calendar.json`) seeded with
  placeholders — edit it and verify dates yourself; nothing fetches it remotely.

### Free-tier budgets (self-imposed, below the provider caps)

| Provider | Provider cap | This app's budget | Typical steady-state use |
|---|---|---|---|
| Alpaca REST | ~200 calls/min | 120/min | ~4/min (snapshot true-ups + scanner batches) |
| Alpaca websocket | 1 concurrent | 1 | 1 connection, ~40 symbols |
| Yahoo | unpublished | 20/min, ≥1.5s apart | ~4/min (30s poll + scanner batch) |
| Finnhub | 60 calls/min | 25/min | ~1/min (10-min per-symbol news cache) |

## What's on screen

- **Header** — ET clock, session state (pre-market / regular / after-hours / closed), and a
  status badge per feed showing the *true* source.
- **Context strip** — SPY, QQQ, XIC.TO (TSX proxy), ^VIX, CAD=X.
- **Left rail: watchlist** — add/remove US and `.TO` tickers (persisted to
  `server/data/watchlist.json`), with price, % change, and a relative-volume mini-bar
  (tick mark = the 2.0× target).
- **Center: ticker detail** — price/bid/ask/spread/OHLC/prev close, an SVG intraday chart
  with VWAP overlay and open-price reference line, a **9-factor grid** (each card: value,
  threshold, pass/warn/fail dot), and a composite **Setup Score** (0–100, 12-block ladder,
  letter grade, plain-language verdict).
- **Center: MID-CAP SCANNER — ranked by tradeability criteria, not advice.** Every 60s the
  curated universe (`server/data/universe.json`, ~150 liquid US/CA mid-caps — edit freely) is
  scored on **objective tradeability only**: relative volume, gap %, intraday range %, spread,
  and dollar-volume liquidity. Market caps are verified from fundamentals at startup (and
  every 12h); anything outside **US$2B–$10B** or under **$5** is dropped. Top 8 shown with
  the two strongest driving factors and an add-to-watchlist button. These are screening
  results, never picks.
- **Right rail** — news/catalyst tape (Finnhub, if configured), a position-size calculator
  (account, risk %, entry, stop → shares, $ at risk, position value, 2R target — arithmetic
  only, no orders), and the editable economic calendar.
- **Footer** — the permanent disclaimer.

### The nine factors

| # | Factor | "Pass" threshold | Notes |
|---|---|---|---|
| 1 | Relative volume | ≥ 2.0× | today's pace vs 30-day average (linear session pace model) |
| 2 | Gap vs prior close | \|gap\| ≥ 2% | |
| 3 | Price vs VWAP | above | long bias |
| 4 | RSI(14), 1-min bars | 40–70 | momentum zone |
| 5 | Bid-ask spread | ≤ 0.10% | IEX book for US free tier |
| 6 | Intraday range | ≥ 1.5% of price | |
| 7 | Float | < 50M | smaller float = faster moves |
| 8 | Short interest | ≥ 10% of float | squeeze fuel |
| 9 | News catalyst | headline within 24h | needs Finnhub key |

Factors with missing data show **N/A** and are excluded (weights renormalize). All thresholds
live in [server/src/services/score.ts](server/src/services/score.ts) — tune to taste.

## Architecture

```
/server  Node + TypeScript + Express + ws
  src/datasources/     one file per provider, all behind the DataSource interface
    DataSource.ts        getSnapshot / getBars / subscribeStream / getFundamentals
    alpaca.ts            US real-time (websocket + REST, reconnect w/ backoff)
    yahoo.ts             CA + reference data (30s polling, caching, cooldowns)
    finnhub.ts           news (NewsSource capability)
    sim.ts               deterministic random-walk fallback
  src/services/
    router.ts            symbol → provider routing; feed status registry
    hub.ts               tracks watchlist/context/selected; computes factors; pushes to clients
    scanner.ts           60s universe scoring loop
    indicators.ts        VWAP, RSI, rel-vol, gap, range, spread
    score.ts             factor thresholds, weights, grades, verdicts
  data/                  universe.json, calendar.json, watchlist.json (runtime)
/client  Vite + React + TypeScript (no UI framework, custom CSS)
```

- API keys live **only** in the server process; the browser talks only to
  `localhost` (`/api/*` REST + `/ws` websocket, proxied by Vite in dev).
- Client and server both auto-reconnect: the browser's websocket retries with backoff, and
  the Alpaca stream reconnects itself the same way.

### Swapping in a paid feed later

Everything upstream of the UI goes through the
[`DataSource`](server/src/datasources/DataSource.ts) interface:

1. Add `server/src/datasources/yourfeed.ts` implementing `getSnapshot`, `getBars`,
   `subscribeStream`, `getFundamentals` (and optionally `NewsSource.getNews`).
2. Map it in [`router.ts`](server/src/services/router.ts) — the constructor is the only
   place providers are chosen (`this.us = …`, `this.ca = …`, `this.fundamentals = …`,
   `this.news = …`).
3. Done — hub, scanner, scoring, and the entire frontend are provider-agnostic.

Most likely upgrades: **Alpaca Algo Trader Plus** (consolidated SIP quotes — fixes the IEX
volume gap with the same API, zero code changes), or a real-time Canadian feed to replace
Yahoo's 15-minute delay.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | server (tsx watch) + client (Vite) together |
| `npm run typecheck` | strict TypeScript across both workspaces |
| `npm run build` | production client build to `client/dist` (served by the server if present) |
| `npm run start` | backend only |

## Troubleshooting

- **Everything says SIMULATED** — no `.env` or empty keys; that's the advertised fallback.
- **US badge shows an error** — bad Alpaca keys. The app stops hammering the API after an
  auth failure; fix the keys and restart.
- **CA badge shows an error / stale prices** — Yahoo is rate-limiting or down. The app backs
  off for 90s and serves cache; it recovers on its own. If it persists, Yahoo may have
  changed something — check for a `yahoo-finance2` package update.
- **News panel missing** — no `FINNHUB_KEY` set (by design), or the key is invalid (badge
  turns red).

---

*Personal-use tool. Data from free tiers (IEX-only US volume; Canadian quotes delayed ~15
min). Screening criteria are heuristics, not a proven edge. Not investment advice.*
