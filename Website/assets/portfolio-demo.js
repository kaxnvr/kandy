/* Portfolio interactions stay in memory; no orders, email requests or storage. */
(function () {
  'use strict';

  function createCart() {
    const lines = new Map();
    return {
      add(product, quantity) {
        if (!product || !product.id || !product.name || !Number.isSafeInteger(product.cents) || product.cents < 0 || !Number.isInteger(quantity) || quantity < 1) return 0;
        const current = lines.get(product.id);
        const previous = current ? current.quantity : 0;
        const next = Math.min(99, previous + quantity);
        lines.set(product.id, { ...product, quantity: next });
        return next - previous;
      },
      update(id, quantity) {
        if (!lines.has(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return false;
        lines.get(id).quantity = quantity;
        return true;
      },
      remove(id) { return lines.delete(id); },
      items() { return Array.from(lines.values(), line => ({ ...line })); },
      count() { return Array.from(lines.values()).reduce((count, line) => count + line.quantity, 0); },
      total() { return Array.from(lines.values()).reduce((total, line) => total + line.cents * line.quantity, 0); }
    };
  }

  function money(cents) { return '$' + (cents / 100).toFixed(2); }

  function mount(doc) {
    const cart = createCart();
    const dialog = doc.getElementById('demoBag');
    const list = doc.getElementById('demoBagItems');
    const empty = doc.getElementById('demoBagEmpty');
    const total = doc.getElementById('demoBagTotal');
    const status = doc.getElementById('demoBagStatus');
    const navBag = doc.querySelector('.nav-bag');
    const count = doc.getElementById('demoBagCount');
    const newsletter = doc.querySelector('.newsletter-signup');
    let opener = null;
    let previousOverflow = '';

    function button(text, label, action, id) {
      const node = doc.createElement('button');
      node.type = 'button';
      node.textContent = text;
      node.setAttribute('aria-label', label);
      node.dataset.bagAction = action;
      node.dataset.bagId = id;
      return node;
    }

    function render(focusId, focusAction) {
      list.replaceChildren();
      const items = cart.items();
      items.forEach(item => {
        const row = doc.createElement('li');
        row.className = 'demo-bag-item';
        const image = doc.createElement('img');
        image.src = item.image;
        image.alt = '';
        image.width = 60;
        image.height = 80;
        image.decoding = 'async';
        const copy = doc.createElement('div');
        copy.className = 'demo-bag-copy';
        const name = doc.createElement('h3');
        name.textContent = item.name;
        const price = doc.createElement('p');
        price.textContent = money(item.cents) + ' each';
        const controls = doc.createElement('div');
        controls.className = 'demo-bag-quantity';
        const minus = button('−', 'Decrease ' + item.name + ' quantity', 'decrease', item.id);
        minus.disabled = item.quantity === 1;
        const number = doc.createElement('span');
        number.textContent = String(item.quantity);
        number.setAttribute('aria-label', 'Quantity: ' + item.quantity);
        const plus = button('+', 'Increase ' + item.name + ' quantity', 'increase', item.id);
        plus.disabled = item.quantity === 99;
        const remove = button('Remove', 'Remove ' + item.name, 'remove', item.id);
        remove.className = 'demo-bag-remove';
        controls.append(minus, number, plus, remove);
        copy.append(name, price, controls);
        const subtotal = doc.createElement('span');
        subtotal.className = 'demo-bag-line-total';
        subtotal.textContent = money(item.cents * item.quantity);
        row.append(image, copy, subtotal);
        list.appendChild(row);
      });
      empty.hidden = items.length > 0;
      list.hidden = items.length === 0;
      total.textContent = money(cart.total());
      const quantity = cart.count();
      count.textContent = quantity > 99 ? '99+' : String(quantity);
      count.hidden = quantity === 0;
      navBag.setAttribute('aria-label', 'Open demo bag, ' + quantity + (quantity === 1 ? ' item' : ' items'));
      if (focusId) {
        const buttons = Array.from(list.querySelectorAll('button'));
        const target = buttons.find(node => node.dataset.bagId === focusId && node.dataset.bagAction === focusAction && !node.disabled)
          || buttons.find(node => node.dataset.bagId === focusId && !node.disabled)
          || buttons.find(node => !node.disabled)
          || doc.getElementById('demoBagClose');
        target.focus({ preventScroll:true });
      }
    }

    function close() { dialog.close(); }

    function open(event) {
      if (event) { event.preventDefault(); event.stopPropagation(); }
      if (dialog.open) return;
      opener = doc.activeElement;
      const pdp = doc.getElementById('pdp');
      if (pdp.classList.contains('open')) {
        window.closePdp();
        opener = doc.activeElement;
      }
      const toggle = doc.querySelector('.nav-toggle');
      if (toggle && toggle.getAttribute('aria-expanded') === 'true') {
        toggle.click();
        opener = toggle;
      }
      render();
      previousOverflow = doc.body.style.overflow;
      doc.body.style.overflow = 'hidden';
      dialog.showModal();
      doc.getElementById('demoBagClose').focus({ preventScroll:true });
    }

    doc.querySelectorAll('[data-demo-bag]').forEach(node => node.addEventListener('click', open));
    doc.getElementById('demoBagClose').addEventListener('click', close);
    doc.getElementById('demoBagContinue').addEventListener('click', close);
    dialog.addEventListener('close', () => {
      doc.body.style.overflow = previousOverflow;
      if (opener && opener.isConnected) opener.focus({ preventScroll:true });
      opener = null;
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
    });
    list.addEventListener('click', event => {
      const control = event.target.closest('button[data-bag-action]');
      if (!control || control.disabled) return;
      const id = control.dataset.bagId;
      const action = control.dataset.bagAction;
      const item = cart.items().find(line => line.id === id);
      if (!item) return;
      if (action === 'remove') cart.remove(id);
      else cart.update(id, item.quantity + (action === 'increase' ? 1 : -1));
      render(id, action);
      status.textContent = action === 'remove' ? item.name + ' removed.' : item.name + ' quantity updated. Demo total ' + money(cart.total()) + '.';
    });

    newsletter.addEventListener('submit', event => {
      event.preventDefault();
      if (!newsletter.reportValidity()) return;
      newsletter.reset();
      doc.getElementById('newsletterDemoStatus').textContent = 'Demo complete — thank you for trying it. Your email was not sent or saved, and no subscription was created.';
    });

    render();
    return {
      addFromCard(card, quantity) {
        if (!card) return 0;
        const name = card.querySelector('.fan-name').textContent.trim();
        const rawPrice = card.querySelector('.fan-tag').firstChild.textContent.trim();
        const image = card.querySelector('.fan-product-image');
        const added = cart.add({ id:name, name, cents:Math.round(Number(rawPrice.replace(/[^\d.]/g, '')) * 100), image:image ? image.getAttribute('src') : '' }, quantity);
        render();
        return added;
      },
      open
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createCart, money, mount };
  if (typeof window !== 'undefined' && window.document) window.KandyPortfolioDemo = mount(window.document);
})();
