/* The decorative receipt is absent below 701px. Do not download its module,
   decode its artwork or allocate a WebGL context until that layout needs it. */
export function mountResponsiveReceipt({ media, load, mount, onError }) {
  let cleanup = null;
  let pending = null;
  let disposed = false;

  function stop() {
    const release = cleanup;
    cleanup = null;
    release?.();
  }

  async function sync() {
    if (disposed || !media.matches) {
      stop();
      return;
    }
    if (cleanup || pending) return;
    pending = Promise.resolve().then(load);
    try {
      const source = await pending;
      if (!disposed && media.matches) cleanup = mount(source) || (() => {});
    } catch (error) {
      if (!disposed && media.matches) cleanup = onError(error) || (() => {});
    } finally {
      pending = null;
    }
  }

  media.addEventListener('change', sync);
  sync();
  return {
    dispose() {
      disposed = true;
      media.removeEventListener('change', sync);
      stop();
    }
  };
}
