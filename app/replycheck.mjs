// Checks on the text a tenant reads. Kept apart from the AI call so they hold whatever the model wrote.

export const FALLBACK_REPLY = 'Thanks, we got your message. A person at Serv is looking at it and will text you back shortly.';

/** True when the reply names a dollar amount or repeats a stretch of a building file entry word for word. */
export function leaks(reply, file = []) {
  if (/\$\s?\d/.test(reply)) return true;
  const flat = (t) => String(t).toLowerCase().replace(/\s+/g, ' ');
  const said = flat(reply);
  const RUN = 28; // characters in a row: longer than any ordinary phrase the two would share by chance
  return file.some((f) => {
    const text = flat(f.text);
    for (let i = 0; i + RUN <= text.length; i += 4) if (said.includes(text.slice(i, i + RUN))) return true;
    return false;
  });
}

/** A tenant never reads a price or the building file (it holds other units' notes and what past repairs cost). */
export function guardReply(reply, file = []) {
  return leaks(String(reply ?? ''), file) ? FALLBACK_REPLY : reply || FALLBACK_REPLY;
}

/** The file as the AI sees it: what a past job cost is left out, since what the model never sees it cannot repeat. */
export function withoutPrices(file = []) {
  return file.map((f) => ({ ...f, text: String(f.text ?? '').replace(/\s+at \$\d+(\.\d+)?/g, '') }));
}
