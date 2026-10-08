/* Fill both halves with whole repeats at a fixed gap. Each half must cover
   the viewport so the CSS -50% loop never exposes an empty trailing edge. */
(() => {
  const ribbon = document.querySelector('.hero-handoff-anchor');
  const track = ribbon?.querySelector('.marquee-track');
  const group = track?.querySelector('.marquee-group');
  if (!group) return;

  const items = Array.from(group.children, item => item.cloneNode(true));
  let lastWidth = -1;

  function fill(force = false) {
    const width = ribbon.clientWidth;
    if (!width || (!force && width === lastWidth)) return;
    lastWidth = width;
    group.replaceChildren(...items.map(item => item.cloneNode(true)));
    const unitWidth = group.getBoundingClientRect().width;
    if (!unitWidth) return;

    const copies = Math.max(1, Math.ceil(width / unitWidth));
    for (let i = 1; i < copies; i++) {
      group.append(...items.map(item => {
        const copy = item.cloneNode(true);
        copy.setAttribute('aria-hidden', 'true');
        return copy;
      }));
    }
    const mirror = group.cloneNode(true);
    mirror.setAttribute('aria-hidden', 'true');
    track.replaceChildren(group, mirror);
    track.style.setProperty('--marquee-duration', `${group.getBoundingClientRect().width / 31}s`);
  }

  fill();
  document.fonts.ready.then(() => fill(true));
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => fill()).observe(ribbon);
  } else {
    window.addEventListener('resize', () => fill(), { passive: true });
  }
})();
