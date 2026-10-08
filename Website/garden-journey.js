/* Vertical scroll -> gift / collection on one horizontal
   track. Native document scroll stays in charge, including reverse scroll. */
(() => {
  const root = document.getElementById('gardenJourney');
  if (!root) return;
  const track = root.querySelector('.garden-journey-track');
  const panels = ['tray', 'products', 'process'].map(id => document.getElementById(id));
  const chapterStops = Array.from(root.querySelectorAll('[data-journey-stop]'));
  const mission = document.getElementById('missionStory');
  const processCards = Array.from(root.querySelectorAll('#process .step-card'));
  const processStepTrack = root.querySelector('#process .process-track');
  const processSteps = root.querySelector('#process .process-steps');
  const processWrap = root.querySelector('#process > .wrap');
  // The pinned editorial needs a desktop measure. Compact screens keep native
  // vertical flow so full-size body copy cannot be clipped below the viewport.
  const viewport = matchMedia('(min-width: 1200px) and (min-height: 600px)');
  const compact = matchMedia('(max-width:1199px), (pointer:coarse), (max-aspect-ratio:1/1), (max-height:599px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
  let enabled = false;
  let position = 0;
  let width = 0;
  let giftHold = 0;
  let travel = 0;
  let collectionHold = 0;
  let processHold = 0;
  let runway = 0;
  let processLayout = null;
  let lastUnfold = -1;
  let lastPosition = NaN;
  let journeyStart = 0;
  let arrivalStops = [];
  let previousScrollY = scrollY;
  let lastWheelAt = -Infinity;
  let wheelDirection = 0;
  let arrivalPause = null;
  let arrivalTimer = 0;
  const arrivalPauseMs = 320;

  function isPageWheel(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    if (!Number.isFinite(event.deltaY) || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return false;
    if (document.documentElement?.dataset?.siteLoading === 'true' || document.body?.style.overflow === 'hidden') return false;
    return !event.target?.closest?.('#pdp,#layoutPositionTuner,#uiFrameTuner,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="slider"],[role="spinbutton"]');
  }

  function releaseArrivalPause() {
    if (!arrivalPause) return;
    arrivalPause = null;
    clearTimeout(arrivalTimer);
    arrivalTimer = 0;
    removeEventListener('wheel',holdArrivalWheel);
    delete root.dataset.chapterPause;
    previousScrollY = scrollY;
  }

  function holdArrivalWheel(event) {
    if (!arrivalPause) return;
    // A deliberate reversal, zoom, horizontal gesture or control input exits
    // the pause immediately. The only blocked input is same-direction inertia.
    if (Date.now() >= arrivalPause.until || !isPageWheel(event) || Math.sign(event.deltaY) !== arrivalPause.direction) {
      releaseArrivalPause();
      return;
    }
    if (event.cancelable) event.preventDefault();
  }

  // Passive, constant-size bookkeeping: no geometry/style reads, no scaling,
  // no wheel prevention while the reader is moving between chapters.
  addEventListener('wheel',event => {
    if (!enabled) return;
    if (!isPageWheel(event)) {
      lastWheelAt = -Infinity;
      wheelDirection = 0;
      return;
    }
    lastWheelAt = Date.now();
    wheelDirection = Math.sign(event.deltaY);
  },{passive:true});
  addEventListener('keydown',() => { lastWheelAt = -Infinity; releaseArrivalPause(); },{passive:true});
  addEventListener('pointerdown',() => { lastWheelAt = -Infinity; releaseArrivalPause(); },{passive:true});
  document.addEventListener('visibilitychange',() => { lastWheelAt = -Infinity; releaseArrivalPause(); });

  function settleArrival(y) {
    if (arrivalPause && Date.now() >= arrivalPause.until) releaseArrivalPause();
    if (arrivalPause) {
      // Catch any compositor movement already queued before the short gate
      // was attached. This is bounded to the arrival pause, not a scroll loop.
      if (Math.abs(y - arrivalPause.y) > .5) scrollTo({top:arrivalPause.y,behavior:'instant'});
      previousScrollY = arrivalPause.y;
      return arrivalPause.y;
    }
    const direction = Math.sign(y - previousScrollY);
    const from = previousScrollY;
    previousScrollY = y;
    if (!direction || direction !== wheelDirection || Date.now() - lastWheelAt > 160) return y;
    const ordered = direction > 0 ? arrivalStops : [...arrivalStops].reverse();
    const stop = ordered.find(point => direction > 0
      ? from < point.y - .5 && y >= point.y
      : from > point.y + .5 && y <= point.y);
    if (!stop) return y;
    arrivalPause = {y:stop.y,direction,until:Date.now() + arrivalPauseMs};
    previousScrollY = stop.y;
    root.dataset.chapterPause = stop.id;
    scrollTo({top:stop.y,behavior:'instant'});
    // A non-passive listener exists for this single 320ms arrival beat only.
    // It has no computed-style/layout reads and no per-event scrollBy calls.
    addEventListener('wheel',holdArrivalWheel,{passive:false});
    arrivalTimer = setTimeout(releaseArrivalPause,arrivalPauseMs);
    return stop.y;
  }

  // The track only transforms its children. Its document position changes on
  // layout refresh, not on scroll; avoid a forced layout after every write.
  function startY() { return journeyStart; }

  function unfoldProcess(progress) {
    if (!enabled) {
      processCards.forEach(card => {
        card.querySelector('.step-reveal')?.style.removeProperty('--step-reveal-height');
        card.style.removeProperty('--process-card-base-y');
        card.style.removeProperty('--process-card-shift');
        card.style.removeProperty('--step-card-reveal-height');
      });
      processSteps?.style.removeProperty('--process-stack-height');
      processStepTrack?.style.removeProperty('--process-unfold-shift');
      return;
    }
    if (!processStepTrack || !processSteps || !processCards.length) return;
    if (progress === lastUnfold && processLayout) return;
    lastUnfold = progress;

    const softer = value => {
      const n = clamp(value);
      return n * n * n * (n * (n * 6 - 15) + 10);
    };
    const mix = (from, to, amount) => from + (to - from) * amount;

    // Establish a compact, collapsed stack in local coordinates. The cards
    // are absolutely placed while the journey is pinned, so opening one can
    // never reflow or push any card beneath it down the page.
    if (!processLayout) {
      // Measure the stable layout once per resize/font/layout refresh. All
      // reads precede writes; unfolding must never force 4-6 layouts a frame.
      const computedSteps = getComputedStyle(processSteps);
      const gap = parseFloat(computedSteps.getPropertyValue('--process-card-gap'))
        || parseFloat(computedSteps.rowGap) || 12;
      const metrics = processCards.map(card => ({
        card, window:card.querySelector('.step-reveal'),
        inner:card.querySelector('.step-reveal-inner'),
        header:card.querySelector('.step-heading')?.offsetHeight || 0,
        height:card.querySelector('.step-reveal-inner')?.offsetHeight || 0,
        baseY:0, reveal:0
      }));
      const previousShift = parseFloat(getComputedStyle(processStepTrack)
        .getPropertyValue('--process-unfold-shift')) || 0;
      // Short-screen zoom affects projected rectangles, but offsetHeight stays
      // in local CSS units. Convert only this measured layout, never per-frame.
      const processScale = parseFloat(processWrap && getComputedStyle(processWrap).zoom) || 1;
      const trackRect = processStepTrack.getBoundingClientRect();
      const panelRect = panels[2].getBoundingClientRect();
      const unshiftedTrackTop = trackRect.top - previousShift * processScale;
      const pickShift = (panelRect.top + panelRect.height / 2 - unshiftedTrackTop)
        / processScale - metrics[0].header / 2;
      const editorial = root.querySelector('#process .process-editorial');
      processLayout = {gap,metrics,pickShift,
        belowFrameShift:(panelRect.bottom + 36 - unshiftedTrackTop) / processScale,
        alignedBaseY:editorial ? (editorial.getBoundingClientRect().bottom
          - unshiftedTrackTop) / processScale - pickShift - metrics.at(-1).header : null};
    }
    const {gap,metrics,pickShift,belowFrameShift,alignedBaseY} = processLayout;
    let stackHeight = 0;
    metrics.forEach((metric, index) => {
      metric.baseY = stackHeight;
      metric.card.style.setProperty('--process-card-base-y', `${stackHeight.toFixed(2)}px`);
      stackHeight += metric.header + (index === metrics.length - 1 ? 0 : gap);
    });
    processSteps.style.setProperty('--process-stack-height', `${stackHeight.toFixed(2)}px`);

    // One entrance beat, then four equal reveal beats. Every card uses the
    // same upward-opening rule; none gets a special centre-transfer motion.
    const entranceEnd = .18;
    const entrance = softer(progress / entranceEnd);
    const unfoldProgress = clamp((progress - entranceEnd) / (1 - entranceEnd));
    const phaseCount = 4;
    const timeline = unfoldProgress * phaseCount;

    metrics.forEach((metric, index) => {
      if (!metric.window || !metric.inner) return;
      const amount = softer(timeline - index);
      metric.reveal = metric.height * amount;
      metric.window.style.setProperty('--step-reveal-height', `${metric.reveal.toFixed(2)}px`);
      metric.card.style.setProperty('--step-card-reveal-height', `${metric.reveal.toFixed(2)}px`);
    });

    // Measure the track with its old transform removed from the equation.
    // The one shared transform is used only for the initial below-frame rise;
    // after Pick arrives, every later motion is upward and card-specific.
    const globalShift = progress < entranceEnd
      ? mix(belowFrameShift, pickShift, entrance)
      : pickShift;
    processStepTrack.style.setProperty('--process-unfold-shift', `${globalShift.toFixed(2)}px`);

    // Keep the collapsed stack on one compact 12px rhythm. Wrap only travels
    // to the editorial baseline during its own reveal, so the earlier phases
    // never need oversized spacer gaps between unopened cards.
    const finalIndex = metrics.length - 1;
    const finalMetric = metrics[finalIndex];
    if (alignedBaseY !== null && finalMetric) {
      const wrapAmount = softer(timeline - finalIndex);
      finalMetric.baseY = mix(finalMetric.baseY, alignedBaseY, wrapAmount);
      finalMetric.card.style.setProperty('--process-card-base-y', `${finalMetric.baseY.toFixed(2)}px`);
    }

    // Keep every collapsed heading on the same measured rhythm. Earlier
    // versions distributed the spare height between headings, which made the
    // lower gaps look much larger than the active 12px gap.
    const groupShifts = metrics.map(() => 0);
    // Each reveal first grows into the available white space above it. Only
    // when it would touch the preceding card does that already-open group move
    // farther upward. This keeps every unopened card below absolutely still,
    // avoids overlaps, and preserves the natural 12px paper-stack rhythm.
    const collisionShifts = metrics.map(() => 0);
    for (let index = metrics.length - 2; index >= 0; index -= 1) {
      const current = metrics[index];
      const next = metrics[index + 1];
      const currentBottom = current.baseY + current.header
        + groupShifts[index] + collisionShifts[index];
      const nextTop = next.baseY - next.reveal
        + groupShifts[index + 1] + collisionShifts[index + 1];
      const overlap = currentBottom + gap - nextTop;
      if (overlap <= 0) continue;
      for (let upper = 0; upper <= index; upper += 1) collisionShifts[upper] -= overlap;
    }
    metrics.forEach((metric, index) => {
      const cardShift = groupShifts[index] + collisionShifts[index];
      metric.card.style.setProperty('--process-card-shift', `${cardShift.toFixed(2)}px`);
    });
  }

  function update() {
    if (!enabled) return;
    const offset = settleArrival(scrollY) - startY();
    const passed = Math.max(0, offset);
    const firstTravelEnd = giftHold + travel;
    const secondTravelStart = firstTravelEnd + collectionHold;
    const secondTravelEnd = secondTravelStart + travel;
    if (passed <= giftHold) position = 0;
    else if (passed < firstTravelEnd) position = (passed - giftHold) / travel;
    else if (passed <= secondTravelStart) position = 1;
    else if (passed < secondTravelEnd) position = 1 + (passed - secondTravelStart) / travel;
    else position = 2;
    // Keep the words at the same vertical position as the card, then move
    // both layers by the exact same horizontal distance. No second clock.
    if (mission) {
      mission.classList.toggle('mission-journey-follow', offset >= 0);
      mission.classList.toggle('mission-journey-exited', position >= 1);
      mission.style.setProperty('--mission-journey-x', `${-width * position}px`);
    }
    // A transformed ancestor would trap the viewport-fixed card entrance.
    if (position !== lastPosition) {
      lastPosition = position;
      track.style.transform = position > 0 ? `translate3d(${-width * position}px,0,0)` : 'none';
      root.dataset.journeyPosition = position.toFixed(4);
      panels.forEach((panel, index) => {
      // Keep keyboard focus from jumping the native horizontal scroll offset
      // to a panel which has not arrived yet. No duplicate or hidden copies.
      panel.inert = Math.abs(index - position) > .98;
      });
    }
    unfoldProcess(clamp((passed - secondTravelEnd) / processHold));
  }

  function refresh() {
    releaseArrivalPause();
    lastWheelAt = -Infinity;
    previousScrollY = scrollY;
    processLayout = null;
    lastUnfold = -1;
    lastPosition = NaN;
    enabled = viewport.matches && !compact.matches && !reduced.matches;
    document.documentElement?.classList?.toggle('garden-chapter-stops', enabled);
    root.classList.toggle('journey-enabled', enabled);
    mission?.classList.toggle('mission-native-pin', enabled);
    if (!enabled) {
      mission?.classList.remove('mission-journey-follow', 'mission-journey-exited');
      mission?.style.removeProperty('--mission-journey-x');
      mission?.style.removeProperty('--mission-pin-extension');
      root.style.removeProperty('--journey-mission-overlap');
      root.style.removeProperty('--journey-fit-scale');
      track.style.removeProperty('transform');
      root.removeAttribute('data-journey-position');
      panels.forEach(panel => { panel.inert = false; });
      position = 0;
      unfoldProcess(0);
      return;
    }
    width = root.clientWidth;
    const height = innerHeight;
    // Preserve the approved 700px+ composition exactly. Only shorter desktop
    // interiors shrink uniformly; pin, camera, travel and document flow do not.
    root.style.setProperty('--journey-fit-scale', `${Math.min(1, (height - 116) / 584)}`);
    giftHold = height * .14;
    travel = Math.max(width, height) * 1.05;
    collectionHold = height * .3;
    // Keep the original unfolding pace after adding the new entrance runway.
    processHold = height * 3.45;
    runway = giftHold + travel + collectionHold + travel + processHold;
    // Only layout refresh writes these snap points. Native proximity settling
    // and the short arrival gate share them without adding runway or spacers.
    const stopOffsets = {
      tray:giftHold / 2,
      products:giftHold + travel + collectionHold / 2,
      process:giftHold + travel + collectionHold + travel + processHold * .18
    };
    chapterStops.forEach(stop => {
      const offset = stopOffsets[stop.dataset.journeyStop];
      if (Number.isFinite(offset)) stop.style.setProperty('--journey-stop-y', `${offset}px`);
    });
    root.style.setProperty('--journey-vh', `${height}px`);
    root.style.setProperty('--journey-height', `${height + runway}px`);
    // Keep the words natively sticky until they have exited left. Compensate
    // the extra parent height before measuring, so the card/section timing
    // and every downstream document position stay exactly as before.
    const missionExtension = mission ? giftHold + travel : 0;
    mission?.style.setProperty('--mission-pin-extension', `${missionExtension}px`);
    root.style.setProperty('--journey-mission-overlap', `${missionExtension}px`);
    journeyStart = root.getBoundingClientRect().top + scrollY;
    arrivalStops = Object.entries(stopOffsets).map(([id,offset]) => ({id,y:journeyStart + offset}));
    update();
  }

  function goTo(id, behavior = 'smooth') {
    if (!enabled) return false;
    const index = panels.findIndex(panel => panel.id === id);
    if (index < 0) return false;
    releaseArrivalPause();
    lastWheelAt = -Infinity;
    const offset = index === 0 ? 0
      : index === 1 ? giftHold + travel + collectionHold / 2
      : giftHold + travel + collectionHold + travel + processHold / 2;
    scrollTo({ top:startY() + offset, behavior });
    return true;
  }

  window.KandyGardenJourney = {
    update, refresh, goTo,
    get enabled() { return enabled; },
    get position() { return position; }
  };
  addEventListener('resize', refresh);
  viewport.addEventListener('change', refresh);
  compact.addEventListener('change', refresh);
  reduced.addEventListener('change', refresh);
  document.fonts?.ready.then(refresh);

  // Anchors now resolve to scroll positions along the track, rather than the
  // identical document-top shared by the two horizontally arranged panels.
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    releaseArrivalPause();
    lastWheelAt = -Infinity;
    const id = link.getAttribute('href').slice(1);
    if (!goTo(id)) return;
    event.preventDefault();
    history.pushState(null, '', `#${id}`);
  });
  document.querySelector('.hero-cta .btn-primary')?.addEventListener('click', () => {
    if (!goTo('products')) panels[1].scrollIntoView({ behavior:reduced.matches ? 'instant' : 'smooth' });
    if (location.hash !== '#products') history.pushState(null, '', '#products');
  });
  function restoreAnchor(behavior = 'instant') {
    releaseArrivalPause();
    lastWheelAt = -Infinity;
    const id = location.hash.slice(1);
    if (!id || goTo(id,behavior)) return;
    document.getElementById(id)?.scrollIntoView({behavior,block:'start'});
  }
  addEventListener('hashchange', () => restoreAnchor(reduced.matches?'instant':'smooth'));
  // Fonts and the meadow's measured mission runway settle during loading.
  // Honor an initial #products link once that preceding layout is final.
  const loader = document.getElementById('siteLoader');
  loader?.addEventListener('kandy-loader-dispose', () => {
    refresh();
    restoreAnchor();
  }, { once:true });
  refresh();
})();
