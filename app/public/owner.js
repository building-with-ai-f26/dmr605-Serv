// The owner's page: what needs a yes, what Serv has handled, and what Serv knows about the building.
// Opened from the owner's private link.

let state = null;
let busy = false;

const OUTCOME = {
  approve: 'You approved this. Serv is sending the pro.',
  pick_myself: 'You said you will pick the pro. Serv will follow up.',
  decline: 'You said not now. Nothing was scheduled.',
};
const KIND = { shutoff: 'Shutoff', equipment: 'Equipment', fixture: 'Fixture', access: 'Access', note: 'Note', job: 'Past job' };

const firstName = (full) => (full || '').split(' ')[0] || 'there';
const waiting = (r) => r.proposal.kind === 'offer' && !r.decision;

async function decide(request, choice) {
  if (busy) return;
  busy = true;
  showError('');
  try {
    const data = await api(`/api/owner/${linkToken()}/requests/${request.id}/decision`, { decision: choice });
    state = data.state;
    track('owner_decision', { choice, price_item: request.proposal.item.id, price_usd: request.proposal.item.priceUsd });
    render();
  } catch (err) {
    showError(err.message);
  } finally {
    busy = false;
  }
}

function showError(text) {
  const box = $('error');
  if (box) { box.textContent = text; box.hidden = !text; }
}

/** The one-tap card. */
function offerCard(r) {
  const { item, pro } = r.proposal;
  const notes = state.file.filter((f) => r.triage.fileEntryIds.includes(f.id));
  const card = el('article', { class: `card ask${r.decision ? ' done' : ''}` }, [
    el('div', { class: 'ask-head' }, [
      el('span', { class: `tag ${r.triage.urgency}`, text: `${URGENCY[r.triage.urgency]} · Unit ${r.unit}` }),
      el('span', { class: 'small', text: when(r.at) }),
    ]),
    el('h3', { text: r.triage.summary, 'data-private': '' }),
    el('p', { class: 'quote', text: `“${r.message}”`, 'data-private': '' }),
    el('div', { class: 'price-row' }, [el('span', { class: 'price', text: money(item.priceUsd) }), el('span', { class: 'price-note', text: 'fixed price, no surprises' })]),
    el('p', { class: 'job', text: item.label }),
    el('dl', { class: 'kv' }, [
      el('div', {}, [el('dt', { text: 'Serv sends' }), el('dd', { text: `${pro.name} · ${pro.licensed}` })]),
      el('div', {}, [el('dt', { text: 'When' }), el('dd', { text: pro.nextOpening })]),
      el('div', {}, [el('dt', { text: 'Distance' }), el('dd', { text: `${pro.blocksAway} blocks from your building` })]),
    ]),
    notes.length
      ? el('div', { class: 'notes-box', 'data-private': '' }, [el('b', { text: 'Passed to the pro from your building file' }), el('ul', {}, notes.map((n) => el('li', { text: n.text })))])
      : null,
  ]);

  if (r.decision) {
    card.append(el('p', { class: `state-line${r.decision.choice === 'approve' ? ' ok' : ''}`, text: (r.decision.choice === 'approve' ? '✓ ' : '') + OUTCOME[r.decision.choice] }));
    return card;
  }
  const act = (label, choice, cls) => {
    const b = el('button', { class: `btn ${cls}`, type: 'button', text: label, 'data-ph': `owner-${choice}` });
    b.addEventListener('click', () => decide(r, choice));
    return b;
  };
  card.append(el('div', { class: 'actions' }, [act(`Approve ${money(item.priceUsd)}`, 'approve', 'primary big'), act('I will pick the pro', 'pick_myself', ''), act('Not now', 'decline', '')]));
  return card;
}

function otherCard(r) {
  const emergency = r.proposal.kind === 'emergency';
  return el('article', { class: `card ask ${emergency ? 'emergency' : 'person'}` }, [
    el('div', { class: 'ask-head' }, [
      el('span', { class: `tag ${r.triage.urgency}`, text: `${URGENCY[r.triage.urgency]} · Unit ${r.unit}` }),
      el('span', { class: 'small', text: when(r.at) }),
    ]),
    el('h3', { text: r.triage.summary, 'data-private': '' }),
    el('p', { class: 'quote', text: `“${r.message}”`, 'data-private': '' }),
    el('p', { class: 'state-line', text: emergency ? 'Emergency. The tenant was told to leave and call 911. Nothing is priced or scheduled.' : 'This one is not on the set price list. A person at Serv is handling it and will contact you.' }),
  ]);
}

function render() {
  const b = state.building;
  const open = state.requests.filter(waiting);
  const other = state.requests.filter((r) => r.proposal.kind !== 'offer');
  const handled = state.requests.filter((r) => r.proposal.kind === 'offer' && r.decision);
  const approved = handled.filter((r) => r.decision.choice === 'approve').length;

  $('bar').replaceChildren(header('Owner view'));

  const parts = [
    el('div', { class: 'hero' }, [el('h1', { text: `Hi ${firstName(b.ownerName)}` }), el('p', { text: `${b.address} · ${b.kind}` })]),
    el('div', { class: 'facts' }, [
      el('div', { class: 'fact' }, [el('b', { text: String(open.length) }), el('span', { text: 'need your OK' })]),
      el('div', { class: 'fact' }, [el('b', { text: String(approved) }), el('span', { text: 'jobs approved' })]),
      el('div', { class: 'fact' }, [el('b', { text: money(b.membershipUsdPerMonth) }), el('span', { text: 'per month' })]),
    ]),
    el('p', { id: 'error', class: 'error', role: 'alert', hidden: true }),
    el('p', { class: 'section-title' }, [document.createTextNode('Needs your OK'), open.length ? el('span', { class: 'count', text: String(open.length) }) : null]),
  ];

  if (open.length) parts.push(...open.map(offerCard));
  else parts.push(el('div', { class: 'card empty' }, [el('strong', { text: 'You are all caught up' }), document.createTextNode('When a tenant reports something, Serv sorts it out and brings it here for one tap.')]));

  if (other.length) parts.push(el('p', { class: 'section-title', text: 'Serv is handling' }), ...other.map(otherCard));

  if (handled.length) {
    parts.push(
      el('p', { class: 'section-title', text: 'Recently handled' }),
      el('section', { class: 'card' }, [
        el('ul', { class: 'list' }, handled.map((r) =>
          el('li', {}, [
            el('div', { class: 'top' }, [el('strong', { text: `Unit ${r.unit} · ${r.proposal.item.label}` }), el('span', { class: 'when', text: when(r.decision.at) })]),
            el('div', { class: 'small', text: `${money(r.proposal.item.priceUsd)} · ${OUTCOME[r.decision.choice]}` }),
          ]),
        )),
      ]),
    );
  }

  parts.push(
    el('details', { class: 'card' }, [
      el('summary', { text: `Your building file (${state.file.length})` }),
      state.file.length
        ? el('ul', { class: 'list', 'data-private': '' }, state.file.map((f) => el('li', { class: 'file-note' }, [el('span', { class: 'tag', text: KIND[f.kind] ?? f.kind, style: 'align-self:start;justify-self:start' }), el('span', { text: f.text })])))
        : el('p', { class: 'hint', text: 'Nothing yet. Serv adds what a pro needs to know: shutoffs, equipment, access.' }),
      el('p', { class: 'small', style: 'margin-top:12px', text: 'Every approved job is added here, so the next pro starts with the full picture.' }),
    ]),
  );

  $('page').replaceChildren(...parts);
}

(async () => {
  try {
    state = await api(`/api/owner/${linkToken()}`);
  } catch {
    $('bar').replaceChildren(header());
    return showBadLink();
  }
  render();
})();
