// A tiny file-backed store. Everything lives in app/data/db.json (ignored by Git).
// The demo data below is made up: one building, its file, and Serv's bench of pros.

import fs from 'node:fs';
import path from 'node:path';

function seed() {
  return {
    building: {
      id: 'bldg-1',
      address: '37-12 84th Street, Jackson Heights, Queens',
      kind: 'Two-family house',
      owner: 'Demo owner',
      membershipUsdPerMonth: 30,
      units: ['1F', '2F'],
    },
    // The working building file: what any Serv pro should know before walking in.
    file: [
      { id: 'f1', kind: 'shutoff', text: 'Main water shutoff: basement, behind the boiler, red handle. Each sink also has its own shutoff underneath.' },
      { id: 'f2', kind: 'equipment', text: 'Electrical panel: basement stairwell, 100 amp, breakers labeled by floor.' },
      { id: 'f3', kind: 'equipment', text: 'Boiler: Weil-McLain gas steam boiler, serviced October 2026. One-pipe steam radiators.' },
      { id: 'f4', kind: 'fixture', text: 'Kitchen faucet in 2F: Moen single-handle. Cartridge (Moen 1225) replaced March 2026.' },
      { id: 'f5', kind: 'access', text: 'The 2F tenant works nights. Knock after 2 pm. The owner keeps a spare key for both units.' },
    ],
    // Serv picks the pro. The owner does not choose from this list.
    bench: [
      { id: 'pro-1', name: 'Rosa M.', trade: 'plumbing', blocksAway: 4, nextOpening: 'tomorrow, 9 to 11 am', licensed: 'NYC master plumber on file' },
      { id: 'pro-2', name: 'Dev P.', trade: 'electrical', blocksAway: 9, nextOpening: 'tomorrow, 1 to 3 pm', licensed: 'NYC electrician license on file' },
      { id: 'pro-3', name: 'Ana K.', trade: 'handyman', blocksAway: 2, nextOpening: 'today, 4 to 6 pm', licensed: 'Home improvement license on file' },
      { id: 'pro-4', name: 'Pat O.', trade: 'heating', blocksAway: 6, nextOpening: 'tomorrow, 8 to 10 am', licensed: 'NYC master plumber on file' },
    ],
    requests: [],
  };
}

/** Local store: one JSON file on this computer. Used for `npm start` on a laptop and in tests. */
export function createStore(filePath) {
  let db;
  try {
    db = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    db = seed();
  }
  function save() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(db, null, 2));
  }
  return {
    get db() {
      return db;
    },
    save,
    reset() {
      db = seed();
      save();
    },
  };
}

/**
 * Hosted store: the same single document, kept in one row of a Postgres table at Supabase.
 * A hosted app's own disk is wiped on every deploy, so a file would lose the trial's data.
 * Talks to Supabase's REST interface with the built-in fetch, so there is still nothing to install.
 * The table is created once by hand; the SQL is in DEPLOY.md.
 */
export async function openRemoteStore({ supabaseUrl, supabaseKey }, fetchImpl = fetch) {
  const table = `${supabaseUrl}/rest/v1/app_state`;
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' };

  async function call(url, init) {
    let res;
    try {
      res = await fetchImpl(url, { ...init, headers: { ...headers, ...init?.headers }, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new Error('Could not reach the database. Check SUPABASE_URL and the internet connection.');
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`The database answered ${res.status}. Check SUPABASE_SERVICE_KEY and that the app_state table exists (see DEPLOY.md). ${detail}`.trim());
    }
    return res;
  }

  const write = (doc) => call(table, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: 'main', doc, updated_at: new Date().toISOString() }) });

  const rows = await (await call(`${table}?id=eq.main&select=doc`)).json();
  let db = rows[0]?.doc;
  if (!db) {
    db = seed();
    await write(db);
  }

  // Writes go one after another, so an earlier save can never land on top of a later one.
  let queue = Promise.resolve();
  function save() {
    const snapshot = JSON.parse(JSON.stringify(db));
    queue = queue.catch(() => {}).then(() => write(snapshot));
    return queue;
  }
  return {
    get db() {
      return db;
    },
    save,
    async reset() {
      db = seed();
      await save();
    },
  };
}

/** Picks the store from the settings: Supabase when both values are set, else the local file. */
export async function openStore(config, fetchImpl = fetch) {
  if (config.supabaseUrl && config.supabaseKey) return openRemoteStore(config, fetchImpl);
  return createStore(config.dataFile);
}
