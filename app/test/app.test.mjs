// Run with `npm test`. No network and no API key needed: the AI call is replaced by a fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PRICE_LIST, TRADES } from '../pricelist.mjs';
import { checkTriage, parseModelJson, pickModel, costUsd, triage, TriageError, _clearModelCache } from '../triage.mjs';
import { propose, decide } from '../dispatch.mjs';
import { createApp, readConfig } from '../server.mjs';
import { createStore } from '../store.mjs';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serv-')), 'db.json');
const seedDb = () => createStore(tmpFile()).db;

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
const cfg = { apiKey: 'sk-or-v1-test', baseUrl: 'https://openrouter.test/api/v1', model: '' };

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
  const t = checkTriage(good, seedDb().file);
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
  const t = checkTriage(good, db.file);
  const request = { id: 'r1', unit: '2F', message: 'sink drips', triage: t, proposal: propose(t, db.bench), decision: null };
  const before = db.file.length;
  decide(request, 'approve', db);
  assert.equal(db.file.length, before + 1);
  assert.match(db.file.at(-1).text, /Rosa M\. at \$145/);
  assert.throws(() => decide(request, 'decline', db));
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
  const db = seedDb();
  const out = await triage({ unit: '2F', message: 'sink drips', photoDataUrl: 'data:image/jpeg;base64,AAAA', building: db.building, file: db.file }, cfg, fakeOpenRouter(good, { calls }));
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
  const db = seedDb();
  const input = { unit: '2F', message: 'x', building: db.building, file: db.file };
  await assert.rejects(triage(input, { ...cfg, apiKey: '' }, fakeOpenRouter(good)), /OPENROUTER_API_KEY/);
  await assert.rejects(triage(input, cfg, fakeOpenRouter(good, { status: 401 })), /rejected the API key/);
});

test('server: report, then owner approval, end to end', async (t) => {
  _clearModelCache();
  const config = { ...readConfig({ OPENROUTER_API_KEY: 'sk-or-v1-test', SERV_DATA_FILE: tmpFile() }) };
  const server = createApp(config, fakeOpenRouter(good));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/../server.mjs')).status, 404);
  assert.equal((await post('/api/requests', { unit: '2F', message: '' })).status, 400);

  const made = await (await post('/api/requests', { unit: '2F', message: 'the kitchen sink keeps dripping' })).json();
  assert.equal(made.request.proposal.kind, 'offer');
  assert.equal(made.request.proposal.item.priceUsd, 145);

  const decided = await (await post(`/api/requests/${made.request.id}/decision`, { decision: 'approve' })).json();
  assert.equal(decided.request.decision.choice, 'approve');
  assert.ok(decided.state.file.some((f) => f.kind === 'job'));
  assert.equal((await post(`/api/requests/${made.request.id}/decision`, { decision: 'decline' })).status, 409);
  assert.equal((await post(`/api/requests/${made.request.id}/decision`, { decision: 'maybe' })).status, 400);
});

test('server: a placeholder key counts as no key', () => {
  assert.equal(readConfig({ OPENROUTER_API_KEY: 'sk-or-v1-replace-with-your-key' }).apiKey, '');
});
