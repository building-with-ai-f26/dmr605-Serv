// Run with `npm test`. No network and no API key needed: the AI call is replaced by a fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PRICE_LIST, TRADES } from '../pricelist.mjs';
import { checkTriage, parseModelJson, pickModel, costUsd, triage, TriageError, _clearModelCache } from '../triage.mjs';
import { propose, decide } from '../dispatch.mjs';
import { createApp, readConfig, hostingProblems, staffCookie, staffCookieValid } from '../server.mjs';
import { createStore, openRemoteStore, openStore, migrate, addBuilding, addFileNote, findOwner, findTenant } from '../store.mjs';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serv-')), 'db.json');
const seedDb = () => createStore(tmpFile()).db;
const seedBuilding = () => seedDb().buildings[0];
const forTriage = (b) => ({ kind: b.kind, address: b.address, units: b.units.map((u) => u.name) });

const good = {
  summary: 'Kitchen faucet in 2F drips constantly.',
  urgency: 'routine',
  trade: 'plumbing',
  price_item_id: 'faucet-leak',
  confidence: 0.9,
  questions: [],
  file_entry_ids: ['f1', 'f4', 'nope'],
  tenant_reply: 'Thanks, we are on it.',
};

/** A fake OpenRouter: answers /models and /chat/completions the way the real one does. */
function fakeOpenRouter(answer, { status = 200, calls = [] } = {}) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'anthropic/claude-opus-5.5', pricing: { prompt: '0.000004', completion: '0.00002' } }, { id: 'anthropic/claude-sonnet-5.5', pricing: {} }] }));
    }
    if (status !== 200) return new Response(JSON.stringify({ error: { message: 'nope' } }), { status });
    const content = typeof answer === 'string' ? answer : JSON.stringify(answer);
    return new Response(JSON.stringify({ model: 'anthropic/claude-opus-5.5', choices: [{ message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }));
  };
}
const cfg = { provider: 'openrouter', apiKey: 'sk-or-v1-test', baseUrl: 'https://openrouter.test/api/v1', model: '' };
const ccCfg = { provider: 'claude-code', claudeBin: 'claude', claudeModel: '' };

test('price list: 20 lines, unique ids, known trades, whole-dollar prices', () => {
  assert.equal(PRICE_LIST.length, 20);
  assert.equal(new Set(PRICE_LIST.map((p) => p.id)).size, 20);
  for (const p of PRICE_LIST) {
    assert.ok(TRADES.includes(p.trade), p.id);
    assert.ok(Number.isInteger(p.priceUsd) && p.priceUsd > 0, p.id);
  }
});

test('every trade on the price list has a pro on the bench', () => {
  const bench = seedDb().bench;
  for (const trade of new Set(PRICE_LIST.map((p) => p.trade))) assert.ok(bench.some((p) => p.trade === trade), trade);
});

test('checkTriage keeps a valid answer and drops file ids that do not exist', () => {
  const t = checkTriage(good, seedBuilding().file);
  assert.equal(t.priceItemId, 'faucet-leak');
  assert.equal(t.trade, 'plumbing');
  assert.deepEqual(t.fileEntryIds, ['f1', 'f4']);
});

test('checkTriage: a made-up price line becomes no match', () => {
  const t = checkTriage({ ...good, price_item_id: 'roof-replacement' }, []);
  assert.equal(t.priceItemId, null);
  assert.equal(propose(t, seedDb().bench).kind, 'needs_person');
});

test('checkTriage: an emergency is never priced, even if the model matched a line', () => {
  const t = checkTriage({ ...good, urgency: 'life_safety' }, []);
  assert.equal(t.priceItemId, null);
  assert.equal(propose(t, seedDb().bench).kind, 'emergency');
});

test('checkTriage: junk fields fall back to the careful choice', () => {
  const t = checkTriage({ urgency: 'whenever', confidence: 7, questions: 'no', file_entry_ids: null }, []);
  assert.equal(t.urgency, 'urgent');
  assert.equal(t.confidence, 0);
  assert.deepEqual(t.questions, []);
});

test('propose: confident match gets the nearest pro of that trade at the list price', () => {
  const p = propose(checkTriage(good, []), seedDb().bench);
  assert.equal(p.kind, 'offer');
  assert.equal(p.item.priceUsd, 145);
  assert.equal(p.pro.name, 'Rosa M.');
});

test('propose: low confidence or open questions go to a person', () => {
  const bench = seedDb().bench;
  assert.equal(propose(checkTriage({ ...good, confidence: 0.4 }, []), bench).kind, 'needs_person');
  assert.equal(propose(checkTriage({ ...good, questions: ['Which sink?'] }, []), bench).kind, 'needs_person');
});

test('decide: approving adds the job to the building file, and only once', () => {
  const db = seedDb();
  const building = db.buildings[0];
  const t = checkTriage(good, building.file);
  const request = { id: 'r1', unit: '2F', message: 'sink drips', triage: t, proposal: propose(t, db.bench), decision: null };
  const before = building.file.length;
  decide(request, 'approve', building);
  assert.equal(building.file.length, before + 1);
  assert.match(building.file.at(-1).text, /Rosa M\. at \$145/);
  assert.throws(() => decide(request, 'decline', building));
});

test('parseModelJson reads JSON inside a code fence and rejects prose', () => {
  assert.equal(parseModelJson('```json\n{"a":1}\n```').a, 1);
  assert.throws(() => parseModelJson('Sorry, I cannot help.'), TriageError);
});

test('pickModel: .env wins, else newest listed Opus, else the default', () => {
  const list = [{ id: 'anthropic/claude-opus-4.8' }, { id: 'anthropic/claude-opus-5.5' }, { id: 'openai/gpt-x' }];
  assert.equal(pickModel(list, 'x/y'), 'x/y');
  assert.equal(pickModel(list, ''), 'anthropic/claude-opus-5.5');
  assert.equal(pickModel([], ''), 'anthropic/claude-opus-5.5');
});

test('costUsd: uses the provider figure when present, else tokens times list price', () => {
  assert.equal(costUsd({ cost: 0.02 }, null), 0.02);
  const c = costUsd({ prompt_tokens: 1000, completion_tokens: 500 }, { pricing: { prompt: '0.000004', completion: '0.00002' } });
  assert.ok(Math.abs(c - 0.014) < 1e-9);
  assert.equal(costUsd({ prompt_tokens: 1 }, undefined), null);
});

test('triage: sends the key, the building file and the photo, and returns cost', async () => {
  _clearModelCache();
  const calls = [];
  const db = seedBuilding();
  const out = await triage({ unit: '2F', message: 'sink drips', photoDataUrl: 'data:image/jpeg;base64,AAAA', building: forTriage(db), file: db.file }, cfg, fakeOpenRouter(good, { calls }));
  const call = calls.find((c) => c.url.endsWith('/chat/completions'));
  const body = JSON.parse(call.init.body);
  assert.equal(call.init.headers.Authorization, 'Bearer sk-or-v1-test');
  assert.equal(body.model, 'anthropic/claude-opus-5.5');
  assert.match(body.messages[1].content[0].text, /Main water shutoff/);
  assert.equal(body.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,AAAA');
  assert.equal(out.priceItemId, 'faucet-leak');
  assert.ok(Math.abs(out.ai.costUsd - 0.014) < 1e-9);
});

test('triage: no key and a bad key give messages a person can act on', async () => {
  _clearModelCache();
  const db = seedBuilding();
  const input = { unit: '2F', message: 'x', building: forTriage(db), file: db.file };
  await assert.rejects(triage(input, { ...cfg, apiKey: '' }, fakeOpenRouter(good)), /OPENROUTER_API_KEY/);
  await assert.rejects(triage(input, cfg, fakeOpenRouter(good, { status: 401 })), /rejected the API key/);
});

test('server: a placeholder key counts as no key', () => {
  assert.equal(readConfig({ OPENROUTER_API_KEY: 'sk-or-v1-replace-with-your-key' }).apiKey, '');
});

/** A fake `claude -p`: records how it was called and prints what Claude Code prints. */
function fakeClaude(result, { calls = [], fail } = {}) {
  return async (command, args, opts) => {
    calls.push({ command, args, opts, files: fs.readdirSync(opts.cwd) });
    if (fail) throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    return {
      code: 0,
      stderr: '',
      stdout: JSON.stringify({ type: 'result', is_error: false, result: typeof result === 'string' ? result : JSON.stringify(result), total_cost_usd: 0.03, usage: { input_tokens: 5, cache_creation_input_tokens: 1500, output_tokens: 400 }, modelUsage: { 'claude-opus-5-5': {} } }),
    };
  };
}

test('config: Claude Code is the default provider; openrouter only when asked', () => {
  assert.equal(readConfig({}).provider, 'claude-code');
  assert.equal(readConfig({ OPENROUTER_API_KEY: 'sk-or-v1-x' }).provider, 'claude-code');
  assert.equal(readConfig({ AI_PROVIDER: 'openrouter' }).provider, 'openrouter');
});

test('claude code: prompt goes in on stdin, the photo is saved for it to read, and cost comes back', async () => {
  const calls = [];
  const db = seedBuilding();
  const out = await triage({ unit: '2F', message: 'sink drips', photoDataUrl: 'data:image/jpeg;base64,AAAA', building: forTriage(db), file: db.file }, ccCfg, { runImpl: fakeClaude(good, { calls }) });
  const call = calls[0];
  assert.equal(call.command, 'claude');
  assert.deepEqual(call.args, ['-p', '--output-format', 'json', '--system-prompt-file', 'system.txt', '--tools', 'Read', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', 'project']);
  assert.ok(!call.args.some((a) => /skip|bypass|dangerous/i.test(a)), 'never passes a flag that skips permission checks');
  assert.match(call.opts.input, /Main water shutoff/);
  assert.match(call.opts.input, /photo\.jpg/);
  assert.deepEqual(call.files.sort(), ['photo.jpg', 'system.txt']);
  assert.equal(fs.existsSync(call.opts.cwd), false, 'scratch folder is removed afterwards');
  assert.equal(out.priceItemId, 'faucet-leak');
  assert.equal(out.ai.provider, 'claude-code');
  assert.equal(out.ai.costUsd, 0.03);
  assert.equal(out.ai.model, 'claude-opus-5-5');
});

test('claude code: not installed, and not signed in, give messages a person can act on', async () => {
  const db = seedBuilding();
  const input = { unit: '2F', message: 'x', building: forTriage(db), file: db.file };
  await assert.rejects(triage(input, ccCfg, { runImpl: fakeClaude(good, { fail: true }) }), /Could not find Claude Code/);
  const notSignedIn = async () => ({ code: 1, stderr: '', stdout: JSON.stringify({ is_error: true, result: 'Invalid API key · Please run /login' }) });
  await assert.rejects(triage(input, ccCfg, { runImpl: notSignedIn }), /sign in with your Claude account/);
});

// ---- Hosting (row 1 of the trial plan) ----

/** A fake Supabase REST table: one row, kept in memory. */
function fakeSupabase(rows = [], calls = []) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (init.headers?.apikey !== 'service-key') return new Response('bad key', { status: 401 });
    if (init.method === 'POST') {
      rows[0] = JSON.parse(init.body);
      return new Response(null, { status: 201 });
    }
    return new Response(JSON.stringify(rows.map((r) => ({ doc: r.doc }))));
  };
}
const remote = { supabaseUrl: 'https://db.test', supabaseKey: 'service-key' };

test('config: a laptop is not hosted and has no AI cap; a hosted app is capped at 200 a day', () => {
  const local = readConfig({});
  assert.equal(local.hosted, false);
  assert.equal(local.aiDailyLimit, 0);
  const online = readConfig({ HOST: '0.0.0.0' });
  assert.equal(online.hosted, true);
  assert.equal(online.aiDailyLimit, 200);
  assert.equal(readConfig({ HOST: '0.0.0.0', AI_DAILY_CALL_LIMIT: '25' }).aiDailyLimit, 25);
});

test('hosting: refuses to start online on a personal subscription or without a database', () => {
  assert.deepEqual(hostingProblems(readConfig({})), []);
  assert.equal(hostingProblems(readConfig({ HOST: '0.0.0.0' })).length, 3);
  assert.equal(hostingProblems(readConfig({ HOST: '0.0.0.0', AI_PROVIDER: 'openrouter' })).length, 3);
  const ready = { HOST: '0.0.0.0', AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-or-v1-x', STAFF_PASSWORD: 'long enough pw', SUPABASE_URL: 'https://db.test/', SUPABASE_SERVICE_KEY: 'k' };
  assert.deepEqual(hostingProblems(readConfig(ready)), []);
  assert.equal(readConfig(ready).supabaseUrl, 'https://db.test');
});

test('remote store: seeds an empty database, then reads back what was saved', async () => {
  const rows = [];
  const calls = [];
  const store = await openRemoteStore(remote, fakeSupabase(rows, calls));
  assert.equal(rows[0].id, 'main');
  assert.equal(rows[0].doc.buildings[0].id, 'bldg-1');
  assert.match(calls[0].url, /\/rest\/v1\/app_state\?id=eq\.main/);

  store.db.requests.push({ id: 'r1' });
  await store.save();
  const again = await openStore({ ...remote, dataFile: tmpFile() }, fakeSupabase(rows));
  assert.equal(again.db.requests[0].id, 'r1');
});

test('remote store: a wrong key gives a message a person can act on', async () => {
  await assert.rejects(openRemoteStore({ ...remote, supabaseKey: 'wrong' }, fakeSupabase()), /SUPABASE_SERVICE_KEY/);
});

test('openStore: without database settings it uses the local file', async () => {
  const store = await openStore({ supabaseUrl: '', supabaseKey: '', dataFile: tmpFile() });
  assert.equal(store.db.buildings[0].id, 'bldg-1');
});

// ---- Private links, buildings and the staff page (rows 2 and 3) ----

/** Starts the app on a free port. Returns helpers that talk to it. */
async function start(t, env = {}, deps = {}) {
  const config = readConfig({ SERV_DATA_FILE: tmpFile(), ...env });
  const store = deps.store ?? createStore(config.dataFile, { demo: !config.hosted });
  const server = createApp(config, { store, runImpl: fakeClaude(good), ...deps });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (p, body, headers = {}) => fetch(base + p, body === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const b = store.db.buildings[0];
  return { base, store, send, config, building: b, owner: b && `/api/owner/${b.ownerToken}`, tenant: (name) => `/api/tenant/${b.units.find((u) => u.name === name).token}` };
}

test('store: a hosted app starts empty, a laptop starts with made-up demo data', () => {
  assert.deepEqual(createStore(tmpFile(), { demo: false }).db.buildings, []);
  assert.equal(createStore(tmpFile(), { demo: false }).db.bench.length, 0);
  assert.equal(createStore(tmpFile()).db.buildings.length, 1);
});

test('store: private links are long, random and different for every unit', () => {
  const b = seedBuilding();
  const tokens = [b.ownerToken, ...b.units.map((u) => u.token)];
  assert.equal(new Set(tokens).size, 3);
  for (const t of tokens) assert.match(t, /^[A-Za-z0-9_-]{20,}$/);
});

test('migrate: a Build 2 document becomes a building with private links', () => {
  const old = { building: { id: 'bldg-1', address: '1 Test St', kind: 'Two-family house', owner: 'Pat', units: ['1F'] }, file: [{ id: 'f1', kind: 'note', text: 'x' }], bench: [], requests: [{ id: 'r1', unit: '1F' }] };
  const db = migrate(old);
  assert.equal(db.buildings.length, 1);
  assert.equal(db.buildings[0].units[0].name, '1F');
  assert.ok(db.buildings[0].ownerToken);
  assert.equal(db.buildings[0].file[0].id, 'f1');
  assert.equal(db.requests[0].buildingId, 'bldg-1');
  assert.equal(db.building, undefined);
});

test('addBuilding and addFileNote: check input and give each unit its own link', () => {
  const db = createStore(tmpFile(), { demo: false }).db;
  assert.throws(() => addBuilding(db, { address: 'x', ownerName: 'A', units: ['1F'] }), /street address/);
  assert.throws(() => addBuilding(db, { address: '5 Main St, Queens', ownerName: '', units: ['1F'] }), /owner/);
  assert.throws(() => addBuilding(db, { address: '5 Main St, Queens', ownerName: 'A', ownerEmail: 'nope', units: ['1F'] }), /email/);
  assert.throws(() => addBuilding(db, { address: '5 Main St, Queens', ownerName: 'A', units: [] }), /units/);
  const b = addBuilding(db, { address: '5 Main St, Queens', ownerName: 'Ana Ruiz', ownerEmail: 'ana@example.com', units: ['1F', '2F', '1F'] });
  assert.deepEqual(b.units.map((u) => u.name), ['1F', '2F']);
  assert.equal(findOwner(db, b.ownerToken), b);
  assert.equal(findTenant(db, b.units[1].token).unit.name, '2F');
  assert.equal(findOwner(db, b.units[0].token), null, 'a tenant link is not an owner link');
  assert.throws(() => addFileNote(b, { text: ' ' }), /note/);
  assert.equal(addFileNote(b, { kind: 'bogus', text: 'Shutoff in the basement' }).kind, 'note');
  assert.equal(b.file.length, 1);
});

test('server: tenant reports, owner approves, tenant sees the result without a price', async (t) => {
  const s = await start(t);
  assert.equal((await s.send(s.tenant('2F') + '/requests', { message: '' })).status, 400);
  const made = await (await s.send(s.tenant('2F') + '/requests', { message: 'the kitchen sink keeps dripping' })).json();
  assert.equal(made.request.status.code, 'waiting');
  assert.doesNotMatch(JSON.stringify(made), /145|priceUsd|proposal|f4/, 'a tenant never sees the price or the file');

  const owner = await (await s.send(s.owner)).json();
  const card = owner.requests[0];
  assert.equal(card.proposal.item.priceUsd, 145);
  assert.equal(card.ai, undefined);

  const decided = await (await s.send(`${s.owner}/requests/${card.id}/decision`, { decision: 'approve' })).json();
  assert.equal(decided.request.decision.choice, 'approve');
  assert.ok(decided.state.file.some((f) => f.kind === 'job'));
  assert.equal((await s.send(`${s.owner}/requests/${card.id}/decision`, { decision: 'decline' })).status, 409);
  assert.equal((await s.send(`${s.owner}/requests/${card.id}/decision`, { decision: 'maybe' })).status, 400);

  const after = await (await s.send(s.tenant('2F'))).json();
  assert.equal(after.requests[0].status.code, 'approved');
  assert.match(after.requests[0].status.detail, /Rosa M\./);
  assert.doesNotMatch(JSON.stringify(after), /145|priceUsd/);
});

test('server: bad links and tokens from another role get a plain 404', async (t) => {
  const s = await start(t);
  const unit = s.building.units[0].token;
  assert.equal((await s.send('/api/owner/' + 'x'.repeat(22))).status, 404);
  assert.equal((await s.send('/api/tenant/short')).status, 404);
  assert.equal((await s.send('/api/owner/' + unit)).status, 404, 'a unit link does not open the owner view');
  assert.equal((await s.send('/api/tenant/' + s.building.ownerToken)).status, 404, 'the owner link does not report for a unit');
  assert.equal((await s.send('/api/state')).status, 404, 'the old open state route is gone');
  assert.equal((await s.send('/api/requests', { message: 'hi there' })).status, 404);
});

test('server: an owner cannot decide on another building, and sees only their own reports', async (t) => {
  const s = await start(t);
  const other = addBuilding(s.store.db, { address: '9 Other Ave, Queens', ownerName: 'Lee', units: ['1F'] });
  await s.store.save();
  const made = await (await s.send(s.tenant('2F') + '/requests', { message: 'the kitchen sink keeps dripping' })).json();
  const theirs = await (await s.send(`/api/owner/${other.ownerToken}`)).json();
  assert.equal(theirs.requests.length, 0);
  assert.equal((await s.send(`/api/owner/${other.ownerToken}/requests/${made.request.id}/decision`, { decision: 'approve' })).status, 404);
  assert.equal(s.store.db.requests[0].decision, null);
});

test('server: one unit can send only so many reports a day', async (t) => {
  const s = await start(t, { REPORTS_PER_UNIT_PER_DAY: '2' });
  for (let i = 0; i < 2; i++) assert.equal((await s.send(s.tenant('2F') + '/requests', { message: `the sink drips again ${i}` })).status, 201);
  const third = await s.send(s.tenant('2F') + '/requests', { message: 'the sink drips again' });
  assert.equal(third.status, 429);
  assert.equal((await third.json()).code, 'unit_limit');
  assert.equal((await s.send(s.tenant('1F') + '/requests', { message: 'the sink drips again' })).status, 201, 'other units are not affected');
});

test('server: an emergency tells the tenant to call 911 and offers the owner nothing to approve', async (t) => {
  const emergency = { ...good, urgency: 'life_safety', price_item_id: null, tenant_reply: 'Leave now and call 911.' };
  const s = await start(t, {}, { runImpl: fakeClaude(emergency) });
  const made = await (await s.send(s.tenant('1F') + '/requests', { message: 'I smell gas near the stove' })).json();
  assert.equal(made.request.status.code, 'emergency');
  assert.match(made.request.status.detail, /911/);
  const owner = await (await s.send(s.owner)).json();
  assert.equal(owner.requests[0].proposal.kind, 'emergency');
});

test('server: pages are served at private paths, marked noindex, and nothing else leaks', async (t) => {
  const s = await start(t);
  for (const p of [`/o/${s.building.ownerToken}`, `/t/${s.building.units[0].token}`, '/staff', '/']) {
    const res = await fetch(s.base + p);
    assert.equal(res.status, 200, p);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer', p);
    assert.match(res.headers.get('x-robots-tag'), /noindex/, p);
  }
  assert.equal((await fetch(s.base + '/o')).status, 404);
  assert.equal((await fetch(s.base + '/../server.mjs')).status, 404);
  assert.match(await (await fetch(s.base + '/robots.txt')).text(), /Disallow: \//);
});

test('staff: sign-in cookie is signed, expires, and rejects tampering', () => {
  const now = 1_000_000;
  const c = staffCookie('secret-pw', now);
  assert.equal(staffCookieValid('secret-pw', c, now + 1000), true);
  assert.equal(staffCookieValid('other-pw', c, now + 1000), false);
  assert.equal(staffCookieValid('secret-pw', c, now + 15 * 86_400_000), false, 'expired');
  assert.equal(staffCookieValid('secret-pw', c.replace(/^\d/, '9'), now), false, 'tampered');
  assert.equal(staffCookieValid('secret-pw', '', now), false);
  assert.equal(staffCookieValid('', '', now), true, 'no password set: a laptop');
});

test('server: staff routes need the password when one is set', async (t) => {
  const s = await start(t, { STAFF_PASSWORD: 'correct horse' });
  assert.equal((await s.send('/api/staff/state')).status, 401);
  assert.equal((await s.send('/api/staff/login', { password: 'wrong' })).status, 401);
  const ok = await s.send('/api/staff/login', { password: 'correct horse' });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  const state = await s.send('/api/staff/state', undefined, { cookie });
  assert.equal(state.status, 200);
  assert.equal((await state.json()).buildings.length, 1);
  assert.equal((await s.send('/api/staff/buildings', { address: '5 Main St, Queens', ownerName: 'A', units: ['1F'] })).status, 401);
});

test('server: staff adds a building and a file note, and the owner sees the note', async (t) => {
  const s = await start(t);
  const added = await s.send('/api/staff/buildings', { address: '5 Main St, Queens', kind: 'Three-family house', ownerName: 'Ana Ruiz', units: ['1', '2', '3'] });
  assert.equal(added.status, 201);
  const { buildings } = await added.json();
  const b = buildings.at(-1);
  assert.equal(b.units.length, 3);
  assert.equal((await s.send('/api/staff/buildings', { address: '', ownerName: 'A', units: ['1'] })).status, 400);
  assert.equal((await s.send(`/api/staff/buildings/${b.id}/notes`, { kind: 'shutoff', text: 'Main shutoff is in the basement.' })).status, 201);
  assert.equal((await s.send('/api/staff/buildings/nope/notes', { text: 'abc' })).status, 404);
  const owner = await (await s.send(`/api/owner/${b.ownerToken}`)).json();
  assert.equal(owner.file[0].text, 'Main shutoff is in the basement.');
  const tenant = await (await s.send(`/api/tenant/${b.units[0].token}`)).json();
  assert.equal(tenant.unit, '1');
  assert.equal(tenant.file, undefined);
});

test('server: online, reset is off, the health check answers, and private links are not listed', async (t) => {
  const s = await start(t, { HOST: '0.0.0.0', AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-or-v1-test', STAFF_PASSWORD: 'correct horse', AI_DAILY_CALL_LIMIT: '1' }, { store: createStore(tmpFile(), { demo: true }), fetchImpl: undefined });
  _clearModelCache();
  assert.deepEqual(await (await s.send('/healthz')).json(), { ok: true });
  const login = await s.send('/api/staff/login', { password: 'correct horse' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /Secure/);
  assert.equal((await s.send('/api/staff/reset', {}, { cookie })).status, 403);
  assert.equal((await s.send('/api/demo-links')).status, 404, 'a hosted app never lists private links');
});

test('server: the daily AI cap stops reports for every unit once used up', async (t) => {
  const s = await start(t, { AI_DAILY_CALL_LIMIT: '1' });
  assert.equal((await s.send(s.tenant('2F') + '/requests', { message: 'the kitchen faucet drips' })).status, 201);
  const second = await s.send(s.tenant('1F') + '/requests', { message: 'the kitchen faucet drips too' });
  assert.equal(second.status, 429);
  assert.equal((await second.json()).code, 'daily_limit');
});
