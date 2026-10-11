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
})();
