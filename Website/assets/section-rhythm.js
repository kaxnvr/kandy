/* Layout-only measurement. No scroll listener, animation or receipt changes. */
(() => {
  const journey = document.getElementById('gardenJourney');
  const process = document.getElementById('process');
  const heading = process?.querySelector('.process-heading');
  const stats = document.getElementById('stats');
  const receipt = document.getElementById('receipt-track');
  const story = document.getElementById('story');
  if (!journey || !process || !heading || !stats) return;
  const compact = matchMedia('(max-width:1199px), (pointer:coarse), (max-aspect-ratio:1/1), (max-height:599px)');
  const tallPortrait = matchMedia('(max-aspect-ratio:3/4)');
  let queued = false;

  function measure() {
    queued = false;
    // Wrap's fully open card ends on the same baseline as the editorial.
    // Read that stable baseline, not a card moving during the scroll sequence.
    const clearance = journey.classList.contains('journey-enabled')
      ? Math.max(0, process.getBoundingClientRect().bottom - heading.getBoundingClientRect().bottom)
      : parseFloat(getComputedStyle(process).paddingBottom) || 0;
    // The original gaps straddle the whole paper footprint. Splitting the
    // extra paper height puts the CARD ROW halfway between process and About.
    // This uses stable sizes, never reveal transforms or the current scroll.
    const flow = receipt && getComputedStyle(receipt).getPropertyValue('--ru-flow-overlap');
    // On tall screens the cards should sit halfway between the end of the
    // making chapter and the start of About. The matching negative margin on
    // the receipt track keeps About in its original document position.
    const currentOffset = parseFloat(document.documentElement.style.getPropertyValue('--stats-center-offset')) || 0;
    const grid = stats.querySelector('.stats-grid');
    const processBottom = process.getBoundingClientRect().bottom;
    const storyTop = story?.getBoundingClientRect().top;
    const gridRect = grid?.getBoundingClientRect();
    const portraitOffset = gridRect && Number.isFinite(storyTop)
      ? Math.max(0, currentOffset + (processBottom + storyTop - gridRect.top - gridRect.bottom) / 2)
      : 0;
    // When the narrow layout omits the paper, there is no receipt interlude
    // to balance. Do not carry its old centring offset into the direct flow.
    const receiptHidden = receipt && receipt.getClientRects().length === 0;
    const offset = receiptHidden ? 0 : tallPortrait.matches ? portraitOffset : flow && !compact.matches
      ? Math.max(0, (receipt.getBoundingClientRect().height - parseFloat(flow) - 140
        - stats.getBoundingClientRect().height) / 2) : 0;
    const value = `${clearance.toFixed(2)}px`;
    if (stats.style.getPropertyValue('--process-tail-clearance') !== value) {
      stats.style.setProperty('--process-tail-clearance', value);
    }
    const shift = `${offset.toFixed(2)}px`;
    const rootStyle = document.documentElement.style;
    if (rootStyle.getPropertyValue('--stats-center-offset') !== shift) {
      rootStyle.setProperty('--stats-center-offset', shift);
    }
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(measure);
  }
  measure();
  addEventListener('resize', schedule, {passive:true});
  compact.addEventListener('change', schedule);
  tallPortrait.addEventListener('change', schedule);
  if ('ResizeObserver' in window) {
    const sizes = new ResizeObserver(schedule);
    sizes.observe(process);
    sizes.observe(heading);
    sizes.observe(stats);
    if (receipt) sizes.observe(receipt);
  }
  if ('MutationObserver' in window) {
    new MutationObserver(schedule).observe(journey, {attributes:true, attributeFilter:['class']});
  }
  document.fonts?.ready.then(schedule);
})();
