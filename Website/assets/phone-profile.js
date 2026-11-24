/* Phone presentation is deliberately separate from the existing compact
   desktop/tablet layout. The preview override only works on local hosts. */
(() => {
  const query = '(pointer:coarse) and (max-width:700px), (pointer:coarse) and (max-width:1024px) and (max-height:600px)';
  const media = matchMedia(query);
  const local = ['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname);
  const preview = local && new URLSearchParams(location.search).get('phone-preview') === '1';
  const events = new EventTarget();
  // The cached value only deduplicates profile events. Read current media
  // values for consumers: related change callbacks may arrive in either order.
  const isPhone = () => preview || media.matches;
  let active = isPhone();
  const profile = {
    query,
    get matches() { return isPhone(); },
    addEventListener(...args) { events.addEventListener(...args); },
    removeEventListener(...args) { events.removeEventListener(...args); },
    withMedia(query, { excludePhone = false } = {}) {
      const other = matchMedia(query);
      const combined = new EventTarget();
      const value = () => excludePhone ? other.matches && !isPhone() : other.matches || isPhone();
      let last = value();
      const sync = () => {
        const next = value();
        if (next === last) return;
        last = next;
        combined.dispatchEvent(new Event('change'));
      };
      other.addEventListener('change', sync);
      events.addEventListener('change', sync);
      return {
        get matches() { return value(); },
        addEventListener(...args) { combined.addEventListener(...args); },
        removeEventListener(...args) { combined.removeEventListener(...args); }
      };
    }
  };
  function sync() {
    const next = isPhone();
    const changed = next !== active;
    active = next;
    if (active) document.documentElement.dataset.kandyPhone = 'true';
    else delete document.documentElement.dataset.kandyPhone;
    if (changed) events.dispatchEvent(new Event('change'));
  }
  window.KandyPhoneProfile = profile;
  media.addEventListener('change', sync);
  sync();

  /* Phones run every scripted animation on one steady 30fps beat. A fixed,
     even cadence keeps low-end phones from wobbling between 60 and 20fps,
     and halves the meadow/receipt GPU work. 30 is the steady form of a
     ~29.97 target: a browser can only present on a display refresh, so an
     exact 29.97 cap would drop a frame every few seconds instead.
     Native scrolling and CSS animations are not driven by rAF and stay at
     the display rate. This runs before every other script on the page. */
  const nativeRequest = window.requestAnimationFrame.bind(window);
  const interval = 1000 / 30;
  const queue = new Map();
  let nextId = 0, scheduled = false, lastBeat = 0;
  function beat(now) {
    scheduled = false;
    // 4ms slack absorbs vsync jitter: on 60Hz every second refresh is a beat,
    // on 120Hz every fourth.
    if (isPhone() && lastBeat && now - lastBeat < interval - 4) {
      if (queue.size) { scheduled = true; nativeRequest(beat); }
      return;
    }
    lastBeat = now;
    const due = Array.from(queue.values());
    queue.clear();
    for (const callback of due) {
      try { callback(now); }
      catch (error) { setTimeout(() => { throw error; }); }
    }
  }
  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    const id = ++nextId;
    queue.set(id, callback);
    if (!scheduled) { scheduled = true; nativeRequest(beat); }
    return id;
  };
  window.cancelAnimationFrame = function cancelAnimationFrame(id) { queue.delete(id); };
  window.KandyFramePacer = {
    fps: 30,
    get active() { return isPhone(); }
  };
})();
