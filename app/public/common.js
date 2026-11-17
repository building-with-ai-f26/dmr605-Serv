// Helpers shared by the owner, tenant and staff pages.
// All text from tenants, owners or the AI goes in with textContent, never as HTML.

window.$ = (id) => document.getElementById(id);
window.track = (event, props) => window.posthog && window.posthog.capture(event, props);

window.el = function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('data-') || k.startsWith('aria-')) node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
};

window.api = async function api(path, body) {
  const res = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `The server answered ${res.status}.`), { status: res.status, code: data.code });
  return data;
};

window.money = (n) => `$${n}`;

/** "5 min ago", "yesterday", "Nov 12". */
window.when = function when(iso) {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 60 * 24) return `${Math.round(min / 60)} hr ago`;
  if (min < 60 * 48) return 'yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

window.URGENCY = { life_safety: 'Emergency', urgent: 'Urgent', routine: 'Routine' };

/** The page's private link token: the second part of /o/<token> or /t/<token>. */
window.linkToken = () => location.pathname.split('/')[2] || '';

/** A page for a link that does not work. Says so without hinting whether the link ever existed. */
window.showBadLink = function showBadLink(message = 'This link is not working.') {
  document.querySelector('.page').replaceChildren(
    el('div', { class: 'card empty' }, [el('strong', { text: message }), document.createTextNode('Ask Serv or your building owner to send it again.')]),
  );
};

window.header = function header(note) {
  return el('div', { class: 'bar-in' }, [
    el('span', { class: 'logo' }, [el('span', { class: 'logo-mark', text: 'S' }), document.createTextNode('Serv')]),
    el('span', { class: 'bar-note', text: note || '' }),
  ]);
};

/** Shrinks a phone photo to at most 1280 px so the upload and the AI call stay small and cheap. */
window.shrinkPhoto = function shrinkPhoto(file) {
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
};
