/** Cooperative CPU work: yield a real task (not just a promise microtask),
 * allowing pointer events to reach the loader worker during model generation. */
export function createStartupBudget(enabled = true) {
  let checks = 0;
  let deadline = performance.now() + 8;
  return {
    exhausted() {
      return enabled && (++checks & 255) === 0 && performance.now() >= deadline;
    },
    async yield() {
      // Model work is background work. A boosted scheduler.yield continuation
      // can still starve normal task queues; explicitly resume at background priority.
      if (globalThis.scheduler?.postTask) await globalThis.scheduler.postTask(() => {}, {priority:'background'});
      else await new Promise(resolve => setTimeout(resolve, 0));
      deadline = performance.now() + 8;
    }
  };
}
