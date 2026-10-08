/* Navigation enhancement only. All desktop dimensions and links stay intact. */
(() => {
  const nav = document.getElementById('nav');
  const toggle = nav?.querySelector('.nav-toggle');
  const links = document.getElementById('navLinks');
  if (!nav || !toggle || !links) return;
  const narrow = matchMedia('(max-width:600px)');

  function close(returnFocus = false) {
    nav.classList.remove('nav-menu-open');
    toggle.setAttribute('aria-expanded', 'false');
    links.inert = narrow.matches;
    if (returnFocus) toggle.focus();
  }
  function resize() {
    toggle.hidden = !narrow.matches;
    close();
  }
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    nav.classList.toggle('nav-menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    links.inert = !open;
  });
  nav.addEventListener('keydown', event => {
    if (event.key === 'Escape' && narrow.matches) close(true);
  });
  links.addEventListener('click', event => {
    if (narrow.matches && event.target.closest('a,button')) close(true);
  });
  document.addEventListener('pointerdown', event => {
    if (narrow.matches && !nav.contains(event.target)) close();
  });
  nav.addEventListener('focusout', event => {
    if (narrow.matches && event.relatedTarget && !nav.contains(event.relatedTarget)) close();
  });
  narrow.addEventListener('change', resize);
  resize();
})();
