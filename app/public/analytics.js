// PostHog loader for the owner and tenant pages. The key comes from .env through window.SERV_CONFIG (config.js).
// The product page (docs/index.html) carries PostHog's own snippet in its <head> instead.
// The staff page never loads this file: staff work is not analytics.
// Private links are secrets, so every URL PostHog sees has the link replaced with "private".
// Anything marked data-private in the page is hidden in session replays, and typed text is always hidden.
(function (d, w) {
  var cfg = w.SERV_CONFIG || {};
  var ph = (w.posthog = w.posthog || []);
  if (ph.__SV) return;

  // Until PostHog's script arrives, calls are queued here and replayed by it.
  ph._i = [];
  ph.people = [];
  ['capture', 'identify', 'register', 'reset'].forEach(function (method) {
    ph[method] = function () {
      ph.push([method].concat(Array.prototype.slice.call(arguments)));
    };
  });
  ph.__SV = 1;

  if (!cfg.posthogKey) return; // no key yet: calls are queued and dropped, nothing is sent

  // Private links appear in page addresses (/o/…, /t/…) and in the pages' own API calls (/api/owner/…, /api/tenant/…).
  var LINK = /\/(o|t|owner|tenant)\/[A-Za-z0-9_-]{16,}/g;
  // Walks an event and rewrites every string in it, including replay snapshots that hold the page address.
  function scrub(value) {
    if (typeof value === 'string') return value.replace(LINK, '/$1/private');
    if (value instanceof Date) return value; // the event's own timestamp
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (k) { out[k] = scrub(value[k]); });
      return out;
    }
    return value;
  }

  var host = cfg.posthogHost || 'https://us.i.posthog.com';
  var options = {
    api_host: host,
    person_profiles: 'identified_only',
    capture_pageview: true,
    autocapture: true,
    disable_session_recording: false,
    before_send: scrub,
    capture_performance: false, // no record of network calls, whose addresses carry the private link
    session_recording: { maskAllInputs: true, maskTextSelector: '[data-private]' },
  };
  ph._i.push([cfg.posthogKey, options, 'posthog']);

  var s = d.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = host.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js';
  d.head.appendChild(s);
})(document, window);
