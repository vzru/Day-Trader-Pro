import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// .env lives at the repo root; also allow server/.env.
dotenv.config({ path: path.resolve(here, '../../.env') });
dotenv.config({ path: path.resolve(here, '../.env') });

const truthy = (v: string | undefined) => !!v && !['0', 'false', 'no', ''].includes(v.toLowerCase());

export interface AppConfig {
  port: number;
  alpacaKeyId: string | null;
  alpacaSecret: string | null;
  finnhubKey: string | null;
  forceSim: boolean;
  disableYahoo: boolean;
  /** Which implementation backs each feed. */
  usFeed: 'alpaca' | 'sim';
  caFeed: 'yahoo' | 'sim';
  newsFeed: 'finnhub' | 'sim' | 'off';
  dataDir: string;
}

function build(): AppConfig {
  const forceSim = truthy(process.env.FORCE_SIM);
  const disableYahoo = truthy(process.env.DISABLE_YAHOO);
  const alpacaKeyId = process.env.ALPACA_KEY_ID?.trim() || null;
  const alpacaSecret = process.env.ALPACA_SECRET_KEY?.trim() || null;
  const finnhubKey = process.env.FINNHUB_KEY?.trim() || null;

  const usFeed = !forceSim && alpacaKeyId && alpacaSecret ? 'alpaca' : 'sim';
  const caFeed = !forceSim && !disableYahoo ? 'yahoo' : 'sim';
  // News: real if a Finnhub key is set. If the whole app is simulated,
  // show simulated news so the full UI is testable. Otherwise hide it.
  const newsFeed: AppConfig['newsFeed'] =
    !forceSim && finnhubKey ? 'finnhub' : usFeed === 'sim' && caFeed === 'sim' ? 'sim' : 'off';

  return {
    port: Number(process.env.PORT) || 4400,
    alpacaKeyId,
    alpacaSecret,
    finnhubKey,
    forceSim,
    disableYahoo,
    usFeed,
    caFeed,
    newsFeed,
    dataDir: path.resolve(here, '../data'),
  };
}

export const config = build();
