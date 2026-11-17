// Serv Build 2: local server. Run with `npm start`, then open http://localhost:3000
// No dependencies: Node's built-in http server, fetch, and test runner.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PRICE_LIST } from './pricelist.mjs';
import { createStore, openStore } from './store.mjs';
import { triage, TriageError } from './triage.mjs';
import { propose, decide, DECISIONS } from './dispatch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);

/** Reads KEY=value lines from .env into process.env (values already set in the shell win). */
export function loadEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export function readConfig(env = process.env) {
  const key = env.OPENROUTER_API_KEY ?? '';
  const host = env.HOST || '127.0.0.1';
  const hosted = !['127.0.0.1', 'localhost', '::1'].includes(host);
  return {
    port: Number(env.PORT) || 3000,
    // Which AI makes the call: Claude Code on this computer (default), or OpenRouter.
    provider: env.AI_PROVIDER === 'openrouter' ? 'openrouter' : 'claude-code',
    claudeBin: env.CLAUDE_BIN || 'claude',
    claudeModel: env.CLAUDE_MODEL || '',
    apiKey: key.includes('replace-with') ? '' : key,
    baseUrl: (env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    model: env.OPENROUTER_MODEL || '',
    posthogKey: env.POSTHOG_KEY || '',
    posthogHost: env.POSTHOG_HOST || 'https://us.i.posthog.com',
    dataFile: env.SERV_DATA_FILE || path.join(here, 'data', 'db.json'),
    // Hosting. On a laptop none of these are set and the app answers only on this computer.
    host,
    hosted,
    supabaseUrl: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    supabaseKey: env.SUPABASE_SERVICE_KEY || '',
    // The most AI calls allowed in one day (UTC). 0 means no limit. A hosted app gets 200 unless told otherwise.
    aiDailyLimit: env.AI_DAILY_CALL_LIMIT !== undefined && env.AI_DAILY_CALL_LIMIT !== '' ? Math.max(0, Number(env.AI_DAILY_CALL_LIMIT) || 0) : hosted ? 200 : 0,
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const MAX_BODY = 4 * 1024 * 1024; // room for one phone photo, downsized in the browser

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('That photo is too large.'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('Request body was not JSON.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

export function createApp(config, deps = {}) {
  if (typeof deps === 'function') deps = { fetchImpl: deps };
  const store = deps.store ?? createStore(config.dataFile);
  const publicDir = path.join(here, 'public');

  function state() {
    const { building, file, bench, requests } = store.db;
    return { building, file, bench, priceList: PRICE_LIST, requests: [...requests].reverse(), hosted: config.hosted, provider: config.provider, aiReady: config.provider === 'claude-code' || Boolean(config.apiKey) };
  }

  async function handleApi(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/state') return sendJson(res, 200, state());

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      // Online, this button would let any visitor wipe the trial's data.
      if (config.hosted) return sendJson(res, 403, { error: 'Reset is turned off on the hosted app.' });
      await store.reset();
      return sendJson(res, 200, state());
    }

    // The one user action: a tenant reports a problem and Serv works out what to do.
    if (req.method === 'POST' && url.pathname === '/api/requests') {
      const body = await readJson(req);
      const { building, file, bench } = store.db;
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      const unit = building.units.includes(body.unit) ? body.unit : building.units[0];
      const photo = typeof body.photoDataUrl === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(body.photoDataUrl) ? body.photoDataUrl : null;
      if (message.length < 3) return sendJson(res, 400, { error: 'Describe the problem in a few words.' });
      if (message.length > 2000) return sendJson(res, 400, { error: 'Keep the message under 2,000 characters.' });

      // The spend cap: stop making AI calls once today's allowance is used up.
      const today = new Date().toISOString().slice(0, 10);
      const used = store.db.aiCalls?.day === today ? store.db.aiCalls.count : 0;
      if (config.aiDailyLimit > 0 && used >= config.aiDailyLimit) {
        return sendJson(res, 429, { error: 'Serv has reached its limit of reports for today. Please call your building owner, or try again tomorrow.', code: 'daily_limit' });
      }
      store.db.aiCalls = { day: today, count: used + 1 };

      const result = await triage({ unit, message, photoDataUrl: photo, building, file }, config, deps);
      const { ai, ...checked } = result;
      const request = {
        id: crypto.randomUUID().slice(0, 8),
        at: new Date().toISOString(),
        unit,
        message,
        hasPhoto: Boolean(photo),
        triage: checked,
        proposal: propose(checked, bench),
        ai,
        decision: null,
      };
      store.db.requests.push(request);
      await store.save();
      return sendJson(res, 201, { request, state: state() });
    }

    // The owner's one tap.
    const m = url.pathname.match(/^\/api\/requests\/([a-z0-9-]+)\/decision$/);
    if (req.method === 'POST' && m) {
      const body = await readJson(req);
      const request = store.db.requests.find((r) => r.id === m[1]);
      if (!request) return sendJson(res, 404, { error: 'No such request.' });
      if (!DECISIONS.includes(body.decision)) return sendJson(res, 400, { error: 'Unknown decision.' });
      try {
        decide(request, body.decision, store.db);
      } catch (err) {
        return sendJson(res, 409, { error: err.message });
      }
      await store.save();
      return sendJson(res, 200, { request, state: state() });
    }

    return sendJson(res, 404, { error: 'Not found.' });
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      // The host pings this to see that the app is up.
      if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

      // The PostHog project key is public by design, but it still comes from .env so it stays out of Git.
      if (url.pathname === '/config.js') {
        res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
        return res.end(`window.SERV_CONFIG = ${JSON.stringify({ posthogKey: config.posthogKey, posthogHost: config.posthogHost })};`);
      }

      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = path.join(publicDir, path.normalize(rel));
      if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      if (err instanceof TriageError) return sendJson(res, err.code === 'no_key' ? 503 : 502, { error: err.message, code: err.code });
      if (err.status) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      sendJson(res, 500, { error: 'Something went wrong on the server. See the terminal.' });
    }
  });
}

/** Stops a hosted app from starting in a state that cannot work or would lose data. Returns the problems found. */
export function hostingProblems(config) {
  if (!config.hosted) return [];
  const problems = [];
  if (config.provider !== 'openrouter') problems.push('Set AI_PROVIDER=openrouter. Claude Code on a personal subscription cannot serve other people.');
  else if (!config.apiKey) problems.push('Set OPENROUTER_API_KEY.');
  if (!config.supabaseUrl || !config.supabaseKey) problems.push('Set SUPABASE_URL and SUPABASE_SERVICE_KEY. Without a database, every deploy wipes the data.');
  return problems;
}

// Start only when run directly (`node app/server.mjs`), not when a test imports this file.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv(path.join(root, '.env'));
  const config = readConfig();
  const problems = hostingProblems(config);
  if (problems.length) {
    console.error('Serv cannot start as a hosted app yet:\n' + problems.map((p) => `  - ${p}`).join('\n') + '\nSee DEPLOY.md.');
    process.exit(1);
  }
  const store = await openStore(config);
  createApp(config, { store }).listen(config.port, config.host, () => {
    console.log(config.hosted ? `Serv is running on port ${config.port}` : `Serv is running at http://localhost:${config.port}`);
    if (config.aiDailyLimit) console.log(`AI calls are capped at ${config.aiDailyLimit} a day.`);
    if (config.provider === 'claude-code') console.log('AI calls go through Claude Code on this computer (your Claude subscription). Run `claude` once to sign in if you have not.');
    else if (!config.apiKey) console.log('AI_PROVIDER is openrouter but there is no OPENROUTER_API_KEY in .env.');
    if (!config.posthogKey) console.log('No POSTHOG_KEY yet: analytics are off until you add it to .env.');
  });
}
