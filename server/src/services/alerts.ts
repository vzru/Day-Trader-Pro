import type { AlertItem, AlertKind, ServerMessage } from '../types';
import { log, warn } from '../util/log';
import { sessionElapsedFraction } from '../util/session';
import { gapPct, haltRisk, relativeVolume, spreadPct } from './indicators';
import { composite, scannerFactors } from './score';
import { isCaSymbol, Router } from './router';
import type { ScanMetrics, Scanner } from './scanner';
import type { SettingsStore } from './settings';
import { VelocityTracker } from './velocity';
import type { WatchlistStore } from './watchlist';

const CHECK_MS = 60_000;
/** Don't re-fire the same symbol+kind alert for this long. */
const COOLDOWN_MS = 30 * 60_000;
const MAX_ITEMS = 50;

// Built-in trigger thresholds (scope is user-configurable; these are not).
const MIN_SCORE = 80;
const MIN_RELVOL = 3;
const MIN_GAP_PCT = 5;

/**
 * Watches the scoped symbol set and emits screening alerts (score / rel-vol /
 * gap / halt-risk). Reuses the scanner's fresh metrics where available and
 * snapshots only the leftover watchlist / Top-25 symbols itself. Alerts are
 * observations about market activity — never buy/sell advice.
 */
export class AlertEngine {
  private items: AlertItem[] = [];
  private lastFired = new Map<string, number>(); // `${symbol}:${kind}` -> ts
  private velocity = new VelocityTracker();
  private timer: NodeJS.Timeout | null = null;
  private nextId = 1;

  broadcast: (msg: ServerMessage) => void = () => {};

  constructor(
    private router: Router,
    private watchlist: WatchlistStore,
    private topSymbols: () => string[],
    private scanner: Scanner,
    private settings: SettingsStore,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.check(), CHECK_MS);
    this.timer.unref?.();
    log('alerts', `engine running (scope=${this.settings.alerts().scope}, every ${CHECK_MS / 1000}s)`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  message(): ServerMessage {
    return { type: 'alerts', items: this.items, settings: this.settings.alerts() };
  }

  /** Called by the API when the user changes scope, to confirm immediately. */
  onSettingsChanged(): void {
    this.broadcast(this.message());
  }

  private scopedSymbols(): string[] {
    const { scope } = this.settings.alerts();
    if (scope === 'off') return [];
    if (scope === 'watchlist') return this.watchlist.list();
    if (scope === 'top25') return this.topSymbols();
    // 'all' = scanner universe + watchlist + top 25
    return [...new Set([...this.scanner.eligibleSymbols(), ...this.watchlist.list(), ...this.topSymbols()])];
  }

  private async check(): Promise<void> {
    const symbols = this.scopedSymbols();
    if (!symbols.length) return;

    // Fresh scanner metrics cover most of the 'all' scope for free.
    const scanned = this.scanner.lastScored();
    const now = Date.now();
    const rows: ScanMetrics[] = [];
    const leftover: string[] = [];
    for (const s of symbols) {
      const m = scanned.get(s);
      if (m && now - m.ts < 90_000) rows.push(m);
      else leftover.push(s);
    }
    if (leftover.length) rows.push(...(await this.snapshotMetrics(leftover)));

    for (const m of rows) this.evaluate(m);
  }

  /** Score the symbols the scanner didn't cover (watchlist / Top-25 extras). */
  private async snapshotMetrics(symbols: string[]): Promise<ScanMetrics[]> {
    const out: ScanMetrics[] = [];
    const usSyms = symbols.filter((s) => !isCaSymbol(s));
    const caSyms = symbols.filter((s) => isCaSymbol(s));
    try {
      const quotes = [
        ...(usSyms.length ? await this.router.us.getSnapshot(usSyms) : []),
        ...(caSyms.length ? await this.router.ca.getSnapshot(caSyms) : []),
      ];
      const funds = await this.router.fundamentals.getFundamentals(symbols, { enrich: false });
      const avgVol = new Map(funds.map((f) => [f.symbol, f.avgVolume30d ?? null]));
      const elapsed = sessionElapsedFraction();
      for (const q of quotes) {
        if (q.price == null) continue;
        const relVol = relativeVolume(q.volume, avgVol.get(q.symbol) ?? null, elapsed);
        const gap = gapPct(q.open, q.prevClose);
        const spread = spreadPct(q.bid, q.ask);
        const move5m = this.velocity.push(q.symbol, q.price);
        const factors = scannerFactors({
          relVol,
          gapPct: gap,
          rangePct: null,
          spreadPct: spread,
          dollarVolume: q.volume != null ? q.volume * q.price : null,
        });
        out.push({
          symbol: q.symbol, price: q.price, changePct: q.changePct,
          score: composite(factors), relVol, gapPct: gap,
          haltRisk: haltRisk(move5m, spread, q.changePct), ts: Date.now(),
        });
      }
    } catch (e) {
      warn('alerts', 'snapshot failed (skipping this check):', e instanceof Error ? e.message : e);
    }
    return out;
  }

  private evaluate(m: ScanMetrics): void {
    if (m.haltRisk) {
      this.fire(m.symbol, 'halt', `${m.symbol} moving fast with thin liquidity — possible halt territory`);
    }
    if (m.score >= MIN_SCORE) {
      this.fire(m.symbol, 'score', `${m.symbol} tradeability score ${m.score} (A-range)`);
    }
    if (m.relVol != null && m.relVol >= MIN_RELVOL) {
      this.fire(m.symbol, 'relvol', `${m.symbol} relative volume ${m.relVol.toFixed(1)}x normal pace`);
    }
    if (m.gapPct != null && Math.abs(m.gapPct) >= MIN_GAP_PCT) {
      this.fire(m.symbol, 'gap', `${m.symbol} gapped ${m.gapPct > 0 ? '+' : ''}${m.gapPct.toFixed(1)}% vs prior close`);
    }
  }

  private fire(symbol: string, kind: AlertKind, message: string): void {
    const key = `${symbol}:${kind}`;
    const now = Date.now();
    const last = this.lastFired.get(key) ?? 0;
    if (now - last < COOLDOWN_MS) return;
    this.lastFired.set(key, now);
    this.items.unshift({ id: `a${this.nextId++}-${now}`, ts: now, symbol, kind, message });
    if (this.items.length > MAX_ITEMS) this.items.length = MAX_ITEMS;
    log('alerts', message);
    this.broadcast(this.message());
  }
}
