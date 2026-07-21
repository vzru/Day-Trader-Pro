import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import type { DataSource } from '../datasources/DataSource';
import type { Fundamentals, ScannerMode, ScannerResult, ServerMessage } from '../types';
import { error, log, warn } from '../util/log';
import { getSession, sessionElapsedFraction } from '../util/session';
import { gapPct, haltRisk, rangePct, relativeVolume, spreadPct } from './indicators';
import { scoreHistory } from './history';
import { composite, scannerFactors } from './score';
import { isCaSymbol, Router } from './router';
import { TOP_POOL } from './topCompanies';
import { VelocityTracker } from './velocity';

const SCAN_INTERVAL_MS = 60_000;
/** Re-verify market caps periodically; caps drift and unknowns get filled. */
const REVERIFY_INTERVAL_MS = 12 * 3_600_000;
/** Market-cap floor: $5B and up (large-caps included, no ceiling). */
const CAP_MIN = 5e9;
const CAP_MAX = Infinity;
const MIN_PRICE = 5;
const TOP_N = 8;
/** Snapshot batch size per REST request (both Alpaca and Yahoo accept lists). */
const BATCH = 40;

interface UniverseEntry {
  symbol: string;
  name: string;
  exchange: string;
}

/**
 * Market scanner ($5B+ cap): every 60s, snapshot the candidate universe in
 * batches and rank by objective tradeability criteria (rel volume, gap, range,
 * spread, dollar volume). The universe is the curated mid-cap list merged with
 * the large/mega-cap POOL from topCompanies. Screening only — never emits
 * buy/sell language.
 */
export class Scanner {
  private universe: UniverseEntry[] = [];
  private eligible: UniverseEntry[] = [];
  private funds = new Map<string, Fundamentals>();
  private results: ScannerResult[] = [];
  private updatedAt = 0;
  private mode: ScannerMode = 'regular';
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;
  private velocity = new VelocityTracker();
  /** Full scored set from the last scan (not just top-N) — alert engine input. */
  private metrics = new Map<string, ScanMetrics>();

  broadcast: (msg: ServerMessage) => void = () => {};
  /** Fired after each scan with the full scored set (backtest capture). */
  onScan: (rows: ScanMetrics[], mode: ScannerMode) => void = () => {};

  constructor(private router: Router) {}

  /** Metrics per symbol from the most recent scan (fresh within ~90s). */
  lastScored(): Map<string, ScanMetrics> {
    return this.metrics;
  }

  eligibleSymbols(): string[] {
    return this.eligible.map((e) => e.symbol);
  }

  async start(): Promise<void> {
    this.loadUniverse();
    await this.verifyUniverse();
    await this.scanOnce();
    this.timer = setInterval(() => void this.scanOnce(), SCAN_INTERVAL_MS);
    const reverify = setInterval(() => void this.verifyUniverse(), REVERIFY_INTERVAL_MS);
    reverify.unref?.();
    log('scanner', `running: ${this.eligible.length}/${this.universe.length} symbols eligible, scanning every ${SCAN_INTERVAL_MS / 1000}s`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private loadUniverse(): void {
    const file = path.join(config.dataDir, 'universe.json');
    let curated: UniverseEntry[] = [];
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      curated = (raw as UniverseEntry[]).filter((e) => e && typeof e.symbol === 'string');
    } catch (e) {
      error('scanner', `could not load ${file}; using large-cap POOL only:`, e);
    }
    // Merge the large/mega-cap POOL (topCompanies) with the curated list so the
    // $5B+ band actually has big names to surface. Curated entries win on
    // conflict (they carry proper display names/exchanges); POOL is US-listed.
    const bySymbol = new Map<string, UniverseEntry>();
    for (const sym of TOP_POOL) bySymbol.set(sym, { symbol: sym, name: sym, exchange: 'US' });
    for (const e of curated) bySymbol.set(e.symbol, e);
    this.universe = [...bySymbol.values()];
    log('scanner', `universe: ${curated.length} curated + ${TOP_POOL.length} large-cap POOL = ${this.universe.length} unique symbols`);
  }

  /**
   * Startup verification: fetch fundamentals for the whole universe (batched)
   * and drop anything with a KNOWN market cap below the $5B floor. Symbols
   * whose cap can't be fetched are kept and re-checked next run.
   */
  private async verifyUniverse(): Promise<void> {
    const symbols = this.universe.map((e) => e.symbol);
    for (let i = 0; i < symbols.length; i += BATCH) {
      const batch = symbols.slice(i, i + BATCH);
      try {
        const funds = await this.router.fundamentals.getFundamentals(batch);
        for (const f of funds) this.funds.set(f.symbol, f);
      } catch (e) {
        warn('scanner', 'fundamentals batch failed (symbols kept, re-checked later):', e instanceof Error ? e.message : e);
      }
    }
    let dropped = 0;
    this.eligible = this.universe.filter((entry) => {
      const cap = this.funds.get(entry.symbol)?.marketCap;
      if (cap != null && (cap < CAP_MIN || cap > CAP_MAX)) {
        dropped++;
        return false;
      }
      return true;
    });
    if (dropped) log('scanner', `dropped ${dropped} symbols below the $5B market-cap floor`);
  }

  private async scanOnce(): Promise<void> {
    if (this.scanning || !this.eligible.length) return;
    this.scanning = true;
    try {
      const usSyms = this.eligible.filter((e) => !isCaSymbol(e.symbol)).map((e) => e.symbol);
      const caSyms = this.eligible.filter((e) => isCaSymbol(e.symbol)).map((e) => e.symbol);
      const quotes = [
        ...(await this.snapshotAll(this.router.us, usSyms)),
        ...(await this.snapshotAll(this.router.ca, caSyms)),
      ];

      // Pre-market (4:00–9:30 ET): today's open doesn't exist yet, so gap is
      // "latest pre-market price vs yesterday's close" and the ranking is by
      // that gap — the classic morning gappers list.
      const pre = getSession().state === 'pre';
      this.mode = pre ? 'premarket' : 'regular';

      const elapsed = sessionElapsedFraction();
      const scored: (ScannerResult & { gap: number | null })[] = [];
      const metrics = new Map<string, ScanMetrics>();
      for (const q of quotes) {
        if (q.price == null || q.price < MIN_PRICE) continue;
        const entry = this.eligible.find((e) => e.symbol === q.symbol);
        if (!entry) continue;
        const f = this.funds.get(q.symbol);
        // Guard against renamed/delisted tickers: a $5B+ scanner must only rank
        // symbols with a CONFIRMED in-band market cap. Some dead tickers (e.g.
        // GPS after the Gap "GAP" rename) still return a live aliased snapshot
        // but have lost their fundamentals — skip anything whose cap we can't
        // verify rather than surface a $5B+ result that isn't one.
        const cap = f?.marketCap;
        if (cap == null || cap < CAP_MIN || cap > CAP_MAX) continue;
        const gap = pre ? gapPct(q.price, q.prevClose) : gapPct(q.open, q.prevClose);
        const relVol = relativeVolume(q.volume, f?.avgVolume30d ?? null, elapsed);
        const spread = spreadPct(q.bid, q.ask);
        const move5m = this.velocity.push(q.symbol, q.price);
        const halt = haltRisk(move5m, spread, q.changePct);
        const factors = scannerFactors({
          relVol,
          gapPct: gap,
          rangePct: rangePct(q.high, q.low, q.price),
          spreadPct: spread,
          dollarVolume: q.volume != null && q.price != null ? q.volume * q.price : null,
        });
        const score = composite(factors);
        scoreHistory.record('scan', q.symbol, score);
        metrics.set(q.symbol, {
          symbol: q.symbol, price: q.price, changePct: q.changePct,
          score, relVol, gapPct: gap, haltRisk: halt, ts: Date.now(),
        });
        const top = factors
          .filter((x) => x.status !== 'na')
          .sort((a, b) => b.score * b.weight - a.score * a.weight)
          .slice(0, 2)
          .map((x) => ({ label: x.label, display: x.display }));
        scored.push({
          symbol: q.symbol,
          name: f?.name ?? entry.name,
          exchange: entry.exchange,
          marketCap: f?.marketCap ?? null,
          price: q.price,
          changePct: q.changePct,
          score,
          grade: score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F',
          topFactors: top,
          source: q.source,
          delayed: q.delayed,
          scoreHist: scoreHistory.points('scan', q.symbol),
          haltRisk: halt,
          sector: f?.sector ?? null,
          gap,
        });
      }

      if (pre) {
        // biggest absolute overnight gap first; unknown gaps sink
        scored.sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0));
      } else {
        scored.sort((a, b) => b.score - a.score);
      }
      this.results = scored.slice(0, TOP_N).map(({ gap: _gap, ...r }) => r);
      this.updatedAt = Date.now();
      this.metrics = metrics;
      await this.attachSectors();
      this.broadcast(this.message());
      this.onScan([...metrics.values()], this.mode);
    } catch (e) {
      error('scanner', 'scan failed (will retry next interval):', e instanceof Error ? e.message : e);
    } finally {
      this.scanning = false;
    }
  }

  /**
   * Fill in sector names for the displayed top-N only (one quoteSummary call
   * per symbol on first sight, cached ~12h by the provider — never the whole
   * universe).
   */
  private async attachSectors(): Promise<void> {
    const missing = this.results.filter((r) => !r.sector).map((r) => r.symbol);
    if (!missing.length) return;
    try {
      const funds = await this.router.fundamentals.getFundamentals(missing, { enrich: true });
      for (const f of funds) {
        const prev = this.funds.get(f.symbol);
        this.funds.set(f.symbol, { ...prev, ...f });
      }
      this.results = this.results.map((r) => ({ ...r, sector: this.funds.get(r.symbol)?.sector ?? r.sector }));
    } catch (e) {
      warn('scanner', 'sector enrich failed (cards show no sector):', e instanceof Error ? e.message : e);
    }
  }

  private async snapshotAll(provider: DataSource, symbols: string[]) {
    const out = [];
    for (let i = 0; i < symbols.length; i += BATCH) {
      try {
        out.push(...(await provider.getSnapshot(symbols.slice(i, i + BATCH))));
      } catch (e) {
        warn('scanner', `snapshot batch failed on ${provider.id}:`, e instanceof Error ? e.message : e);
      }
    }
    return out;
  }

  message(): ServerMessage {
    return {
      type: 'scanner',
      results: this.results,
      universeSize: this.universe.length,
      eligible: this.eligible.length,
      updatedAt: this.updatedAt,
      mode: this.mode,
    };
  }
}

/** Per-symbol tradeability metrics from one scan (alert engine / backtest input). */
export interface ScanMetrics {
  symbol: string;
  price: number | null;
  changePct: number | null;
  score: number;
  relVol: number | null;
  gapPct: number | null;
  haltRisk: boolean;
  ts: number;
}
