// The staff page: sign in, add buildings, copy private links, keep each building's file, watch the queue.
// No analytics here.

let state = null;
let tab = 'buildings';
const KINDS = ['Two-family house', 'Three-family house', 'Four-family house', 'Other small building'];
const NOTE_KINDS = [['shutoff', 'Shutoff'], ['equipment', 'Equipment'], ['fixture', 'Fixture'], ['access', 'Access'], ['note', 'Other']];
const DECISION = { approve: 'Approved', pick_myself: 'Owner will pick', decline: 'Not now' };

const origin = location.origin;

function signIn() {
  $('bar').replaceChildren(header('Staff'));
  const password = el('input', { type: 'password', id: 'password', autocomplete: 'current-password', required: true });
  const error = el('p', { class: 'error', role: 'alert', hidden: true });
  const form = el('form', { class: 'card' }, [
    el('h1', { text: 'Staff sign-in', style: 'font-size:22px;margin-bottom:12px' }),
    el('label', { class: 'field' }, [document.createTextNode('Password'), password]),
    el('button', { class: 'btn primary block', type: 'submit', text: 'Sign in' }),
    error,
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/staff/login', { password: password.value });
      await load();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
  $('page').replaceChildren(form);
  $('page').style.maxWidth = '420px';
}

async function load() {
  try {
    state = await api('/api/staff/state');
  } catch (err) {
    if (err.status === 401) return signIn();
    throw err;
  }
  $('page').style.maxWidth = '';
  render();
}

async function post(path, body) {
  state = await api(path, body);
  render();
}

function copyButton(text) {
  const b = el('button', { class: 'btn small', type: 'button', text: 'Copy link' });
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = 'Copied ✓';
    } catch {
      window.prompt('Copy this link', text);
    }
    setTimeout(() => (b.textContent = 'Copy link'), 1800);
  });
  return b;
}

function linkRow(label, path) {
  return el('div', { class: 'link-row' }, [el('strong', { text: label }), el('code', { text: origin + path }), copyButton(origin + path)]);
}

function buildingCard(b) {
  const noteText = el('input', { placeholder: 'For example: Main water shutoff is in the basement, red handle', maxLength: 500, required: true });
  const noteKind = el('select', {}, NOTE_KINDS.map(([v, l]) => el('option', { value: v, text: l })));
  const noteError = el('p', { class: 'error', hidden: true, role: 'alert' });
  const noteForm = el('form', { class: 'row', style: 'margin-top:10px;flex-wrap:nowrap' }, [
    el('div', { style: 'flex:0 0 120px' }, [noteKind]),
    el('div', { style: 'flex:1;min-width:0' }, [noteText]),
    el('button', { class: 'btn primary small', type: 'submit', text: 'Add', style: 'align-self:stretch' }),
  ]);
  for (const f of [noteKind, noteText]) Object.assign(f.style, { padding: '8px 10px', border: '1px solid #d8d2c4', borderRadius: '10px', width: '100%' });
  noteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await post(`/api/staff/buildings/${b.id}/notes`, { kind: noteKind.value, text: noteText.value });
    } catch (err) {
      noteError.textContent = err.message;
      noteError.hidden = false;
    }
  });

  return el('article', { class: 'card' }, [
    el('div', { class: 'building-head' }, [
      el('div', {}, [el('h3', { text: b.address }), el('p', { class: 'small', text: `${b.kind} · ${b.ownerName}${b.ownerEmail ? ' · ' + b.ownerEmail : ''}` })]),
      b.openRequests ? el('span', { class: 'tag waiting', text: `${b.openRequests} waiting on owner` }) : null,
    ]),
    el('p', { class: 'section-title', text: 'Private links', style: 'margin:12px 0 4px' }),
    linkRow('Owner', `/o/${b.ownerToken}`),
    ...b.units.map((u) => linkRow(`Unit ${u.name}`, `/t/${u.token}`)),
    el('p', { class: 'small', text: 'Anyone with a link can act as that owner or tenant. Send each one only to that person.', style: 'margin-top:6px' }),
    el('p', { class: 'section-title', text: `Building file (${b.file.length})`, style: 'margin:16px 0 4px' }),
    b.file.length ? el('ul', { class: 'list' }, b.file.map((f) => el('li', { class: 'file-note' }, [el('span', { class: 'tag', text: f.kind, style: 'align-self:start;justify-self:start' }), el('span', { text: f.text })]))) : el('p', { class: 'hint', text: 'Empty. Add the shutoffs, equipment and access notes a pro needs.' }),
    noteForm,
    noteError,
  ]);
}

function addBuildingForm() {
  const f = {
    address: el('input', { required: true, maxLength: 160, placeholder: '37-12 84th Street, Jackson Heights, Queens', autocomplete: 'off' }),
    kind: el('select', {}, KINDS.map((k) => el('option', { value: k, text: k }))),
    ownerName: el('input', { required: true, maxLength: 80, autocomplete: 'off' }),
    ownerEmail: el('input', { type: 'email', maxLength: 120, autocomplete: 'off' }),
    units: el('input', { required: true, value: '1F, 2F', autocomplete: 'off' }),
  };
  const error = el('p', { class: 'error', role: 'alert', hidden: true });
  const field = (label, input, help) => el('label', { class: 'field' }, [document.createTextNode(label), input, help ? el('span', { class: 'help', text: help }) : null]);
  const form = el('form', { class: 'card' }, [
    el('h3', { text: 'Add a building', style: 'margin-bottom:12px' }),
    field('Street address', f.address),
    field('Type', f.kind),
    field('Owner name', f.ownerName),
    field('Owner email (optional)', f.ownerEmail, 'Used later to send the owner their approvals. Only with the owner’s consent.'),
    field('Units', f.units, 'Separate with commas. Each unit gets its own private link.'),
    el('button', { class: 'btn primary block', type: 'submit', text: 'Add building and make links' }),
    error,
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    try {
      await post('/api/staff/buildings', {
        address: f.address.value, kind: f.kind.value, ownerName: f.ownerName.value, ownerEmail: f.ownerEmail.value,
        units: f.units.value.split(',').map((u) => u.trim()),
      });
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
  return form;
}

function queue() {
  if (!state.requests.length) return el('div', { class: 'card empty' }, [el('strong', { text: 'No reports yet' }), document.createTextNode('Reports from tenants appear here as they come in.')]);
  return el('section', { class: 'card' }, [
    el('ul', { class: 'list' }, state.requests.map((r) => {
      const p = r.proposal;
      const outcome = p.kind === 'offer' ? `${p.item.label} · ${money(p.item.priceUsd)} · ${r.decision ? DECISION[r.decision.choice] : 'waiting on owner'}` : p.kind === 'emergency' ? 'EMERGENCY: tenant told to call 911' : 'Needs a person at Serv';
      return el('li', {}, [
        el('div', { class: 'top' }, [
          el('span', {}, [el('span', { class: `tag ${r.triage.urgency}`, text: URGENCY[r.triage.urgency] }), document.createTextNode(` ${r.address} · Unit ${r.unit}`)]),
          el('span', { class: 'when', text: when(r.at) }),
        ]),
        el('p', { class: 'msg', text: `“${r.message}”` }),
        el('p', { class: 'small', text: outcome }),
      ]);
    })),
  ]);
}

function benchView() {
  return el('section', { class: 'card' }, [
    state.bench.length
      ? el('ul', { class: 'list' }, state.bench.map((p) => el('li', {}, [el('div', { class: 'top' }, [el('strong', { text: p.name }), el('span', { class: 'tag', text: p.trade })]), el('p', { class: 'small', text: `${p.licensed} · ${p.blocksAway} blocks · ${p.nextOpening}` })])))
      : el('p', { class: 'hint', text: 'No pros on the bench yet. Until there are, every report goes to a person at Serv instead of an offer.' }),
  ]);
}

function render() {
  $('bar').replaceChildren(header('Staff'));
  const tabs = [['buildings', `Buildings (${state.buildings.length})`], ['queue', `Reports (${state.requests.length})`], ['bench', `Bench (${state.bench.length})`]];
  const nav = el('div', { class: 'tabs', role: 'tablist' }, tabs.map(([id, label]) => {
    const t = el('button', { class: 'tab', role: 'tab', 'aria-selected': String(tab === id), text: label, type: 'button' });
    t.addEventListener('click', () => { tab = id; render(); });
    return t;
  }));
  const parts = [nav];
  if (state.hosted === false) parts.push(el('div', { class: 'demo', text: 'Running on this computer with made-up demo data.' }));
  if (!state.aiReady) parts.push(el('p', { class: 'error', text: 'No AI key is set, so tenant reports will fail.' }));

  if (tab === 'buildings') {
    parts.push(el('div', { class: 'grid two' }, [el('div', { class: 'grid' }, state.buildings.length ? state.buildings.map(buildingCard) : [el('div', { class: 'card empty' }, [el('strong', { text: 'No buildings yet' }), document.createTextNode('Add the first one with the form.')])]), addBuildingForm()]));
  } else if (tab === 'queue') parts.push(queue());
  else parts.push(benchView());

  if (state.hosted === false) {
    const reset = el('button', { class: 'btn ghost small', type: 'button', text: 'Reset demo data' });
    reset.addEventListener('click', () => post('/api/staff/reset', {}));
    parts.push(reset);
  }
  const out = el('button', { class: 'btn ghost small', type: 'button', text: 'Sign out' });
  out.addEventListener('click', async () => { await api('/api/staff/logout', {}); signIn(); });
  parts.push(out);
  $('page').replaceChildren(...parts);
}

load().catch((err) => $('page').replaceChildren(el('p', { class: 'error', text: err.message })));
