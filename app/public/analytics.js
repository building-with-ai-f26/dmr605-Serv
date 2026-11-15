// PostHog loader, shared by the product page (docs/) and the local app (app/public/).
// Keep the two copies identical. The key comes from window.SERV_CONFIG (config.js).
// With a key set, PostHog records pageviews, clicks (autocapture) and session replay.
// Session replay also has to be switched on once in PostHog: Settings > Replay > Record user sessions.
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

  var host = cfg.posthogHost || 'https://us.i.posthog.com';
  var options = {
    api_host: host,
    person_profiles: 'identified_only',
    capture_pageview: true,
    autocapture: true,
    disable_session_recording: false,
    // Replays hide what people type, so a tenant's message never leaves the laptop through analytics.
    session_recording: { maskAllInputs: true },
  };
  ph._i.push([cfg.posthogKey, options, 'posthog']);

  var s = d.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = host.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js';
  d.head.appendChild(s);
})(document, window);
