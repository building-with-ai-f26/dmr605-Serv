// The one real AI call in Build 2.
// Input: a tenant's message (and maybe a photo) plus the building file.
// Output: which line of the set price list this is, how urgent it is, and what to text back.
//
// The AI only classifies and writes. Code decides the price (from the price list) and the pro
// (from the bench), so a wrong or made-up answer from the model can never change what the owner pays.

import { PRICE_LIST, TRADES, findPriceItem } from './pricelist.mjs';

const URGENCIES = ['life_safety', 'urgent', 'routine'];

// Tried in order against the models OpenRouter lists. Set OPENROUTER_MODEL in .env to override.
const MODEL_PREFERENCE = [
  /^anthropic\/claude-opus-5\.5$/,
  /^anthropic\/claude-opus-5(\.\d+)?$/,
  /^anthropic\/claude-opus-4\.\d+$/,
  /^anthropic\/claude-sonnet-/,
];
const FALLBACK_MODEL = 'anthropic/claude-opus-5.5';

const SYSTEM_PROMPT = `You triage repair requests for Serv, a service that acts as the building super for small rental buildings in Queens, New York. Tenants text Serv when something breaks. The building's owner pays a monthly membership and does not want to play dispatcher, so your read of the message decides what Serv offers the owner.

You will get the tenant's message, sometimes a photo, the building's file (notes earlier visits left behind), and Serv's set price list. Decide which single line of the price list the problem is, if any.

How to decide:
- Match a price list line only when the usual fix for what the tenant describes is that line. When the message could be two different jobs, or it is too vague to tell, do not guess: leave the match empty and ask the one or two questions that would settle it. A wrong match sends the wrong pro at the wrong price, which costs more than a question does.
- Problems that are not on the list (pests, appliances, renovations, anything large) get no match. A person at Serv handles those.
- Urgency is "life_safety" for anything that can hurt someone now: a gas smell, a carbon monoxide alarm, sparking or burning smells from wiring, fire, flooding near electricity. For these, never match a price line. Tell the tenant to leave and call 911 first.
- Urgency is "urgent" when waiting a day causes damage or leaves the unit unlivable: an active leak, no heat in cold weather, no water, a door that will not lock. Everything else is "routine".
- The building file is there to save the pro time. List the ids of the entries the pro should read before this visit, and only those.
- If a photo is attached, use what it shows, and say when it contradicts the message.

The reply to the tenant is a text message from Serv: plain, warm, two or three sentences, no price (the owner approves the price, not the tenant). Write it in the language the tenant wrote in.

Answer with one JSON object and nothing else, with exactly these keys:
{
  "summary": string,              // one sentence for the owner, in English: what is wrong and where
  "urgency": "life_safety" | "urgent" | "routine",
  "trade": "plumbing" | "electrical" | "heating" | "handyman" | null,
  "price_item_id": string | null, // an id from the price list, or null
  "confidence": number,           // 0 to 1: how sure you are of the price list match
  "questions": string[],          // questions for the tenant; empty when none are needed
  "file_entry_ids": string[],     // ids from the building file worth reading before the visit
  "tenant_reply": string
}`;

export function buildUserText({ unit, message, building, file }) {
  const priceLines = PRICE_LIST.map((p) => `- ${p.id} (${p.trade}): ${p.label}`).join('\n');
  const fileLines = file.length ? file.map((f) => `- ${f.id} [${f.kind}]: ${f.text}`).join('\n') : '(empty)';
  return `<building>
${building.kind} at ${building.address}. Units: ${building.units.join(', ')}.
</building>

<building_file>
${fileLines}
</building_file>

<price_list>
${priceLines}
</price_list>

<tenant_message unit="${unit}">
${message}
</tenant_message>`;
}

/** Pulls the JSON object out of the model's text, even if it wrapped it in a code fence. */
export function parseModelJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new TriageError('The model did not answer with JSON.', 'bad_model_output');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new TriageError('The model answered with JSON that could not be read.', 'bad_model_output');
  }
}

/**
 * Turns the model's raw answer into something the app trusts.
 * Anything out of range is replaced by the safe choice: no match, and a person at Serv looks at it.
 */
export function checkTriage(raw, file) {
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const urgency = URGENCIES.includes(raw.urgency) ? raw.urgency : 'urgent';
  let item = typeof raw.price_item_id === 'string' ? findPriceItem(raw.price_item_id) : null;
  if (urgency === 'life_safety') item = null; // never price or dispatch an emergency
  const confidence = typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1 ? raw.confidence : 0;
  const fileIds = new Set(file.map((f) => f.id));
  return {
    summary: str(raw.summary, 300) || 'Repair request (no summary)',
    urgency,
    trade: item ? item.trade : TRADES.includes(raw.trade) ? raw.trade : null,
    priceItemId: item ? item.id : null,
    confidence,
    questions: Array.isArray(raw.questions) ? raw.questions.map((q) => str(q, 200)).filter(Boolean).slice(0, 3) : [],
    fileEntryIds: Array.isArray(raw.file_entry_ids) ? raw.file_entry_ids.filter((id) => fileIds.has(id)) : [],
    tenantReply: str(raw.tenant_reply, 600),
  };
}

export class TriageError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

let modelListCache = null;

/** OpenRouter's public model list: used to pick a model that exists and to price each call. */
async function loadModels(baseUrl, fetchImpl) {
  if (modelListCache) return modelListCache;
  try {
    const res = await fetchImpl(`${baseUrl}/models`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const body = await res.json();
    modelListCache = Array.isArray(body.data) ? body.data : [];
    return modelListCache;
  } catch {
    return []; // offline or blocked: fall back to the default model and report cost as unknown
  }
}

export function pickModel(models, wanted) {
  if (wanted) return wanted;
  for (const pattern of MODEL_PREFERENCE) {
    const hit = models.map((m) => m.id).filter((id) => pattern.test(id)).sort().pop();
    if (hit) return hit;
  }
  return FALLBACK_MODEL;
}

/** Cost of one call in US dollars: OpenRouter's own figure when it sends one, else tokens times list price. */
export function costUsd(usage, modelInfo) {
  if (usage && typeof usage.cost === 'number') return usage.cost;
  const p = modelInfo?.pricing;
  if (!usage || !p) return null;
  const cost = Number(p.prompt) * (usage.prompt_tokens ?? 0) + Number(p.completion) * (usage.completion_tokens ?? 0);
  return Number.isFinite(cost) ? cost : null;
}

function explainHttpError(status, detail, model) {
  if (status === 401) return 'OpenRouter rejected the API key. Check OPENROUTER_API_KEY in .env.';
  if (status === 402) return 'The OpenRouter account is out of credits.';
  if (status === 404 || /not a valid model|no endpoints/i.test(detail)) {
    return `OpenRouter does not know the model "${model}". Set OPENROUTER_MODEL in .env to a model id from openrouter.ai/models.`;
  }
  if (status === 429) return 'OpenRouter is rate limiting this key. Wait a minute and try again.';
  return `OpenRouter answered ${status}. ${detail}`.trim();
}

/**
 * Makes the real call. `config` comes from .env; `fetchImpl` is swapped for a fake in tests.
 * Returns the checked triage plus what the call cost and how long it took.
 */
export async function triage({ unit, message, photoDataUrl, building, file }, config, fetchImpl = fetch) {
  if (!config.apiKey) {
    throw new TriageError('No OPENROUTER_API_KEY found. Copy .env.example to .env and paste your key.', 'no_key');
  }
  const models = await loadModels(config.baseUrl, fetchImpl);
  const model = pickModel(models, config.model);

  const content = [{ type: 'text', text: buildUserText({ unit, message, building, file }) }];
  if (photoDataUrl) content.push({ type: 'image_url', image_url: { url: photoDataUrl } });

  const started = Date.now();
  let res;
  try {
    res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Serv Build 2 (local)',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    const why = err?.name === 'TimeoutError' ? 'The AI call took longer than 90 seconds.' : 'Could not reach OpenRouter. Check the internet connection.';
    throw new TriageError(why, 'network');
  }
  const ms = Date.now() - started;

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message ?? '';
    } catch {
      /* no readable body */
    }
    throw new TriageError(explainHttpError(res.status, detail, model), 'upstream');
  }

  const body = await res.json();
  if (body.error) throw new TriageError(explainHttpError(body.error.code ?? 500, body.error.message ?? '', model), 'upstream');
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new TriageError('The model sent back an empty answer.', 'bad_model_output');

  const result = checkTriage(parseModelJson(text), file);
  return {
    ...result,
    ai: {
      model: body.model ?? model,
      ms,
      inputTokens: body.usage?.prompt_tokens ?? null,
      outputTokens: body.usage?.completion_tokens ?? null,
      costUsd: costUsd(body.usage, models.find((m) => m.id === model)),
    },
  };
}

// For tests only.
export function _clearModelCache() {
  modelListCache = null;
}
