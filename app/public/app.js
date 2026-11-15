// Browser side of the local app. Talks to server.mjs and draws the page.
// All text from the tenant or the AI goes in with textContent, never as HTML.

const $ = (id) => document.getElementById(id);
const track = (event, props) => window.posthog && window.posthog.capture(event, props);

const EXAMPLES = [
  'the kitchen sink keeps dripping even when its off, its been 3 days',
  'bathroom outlet stopped working, hair dryer wont turn on',
  'el inodoro no para de correr agua desde anoche',
  'I smell gas near the stove',
  'something is wrong in the bathroom',
];

let state = null;
let current = null; // the request shown in step 2
let photoDataUrl = null;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  return data;
}

const money = (n) => `$${n}`;
const cost = (n) => (n == null ? 'cost unknown' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);
const URGENCY = { life_safety: 'Emergency', urgent: 'Urgent', routine: 'Routine' };
const DECISION = {
  approve: 'Owner approved. Serv sends the pro.',
  pick_myself: 'Owner wants to pick the pro themselves.',
  decline: 'Owner said not now.',
};

function renderBuilding() {
  const b = state.building;
  $('building').replaceChildren(
    el('div', {}, [el('strong', { text: b.address }), el('div', { class: 'meta', text: `${b.kind} · units ${b.units.join(', ')}` })]),
    el('div', { class: 'meta', text: `Serv membership · $${b.membershipUsdPerMonth} a month` }),
  );
  if (!$('unit').options.length) {
    for (const u of b.units) $('unit').append(el('option', { value: u, text: u }));
    $('unit').value = b.units[b.units.length - 1];
  }
  $('ai-status').textContent = state.aiReady ? 'AI connected' : 'No API key in .env';
  $('ai-status').className = state.aiReady ? 'pill' : 'pill off';
}

function renderFile() {
  $('file').replaceChildren(...state.file.map((f) => el('li', {}, [el('span', { class: 'tag', text: f.kind }), document.createTextNode(f.text)])));
}

function renderHistory() {
  if (!state.requests.length) return $('history').replaceChildren(el('li', { class: 'none', text: 'Nothing yet.' }));
  $('history').replaceChildren(
    ...state.requests.map((r) => {
      const outcome =
        r.proposal.kind === 'offer'
          ? `${r.proposal.item.label}, ${money(r.proposal.item.priceUsd)}. ${r.decision ? DECISION[r.decision.choice] : 'Waiting for the owner.'}`
          : r.proposal.kind === 'emergency'
            ? 'Emergency: tenant told to call 911.'
            : 'Needs a person at Serv.';
      return el('li', {}, [el('strong', { text: `${r.unit}: ` }), document.createTextNode(`"${r.message}" `), el('div', { class: 'hint', text: outcome })]);
    }),
  );
}

function renderResult() {
  const r = current;
  if (!r) return;
  const t = r.triage;
  const parts = [
    el('div', { class: 'bubble tenant' }, [el('span', { class: 'who', text: `Tenant, ${r.unit}${r.hasPhoto ? ' · photo attached' : ''}` }), document.createTextNode(r.message)]),
    el('div', { class: 'bubble serv' }, [el('span', { class: 'who', text: 'Serv replies' }), document.createTextNode(t.tenantReply || '(no reply written)')]),
  ];

  const heading = el('p', {}, [el('span', { class: `tag ${t.urgency}`, text: URGENCY[t.urgency] }), document.createTextNode(t.summary)]);

  if (r.proposal.kind === 'offer') {
    const { item, pro } = r.proposal;
    const notes = state.file.filter((f) => t.fileEntryIds.includes(f.id));
    const card = el('div', { class: 'offer' }, [
      el('h3', { text: 'To the owner: one tap' }),
      heading,
      el('div', { class: 'price', text: money(item.priceUsd) }),
      el('p', {}, [el('strong', { text: item.label })]),
      el('p', { text: `Serv sends ${pro.name} (${pro.licensed}), ${pro.blocksAway} blocks away, ${pro.nextOpening}.` }),
      notes.length ? el('p', { class: 'hint', text: 'From the building file, sent to the pro:' }) : null,
      notes.length ? el('ul', { class: 'notes' }, notes.map((n) => el('li', { text: n.text }))) : null,
    ]);
    if (r.decision) {
      card.append(el('p', { class: 'decided', text: DECISION[r.decision.choice] }));
    } else {
      const button = (label, choice, cls) => {
        const b = el('button', { class: cls, type: 'button', text: label, 'data-ph': `owner-${choice}` });
        b.addEventListener('click', () => decide(choice));
        return b;
      };
      card.append(
        el('div', { class: 'actions' }, [
          button(`Approve ${money(item.priceUsd)}`, 'approve', 'primary'),
          button('I would rather pick the pro', 'pick_myself', 'secondary'),
          button('Not now', 'decline', 'secondary'),
        ]),
      );
    }
    parts.push(card);
  } else if (r.proposal.kind === 'emergency') {
    parts.push(
      el('div', { class: 'offer emergency' }, [
        el('h3', { text: 'Emergency: no job offered' }),
        heading,
        el('p', { text: 'Serv told the tenant to leave and call 911. The owner is alerted. Nothing is priced or dispatched.' }),
      ]),
    );
  } else {
    parts.push(
      el('div', { class: 'offer plain' }, [
        el('h3', { text: 'A person at Serv takes this one' }),
        heading,
        el('p', { text: t.questions.length ? 'Serv needs to know more before naming a price:' : 'This is not on the set price list, so no price is offered automatically.' }),
        t.questions.length ? el('ul', { class: 'notes' }, t.questions.map((q) => el('li', { text: q }))) : null,
      ]),
    );
  }

  const a = r.ai;
  parts.push(
    el('div', {
      class: 'ai-meta',
      text: `AI call · ${a.model} · ${(a.ms / 1000).toFixed(1)}s · ${a.inputTokens ?? '?'} tokens in, ${a.outputTokens ?? '?'} out · ${cost(a.costUsd)} · match confidence ${Math.round(t.confidence * 100)}%`,
    }),
  );
  $('result').className = '';
  $('result').replaceChildren(...parts);
}

function renderAll() {
  renderBuilding();
  renderFile();
  renderHistory();
  renderResult();
}

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}

/** Shrinks a phone photo to at most 1280 px so the upload and the AI call stay small and cheap. */
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => reject(new Error('That file is not a photo the browser can read.'));
    img.src = URL.createObjectURL(file);
  });
}

$('photo').addEventListener('change', async () => {
  const file = $('photo').files[0];
  photoDataUrl = null;
  $('preview').hidden = true;
  if (!file) return;
  try {
    photoDataUrl = await shrinkPhoto(file);
    $('preview').src = photoDataUrl;
    $('preview').hidden = false;
  } catch (err) {
    showError(err.message);
  }
});

$('report').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const send = $('send');
  send.disabled = true;
  send.textContent = 'Serv is reading it…';
  track('report_submitted', { unit: $('unit').value, has_photo: Boolean(photoDataUrl), length: $('message').value.length });
  try {
    const data = await api('/api/requests', { unit: $('unit').value, message: $('message').value, photoDataUrl });
    state = data.state;
    current = data.request;
    const r = current;
    track('triage_completed', {
      outcome: r.proposal.kind,
      urgency: r.triage.urgency,
      price_item: r.triage.priceItemId,
      price_usd: r.proposal.item ? r.proposal.item.priceUsd : null,
      confidence: r.triage.confidence,
      ai_ms: r.ai.ms,
      ai_cost_usd: r.ai.costUsd,
      ai_model: r.ai.model,
    });
    $('message').value = '';
    $('photo').value = '';
    $('preview').hidden = true;
    photoDataUrl = null;
    renderAll();
  } catch (err) {
    showError(err.message);
    track('triage_failed', { reason: err.message });
  } finally {
    send.disabled = false;
    send.textContent = 'Send to Serv';
  }
});

async function decide(choice) {
  showError('');
  try {
    const data = await api(`/api/requests/${current.id}/decision`, { decision: choice });
    state = data.state;
    current = data.request;
    // The number the sprint cares about: does the owner approve without asking to pick?
    track('owner_decision', { choice, price_item: current.proposal.item.id, price_usd: current.proposal.item.priceUsd });
    renderAll();
  } catch (err) {
    showError(err.message);
  }
}

$('reset').addEventListener('click', async () => {
  state = await api('/api/reset', {});
  current = null;
  $('result').className = 'empty';
  $('result').textContent = 'Send a message to see what Serv does with it.';
  renderAll();
});

for (const text of EXAMPLES) {
  const chip = el('button', { class: 'chip', type: 'button', text: text.length > 34 ? `${text.slice(0, 32)}…` : text, 'data-ph': 'example' });
  chip.addEventListener('click', () => {
    $('message').value = text;
    $('message').focus();
  });
  $('examples').append(chip);
}

api('/api/state').then((s) => {
  state = s;
  renderAll();
});
