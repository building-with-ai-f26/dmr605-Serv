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
