// The store: one JSON document, kept in a local file (laptop, tests) or in a Supabase row (hosted).
// The demo data below is made up: one building, its file, and Serv's bench of pros.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** A private link is a random 128-bit value. Whoever holds the link is that owner or that tenant. */
export const newToken = () => crypto.randomBytes(16).toString('base64url');

export const BUILDING_KINDS = ['Two-family house', 'Three-family house', 'Four-family house', 'Other small building'];
export const FILE_KINDS = ['shutoff', 'equipment', 'fixture', 'access', 'note'];

function demoBuilding() {
  return {
    id: 'bldg-1',
    address: '37-12 84th Street, Jackson Heights, Queens',
    kind: 'Two-family house',
    ownerName: 'Demo owner',
    ownerEmail: '',
    membershipUsdPerMonth: 30,
    ownerToken: newToken(),
    units: [
      { name: '1F', token: newToken() },
      { name: '2F', token: newToken() },
    ],
    // The working building file: what any Serv pro should know before walking in.
    file: [
      { id: 'f1', kind: 'shutoff', text: 'Main water shutoff: basement, behind the boiler, red handle. Each sink also has its own shutoff underneath.' },
      { id: 'f2', kind: 'equipment', text: 'Electrical panel: basement stairwell, 100 amp, breakers labeled by floor.' },
      { id: 'f3', kind: 'equipment', text: 'Boiler: Weil-McLain gas steam boiler, serviced October 2026. One-pipe steam radiators.' },
      { id: 'f4', kind: 'fixture', text: 'Kitchen faucet in 2F: Moen single-handle. Cartridge (Moen 1225) replaced March 2026.' },
      { id: 'f5', kind: 'access', text: 'The 2F tenant works nights. Knock after 2 pm. The owner keeps a spare key for both units.' },
    ],
  };
}

// Serv picks the pro. The owner does not choose from this list.
const DEMO_BENCH = [
  { id: 'pro-1', name: 'Rosa M.', trade: 'plumbing', blocksAway: 4, nextOpening: 'tomorrow, 9 to 11 am', licensed: 'NYC master plumber on file' },
  { id: 'pro-2', name: 'Dev P.', trade: 'electrical', blocksAway: 9, nextOpening: 'tomorrow, 1 to 3 pm', licensed: 'NYC electrician license on file' },
  { id: 'pro-3', name: 'Ana K.', trade: 'handyman', blocksAway: 2, nextOpening: 'today, 4 to 6 pm', licensed: 'Home improvement license on file' },
  { id: 'pro-4', name: 'Pat O.', trade: 'heating', blocksAway: 6, nextOpening: 'tomorrow, 8 to 10 am', licensed: 'NYC master plumber on file' },
];

/** A new document. Demo data is for laptops and tests only: a hosted app starts empty, so no made-up building reaches an owner. */
export function seed({ demo = true } = {}) {
  return { buildings: demo ? [demoBuilding()] : [], bench: demo ? DEMO_BENCH.map((p) => ({ ...p })) : [], requests: [], aiCalls: null };
}

/** Brings a document saved by an older version up to date (the Build 2 file held one `building` and one `file`). */
export function migrate(db) {
  if (!db.buildings) {
    const old = db.building;
    db.buildings = old
      ? [{ id: old.id, address: old.address, kind: old.kind, ownerName: old.owner ?? 'Owner', ownerEmail: '', membershipUsdPerMonth: old.membershipUsdPerMonth ?? 30, ownerToken: newToken(), units: (old.units ?? []).map((name) => ({ name, token: newToken() })), file: db.file ?? [] }]
      : [];
    for (const r of db.requests ?? []) r.buildingId ??= old?.id;
    delete db.building;
    delete db.file;
  }
  db.bench ??= [];
  db.requests ??= [];
  return db;
}

const clean = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/** Adds a building from the staff form. Throws an Error with a message a person can act on. */
export function addBuilding(db, input) {
  const address = clean(input.address, 160);
  const ownerName = clean(input.ownerName, 80);
  if (address.length < 5) throw new Error('Enter the building\'s street address.');
  if (!ownerName) throw new Error('Enter the owner\'s name.');
  const kind = BUILDING_KINDS.includes(input.kind) ? input.kind : BUILDING_KINDS[0];
  const ownerEmail = clean(input.ownerEmail, 120);
  if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error('That owner email does not look right.');
  const names = [...new Set((Array.isArray(input.units) ? input.units : []).map((u) => clean(u, 12)).filter(Boolean))];
  if (names.length < 1 || names.length > 8) throw new Error('List between 1 and 8 units, for example 1F, 2F.');
  const building = {
    id: `bldg-${crypto.randomBytes(4).toString('hex')}`,
    address,
    kind,
    ownerName,
    ownerEmail,
    membershipUsdPerMonth: 30,
    ownerToken: newToken(),
    units: names.map((name) => ({ name, token: newToken() })),
    file: [],
  };
  db.buildings.push(building);
  return building;
}

/** Adds one note to a building's file. */
export function addFileNote(building, input) {
  const text = clean(input.text, 500);
  if (text.length < 3) throw new Error('Write the note first.');
  const note = { id: `n-${crypto.randomBytes(3).toString('hex')}`, kind: FILE_KINDS.includes(input.kind) ? input.kind : 'note', text };
  building.file.push(note);
  return note;
}

export const findOwner = (db, token) => db.buildings.find((b) => b.ownerToken === token) ?? null;

export function findTenant(db, token) {
  for (const building of db.buildings) {
    const unit = building.units.find((u) => u.token === token);
    if (unit) return { building, unit };
  }
  return null;
}

/** Local store: one JSON file on this computer. Used for `npm start` on a laptop and in tests. */
export function createStore(filePath, { demo = true } = {}) {
  let db;
  try {
    db = migrate(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    db = seed({ demo });
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
      db = seed({ demo });
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
export async function openRemoteStore({ supabaseUrl, supabaseKey }, fetchImpl = fetch, { demo = true } = {}) {
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
  let db = rows[0]?.doc && migrate(rows[0].doc);
  if (!db) {
    db = seed({ demo });
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
      db = seed({ demo });
      await save();
    },
  };
}

/** Picks the store from the settings: Supabase when both values are set, else the local file. */
export async function openStore(config, fetchImpl = fetch) {
  const options = { demo: !config.hosted };
  if (config.supabaseUrl && config.supabaseKey) return openRemoteStore(config, fetchImpl, options);
  return createStore(config.dataFile, options);
}
