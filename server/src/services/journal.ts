import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config';
import type { JournalEntry, TickerDetail } from '../types';
import { log, warn } from '../util/log';
import { etDateStr } from '../util/session';
import type { Router } from './router';

const FILE = path.join(config.dataDir, 'journal.json');
const MAX_ENTRIES = 200;
/** Resolve at most this many symbols' outcomes per list call (API budget). */
const RESOLVE_BUDGET = 5;
/** Stop retrying an outcome we can't find after this long. */
const GIVE_UP_MS = 7 * 86_400_000;

/**
 * One-click trading journal: snapshots the moment you found a setup
 * interesting (price, score, factors, your note) and — once that trading day
 * has closed — fills in what actually happened. Reflection tool, not a trade
 * log: the app never places trades.
 */
export class JournalStore {
  private entries: JournalEntry[] = [];

  constructor(private router: Router) {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(FILE)) {
        const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        if (Array.isArray(raw)) this.entries = raw as JournalEntry[];
      }
    } catch (e) {
      warn('journal', `could not read ${FILE}, starting empty:`, e);
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(this.entries, null, 2));
    } catch (e) {
      warn('journal', 'could not persist journal:', e);
    }
  }

  add(detail: TickerDetail, note: string): JournalEntry {
    const entry: JournalEntry = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      symbol: detail.symbol,
      note: note.slice(0, 500),
      price: detail.quote.price,
      score: detail.setup.score,
      grade: detail.setup.grade,
      factors: detail.factors.map((f) => ({ label: f.label, display: f.display, status: f.status })),
    };
    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.length = MAX_ENTRIES;
    this.persist();
    log('journal', `logged ${entry.symbol} @ ${entry.price} (score ${entry.score})`);
    return entry;
  }

  remove(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  /** List entries, lazily resolving day-close outcomes for past days. */
  async list(): Promise<JournalEntry[]> {
    await this.resolveOutcomes();
    return this.entries;
  }

  private async resolveOutcomes(): Promise<void> {
    const today = etDateStr(Date.now());
    const unresolved = this.entries.filter(
      (e) => e.outcome === undefined && etDateStr(e.ts) < today,
    );
    if (!unresolved.length) return;

    const bySymbol = new Map<string, JournalEntry[]>();
    for (const e of unresolved) {
      bySymbol.set(e.symbol, [...(bySymbol.get(e.symbol) ?? []), e]);
    }

    let changed = false;
    let budget = RESOLVE_BUDGET;
    for (const [symbol, entries] of bySymbol) {
      if (budget-- <= 0) break;
      try {
        const daily = await this.router.providerFor(symbol).getBars(symbol, '1Day', 30);
        const closeByDay = new Map(daily.map((b) => [etDateStr(b.t), b.c]));
        for (const e of entries) {
          const day = etDateStr(e.ts);
          const close = closeByDay.get(day) ?? null;
          if (close != null) {
            e.outcome = {
              date: day,
              close,
              closePct: e.price != null && e.price > 0 ? ((close - e.price) / e.price) * 100 : null,
            };
            changed = true;
          } else if (Date.now() - e.ts > GIVE_UP_MS) {
            e.outcome = null; // unresolvable — stop burning API calls on it
            changed = true;
          }
        }
      } catch (e) {
        warn('journal', `outcome fetch failed for ${symbol} (will retry):`, e instanceof Error ? e.message : e);
      }
    }
    if (changed) this.persist();
  }
}
