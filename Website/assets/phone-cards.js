/* Only enhance the shared phone profile. Existing nodes, IDs and listeners
   remain live; leaving the profile restores their exact original positions. */
(() => {
  const profile = window.KandyPhoneProfile;
  if (!profile) return;

  let active = false;
  let moves = [];
  let disclosures = [];
  let productObserver = null;

  function moveInto(node, target) {
    if (!node || !node.parentNode) return;
    const marker = document.createComment('phone-card-original-position');
    node.parentNode.insertBefore(marker, node);
    moves.push({ node, marker });
    target.appendChild(node);
  }

  function disclosure(parent, label, before = null) {
    const details = document.createElement('details');
    details.className = 'phone-card-details';
    const summary = document.createElement('summary');
    summary.textContent = label;
    details.appendChild(summary);
    parent.insertBefore(details, before);
    disclosures.push(details);
    return details;
  }

  function enter() {
    if (active) return;
    active = true;
    const trayCopy = document.querySelector('#trayPlane .tray-feature-copy');
    if (trayCopy) {
      const facts = trayCopy.querySelector('.tray-feature-facts');
      const note = trayCopy.querySelector('.tray-feature-note');
      const small = trayCopy.querySelector('.tray-feature-actions .small');
      if (facts || note || small) {
        const details = disclosure(trayCopy, 'Collection details');
        [facts, note, small].forEach(node => moveInto(node, details));
      }
    }

    const pdp = document.getElementById('pdp');
    const body = pdp?.querySelector('.pdp-body');
    const facts = document.getElementById('pdpFacts');
    if (body && facts) {
      // Keep the description, price, quantity and add action visible before
      // secondary facts. The portfolio notice remains outside the disclosure.
      const details = disclosure(body, 'Product details', body.querySelector('.pdp-note'));
      moveInto(facts, details);
      productObserver = new MutationObserver(() => {
        details.open = false;
        // Each new opening starts at the product, not an old detail scroll.
        if (!pdp.hidden) {
          const panel = pdp.querySelector('.pdp-panel');
          if (panel) panel.scrollTop = 0;
        }
      });
      productObserver.observe(pdp, { attributes:true, attributeFilter:['hidden'] });
    }
  }

  function leave() {
    if (!active) return;
    productObserver?.disconnect();
    productObserver = null;
    const focused = document.activeElement;
    const focusedDisclosure = disclosures.find(details => details.contains(focused));
    disclosures.forEach(details => { details.open = false; });
    moves.forEach(({ node, marker }) => {
      marker.parentNode?.insertBefore(node, marker);
      marker.remove();
    });
    // A focused summary is removed during rotation out of phone mode. Keep
    // keyboard focus in the same component, without scrolling the document.
    if (focusedDisclosure && focused?.tagName === 'SUMMARY') {
      const target = focusedDisclosure.closest('#pdp')
        ? document.getElementById('pdpClose')
        : document.querySelector('#trayPlane .tray-feature-actions .btn');
      target?.focus({ preventScroll:true });
    }
    disclosures.forEach(details => details.remove());
    moves = [];
    disclosures = [];
    active = false;
  }

  function sync() {
    if (profile.matches) enter();
    else leave();
  }
  profile.addEventListener('change', sync);
  sync();
})();
