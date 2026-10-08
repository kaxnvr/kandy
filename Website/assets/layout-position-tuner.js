/* Temporary position preview. No markup, style or storage writes without the
   opt-in URL; zero offsets are the currently saved website, not a new layout. */
(() => {
  if (new URLSearchParams(location.search).get('layoutPanel') !== '1') return;
  const baseline = '20261001-user-layout-positions-1';
  const storageKey = `kandy-layout-position:${location.pathname}:${baseline}`;
  const root = document.documentElement;
  const desktop = matchMedia('(min-width:835px) and (min-aspect-ratio:1/1) and (pointer:fine)');
  const values = { stats:0, about:0 };
  const clamp = value => Math.round(Math.min(240,Math.max(-240,value)));
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    for (const key of Object.keys(values)) {
      if (Number.isFinite(saved?.[key])) values[key] = clamp(saved[key]);
    }
  } catch (_) { /* Storage is optional; invalid saved data is ignored. */ }

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = './assets/layout-position-tuner.css?v=20261001-positions-saved';
  document.head.appendChild(stylesheet);
  root.classList.add('kandy-layout-tuning');

  const panel = document.createElement('aside');
  panel.id = 'layoutPositionTuner';
  panel.setAttribute('aria-label','布局位置调节');
  panel.innerHTML = `
    <header><h2>布局位置调节</h2><button type="button" data-action="collapse" aria-controls="layoutPositionTuner" aria-expanded="true">收起</button></header>
    <p>负数往上，正数往下。0＝现在的布局。<br>只预览位置，不改变图片、字体和 UI 大小。</p>
    <div class="lpt-controls"></div>
    <p class="lpt-scope"></p>
    <details class="lpt-export"><summary>查看参数</summary><textarea readonly spellcheck="false" aria-label="布局位置参数"></textarea></details>
    <div class="lpt-actions"><button type="button" data-action="copy">复制参数</button><button type="button" data-action="reset">重置</button></div>
    <p class="lpt-status" role="status" aria-live="polite"></p>`;
  const opener = document.createElement('button');
  opener.id = 'layoutPositionTunerOpen';
  opener.type = 'button';
  opener.textContent = '调节位置';
  opener.hidden = true;
  opener.setAttribute('aria-controls',panel.id);
  opener.setAttribute('aria-expanded','false');
  document.body.append(panel,opener);
  const output = panel.querySelector('textarea');
  const exportDetails = panel.querySelector('.lpt-export');
  const status = panel.querySelector('.lpt-status');
  const controls = panel.querySelector('.lpt-controls');
  const scope = panel.querySelector('.lpt-scope');
  const inputs = {};
  const specs = [
    {key:'stats',label:'数字卡片＋收据',target:'#stats .stats-grid'},
    {key:'about',label:'About KANDy＋后续区块',target:'#story .story-grid'}
  ];

  function updateOutput() {
    output.value = JSON.stringify({
      type:'KANDY_LAYOUT_POSITION_V1',
      baseline,
      units:'CSS px; negative=up; relative to saved baseline',
      viewport:{width:innerWidth,height:innerHeight},
      desktopPreviewActive:desktop.matches,
      STATS_RECEIPT_OFFSET_Y:values.stats,
      ABOUT_OFFSET_Y:values.about
    },null,2);
  }
  function apply() {
    root.style.setProperty('--layout-stats-shift',`${desktop.matches ? values.stats : 0}px`);
    root.style.setProperty('--layout-about-shift',`${desktop.matches ? values.about : 0}px`);
    for (const key of Object.keys(values)) {
      inputs[key].number.value = String(values[key]);
      inputs[key].range.value = String(values[key]);
      inputs[key].fieldset.disabled = !desktop.matches;
    }
    scope.textContent = desktop.matches
      ? '仅调节电脑横屏。刷新会保留预览；普通链接不套用这些参数。'
      : '请在宽度至少 835px 的电脑横屏打开，手机／竖屏预览不会被修改。';
    updateOutput();
    try { localStorage.setItem(storageKey,JSON.stringify(values)); } catch (_) {}
  }
  function setValue(key,raw) {
    if (!Number.isFinite(raw)) return;
    values[key] = clamp(raw);
    apply();
    status.textContent = '已即时更新，满意后复制参数发给我。';
  }
  function showTarget(selector) {
    const target = document.querySelector(selector);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const top = rect.top + scrollY - Math.max(100,(innerHeight - rect.height)/2);
    scrollTo({top:Math.max(0,top),behavior:'smooth'});
  }
  for (const spec of specs) {
    const fieldset = document.createElement('fieldset');
    fieldset.innerHTML = `
      <legend>${spec.label}</legend>
      <div class="lpt-label"><label for="lpt-${spec.key}-range">上下偏移</label><span><input id="lpt-${spec.key}-number" type="number" min="-240" max="240" step="1" aria-label="${spec.label}偏移像素"> px</span></div>
      <input id="lpt-${spec.key}-range" type="range" min="-240" max="240" step="1" aria-label="${spec.label}上下位置">
      <div class="lpt-nudges"><button type="button" data-nudge="-10" aria-label="${spec.label}向上 10px">上移 10</button><button type="button" data-nudge="10" aria-label="${spec.label}向下 10px">下移 10</button><button type="button" data-show aria-label="查看${spec.label}">查看</button></div>`;
    controls.appendChild(fieldset);
    const number = fieldset.querySelector('input[type=number]');
    const range = fieldset.querySelector('input[type=range]');
    inputs[spec.key] = {number,range,fieldset};
    for (const input of [number,range]) {
      input.addEventListener('input',() => {
        if (input.value === '') return;
        setValue(spec.key,input.valueAsNumber);
      });
      input.addEventListener('change',apply);
    }
    fieldset.querySelectorAll('[data-nudge]').forEach(button => {
      button.addEventListener('click',() => setValue(spec.key,values[spec.key] + Number(button.dataset.nudge)));
    });
    fieldset.querySelector('[data-show]').addEventListener('click',() => showTarget(spec.target));
  }
  panel.querySelector('[data-action=reset]').addEventListener('click',() => {
    values.stats = values.about = 0;
    apply();
    status.textContent = '已恢复现在保存的网页位置。';
  });
  panel.querySelector('[data-action=copy]').addEventListener('click',async () => {
    updateOutput();
    try {
      await navigator.clipboard.writeText(output.value);
      status.textContent = '参数已复制，直接粘贴发给我。';
    } catch (_) {
      exportDetails.open = true;
      output.focus();
      output.select();
      status.textContent = '已选中参数，请按 ⌘C / Ctrl+C 复制。';
    }
  });
  panel.querySelector('[data-action=collapse]').addEventListener('click',() => {
    panel.hidden = true;
    opener.hidden = false;
    opener.focus();
  });
  opener.addEventListener('click',() => {
    opener.hidden = true;
    panel.hidden = false;
    panel.querySelector('[data-action=collapse]').focus();
  });
  desktop.addEventListener('change',apply);
  let resizeFrame;
  addEventListener('resize',() => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; updateOutput(); });
  },{passive:true});
  apply();
})();
