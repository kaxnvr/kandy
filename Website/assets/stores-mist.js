(() => {
  const field = document.getElementById('airField');
  if (!field) return;

  const nodes = [...field.querySelectorAll('.air-node')];
  const copies = nodes.map(node => node.querySelector('.air-copy'));
  const halos = nodes.map(node => node.querySelector('.air-halo'));
  // Keep all white mist below all type. A halo attached to a depth-sorted
  // label abruptly washes out neighbours when their stacking order swaps.
  const mistLayer = document.createElement('div');
  mistLayer.className = 'air-mist-layer';
  mistLayer.setAttribute('aria-hidden', 'true');
  field.prepend(mistLayer);
  halos.forEach(halo => mistLayer.append(halo));
  const lines = copies.map(copy => [...copy.querySelectorAll('.city,.flavour,.hours')]);
  const glyphLines = lines.map(group => group.map(line => {
    const text = line.textContent.trim();
    const glyphs = [];
    line.setAttribute('aria-label', text);
    line.textContent = '';
    text.split(/(\s+)/).filter(Boolean).forEach(token => {
      if (/\s/.test(token)) {
        line.append(document.createTextNode(' '));
        return;
      }
      const word = document.createElement('span');
      word.className = 'word';
      word.setAttribute('aria-hidden', 'true');
      [...token].forEach(character => {
        const glyph = document.createElement('span');
        glyph.className = 'glyph';
        glyph.textContent = character;
        word.append(glyph);
        glyphs.push(glyph);
      });
      line.append(word);
    });
    return glyphs;
  }));

  const small = matchMedia('(max-width:700px)');
  const fine = matchMedia('(hover:hover) and (pointer:fine)');
  const reduced = matchMedia('(prefers-reduced-motion:reduce)');
  const FREEZE_HOLD = new URLSearchParams(location.search).has('qaHold');
  const APPROACH = 4600;
  const HOLD = 4000;
  const RETURN = 5400;
  const phases = [1.2, 4.8, 2.6, 6.4, .3, 3.7, 5.5];

  // Approved desktop values pasted from the v8 tuner on 2026-09-19.
  const desktopLayout = [
    [.20, .17, 1.02, 110],
    [.58, .18, 1.12, -295],
    [.485, .445, 1, 165],
    [.18, .64, .88, 30],
    [.82, .345, 1.06, -145],
    [.75, .685, 1.16, -295],
    [.455, .79, .95, -180]
  ];
  const mobileLayout = [
    [.28, .14, .94, 66],
    [.61, .08, .94, -150],
    [.44, .34, .94, 99],
    [.26, .54, .94, 18],
    [.70, .39, .94, -87],
    [.64, .57, .94, -174],
    [.35, .78, .94, 51]
  ];

  const view = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
  let width = 0;
  let height = 0;
  let nodeWidth = 0;
  let nodeHeight = 0;
  let homes = [];
  let particles = [];
  let cycle = null;
  let frame = 0;
  let lastFrame = 0;
  let clock = 0;
  let visible = true;
  let dwell = 0;
  let candidate = -1;
  let lastPointer = null;
  let triggerPointer = null;
  let hoverUntil = 0;

  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = t => {
    t = Math.max(0, Math.min(1, t));
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  const snapshot = () => particles.map(p => ({ x: p.x, y: p.y, z: p.z, scale: p.scale }));
  const perspective = () => small.matches ? 1000 : 1200;
  const projection = z => perspective() / (perspective() - z);

  function cancelIntent() {
    clearTimeout(dwell);
    dwell = 0;
    candidate = -1;
  }

  function phase(name) {
    field.dataset.phase = name;
    field.dataset.phaseStartedMs = String(Math.round(clock));
  }

  function confine(point) {
    const factor = projection(point.z || 0) * point.scale;
    const half = nodeWidth * factor * .5 + 18;
    const halfY = nodeHeight * factor * .5 + 16;
    point.x = Math.max(half, Math.min(width - half, point.x));
    point.y = Math.max(halfY, Math.min(height - halfY, point.y));
  }

  function compose(id) {
    const center = { x: width * .50, y: height * .47 };
    const baseClearX = small.matches ? Math.min(width * .33, 148) : Math.min(width * .30, 272);
    const baseClearY = small.matches ? 140 : 172;
    const nudgeX = [-13, 9, -4, -16, 12, 8, -10];
    const nudgeY = [7, -9, 3, 12, -6, 9, -8];

    return homes.map((home, index) => {
      if (index === id) {
        return { ...center, z: small.matches ? 180 : 340, scale: small.matches ? 1.04 : .90 };
      }

      const cloudPhase = phases[index] + id * .73;
      const point = {
        x: home.x + nudgeX[index] + Math.sin(cloudPhase) * (small.matches ? 4 : 9),
        y: home.y + nudgeY[index] + Math.cos(cloudPhase * .91) * (small.matches ? 5 : 11),
        z: home.z - (small.matches ? 34 : index === 2 ? 102 : 70),
        scale: home.scale * (small.matches ? .96 : index === 2 ? .95 : .988)
      };

      if (index === 2 && id === 4) {
        point.x = width * .78;
        point.y = height * .25;
      }

      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const safeX = baseClearX * (.91 + .10 * (.5 + .5 * Math.sin(phases[index] * 1.31 + id * .83)));
      const safeY = baseClearY * (.90 + .12 * (.5 + .5 * Math.cos(phases[index] * .87 - id * .74)));

      // Only copy inside C's visible footprint yields, along one unequal axis.
      if (Math.abs(dx) < safeX && Math.abs(dy) < safeY) {
        const factor = projection(point.z) * point.scale;
        const half = nodeWidth * factor * .5 + 18;
        const halfY = nodeHeight * factor * .5 + 16;
        const side = dx === 0 ? (Math.sin(phases[index] + id) < 0 ? -1 : 1) : Math.sign(dx);
        const vertical = dy === 0 ? (Math.cos(phases[index] - id) < 0 ? -1 : 1) : Math.sign(dy);
        const xJitter = (index % 3 - 1) * (small.matches ? 5 : 13);
        const yJitter = ((index + id) % 3 - 1) * (small.matches ? 6 : 15);
        const targetX = center.x + side * (safeX + xJitter);
        const targetY = center.y + vertical * (safeY + yJitter);
        const canX = targetX >= half && targetX <= width - half;
        const canY = targetY >= halfY && targetY <= height - halfY;
        const xRatio = Math.abs(dx) / safeX;
        const yRatio = Math.abs(dy) / safeY;
        const preferX = index === 2 ? false : (
          xRatio > yRatio + .14 ||
          (Math.abs(xRatio - yRatio) <= .14 && Math.sin((index + 1) * 2.17 + (id + 1) * 1.43) > .18)
        );

        if (preferX && canX) point.x = targetX;
        else if (canY) {
          point.y = targetY;
          if (index === 2) point.x += Math.sin(id * 1.73 - 1.1) * (small.matches ? 18 : 58);
        } else if (canX) point.x = targetX;
      }

      confine(point);
      return point;
    });
  }

  function flowTargets(progress) {
    return cycle.from.map((from, index) => ({
      x: mix(from.x, cycle.to[index].x, progress),
      y: mix(from.y, cycle.to[index].y, progress),
      z: mix(from.z, cycle.to[index].z, progress),
      scale: mix(from.scale, cycle.to[index].scale, progress)
    }));
  }

  function spring(p, key, velocity, target, omega, dt) {
    const offset = p[key] - target;
    const common = p[velocity] + omega * offset;
    const decay = Math.exp(-omega * dt);
    p[key] = target + (offset + common * dt) * decay;
    p[velocity] = (p[velocity] - omega * common * dt) * decay;
  }

  function begin(id) {
    if (small.matches) return;
    cancelIntent();
    if (cycle?.id === id && cycle.phase !== 'returning') return;
    cycle = { id, phase: 'approaching', started: clock, from: snapshot(), to: compose(id) };
    phase('approaching');
    field.dataset.focus = nodes[id].querySelector('.city').textContent;
    field.dataset.holdMs = String(HOLD);
    nodes.forEach((node, index) => node.setAttribute('aria-pressed', String(index === id)));
    triggerPointer = lastPointer ? { ...lastPointer } : null;
    hoverUntil = clock + 280;
    run();
  }

  function returnHome() {
    if (!cycle || cycle.phase === 'returning') return;
    cycle = {
      ...cycle,
      phase: 'returning',
      started: clock,
      from: snapshot(),
      to: homes.map(p => ({ ...p }))
    };
    phase('returning');
    nodes.forEach(node => node.setAttribute('aria-pressed', 'false'));
  }

  function draw(dt) {
    if (small.matches) return;
    const elapsed = cycle ? clock - cycle.started : 0;
    const travel = cycle?.phase === 'returning' ? RETURN : APPROACH;
    const progress = reduced.matches ? 1 : smooth(elapsed / travel);
    const targets = cycle ? flowTargets(progress) : homes;

    spring(view, 'x', 'vx', reduced.matches ? 0 : view.tx, 2.1, dt);
    spring(view, 'y', 'vy', reduced.matches ? 0 : view.ty, 2.1, dt);

    particles.forEach((p, index) => {
      const target = targets[index];
      if (reduced.matches) {
        p.x = target.x;
        p.y = target.y;
        p.z = target.z;
        p.scale = target.scale;
        p.vx = p.vy = p.vz = p.vs = 0;
      } else {
        const omega = 3.4 + (index % 3) * .12;
        spring(p, 'x', 'vx', target.x, omega, dt);
        spring(p, 'y', 'vy', target.y, omega * .95, dt);
        spring(p, 'scale', 'vs', target.scale, 3.4, dt);
        spring(p, 'z', 'vz', target.z, 3.2, dt);
      }

      const t = clock / 1000;
      const seed = phases[index];
      const x = reduced.matches ? 0 : (
        Math.sin(t * .19 + seed) * 5 +
        Math.sin(t * .071 + seed * 1.8) * 3 +
        Math.sin(t * .11) * 2
      );
      const y = reduced.matches ? 0 : (
        Math.cos(t * .15 + seed * .7) * 7 +
        Math.sin(t * .087 + seed) * 4
      );
      const floatX = reduced.matches ? 0 : Math.sin(t * .17 + seed) * 2.8;
      const floatY = reduced.matches ? 0 : Math.cos(t * .15 + seed) * 3.8;
      const breath = reduced.matches ? 0 : Math.sin(t * .105 + seed) * 12;
      const depth = p.z + breath;
      const factor = projection(depth);
      const parallax = depth / 340;
      const screenX = p.x + x + view.x * parallax * 20;
      const screenY = p.y + y + view.y * parallax * 13;
      // Apply the same perspective projection explicitly, so the mist can
      // live in a separate, permanently lower compositing layer.
      const projectedScale = p.scale * factor;
      const projectedTransform = `translate3d(${screenX.toFixed(2)}px,${screenY.toFixed(2)}px,0) scale(${projectedScale.toFixed(4)})`;
      nodes[index].style.transform = projectedTransform;
      halos[index].style.transform = projectedTransform;
      nodes[index].style.zIndex = String(Math.round(depth) + 500);
      nodes[index].dataset.depth = depth.toFixed(1);
      copies[index].style.transform = `translate3d(${floatX.toFixed(2)}px,${floatY.toFixed(2)}px,0)`;
    });

    const emphasis = cycle ? (cycle.phase === 'returning' ? 1 - progress : 1) : 0;
    const front = cycle ? particles[cycle.id] : null;
    particles.forEach((p, index) => {
      const isFront = cycle?.id === index;
      const distance = front
        ? Math.hypot((p.x - front.x) / (nodeWidth * 1.07), (p.y - front.y) / 145)
        : 10;
      // Fade only as the focused copy gets physically close. Keeping this at
      // zero in the distance prevents every label from dimming at once when a
      // new C-position cycle begins.
      const fogTarget = front && !isFront
        ? emphasis * .86 * Math.exp(-distance * distance * .95)
        : 0;

      if (reduced.matches) {
        p.fog = fogTarget;
        p.vfog = 0;
      } else {
        spring(p, 'fog', 'vfog', fogTarget, 2.25, dt);
      }

      const t = clock / 1000;
      const seed = phases[index];
      const softness = reduced.matches ? .12 : .18 + .08 * (.5 + .5 * Math.sin(t * .12 + seed));
      const distanceHaze = Math.max(0, -p.z / 440);
      const alphaTarget = Math.max(.24, .98 - distanceHaze * .35 - p.fog * .55);
      const haloTarget = isFront ? .7 + .3 * emphasis : .48;

      // Opacity has its own critically damped state. A hand-off to another
      // label now continues from the current value and velocity instead of
      // snapping when isFront changes during an overlap.
      if (reduced.matches) {
        p.alpha = alphaTarget;
        p.valpha = 0;
        p.halo = haloTarget;
        p.vhalo = 0;
      } else {
        spring(p, 'alpha', 'valpha', alphaTarget, 1.7, dt);
        spring(p, 'halo', 'vhalo', haloTarget, 1.55, dt);
      }

      copies[index].style.opacity = p.alpha.toFixed(3);
      copies[index].style.filter = `blur(${(softness + distanceHaze * 1.8 + p.fog * 1.45).toFixed(3)}px)`;
      halos[index].style.opacity = p.halo.toFixed(3);
      nodes[index].dataset.opacity = p.alpha.toFixed(3);
      nodes[index].dataset.fog = p.fog.toFixed(3);

      lines[index].forEach((line, lineIndex) => {
        const linePhase = seed + lineIndex * .92;
        const x = reduced.matches ? 0 : Math.sin(t * .12 + linePhase) * (.72 + lineIndex * .18);
        const y = reduced.matches ? 0 : (
          Math.sin(t * .14 + linePhase) * 1.05 +
          Math.cos(t * .067 + linePhase) * .55
        );
        line.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`;

        const baseAmplitude = [3.15, 1.75, 1.18][lineIndex] * (isFront ? 1.18 : 1);
        glyphLines[index][lineIndex].forEach((glyph, glyphIndex) => {
          const ripple = reduced.matches ? 0 : (
            Math.sin(t * .78 - glyphIndex * .43 + linePhase) * baseAmplitude +
            Math.sin(t * .29 + glyphIndex * .18 + linePhase * 1.31) * baseAmplitude * .32
          );
          const lateral = reduced.matches ? 0 : Math.sin(t * .23 + glyphIndex * .16 + linePhase) * .38;
          glyph.style.transform = `translate3d(${lateral.toFixed(2)}px,${ripple.toFixed(2)}px,0)`;
        });
      });
    });

    if (!cycle) return;
    const focused = particles[cycle.id];
    const destination = cycle.to[cycle.id];
    const distance = Math.hypot(focused.x - destination.x, focused.y - destination.y);
    if (
      cycle.phase === 'approaching' &&
      elapsed >= (reduced.matches ? 0 : APPROACH) &&
      distance < 2.5 &&
      Math.abs(focused.z - destination.z) < 3
    ) {
      cycle = { ...cycle, phase: 'holding', started: clock, from: cycle.to.map(p => ({ ...p })) };
      phase('holding');
    } else if (cycle.phase === 'holding' && !FREEZE_HOLD && elapsed >= HOLD) {
      field.dataset.lastHoldMs = String(Math.round(elapsed));
      returnHome();
    } else if (
      cycle.phase === 'returning' &&
      elapsed >= (reduced.matches ? 0 : RETURN) &&
      particles.every((p, i) => (
        Math.hypot(p.x - homes[i].x, p.y - homes[i].y) < 2.5 &&
        Math.abs(p.z - homes[i].z) < 3
      ))
    ) {
      cycle = null;
      phase('idle');
      delete field.dataset.focus;
    }
  }

  function tick(now) {
    frame = 0;
    if (small.matches || !visible || document.hidden) {
      lastFrame = 0;
      return;
    }
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, .05) : 1 / 60;
    lastFrame = now;
    // Wall clock keeps the requested four-second rest literal in preview tools.
    clock = Date.now();
    draw(dt);
    if (!reduced.matches || cycle) frame = requestAnimationFrame(tick);
  }

  function run() {
    if (!small.matches && !frame && visible && !document.hidden) frame = requestAnimationFrame(tick);
  }

  function visibility() {
    if (small.matches || !visible || document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      lastFrame = 0;
      cancelIntent();
    } else {
      run();
    }
  }

  function measure() {
    if (small.matches) return;
    const w = field.clientWidth;
    const h = field.clientHeight;
    if (width === w && height === h && homes.length) return;

    width = w;
    height = h;
    nodeWidth = nodes[0].offsetWidth;
    nodeHeight = nodes[0].offsetHeight;
    halos.forEach(halo => {
      halo.style.width = `${nodeWidth + 260}px`;
      halo.style.height = `${nodeHeight + 220}px`;
      halo.style.marginLeft = `${-nodeWidth / 2 - 130}px`;
      halo.style.marginTop = `${-nodeHeight / 2 - 110}px`;
    });
    const layout = small.matches ? mobileLayout : desktopLayout;
    homes = layout.map(([x, y, scale, z]) => {
      const p = { x: x * width, y: y * height, z, scale };
      confine(p);
      return p;
    });
    particles = homes.map(p => {
      const distanceHaze = Math.max(0, -p.z / 440);
      return {
        ...p,
        vx: 0,
        vy: 0,
        vz: 0,
        vs: 0,
        fog: 0,
        vfog: 0,
        alpha: Math.max(.24, .98 - distanceHaze * .35),
        valpha: 0,
        halo: .48,
        vhalo: 0
      };
    });
    nodes.forEach((node, i) => {
      node.dataset.homeX = String(homes[i].x);
      node.dataset.homeY = String(homes[i].y);
      node.dataset.homeZ = String(homes[i].z);
      node.setAttribute('aria-pressed', 'false');
      node.style.zIndex = String(Math.round(homes[i].z) + 500);
    });
    cycle = null;
    phase('idle');
    delete field.dataset.focus;
    cancelIntent();
    draw(0);
    run();
  }

  function syncLayoutMode() {
    // The narrow layout is a static grid. Its CSS overrides every animation
    // transform, so neither frame writes nor focus/hover cycles are useful.
    if (small.matches) {
      cancelAnimationFrame(frame);
      frame = 0;
      lastFrame = 0;
      cancelIntent();
      cycle = null;
      lastPointer = triggerPointer = null;
      hoverUntil = 0;
      Object.keys(view).forEach(key => { view[key] = 0; });
      nodes.forEach(node => node.setAttribute('aria-pressed', 'false'));
      phase('idle');
      delete field.dataset.focus;
      delete field.dataset.pointerHit;
    }
    // Remeasure on returning to desktop, even if the field happens to have
    // the same dimensions as it did before crossing the breakpoint.
    width = height = 0;
    measure();
  }

  function nodeAt(clientX, clientY) {
    // Negative-Z text is visibly behind the field plane, so hit-test the
    // rendered lines instead of relying on DOM stacking boxes.
    const candidates = [];
    lines.forEach((group, index) => {
      const rects = group.map(line => line.getBoundingClientRect());
      const left = Math.min(...rects.map(rect => rect.left)) - 18;
      const right = Math.max(...rects.map(rect => rect.right)) + 18;
      const top = Math.min(...rects.map(rect => rect.top)) - 14;
      const bottom = Math.max(...rects.map(rect => rect.bottom)) + 14;
      if (clientX >= left && clientX <= right && clientY >= top && clientY <= bottom) {
        const centerX = (left + right) * .5;
        const centerY = (top + bottom) * .5;
        const distance = Math.hypot(
          (clientX - centerX) / (right - left),
          (clientY - centerY) / (bottom - top)
        );
        candidates.push({ index, depth: particles[index].z, distance });
      }
    });
    candidates.sort((a, b) => b.depth - a.depth || a.distance - b.distance);
    return candidates[0]?.index ?? -1;
  }

  field.addEventListener('pointermove', event => {
    if (small.matches || !fine.matches || event.pointerType === 'touch') return;
    const rect = field.getBoundingClientRect();
    view.tx = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
    view.ty = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
    const point = { x: event.clientX, y: event.clientY };
    const moved = !lastPointer || Math.hypot(point.x - lastPointer.x, point.y - lastPointer.y) > .3;
    lastPointer = point;
    if (!moved || clock < hoverUntil) return;

    const id = nodeAt(point.x, point.y);
    field.dataset.pointerHit = id < 0 ? '' : nodes[id].querySelector('.city').textContent;
    if (id < 0) {
      cancelIntent();
      if (triggerPointer && Math.hypot(point.x - triggerPointer.x, point.y - triggerPointer.y) > 24) {
        triggerPointer = null;
      }
      return;
    }
    if (triggerPointer && Math.hypot(point.x - triggerPointer.x, point.y - triggerPointer.y) < 24) return;
    if (cycle?.id === id && cycle.phase !== 'returning') {
      cancelIntent();
      return;
    }
    if (candidate === id) return;

    cancelIntent();
    candidate = id;
    const handoffDelay = cycle ? 120 : 190;
    dwell = setTimeout(() => {
      if (nodeAt(lastPointer.x, lastPointer.y) === id) begin(id);
      else cancelIntent();
    }, handoffDelay);
  });

  field.addEventListener('click', event => {
    if (small.matches) return;
    const id = nodeAt(event.clientX, event.clientY);
    if (id >= 0) begin(id);
  });

  field.addEventListener('pointerleave', () => {
    cancelIntent();
    triggerPointer = null;
    view.tx = view.ty = 0;
    field.dataset.pointerHit = '';
  });

  nodes.forEach((node, id) => {
    node.addEventListener('focus', () => {
      if (node.matches(':focus-visible')) begin(id);
    });
    node.addEventListener('click', event => {
      if (event.detail === 0) {
        event.stopPropagation();
        begin(id);
      }
    });
  });

  window.__kandyMistDemo = {
    focus: begin,
    returnHome,
    state: () => ({
      clock,
      freezeHold: FREEZE_HOLD,
      cycle: cycle ? { id: cycle.id, phase: cycle.phase, started: cycle.started } : null
    })
  };

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      cancelIntent();
      returnHome();
    }
  });
  document.addEventListener('visibilitychange', visibility);
  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    visibility();
  }).observe(field);
  new ResizeObserver(measure).observe(field);
  small.addEventListener('change', syncLayoutMode);
  reduced.addEventListener('change', () => {
    draw(0);
    run();
  });
  syncLayoutMode();
})();
