// Serv server. Run with `npm start`, then open http://localhost:3000
// No dependencies: Node's built-in http server, fetch, and test runner.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PRICE_LIST } from './pricelist.mjs';
import { createStore, openStore, addBuilding, addFileNote, findOwner, findTenant } from './store.mjs';
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
    // One shared password for Serv staff. Required online; on a laptop, unset means no sign-in.
    staffPassword: env.STAFF_PASSWORD || '',
    // Most reports one unit may send in a day. 0 means no limit.
    reportsPerUnitPerDay: env.REPORTS_PER_UNIT_PER_DAY ? Math.max(0, Number(env.REPORTS_PER_UNIT_PER_DAY) || 0) : 5,
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

// ---- Staff sign-in: one shared password, remembered in a signed cookie ----

const STAFF_COOKIE = 'serv_staff';
const STAFF_DAYS = 14;
const sign = (secret, value) => crypto.createHmac('sha256', `serv-staff:${secret}`).update(value).digest('base64url');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function staffCookie(secret, now = Date.now()) {
  const exp = String(now + STAFF_DAYS * 86_400_000);
  return `${exp}.${sign(secret, exp)}`;
}

export function staffCookieValid(secret, value, now = Date.now()) {
  if (!secret) return true; // no password set: a laptop
  const [exp, sig] = String(value ?? '').split('.');
  return Boolean(exp && sig && Number(exp) > now && same(sig, sign(secret, exp)));
}

function cookieOf(req, name) {
  const found = (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name);
  return found ? decodeURIComponent(found.slice(1).join('=')) : '';
}

const TOKEN = /^[A-Za-z0-9_-]{16,40}$/;

// ---- What each kind of visitor may see ----

/** The tenant sees what Serv said and where things stand. Never a price, a note from the file, or another unit. */
function tenantRequest(r) {
  let status;
  const d = r.decision;
  if (r.proposal.kind === 'emergency') status = { code: 'emergency', label: 'Emergency', detail: 'Call 911 now. Serv has alerted your building owner.' };
  else if (r.proposal.kind === 'needs_person') status = { code: 'person', label: 'Serv is on it', detail: 'A person at Serv is reading your report and will follow up.' };
  else if (!d) status = { code: 'waiting', label: 'Waiting for your owner', detail: 'Serv sent your owner a one-tap request. Most are answered the same day.' };
  else if (d.choice === 'approve') status = { code: 'approved', label: 'Approved', detail: `${r.proposal.pro.name} is coming: ${r.proposal.pro.nextOpening}.` };
  else if (d.choice === 'pick_myself') status = { code: 'owner', label: 'Your owner is arranging it', detail: 'Your building owner will pick the person who comes.' };
  else status = { code: 'later', label: 'On hold', detail: 'Your owner is not scheduling this right now. Serv will check back.' };
  return { id: r.id, at: r.at, message: r.message, hasPhoto: r.hasPhoto, reply: r.triage.tenantReply, urgency: r.triage.urgency, status };
}

/** The owner sees the whole card, but only for their own building. */
function ownerRequest(r) {
  const { ai, ...rest } = r;
  return rest;
}

export function createApp(config, deps = {}) {
  if (typeof deps === 'function') deps = { fetchImpl: deps };
  const store = deps.store ?? createStore(config.dataFile, { demo: !config.hosted });
  const publicDir = path.join(here, 'public');
  const reportsPerUnitPerDay = config.reportsPerUnitPerDay ?? 5;

  const buildingOf = (r) => store.db.buildings.find((b) => b.id === r.buildingId);
  const triageBuilding = (b) => ({ kind: b.kind, address: b.address, units: b.units.map((u) => u.name) });

  function ownerState(building) {
    return {
      building: { address: building.address, kind: building.kind, ownerName: building.ownerName, units: building.units.map((u) => u.name), membershipUsdPerMonth: building.membershipUsdPerMonth },
      file: building.file,
      requests: store.db.requests.filter((r) => r.buildingId === building.id).map(ownerRequest).reverse(),
    };
  }

  function tenantState({ building, unit }) {
    return {
      building: { address: building.address, kind: building.kind },
      unit: unit.name,
      requests: store.db.requests.filter((r) => r.buildingId === building.id && r.unit === unit.name).map(tenantRequest).reverse(),
    };
  }

  function staffState() {
    const { buildings, bench, requests } = store.db;
    return {
      hosted: config.hosted,
      provider: config.provider,
      aiReady: config.provider === 'claude-code' || Boolean(config.apiKey),
      priceList: PRICE_LIST,
      bench,
      buildings: buildings.map((b) => ({ ...b, openRequests: requests.filter((r) => r.buildingId === b.id && r.proposal.kind === 'offer' && !r.decision).length })),
      requests: requests.map((r) => ({ ...ownerRequest(r), address: buildingOf(r)?.address ?? '' })).reverse(),
    };
  }

  // The one user action: a tenant reports a problem and Serv works out what to do.
  async function report(found, body) {
    const { building, unit } = found;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const photo = typeof body.photoDataUrl === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(body.photoDataUrl) ? body.photoDataUrl : null;
    if (message.length < 3) return [400, { error: 'Describe the problem in a few words.' }];
    if (message.length > 2000) return [400, { error: 'Keep the message under 2,000 characters.' }];

    // Stops one phone, or one prankster holding a link, from running up the AI bill.
    const today = new Date().toISOString().slice(0, 10);
    const todays = store.db.requests.filter((r) => r.buildingId === building.id && r.unit === unit.name && r.at.slice(0, 10) === today).length;
    if (reportsPerUnitPerDay > 0 && todays >= reportsPerUnitPerDay) {
      return [429, { error: 'You have sent several reports today. Serv is working on them. For anything urgent, call your building owner.', code: 'unit_limit' }];
    }
    // The spend cap: stop making AI calls once today's allowance is used up.
    const used = store.db.aiCalls?.day === today ? store.db.aiCalls.count : 0;
    if (config.aiDailyLimit > 0 && used >= config.aiDailyLimit) {
      return [429, { error: 'Serv has reached its limit of reports for today. Please call your building owner, or try again tomorrow.', code: 'daily_limit' }];
    }
    store.db.aiCalls = { day: today, count: used + 1 };

    const result = await triage({ unit: unit.name, message, photoDataUrl: photo, building: triageBuilding(building), file: building.file }, config, deps);
    const { ai, ...checked } = result;
    const request = {
      id: crypto.randomUUID().slice(0, 8),
      buildingId: building.id,
      at: new Date().toISOString(),
      unit: unit.name,
      message,
      hasPhoto: Boolean(photo),
      triage: checked,
      proposal: propose(checked, store.db.bench),
      ai,
      decision: null,
    };
    store.db.requests.push(request);
    await store.save();
    return [201, { request: tenantRequest(request), state: tenantState(found) }];
  }

  async function handleApi(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
    const [area, token, ...rest] = parts;

    // ---- Tenant: /api/tenant/<unit link> ----
    if (area === 'tenant' && token && TOKEN.test(token)) {
      const found = findTenant(store.db, token);
      if (!found) return sendJson(res, 404, { error: 'This link is not working.' });
      if (req.method === 'GET' && !rest.length) return sendJson(res, 200, tenantState(found));
      if (req.method === 'POST' && rest.join('/') === 'requests') {
        const [status, body] = await report(found, await readJson(req));
        return sendJson(res, status, body);
      }
    }

    // ---- Owner: /api/owner/<building link> ----
    if (area === 'owner' && token && TOKEN.test(token)) {
      const building = findOwner(store.db, token);
      if (!building) return sendJson(res, 404, { error: 'This link is not working.' });
      if (req.method === 'GET' && !rest.length) return sendJson(res, 200, ownerState(building));
      const m = rest.join('/').match(/^requests\/([a-z0-9-]+)\/decision$/);
      if (req.method === 'POST' && m) {
        const body = await readJson(req);
        const request = store.db.requests.find((r) => r.id === m[1] && r.buildingId === building.id);
        if (!request) return sendJson(res, 404, { error: 'No such request.' });
        if (!DECISIONS.includes(body.decision)) return sendJson(res, 400, { error: 'Unknown decision.' });
        try {
          decide(request, body.decision, building);
        } catch (err) {
          return sendJson(res, 409, { error: err.message });
        }
        await store.save();
        return sendJson(res, 200, { request: ownerRequest(request), state: ownerState(building) });
      }
    }

    // ---- Staff ----
    if (area === 'staff') {
      const sub = [token, ...rest].filter(Boolean).join('/');
      if (req.method === 'POST' && sub === 'login') {
        const body = await readJson(req);
        const now = Date.now();
        loginTries = loginTries.filter((t) => now - t < 15 * 60_000);
        if (loginTries.length >= 10) return sendJson(res, 429, { error: 'Too many tries. Wait a few minutes.' });
        loginTries.push(now);
        const given = typeof body.password === 'string' ? body.password : '';
        if (config.staffPassword && !same(sign('check', given), sign('check', config.staffPassword))) return sendJson(res, 401, { error: 'That password is not right.' });
        res.setHeader('Set-Cookie', `${STAFF_COOKIE}=${encodeURIComponent(config.staffPassword ? staffCookie(config.staffPassword) : 'open')}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${STAFF_DAYS * 86400}${config.hosted ? '; Secure' : ''}`);
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'POST' && sub === 'logout') {
        res.setHeader('Set-Cookie', `${STAFF_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
        return sendJson(res, 200, { ok: true });
      }
      if (!staffCookieValid(config.staffPassword, cookieOf(req, STAFF_COOKIE))) return sendJson(res, 401, { error: 'Sign in first.', code: 'signin' });

      if (req.method === 'GET' && sub === 'state') return sendJson(res, 200, staffState());

      if (req.method === 'POST' && sub === 'buildings') {
        try {
          addBuilding(store.db, await readJson(req));
        } catch (err) {
          if (err.status) throw err;
          return sendJson(res, 400, { error: err.message });
        }
        await store.save();
        return sendJson(res, 201, staffState());
      }
      const note = sub.match(/^buildings\/([a-z0-9-]+)\/notes$/);
      if (req.method === 'POST' && note) {
        const building = store.db.buildings.find((b) => b.id === note[1]);
        if (!building) return sendJson(res, 404, { error: 'No such building.' });
        try {
          addFileNote(building, await readJson(req));
        } catch (err) {
          if (err.status) throw err;
          return sendJson(res, 400, { error: err.message });
        }
        await store.save();
        return sendJson(res, 201, staffState());
      }
      if (req.method === 'POST' && sub === 'reset') {
        if (config.hosted) return sendJson(res, 403, { error: 'Reset is turned off on the hosted app.' });
        await store.reset();
        return sendJson(res, 200, staffState());
      }
    }

    // Laptop only: links to try every screen. A hosted app never lists its private links without the staff password.
    if (req.method === 'GET' && area === 'demo-links' && !config.hosted) {
      return sendJson(res, 200, { buildings: store.db.buildings.map((b) => ({ address: b.address, owner: `/o/${b.ownerToken}`, units: b.units.map((u) => ({ name: u.name, link: `/t/${u.token}` })) })) });
    }

    return sendJson(res, 404, { error: 'Not found.' });
  }

  let loginTries = [];

  const PAGES = { o: 'owner.html', t: 'tenant.html', staff: 'staff.html' };
  const PRIVATE_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      // The host pings this to see that the app is up.
      if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (url.pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('User-agent: *\nDisallow: /\n');
      }

      // The PostHog project key is public by design, but it still comes from .env so it stays out of Git.
      if (url.pathname === '/config.js') {
        res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
        return res.end(`window.SERV_CONFIG = ${JSON.stringify({ posthogKey: config.posthogKey, posthogHost: config.posthogHost, hosted: config.hosted })};`);
      }

      // Private pages: /o/<owner link>, /t/<unit link>, /staff. The page asks the API for its data.
      const privateMatch = url.pathname.match(/^\/(o|t)\/[^/]+\/?$/) || (url.pathname === '/staff' || url.pathname === '/staff/' ? ['', 'staff'] : null);
      const rel = privateMatch ? PAGES[privateMatch[1]] : url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = path.join(publicDir, path.normalize(rel));
      if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', ...PRIVATE_HEADERS });
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
  if (config.staffPassword.length < 8) problems.push('Set STAFF_PASSWORD (at least 8 characters). Without it anyone could open the staff page.');
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
