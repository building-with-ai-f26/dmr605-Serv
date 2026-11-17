// The tenant's page: report a repair, see where it stands. Opened from the private link for one unit.

const EXAMPLES = ['The kitchen sink keeps dripping', 'Bathroom outlet stopped working', 'El inodoro no para de correr agua', 'No hot water since this morning'];

let state = null;
let photoDataUrl = null;

function build() {
  $('bar').replaceChildren(header(state.building.address));

  const message = el('textarea', { id: 'message', maxLength: 2000, required: true, placeholder: 'For example: the kitchen sink keeps dripping even when it is off, since Friday', rows: 4, name: 'message' });
  const photoInput = el('input', { id: 'photo', type: 'file', accept: 'image/*' });
  const preview = el('img', { id: 'preview', alt: 'Photo to send', hidden: true });
  const photoLabel = document.createTextNode('Add a photo');
  const photoHint = el('span', { class: 'small', text: 'Optional. It helps Serv pick the right fix.' });
  const removePhoto = el('button', { class: 'btn small ghost', type: 'button', text: 'Remove', 'aria-label': 'Remove photo', hidden: true });
  const error = el('p', { id: 'error', class: 'error', role: 'alert', hidden: true });
  const send = el('button', { id: 'send', class: 'btn primary big block', type: 'submit', text: 'Send to Serv', 'data-ph': 'send-report' });

  const chips = el('div', { class: 'chips' }, EXAMPLES.map((text) => {
    const chip = el('button', { class: 'chip', type: 'button', text, 'data-ph': 'example' });
    chip.addEventListener('click', () => { message.value = text; message.focus(); });
    return chip;
  }));

  const photo = el('div', { class: 'photo' }, [
    el('label', { class: 'btn small', 'data-ph': 'add-photo' }, [photoLabel, photoInput]),
    preview,
    removePhoto,
    photoHint,
  ]);

  const form = el('form', { id: 'report', class: 'card' }, [
    el('label', { class: 'field' }, [document.createTextNode('What is wrong?'), message]),
    el('p', { class: 'small', text: 'Or tap an example to start:' }),
    chips,
    photo,
    send,
    error,
  ]);

  $('page').replaceChildren(
    el('div', { class: 'hero' }, [el('h1', { text: 'Something broken?' }), el('p', { text: `Unit ${state.unit} · ${state.building.address}. Tell Serv what is wrong and we will take care of it.` })]),
    el('div', { class: 'alert', role: 'note', text: 'Gas smell, fire, smoke, or someone hurt? Leave and call 911 first. Then message Serv.' }),
    form,
    el('div', { id: 'list' }),
  );

  // Shows the chosen photo with a way to take it back, or the plain "Add a photo" button when there is none.
  const setPhoto = (dataUrl) => {
    photoDataUrl = dataUrl;
    if (dataUrl) preview.src = dataUrl;
    else photoInput.value = '';
    preview.hidden = removePhoto.hidden = !dataUrl;
    photoHint.hidden = Boolean(dataUrl);
    photoLabel.textContent = dataUrl ? 'Change photo' : 'Add a photo';
  };
  removePhoto.addEventListener('click', () => { setPhoto(null); announce('Photo removed.'); });
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    showError('');
    if (!file) return setPhoto(null);
    try {
      setPhoto(await shrinkPhoto(file));
      announce('Photo added.');
    } catch (err) {
      setPhoto(null);
      showError(err.message);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    if (send.disabled) return;
    send.disabled = true;
    form.setAttribute('aria-busy', 'true');
    send.textContent = 'Serv is reading it…';
    track('report_submitted', { has_photo: Boolean(photoDataUrl), length: message.value.length });
    try {
      const data = await api(`/api/tenant/${linkToken()}/requests`, { message: message.value, photoDataUrl });
      state = data.state;
      track('triage_completed', { urgency: data.request.urgency, status: data.request.status.code });
      message.value = '';
      setPhoto(null);
      renderList(data.request.id);
      announce(`Report sent. ${data.request.status.label}. ${data.request.status.detail}`);
      $('list').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showError(err.message);
      track('triage_failed', { code: err.code || 'error' });
    } finally {
      send.disabled = false;
      form.removeAttribute('aria-busy');
      send.textContent = 'Send to Serv';
    }
  });
}

function showError(text) {
  const box = $('error');
  box.textContent = text;
  box.hidden = !text;
  if (text) box.scrollIntoView({ block: 'nearest' });
}

function renderList(highlightId) {
  const box = $('list');
  if (!state.requests.length) return box.replaceChildren();
  box.replaceChildren(
    el('h2', { class: 'section-title', text: 'Your reports' }),
    ...state.requests.map((r) =>
      el('article', { class: r.id === highlightId ? 'card new' : 'card', style: 'margin-top:12px', id: r.id }, [
        el('div', { class: 'top', style: 'display:flex;justify-content:space-between;gap:8px;align-items:center' }, [
          el('span', { class: 'small', text: `Unit ${state.unit}` }),
          el('span', { class: 'small', text: when(r.at) }),
        ]),
        el('div', { class: 'bubble', 'data-private': '' }, [el('b', { text: r.hasPhoto ? 'You · photo attached' : 'You' }), document.createTextNode(r.message)]),
        r.reply ? el('div', { class: 'bubble serv', 'data-private': '' }, [el('b', { text: 'Serv' }), document.createTextNode(r.reply)]) : null,
        el('div', { class: `status ${r.status.code}` }, [el('b', { text: r.status.label }), document.createTextNode(r.status.detail)]),
      ]),
    ),
  );
}

(async () => {
  try {
    state = await api(`/api/tenant/${linkToken()}`);
  } catch {
    $('bar').replaceChildren(header());
    return showBadLink();
  }
  build();
  renderList();
})();
