import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import type { AlertScope, AlertSettings } from '../types';
import { log, warn } from '../util/log';

const FILE = path.join(config.dataDir, 'settings.json');
const SCOPES: AlertScope[] = ['all', 'watchlist', 'top25', 'off'];

/** User settings persisted to a local JSON file (like the watchlist). */
export class SettingsStore {
  private alertScope: AlertScope = 'all';

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(FILE)) {
        const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { alertScope?: string };
        if (SCOPES.includes(raw.alertScope as AlertScope)) this.alertScope = raw.alertScope as AlertScope;
      }
    } catch (e) {
      warn('settings', `could not read ${FILE}, using defaults:`, e);
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify({ alertScope: this.alertScope }, null, 2));
    } catch (e) {
      warn('settings', 'could not persist settings:', e);
    }
  }

  alerts(): AlertSettings {
    return { scope: this.alertScope };
  }

  setAlertScope(scope: string): { ok: boolean; error?: string } {
    if (!SCOPES.includes(scope as AlertScope)) {
      return { ok: false, error: `Invalid scope "${scope}" (use ${SCOPES.join('/')})` };
    }
    this.alertScope = scope as AlertScope;
    this.persist();
    log('settings', `alert scope -> ${scope}`);
    return { ok: true };
  }
}
