/* Phone full-screen chapters (direction B), on the same URL as the desktop
   page. Content is read from the original sections so there is one source of
   copy; product taps open the page's own detail dialog and bag. Leaving the
   phone profile (rotation to a tablet-size viewport) removes the layer. */
(() => {
  const profile = window.KandyPhoneProfile;
  if (!profile) return;
  const root = document.documentElement;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const text = el => (el ? el.textContent.trim() : '');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
  const tints = { London:'#C9A6D8', California:'#F3DE8A', 'New York':'#F4B183', Melbourne:'#F2CF6B', Shanghai:'#E9C27A', Bangkok:'#F7C59F', Online:'#CFE3C8' };
  const anchorMap = { hero:'hero', missionStory:'pc-mission', tray:'pc-fridge', products:'pc-collection', process:'pc-process', stats:'pc-numbers', story:'pc-story', stores:'pc-stores', newsletter:'pc-news' };

  let layer = null, progress = null, observer = null, active = false;

  function bigImage(img) {
    if (!img) return '';
    const set = img.getAttribute('srcset');
    if (set) {
      const parts = set.split(',').map(s => s.trim().split(/\s+/));
      parts.sort((a, b) => parseInt(b[1]) - parseInt(a[1]));
      if (parts[0]?.[0]) return parts[0][0];
    }
    return img.getAttribute('src');
  }

  function read() {
    const products = $$('#fanDeck .fan-card').map(card => ({
      card,
      name: text($('.fan-name', card)),
      flavor: text($('.fan-flavor', card)),
      price: text($('.fan-tag', card)).split(/\s/)[0],
      img: bigImage($('img', card)),
      dark: card.classList.contains('fan-hero'),
      ribbon: text($('.ribbon', card))
    }));
    // Lead with the bestseller, as the stack's face card.
    products.sort((a, b) => (b.dark ? 1 : 0) - (a.dark ? 1 : 0));
    return {
      mission: $$('#missionStory .mission-line').slice(0, 4).map(text),
      trayImg: bigImage($('#trayPlane .tray-feature-photo')) || './assets/web/optimized/manor-oak-bark-lifestyle-720-lossless.webp',
      facts: $$('#trayPlane .tray-feature-facts li').map(li => [text($('b,strong,.num', li)) || text(li.firstElementChild), text(li.lastElementChild)]),
      products,
      steps: $$('#process .step-card').map(card => ({
        num: text($('.step-index', card)),
        name: text($('h3', card)),
        svg: $('.step-emblem svg', card)?.outerHTML || '',
        summary: text($('.step-summary', card)),
        detail: text($('.step-detail', card))
      })),
      stats: $$('#stats .stat').map(s => [text($('.num, .num-static', s)) || text(s.firstElementChild), text($('p', s))]),
      storyImg: bigImage($('#story .story-photo')),
      storyLead: text($('#story .lead')),
      reviews: $$('.testimonials .t-card').map(c => ({
        name: text($('.t-name', c)), img: $('.t-avatar img', c)?.getAttribute('src') || '',
        rating: text($('.rating', c)), quote: text($('blockquote', c)), meta: text($('.t-meta', c))
      })),
      stores: $$('#stores .air-node').map(n => ({ city: text($('.city', n)), sig: text($('.flavour', n)), hours: text($('.hours', n)) }))
    };
  }

  function build(d) {
    const facts = d.facts.length === 3 ? d.facts : [['4','full-size pouches'],['4','garden flavours'],['0g','added sugar']];
    const stats = d.stats.length === 4 && d.stats.every(s => s[0]) ? d.stats : [['4','Signature garden shapes'],['6','Cities worldwide'],['100%','Small-batch crafted'],['0g','Added sugar']];
    const el = document.createElement('div');
    el.id = 'phoneChapters';
    el.innerHTML = `
<section class="pc-ch pc-mission" id="pc-mission" data-name="The garden">
  ${d.mission.map((m, i) => `<p style="--d:${i}">${esc(m)}</p>`).join('')}
</section>
<section class="pc-ch pc-fridge" id="pc-fridge" data-name="The fridge line-up">
  <div class="pc-photo pc-rv"><img src="${esc(d.trayImg)}" alt="Manor Oak Bark and Woodland Toadstools, carried in a tote" loading="lazy"></div>
  <div class="pc-fridge-card pc-rv" style="--d:1">
    <span class="pc-eyebrow">The fridge line-up</span>
    <h2 class="pc-title">Four garden favourites, always within reach.</h2>
    <p class="pc-lead">Wild strawberry, dark chocolate, caramel almond and vanilla bean — four small-batch treats.</p>
    <ul class="pc-facts">${facts.map(([b, s]) => `<li><b>${esc(b)}</b><span>${esc(s)}</span></li>`).join('')}</ul>
    <a class="pc-btn pc-btn-dark" href="#products">Meet the collection</a>
  </div>
</section>
<section class="pc-ch pc-collection" id="pc-collection" data-name="The collection">
  <span class="pc-eyebrow pc-rv">The collection</span>
  <h2 class="pc-title pc-rv" style="--d:1">Four confections from the grounds.</h2>
  <div class="pc-deck pc-rv" style="--d:2">
    ${d.products.map(p => `<article class="pc-card${p.dark ? ' pc-dark' : ''}" role="button" tabindex="0" aria-label="${esc(p.name)} — view details">
      ${p.ribbon ? `<span class="pc-ribbon">${esc(p.ribbon)}</span>` : ''}
      <div class="pc-pic"><img src="${esc(p.img)}" alt="${esc(p.name)} packaging" draggable="false" loading="lazy"></div>
      <span class="pc-flavor">${esc(p.flavor)}</span><h3>${esc(p.name)}</h3>
      <div class="pc-row"><b>${esc(p.price)}</b><span>View details ↗</span></div></article>`).join('')}
  </div>
  <div class="pc-deck-foot pc-rv" style="--d:3">
    <button type="button" class="pc-prev" aria-label="Previous confection">‹</button>
    <span class="pc-count">1 / ${d.products.length}</span>
    <button type="button" class="pc-next" aria-label="Next confection">›</button>
  </div>
  <p class="pc-tip pc-rv" style="--d:3">Swipe the pile · tap a pouch for details</p>
</section>
<section class="pc-ch pc-process" id="pc-process" data-name="How it's made">
  <span class="pc-eyebrow pc-rv">How it's made</span>
  <h2 class="pc-title pc-rv" style="--d:1">Four steps, none of them hurried.</h2>
  <div class="pc-bars pc-rv" style="--d:2">${d.steps.map(() => '<i></i>').join('')}</div>
  <div class="pc-stage pc-rv" style="--d:2">
    ${d.steps.map((s, i) => `<article class="pc-step${i ? '' : ' on'}"><span class="pc-num">${esc(s.num)}</span><h3>${esc(s.name)}</h3>${s.svg}<p class="pc-summary">${esc(s.summary)}</p><p class="pc-detail">${esc(s.detail)}</p></article>`).join('')}
    <div class="pc-taps"><button type="button" class="pc-step-prev" aria-label="Previous step"></button><button type="button" class="pc-step-next" aria-label="Next step"></button></div>
  </div>
  <p class="pc-tip pc-rv" style="--d:3">Tap to turn the page</p>
</section>
<section class="pc-ch pc-numbers" id="pc-numbers" data-name="By the numbers">
  <div class="pc-head">
    <span class="pc-eyebrow pc-rv">By the numbers</span>
    <h2 class="pc-title pc-rv" style="--d:1">Small batches, kept on paper.</h2>
  </div>
  <div class="pc-stats">${stats.map(([b, s], i) => `<div class="pc-stat pc-rv" style="--d:${i + 1}"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('')}</div>
  <div class="pc-receipt">
    <img src="./assets/web/optimized/receipt-kandy-lossless.webp" alt="A KANDy batch receipt" loading="lazy">
    <span class="pc-caption">Every tin ships with its batch receipt</span>
  </div>
</section>
<section class="pc-ch pc-story" id="pc-story" data-name="Our story">
  <div class="pc-photo pc-rv"><img src="${esc(d.storyImg)}" alt="Sharing Woodland Toadstools" loading="lazy"></div>
  <div class="pc-story-copy">
    <span class="pc-eyebrow pc-rv" style="--d:1">About KANDy</span>
    <h2 class="pc-title pc-rv" style="--d:1">Grown, not manufactured.</h2>
    <p class="pc-lead pc-rv" style="--d:2">${esc(d.storyLead.split('. ')[0])}.</p>
    <a class="pc-link pc-rv" style="--d:3" href="#missionStory">Read our story ›</a>
  </div>
</section>
<section class="pc-ch pc-reviews" id="pc-reviews" data-name="Sweet moments">
  <div class="pc-head">
    <span class="pc-eyebrow pc-rv">Sweet moments</span>
    <h2 class="pc-title pc-rv" style="--d:1">What people are saying.</h2>
  </div>
  <div class="pc-rail pc-rv" style="--d:2">
    ${d.reviews.map(r => `<figure class="pc-review"><header><img src="${esc(r.img)}" alt="" loading="lazy"><div><b>${esc(r.name)}</b><small>★★★★★ ${esc(r.rating)}</small></div></header><blockquote>${esc(r.quote)}</blockquote><footer>${esc(r.meta)}</footer></figure>`).join('')}
  </div>
  <p class="pc-rail-count">1 / ${d.reviews.length} · swipe</p>
</section>
<section class="pc-ch pc-stores" id="pc-stores" data-name="Find us">
  <span class="pc-eyebrow pc-rv">Find us</span>
  <h2 class="pc-title pc-rv" style="--d:1">Six gardens, six flavours.</h2>
  <div class="pc-chips pc-rv" style="--d:2">${d.stores.map(s => `<button type="button">${esc(s.city)}</button>`).join('')}</div>
  <div class="pc-store pc-rv" style="--d:3"></div>
</section>
<section class="pc-ch pc-news" id="pc-news" data-name="Garden correspondence">
  <div class="pc-letter pc-rv">
    <span class="pc-eyebrow">Garden correspondence</span>
    <h2 class="pc-title">Unlock the garden.</h2>
    <p class="pc-lead">New shapes, seasonal drops, and store perks — straight to your inbox.</p>
    <form class="pc-email"><input type="email" placeholder="Email address" aria-label="Email address"><button type="submit">Subscribe →</button></form>
    <p class="pc-demo">Portfolio demo · No email will be sent or saved.</p>
  </div>
  <div class="pc-foot pc-rv" style="--d:1">
    <div><b>Shop</b>${d.products.slice(0, 3).map(p => `<a href="#products">${esc(p.name)}</a>`).join('')}</div>
    <div><b>Company</b><a href="#story">Our story</a><a href="#stores">Stores</a><a href="#">Careers</a></div>
    <div class="pc-legal"><span>© 2026 KANDy Manor Confections</span><span>Portfolio by @kaxnvr</span></div>
  </div>
</section>`;
    return el;
  }

  function wire(el, d) {
    /* chapters: progress + entrance */
    const chapters = [$('#hero'), ...$$('.pc-ch', el)].filter(Boolean);
    progress = document.createElement('nav');
    progress.className = 'pc-progress';
    progress.setAttribute('aria-hidden', 'true');
    chapters.forEach(() => progress.appendChild(document.createElement('i')));
    document.body.appendChild(progress);
    const dots = [...progress.children];
    observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.intersectionRatio < .6) return;
        const i = chapters.indexOf(e.target);
        e.target.classList.add('pc-in');
        dots.forEach((dot, k) => dot.classList.toggle('on', k === i));
        progress.classList.toggle('light', e.target.id === 'hero');
      });
    }, { threshold:[.6] });
    chapters.forEach(c => observer.observe(c));

    /* collection pile */
    const deck = $('.pc-deck', el), cards = $$('.pc-card', deck), count = $('.pc-count', el);
    let order = cards.map((_, i) => i), moved = false, startX = 0, startY = 0, dragging = false;
    function layout(dx = 0) {
      order.forEach((idx, pos) => {
        const c = cards[idx];
        c.style.setProperty('--a', Math.min(pos, 3));
        c.style.setProperty('--o', pos === 0 ? 0 : (pos % 2 ? 1 : -1) * Math.min(pos, 2) * .6);
        c.style.zIndex = 10 - pos;
        c.style.transform = pos === 0 && dx ? `translate(-50%,-50%) translateX(${dx}px) rotate(${dx / 18}deg)` : '';
      });
      count.textContent = `${order[0] + 1} / ${cards.length}`;
    }
    const step = dir => { order = dir > 0 ? [...order.slice(1), order[0]] : [order.at(-1), ...order.slice(0, -1)]; layout(); };
    const openDetails = i => d.products[i]?.card?.click();
    cards.forEach((c, i) => {
      c.addEventListener('click', () => { if (!moved && order[0] === i) openDetails(i); });
      c.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && order[0] === i) { e.preventDefault(); openDetails(i); } });
    });
    deck.addEventListener('pointerdown', e => { startX = e.clientX; startY = e.clientY; dragging = true; moved = false; cards[order[0]].classList.add('dragging'); });
    deck.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - startY)) { moved = true; layout(dx); }
    });
    const end = e => {
      if (!dragging) return;
      dragging = false;
      cards[order[0]].classList.remove('dragging');
      const dx = e.clientX - startX;
      if (moved && Math.abs(dx) > 60) step(dx < 0 ? 1 : -1); else layout();
      setTimeout(() => { moved = false; }, 0);
    };
    deck.addEventListener('pointerup', end);
    deck.addEventListener('pointercancel', end);
    $('.pc-next', el).onclick = () => step(1);
    $('.pc-prev', el).onclick = () => step(-1);
    layout();

    /* process steps */
    const steps = $$('.pc-step', el), bars = $$('.pc-bars i', el);
    let s = 0;
    const show = n => {
      s = (n + steps.length) % steps.length;
      steps.forEach((st, k) => { st.classList.toggle('on', k === s); st.classList.toggle('off', k < s); });
      bars.forEach((b, k) => b.style.setProperty('--f', k <= s ? 1 : 0));
    };
    $('.pc-step-next', el).onclick = () => show(s + 1);
    $('.pc-step-prev', el).onclick = () => show(s - 1);
    show(0);

    /* reviews */
    const rail = $('.pc-rail', el), railCount = $('.pc-rail-count', el);
    rail.addEventListener('scroll', () => {
      const w = rail.firstElementChild.getBoundingClientRect().width + 12;
      railCount.textContent = `${Math.round(rail.scrollLeft / w) + 1} / ${d.reviews.length} · swipe`;
    }, { passive:true });

    /* stores */
    const chips = $$('.pc-chips button', el), card = $('.pc-store', el);
    const pick = i => {
      const st = d.stores[i];
      chips.forEach((b, k) => b.classList.toggle('on', k === i));
      card.style.setProperty('--tint', tints[st.city] || '#FCB7DD');
      const initials = st.city === 'Online' ? '@' : st.city.split(' ').map(w => w[0]).join('');
      const ring = `KANDy · ${st.city.toUpperCase()} GARDEN · `.repeat(2);
      card.innerHTML = `<div class="pc-seal pc-swap"><svg viewBox="0 0 200 200" aria-hidden="true"><defs><path id="pcRing" d="M100 100m-82 0a82 82 0 1 1 164 0a82 82 0 1 1 -164 0"/></defs><text font-family="Lato" font-size="12.5" fill="rgba(43,38,32,.55)"><textPath href="#pcRing" textLength="505" lengthAdjust="spacing">${esc(ring)}</textPath></text></svg><b>${esc(initials)}</b></div>
        <div class="pc-swap"><span class="pc-eyebrow">${st.city === 'Online' ? 'Everywhere' : 'Signature flavour'}</span><div class="pc-city">${esc(st.city)}</div><p class="pc-sig">${esc(st.sig.replace(/^Signature:\s*/, ''))}</p><p class="pc-hours">${esc(st.hours)}</p></div>`;
    };
    chips.forEach((b, i) => { b.onclick = () => pick(i); });
    const london = d.stores.findIndex(st => st.city === 'London');
    pick(london >= 0 ? london : 0);

    /* newsletter demo */
    $('.pc-email', el).addEventListener('submit', e => {
      e.preventDefault();
      $('.pc-demo', el).textContent = 'Thank you — this is a portfolio demo, nothing was sent.';
    });
  }

  /* Same-page links land on the matching chapter instead of a hidden section. */
  function onLink(e) {
    if (!active) return;
    const cta = e.target.closest('.hero-cta .btn-primary');
    const link = e.target.closest('a[href^="#"]');
    const id = cta ? 'products' : link && link.getAttribute('href').slice(1);
    if (!id || !(id in anchorMap)) return;
    const target = document.getElementById(anchorMap[id]);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const nav = $('#nav');
    if (nav?.classList.contains('nav-menu-open')) {
      nav.classList.remove('nav-menu-open');
      $('#nav .nav-toggle')?.setAttribute('aria-expanded', 'false');
    }
    target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'start' });
  }

  function enter() {
    if (active) return;
    const data = read();
    if (!data.products.length) return;
    active = true;
    layer = build(data);
    $('#hero').after(layer);
    wire(layer, data);
    root.setAttribute('data-phone-chapters', '');
  }

  function leave() {
    if (!active) return;
    active = false;
    root.removeAttribute('data-phone-chapters');
    observer?.disconnect();
    layer?.remove();
    progress?.remove();
    layer = progress = observer = null;
  }

  const sync = () => (profile.matches ? enter() : leave());
  addEventListener('click', onLink, true);
  profile.addEventListener('change', sync);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once:true });
  else sync();
})();
