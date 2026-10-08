/* Size synchronisation only: no scroll handler and no motion changes. */
(() => {
  const tray = document.getElementById('trayPlane');
  const collection = document.querySelector('#products > .wrap');
  if (!tray || !collection) return;
  const wide = matchMedia('(min-width:641px)');
  const root = document.documentElement;
  let queued = false;

  function measure() {
    queued = false;
    if (!wide.matches) {
      root.style.removeProperty('--collection-panel-width');
      root.style.removeProperty('--collection-panel-height');
      return;
    }
    const rect = collection.getBoundingClientRect();
    root.style.setProperty('--collection-panel-width', `${rect.width.toFixed(2)}px`);
    root.style.setProperty('--collection-panel-height', `${rect.height.toFixed(2)}px`);
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(measure);
  }

  measure();
  addEventListener('resize', schedule, {passive:true});
  wide.addEventListener?.('change', schedule);
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(collection);
  document.fonts?.ready.then(schedule);
})();
