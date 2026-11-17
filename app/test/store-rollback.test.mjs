import test from 'node:test';
import assert from 'node:assert/strict';
import { openRemoteStore } from '../store.mjs';

// A stand-in database: answers reads with nothing saved, and takes or refuses writes on command.
function fakeDb() {
  const state = { down: false, saved: null };
  const fetchImpl = async (url, init) => {
    if (!init?.method) return { ok: true, json: async () => [] };
    if (state.down) return { ok: false, status: 503, text: async () => 'down' };
    state.saved = JSON.parse(init.body).doc;
    return { ok: true };
  };
  return { state, fetchImpl };
}
const open = (f) => openRemoteStore({ supabaseUrl: 'https://db.example', supabaseKey: 'k' }, f.fetchImpl, { demo: true, retryWaitMs: 1 });

test('a save that fails for good puts the app back to what the database last took', async () => {
  const f = fakeDb();
  const store = await open(f);
  store.db.requests.push({ id: 'kept' });
  await store.save();
  f.state.down = true;
  store.db.requests.push({ id: 'lost' });
  await assert.rejects(store.save());
  assert.deepEqual(store.db.requests.map((r) => r.id), ['kept']);
  f.state.down = false;
  store.db.requests.push({ id: 'next' });
  await store.save();
  assert.deepEqual(f.state.saved.requests.map((r) => r.id), ['kept', 'next']);
});

test('a failed save does not undo a later change that is still being saved', async () => {
  const f = fakeDb();
  const store = await open(f);
  f.state.down = true;
  store.db.requests.push({ id: 'a' });
  const first = store.save();
  store.db.requests.push({ id: 'b' });
  const second = store.save();
  await assert.rejects(first);
  f.state.down = false;
  await second;
  assert.deepEqual(store.db.requests.map((r) => r.id), ['a', 'b']);
  assert.deepEqual(f.state.saved.requests.map((r) => r.id), ['a', 'b']);
});
