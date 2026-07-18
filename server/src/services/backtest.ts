import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import type { BacktestBucket, BacktestReport, ScannerMode } from '../types';
import { log, warn } from '../util/log';
import { etDateStr, etMinutes, getSession } from '../util/session';
import { isCaSymbol, Router } from './router';
import type { ScanMetrics } from './scanner';

const FILE = path.join(config.dataDir, 'backtest.json');
/** Capture the morning snapshot inside this ET window (one capture per day). */
const CAPTURE_FROM_MIN = 9 * 60 + 35;
const CAPTURE_TO_MIN = 11 * 60;
/** Record the N best-scored symbols each morning (bounds resolution cost). */
const CAPTURE_TOP_N = 40;
const RESOLVE_CHECK_MS = 10 * 60_000;
/** Unresolved records older than this are dropped (app wasn't running at close). */
const PRUNE_AFTER_DAYS = 3;
const MAX_RECORDS = 2000;

interface BacktestRecord {
  date: string; // ET day, YYYY-MM-DD
  symbol: string;
  score: number;
  price: number; // price at capture time
  close?: number | null;
  high?: number | null;
  low?: number | null;
}

/**
 * Score honesty report: each trading morning, remember what the scanner
 * scored everything; after the close, record what actually happened. Over
 * days this shows whether high scores really mean bigger intraday movement —
 * the app grading itself, not the user. Needs the app running through the
 * close (or evening) of a captured day to resolve it.
 */
export class Backtest {
  private records: BacktestRecord[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private router: Router) {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(FILE)) {
        const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        if (Array.isArray(raw)) this.records = raw as BacktestRecord[];
      }
    } catch (e) {
      warn('backtest', `could not read ${FILE}, starting empty:`, e);
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(this.records, null, 2));
    } catch (e) {
      warn('backtest', 'could not persist records:', e);
    }
  }

  start(): void {
    this.timer = setInterval(() => void this.maybeResolve(), RESOLVE_CHECK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Scanner hook: capture one morning snapshot per trading day. */
  onScan(rows: ScanMetrics[], mode: ScannerMode): void {
    if (mode !== 'regular') return;
    const mins = etMinutes();
    if (mins < CAPTURE_FROM_MIN || mins > CAPTURE_TO_MIN) return;
    const today = etDateStr(Date.now());
    if (this.records.some((r) => r.date === today)) return; // already captured

    const captured = rows
      .filter((r) => r.price != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, CAPTURE_TOP_N)
      .map((r) => ({ date: today, symbol: r.symbol, score: r.score, price: r.price as number }));
    if (!captured.length) return;
    this.records.push(...captured);
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
    this.persist();
    log('backtest', `captured ${captured.length} morning scores for ${today}`);
  }

  /** After the close, snapshot today's captured symbols to get close/high/low. */
  private async maybeResolve(): Promise<void> {
    const state = getSession().state;
    if (state !== 'after' && state !== 'closed') return;
    const today = etDateStr(Date.now());
    this.prune(today);
    const open = this.records.filter((r) => r.date === today && r.close === undefined);
    if (!open.length) return;
    try {
      const symbols = [...new Set(open.map((r) => r.symbol))];
      const quotes = [
        ...(await this.router.us.getSnapshot(symbols.filter((s) => !isCaSymbol(s)))),
        ...(await this.router.ca.getSnapshot(symbols.filter((s) => isCaSymbol(s)))),
      ];
      const byQuote = new Map(quotes.map((q) => [q.symbol, q]));
      let resolved = 0;
      for (const r of open) {
        const q = byQuote.get(r.symbol);
        if (!q || q.price == null) continue;
        r.close = q.price;
        r.high = q.high;
        r.low = q.low;
        resolved++;
      }
      if (resolved) {
        this.persist();
        log('backtest', `resolved ${resolved} records for ${today}`);
      }
    } catch (e) {
      warn('backtest', 'resolve failed (will retry):', e instanceof Error ? e.message : e);
    }
  }

  /** Drop records that never got resolved (app wasn't running at their close). */
  private prune(today: string): void {
    const cutoff = new Date(Date.now() - PRUNE_AFTER_DAYS * 86_400_000).toISOString().slice(0, 10);
    const before = this.records.length;
    this.records = this.records.filter((r) => r.close !== undefined || r.date === today || r.date >= cutoff);
    if (this.records.length !== before) this.persist();
  }

  report(): BacktestReport {
    const resolved = this.records.filter((r) => r.close != null && r.price > 0);
    const today = etDateStr(Date.now());
    const bands: { label: string; min: number; max: number }[] = [
      { label: '80–100 (A)', min: 80, max: 101 },
      { label: '65–79 (B)', min: 65, max: 80 },
      { label: '50–64 (C)', min: 50, max: 65 },
      { label: '35–49 (D)', min: 35, max: 50 },
      { label: '0–34 (F)', min: 0, max: 35 },
    ];
    const buckets: BacktestBucket[] = bands.map(({ label, min, max }) => {
      const rows = resolved.filter((r) => r.score >= min && r.score < max);
      if (!rows.length) {
        return { label, count: 0, avgAbsMovePct: null, avgRangePct: null, bigMoveShare: null };
      }
      const moves = rows.map((r) => Math.abs(((r.close as number) - r.price) / r.price) * 100);
      const ranges = rows
        .filter((r) => r.high != null && r.low != null)
        .map((r) => (((r.high as number) - (r.low as number)) / r.price) * 100);
      const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
      return {
        label,
        count: rows.length,
        avgAbsMovePct: avg(moves),
        avgRangePct: avg(ranges),
        bigMoveShare: (moves.filter((m) => m > 2).length / rows.length) * 100,
      };
    });
    return {
      buckets,
      samples: resolved.length,
      days: new Set(resolved.map((r) => r.date)).size,
      pendingToday: this.records.filter((r) => r.date === today && r.close === undefined).length,
    };
  }
}
