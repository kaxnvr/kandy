/* Local design controls. Saved previews are applied only with ?uiPanel=1. */
(() => {
  if (new URLSearchParams(location.search).get('uiPanel') !== '1') return;
  const storageKey = 'kandy-ui-frame-tuner-v1';
  const defaults = { white:75, blur:48 };
  const values = { ...defaults };
  const clamp = (n,min,max) => Math.min(max,Math.max(min,n));
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Number.isFinite(saved?.white)) values.white = clamp(saved.white,0,100);
    if (Number.isFinite(saved?.blur)) values.blur = clamp(saved.blur,0,48);
  } catch (_) { /* Storage is optional, including in private browsing. */ }

  const style = document.createElement('style');
  style.textContent = `
    #uiFrameTuner,#uiFrameTunerOpen{position:fixed;z-index:500;color:#292820;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-sizing:border-box}
    #uiFrameTuner{right:18px;bottom:18px;width:296px;max-width:calc(100vw - 28px);max-height:calc(100dvh - 100px);overflow:auto;padding:19px;border:1px solid #dddeda;border-radius:20px;background:#fafbf9;box-shadow:0 12px 44px #1b251d26}
    #uiFrameTuner *{box-sizing:border-box}
    #uiFrameTuner header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
    #uiFrameTuner h2{font:600 16px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0;margin:0}
    #uiFrameTuner p{font-size:12px;line-height:1.6;color:#70736b;margin:0 0 14px}
    #uiFrameTuner button,#uiFrameTunerOpen{cursor:pointer;font:inherit;border:1px solid #dfe1da;border-radius:9px;background:#fff;padding:7px 10px;color:inherit}
    #uiFrameTuner button:hover{background:#edf0e9}
    #uiFrameTuner button:focus-visible,#uiFrameTuner input:focus-visible,#uiFrameTuner textarea:focus-visible,#uiFrameTunerOpen:focus-visible{outline:2px solid #526b59;outline-offset:3px}
    #uiFrameTuner .uft-presets{display:flex;gap:7px;margin-bottom:20px}
    #uiFrameTuner .uft-presets button{flex:1}
    #uiFrameTuner .uft-row{margin:17px 0}
    #uiFrameTuner .uft-label{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
    #uiFrameTuner input[type=number]{width:64px;padding:4px 6px;border:1px solid #d8dcd3;border-radius:6px;background:#fff;color:#292820;font:inherit;text-align:right}
    #uiFrameTuner input[type=range]{display:block;width:100%;margin:8px 0;accent-color:#647a66;cursor:pointer}
    #uiFrameTuner .uft-ends{display:flex;justify-content:space-between;font-size:11px;color:#777d70}
    #uiFrameTuner textarea{display:block;resize:vertical;width:100%;min-height:69px;padding:9px;margin:15px 0 10px;border:1px solid #dfe1da;border-radius:9px;background:#f1f3ed;color:#444b3d;font:11px/1.6 ui-monospace,monospace}
    #uiFrameTuner .uft-actions{display:flex;gap:8px}
    #uiFrameTuner .uft-actions button:first-child{flex:1;background:#303b30;color:#fff;border-color:#303b30}
    #uiFrameTuner .uft-status{min-height:19px;font-size:11px;color:#65715d;margin:8px 0 0}
    #uiFrameTunerOpen{right:18px;bottom:18px;border-radius:999px;padding:10px 17px;box-shadow:0 8px 24px #1b251d20}
    #uiFrameTuner[hidden],#uiFrameTunerOpen[hidden]{display:none}
    @media(max-width:600px){#uiFrameTuner{right:14px;bottom:14px;max-height:60dvh}}
  `;
  document.head.append(style);
  const panel = document.createElement('aside');
  panel.id = 'uiFrameTuner';
  panel.setAttribute('aria-label','UI 框材质调节');
  panel.innerHTML = `
    <header><h2>UI 框材质</h2><button type="button" data-action="collapse" aria-expanded="true" aria-controls="uiFrameTuner">收起</button></header>
    <p>全站有框面板同步预览，导航固定不透明。调整后复制参数发给我。</p>
    <div class="uft-presets"><button type="button" data-preset="white">纯白</button><button type="button" data-preset="frost">磨砂</button><button type="button" data-preset="clear">清透</button></div>
    <div class="uft-row">
      <div class="uft-label"><label for="uftWhiteRange">白色浓度</label><span><input id="uftWhiteNumber" type="number" min="0" max="100" step="1" aria-label="白色浓度百分比"> %</span></div>
      <input id="uftWhiteRange" type="range" min="0" max="100" step="1">
      <div class="uft-ends"><span>透明</span><span>纯白</span></div>
    </div>
    <div class="uft-row">
      <div class="uft-label"><label for="uftBlurRange">磨砂强度</label><span><input id="uftBlurNumber" type="number" min="0" max="48" step="1" aria-label="磨砂强度像素"> px</span></div>
      <input id="uftBlurRange" type="range" min="0" max="48" step="1">
      <div class="uft-ends"><span>清晰</span><span>柔雾</span></div>
    </div>
    <p>降低白色浓度后，可看到磨砂变化。刷新会保留本次调节。</p>
    <textarea aria-label="UI 框参数" readonly spellcheck="false"></textarea>
    <div class="uft-actions"><button type="button" data-action="copy">复制参数</button><button type="button" data-action="reset">重置</button></div>
    <p class="uft-status" role="status" aria-live="polite"></p>
  `;
  const opener = document.createElement('button');
  opener.id = 'uiFrameTunerOpen';
  opener.type = 'button';
  opener.textContent = '调节 UI 框';
  opener.hidden = true;
  opener.setAttribute('aria-controls','uiFrameTuner');
  opener.setAttribute('aria-expanded','false');
  document.body.append(panel,opener);
  const output = panel.querySelector('textarea');
  const status = panel.querySelector('.uft-status');
  const inputs = {
    white:[panel.querySelector('#uftWhiteRange'),panel.querySelector('#uftWhiteNumber')],
    blur:[panel.querySelector('#uftBlurRange'),panel.querySelector('#uftBlurNumber')]
  };
  function apply() {
    document.documentElement.style.setProperty('--ui-frame-white',String(values.white/100));
    // Opaque white needs no background sampling. Keep the blur setting ready
    // so moving towards transparency immediately reveals frosted glass.
    document.documentElement.style.setProperty('--ui-frame-blur',`${values.white===100?0:values.blur}px`);
    for (const [key,pair] of Object.entries(inputs)) pair.forEach(input => { input.value = values[key]; });
    output.value = `UI_FRAME_WHITE: ${(values.white/100).toFixed(2)}\nUI_FRAME_BLUR: ${values.blur}`;
    try { localStorage.setItem(storageKey,JSON.stringify(values)); } catch (_) {}
  }
  for (const [key,pair] of Object.entries(inputs)) {
    for (const input of pair) {
      input.addEventListener('input',() => {
        if (input.value === '' || !Number.isFinite(input.valueAsNumber)) return;
        values[key] = Math.round(clamp(input.valueAsNumber,0,key==='white'?100:48));
        status.textContent = '';
        apply();
      });
      input.addEventListener('change',apply);
    }
  }
  const presets = { white:{white:100,blur:28},frost:{white:45,blur:28},clear:{white:15,blur:10} };
  panel.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click',() => {
    Object.assign(values,presets[button.dataset.preset]);
    status.textContent = '';
    apply();
  }));
  panel.querySelector('[data-action=reset]').addEventListener('click',() => {
    Object.assign(values,defaults);
    apply();
    status.textContent = '已恢复默认：白色 75%，磨砂 48px。';
  });
  panel.querySelector('[data-action=copy]').addEventListener('click',async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      status.textContent = '参数已复制，可以发给我。';
    } catch (_) {
      output.focus();
      output.select();
      status.textContent = '已选中参数，按 ⌘C / Ctrl+C 复制。';
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
  apply();
})();
