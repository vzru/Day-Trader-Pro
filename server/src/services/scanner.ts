import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import type { DataSource } from '../datasources/DataSource';
import type { Fundamentals, ScannerResult, ServerMessage } from '../types';
import { error, log, warn } from '../util/log';
import { sessionElapsedFraction } from '../util/session';
import { gapPct, rangePct, relativeVolume, spreadPct } from './indicators';
import { composite, scannerFactors } from './score';
import { isCaSymbol, Router } from './router';

const SCAN_INTERVAL_MS = 60_000;
const CAP_MIN = 2e9;
const CAP_MAX = 10e9;
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
 * Mid-cap scanner: every 60s, snapshot the curated universe in batches and
 * rank by objective tradeability criteria (rel volume, gap, range, spread,
 * dollar volume). Screening only — never emits buy/sell language.
 */
export class Scanner {
  private universe: UniverseEntry[] = [];
  private eligible: UniverseEntry[] = [];
  private funds = new Map<string, Fundamentals>();
  private results: ScannerResult[] = [];
  private updatedAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;

  broadcast: (msg: ServerMessage) => void = () => {};

  constructor(private router: Router) {}

  async start(): Promise<void> {
    this.loadUniverse();
    await this.verifyUniverse();
    await this.scanOnce();
    this.timer = setInterval(() => void this.scanOnce(), SCAN_INTERVAL_MS);
    log('scanner', `running: ${this.eligible.length}/${this.universe.length} symbols eligible, scanning every ${SCAN_INTERVAL_MS / 1000}s`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private loadUniverse(): void {
    const file = path.join(config.dataDir, 'universe.json');
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.universe = (raw as UniverseEntry[]).filter((e) => e && typeof e.symbol === 'string');
      log('scanner', `loaded ${this.universe.length} universe symbols from ${file}`);
    } catch (e) {
      error('scanner', `could not load ${file}; scanner disabled:`, e);
      this.universe = [];
    }
  }

  /**
   * Startup verification: fetch fundamentals for the whole universe (batched)
   * and drop anything with a KNOWN market cap outside the $2B-$10B band.
   * Symbols whose cap can't be fetched are kept and re-checked next run.
   */
  private async verifyUniverse(): Promise<void> {
    const symbols = this.universe.map((e) => e.symbol);
    for (let i = 0; i < symbols.length; i += BATCH) {
      const batch = symbols.slice(i, i + BATCH);
      try {
        const funds = await this.router.fundamentals.getFundamentals(batch);
        for (const f of funds) this.funds.set(f.symbol, f);
      } catch (e) {
        warn('scanner', 'fundamentals batch failed (symbols kept, re-checked later):', e);
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
    if (dropped) log('scanner', `dropped ${dropped} symbols outside the $2B-$10B market-cap band`);
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

      const elapsed = sessionElapsedFraction();
      const scored: ScannerResult[] = [];
      for (const q of quotes) {
        if (q.price == null || q.price < MIN_PRICE) continue;
        const entry = this.eligible.find((e) => e.symbol === q.symbol);
        if (!entry) continue;
        const f = this.funds.get(q.symbol);
        const factors = scannerFactors({
          relVol: relativeVolume(q.volume, f?.avgVolume30d ?? null, elapsed),
          gapPct: gapPct(q.open, q.prevClose),
          rangePct: rangePct(q.high, q.low, q.price),
          spreadPct: spreadPct(q.bid, q.ask),
          dollarVolume: q.volume != null && q.price != null ? q.volume * q.price : null,
        });
        const score = composite(factors);
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
        });
      }

      scored.sort((a, b) => b.score - a.score);
      this.results = scored.slice(0, TOP_N);
      this.updatedAt = Date.now();
      this.broadcast(this.message());
    } catch (e) {
      error('scanner', 'scan failed (will retry next interval):', e);
    } finally {
      this.scanning = false;
    }
  }

  private async snapshotAll(provider: DataSource, symbols: string[]) {
    const out = [];
    for (let i = 0; i < symbols.length; i += BATCH) {
      try {
        out.push(...(await provider.getSnapshot(symbols.slice(i, i + BATCH))));
      } catch (e) {
        warn('scanner', `snapshot batch failed on ${provider.id}:`, e);
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
    };
  }
}
