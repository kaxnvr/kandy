/**
 * 收据展开滚动动效 — 可嵌入组件
 *
 *   import { ReceiptUnroll } from './receipt/receipt-unroll.js';
 *   const ru = new ReceiptUnroll(document.getElementById('receipt-track'), { ... });
 *   ru.mount();
 *
 * 传进来的元素会被设成滚动轨道（默认 800vh），组件在里面自己建
 * sticky 容器 / canvas / 颗粒层。销毁调 ru.dispose()。
 *
 * 机制：
 *   卷曲段原地不动 · 纸往下延伸 · 相机跟着纸的末端走 · 印刷内容粘在纸上
 *
 * 场景里只有一个 mesh —— 那张收据。没有卷筒、没有卷芯、没有端盖：
 * 卷起来的那一段就是纸自己绕成的空心螺线（见 _curl / _pointAt）。
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RECEIPT, DEFAULTS, mergeConfig } from './receipt-config.js?v=receipt-art-20260918';
import { drawReceipt, drawReceiptImage, loadReceiptImage, layoutMetrics,
         ensureFonts, TEX_WIDTH } from './receipt-texture.js';
import { createPaperMaterial, updatePaperLight, setPaperTranslucency } from './paper-material.js';

const DEG = Math.PI / 180;
const TH_E = Math.PI / 2;
/* 接缝缓冲：贴着「卷曲段 → 直段」接缝的这一小段弧长里，把只存在于
   卷曲段的项（wobble、切线里的径向分量）平滑收到 0。这两项在接缝处
   都不为零，直段却是零 —— 位移和导数一起跳，接缝横在画面里时
   （比如正卡在订单号那一行）字会错位，明暗也会突变出一道假折痕。 */
const SEAM_FADE = 0.12;

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
const STYLE_ID = 'receipt-unroll-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
.ru-track{position:relative}
.ru-sticky{position:sticky;top:0;height:100vh;overflow:hidden;display:flex;
  align-items:center;justify-content:center}
/* fixed 模式：不跟滚动，铺满给它的容器，进度由 setProgress() 驱动 */
.ru-track.ru-fixed{height:100%}
.ru-track.ru-fixed .ru-sticky{position:relative;height:100%}
.ru-frame{position:relative;overflow:hidden}
.ru-canvas{display:block;width:100%;height:100%}
.ru-grain{position:absolute;inset:0;pointer-events:none;z-index:2;
  background-repeat:repeat;will-change:transform}
.ru-grain.anim{animation:ru-grain-shift .8s steps(1) infinite}
@keyframes ru-grain-shift{
  0%{transform:translate3d(0,0,0)}      12.5%{transform:translate3d(-2%,-3%,0)}
  25%{transform:translate3d(3%,1%,0)}   37.5%{transform:translate3d(-1%,2%,0)}
  50%{transform:translate3d(2%,-2%,0)}  62.5%{transform:translate3d(-3%,1%,0)}
  75%{transform:translate3d(1%,3%,0)}   87.5%{transform:translate3d(-2%,-1%,0)}
  100%{transform:translate3d(0,0,0)}}
@media (prefers-reduced-motion: reduce){.ru-grain.anim{animation:none}}
`;
  document.head.appendChild(s);
}

/* 一张平铺的噪点图，SVG feTurbulence 直接当 background */
function grainDataURI(tile) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}">` +
    `<filter id="n" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/>` +
    `</filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
  return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
}

export class ReceiptUnroll {
  constructor(track, options = {}) {
    this.track = track;
    this.cfg = mergeConfig(DEFAULTS, options.config);
    this.receipt = mergeConfig(RECEIPT, options.receipt);
    this.onQualityChange = options.onQualityChange || null;
    this.onFrame = options.onFrame || null;

    this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.ready = false;
    this.disposed = false;

    this.curlR = this.cfg.paper.CURL_R;
    this._pt = { y: 0, z: 0, ty: 0, tz: 0, r: 0, phi: 0, inCurl: 0 };
    this._tail = new THREE.Vector3();
    this._coreNdc = new THREE.Vector3();
    this._tailNdc = new THREE.Vector3();
    this._documentAnchor = this.cfg.camera.DOCUMENT_ANCHOR
      ? document.querySelector(this.cfg.camera.DOCUMENT_ANCHOR) : null;
    this._t0 = performance.now();
    this._lastP = -1;
    this._dirty = true;

    this._frames = 0;
    this._fpsLast = performance.now();
    this._lowStreak = 0;
    this._degraded = false;
    this.fps = 0;

    this._onResize = () => this._resize();
    this._visible = !('IntersectionObserver' in window);
    this._onVisibility = () => this._schedule();
    this._loop = this._loop.bind(this);
  }

  /* ============================ 生命周期 ============================ */

  mount() {
    injectStyle();
    this._buildDOM();

    const ok = this._initGL();
    if (!ok) return false;

    this._buildScene();
    this._resize();
    if (this.receipt.imageUrl) {
      loadReceiptImage(this.receipt.imageUrl).then(img => {
        if (this.disposed) return;
        if (img) {
          this._receiptImg = img;
        } else {
          this._imgFailed = true;
          console.error('[ReceiptUnroll] 成品图加载失败，退回 canvas 绘制：', this.receipt.imageUrl);
          ensureFonts().then(() => { if (!this.disposed) { this._drawTexture(); this._dirty = true; } });
        }
        this._drawTexture();
        this._lastP = -1; this._dirty = true;
      });
    } else {
      ensureFonts().then(() => {
        if (this.disposed) return;
        this._drawTexture();
        this._lastP = -1; this._dirty = true;
      });
      if (this.receipt.logoUrl) this._loadLogo(this.receipt.logoUrl);
    }

    addEventListener('resize', this._onResize);
    this.ready = true;
    // Establish document height before a deep link is positioned, even when
    // the receipt is off screen and its animation loop is correctly parked.
    this.progress();
    if ('IntersectionObserver' in window) {
      this._observer = new IntersectionObserver(entries => {
        this._visible = entries[0].isIntersecting;
        this._schedule();
      });
      this._observer.observe(this.track);
    }
    document.addEventListener('visibilitychange',this._onVisibility);
    this._schedule();
    return true;
  }

  dispose() {
    this.disposed = true;
    this.ready = false;
    cancelAnimationFrame(this._raf);
    this._observer?.disconnect();
    document.removeEventListener('visibilitychange',this._onVisibility);
    removeEventListener('resize', this._onResize);
    this.ribGeo?.dispose();
    this.paperMat?.dispose();
    this.tex?.dispose();
    this.envRT?.dispose();
    this.bgTex?.dispose();
    this.renderer?.dispose();
    this.sticky?.remove();
    this.track.classList.remove('ru-track');
  }

  _buildDOM() {
    const L = this.cfg.layout;
    this.track.classList.add('ru-track');
    if (L.mode === 'fixed') {
      this.track.classList.add('ru-fixed');
    } else if (L.trackHeight) {
      this.track.style.height = L.trackHeight;
    }

    this.sticky = document.createElement('div');
    this.sticky.className = 'ru-sticky';
    if (L.mode !== 'fixed') {
      this.sticky.style.top = typeof L.stickyTop === 'number'
        ? `${L.stickyTop}px`
        : (L.stickyTop || '0px');
    }

    this.frame = document.createElement('div');
    this.frame.className = 'ru-frame';

    this.canvasEl = document.createElement('canvas');
    this.canvasEl.className = 'ru-canvas';

    this.grainEl = document.createElement('div');
    this.grainEl.className = 'ru-grain';

    this.frame.append(this.canvasEl, this.grainEl);
    this.sticky.appendChild(this.frame);
    this.track.appendChild(this.sticky);

    this._applyGrain();
  }

  _applyGrain() {
    const g = this.cfg.grain;
    const el = this.grainEl;
    el.style.display = g.enabled ? '' : 'none';
    if (!g.enabled) return;
    el.style.backgroundImage = grainDataURI(g.tile);
    el.style.backgroundSize = g.tile + 'px ' + g.tile + 'px';
    el.style.opacity = g.opacity;
    el.style.mixBlendMode = g.blend;
    el.classList.toggle('anim', !!g.animate && !this.reduce);
  }

  /* ============================ 渲染初始化 ============================ */

  _initGL() {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvasEl,
        antialias: true,
        alpha: !!this.cfg.look.transparent,
        powerPreference: 'high-performance'
      });
    } catch (e) {
      return false;   // WebGL 不可用 → 调用方退回静态图（第 4 步做）
    }

    const tier = this._tier();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, tier.dpr));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._applyToneMapping();
    return true;
  }

  _tier() { return this.cfg.quality.tiers[this.cfg.quality.tier]; }

  _applyToneMapping() {
    const L = this.cfg.look;
    this.renderer.toneMapping = L.toneMapping
      ? THREE.ACESFilmicToneMapping
      : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = L.exposure;
    if (this.paperMat) this.paperMat.needsUpdate = true;
    this._dirty = true;
  }

  _buildScene() {
    const C = this.cfg, L = C.look, M = C.material;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(C.camera.FOV, 1, 0.1, 400);
    this.scene.add(this.camera);

    this._applyBackground();
    this._applyEnvironment();

    /* 关键光：主要负责高光方向和半透的透光方向，
       大部分照明其实来自环境贴图 */
    this.key = new THREE.DirectionalLight(new THREE.Color(L.keyColor), L.keyIntensity);
    this.key.position.set(...L.keyPosition);
    this.scene.add(this.key, this.key.target);

    /* 透光方向：纸的斜后上方。只喂给 shader 的背透项，不是真的灯。 */
    this._transDir = new THREE.Vector3(...L.transDirection);

    this.back = new THREE.DirectionalLight(new THREE.Color(L.backColor), L.backIntensity);
    this.back.position.set(...L.backPosition);
    this.scene.add(this.back);

    /* 没有环境贴图时（对照组）补一盏环境光，否则会黑成一团 */
    this.fill = new THREE.AmbientLight(0xffffff, L.environment ? 0.0 : 0.72);
    this.scene.add(this.fill);

    /* ---- 贴图 ----
       画布尺寸 = tier 的宽度 × 收据长宽比。成品图没加载完之前先按 1:3.5 起，
       图一到就按真实比例重建（_applyTexSize）。 */
    this.texCanvas = document.createElement('canvas');
    this.texCtx = this.texCanvas.getContext('2d');
    this._canonicalH = TEX_WIDTH * 3.5;
    this._applyTexSize();
    this._drawTexture();

    this.tex = new THREE.CanvasTexture(this.texCanvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;

    /* ---- 纸 ---- */
    this.paperMat = createPaperMaterial(this.tex, M);
    this.paperMat.envMapIntensity = L.envIntensity;
    this._buildGeometry();
    this.ribbon = new THREE.Mesh(this.ribGeo, this.paperMat);
    // The track observer culls the whole receipt. Its deforming geometry does
    // not need a freshly computed bounding sphere on every visible frame.
    this.ribbon.frustumCulled = false;

    /* 没有卷筒、没有卷芯、没有端盖 —— 场景里只有这一张纸 */
    this.rig = new THREE.Group();
    this.rig.add(this.ribbon);
    this.scene.add(this.rig);
  }

  _applyBackground() {
    const L = this.cfg.look;
    this.bgTex?.dispose();
    this.bgTex = null;
    if (L.transparent) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
      return;
    }
    if (!L.bgGradient) {
      this.scene.background = new THREE.Color(L.background);
      return;
    }
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    const base = new THREE.Color(L.background);
    const edge = base.clone().multiplyScalar(L.bgGradientEdge);
    const grd = g.createRadialGradient(256, 205, 40, 256, 256, 400);
    grd.addColorStop(0, '#' + base.getHexString(THREE.SRGBColorSpace));
    grd.addColorStop(1, '#' + edge.getHexString(THREE.SRGBColorSpace));
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 512);
    this.bgTex = new THREE.CanvasTexture(c);
    this.bgTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.bgTex;
  }

  _applyEnvironment() {
    const L = this.cfg.look;
    if (!L.environment) {
      this.scene.environment = null;
      if (this.fill) this.fill.intensity = 0.72;
      this._dirty = true;
      return;
    }
    if (!this.envRT) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      this.envRT = pmrem.fromScene(room, 0.04);
      room.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
      pmrem.dispose();
    }
    this.scene.environment = this.envRT.texture;
    if (this.fill) this.fill.intensity = 0.0;
    this._dirty = true;
  }

  /** 画布尺寸跟着收据的长宽比走，横竖分辨率一致 */
  _applyTexSize() {
    const maxTex = this.renderer.capabilities.maxTextureSize;
    const ratio = this._canonicalH / TEX_WIDTH;
    let w = Math.min(this._tier().texW, maxTex);
    let h = Math.round(w * ratio);
    if (h > maxTex) { h = maxTex; w = Math.round(h / ratio); }
    if (this.texCanvas.width === w && this.texCanvas.height === h) return false;
    this.texCanvas.width = w;
    this.texCanvas.height = h;
    return true;
  }

  /**
   * 重画贴图。
   * 成品图模式：整张图铺满画布，纸长 = 纸宽 × 图片长宽比。
   * 数据驱动模式：版式先量一遍拿到标准高，再按画布高缩放画进去。
   */
  _drawTexture() {
    /* 成品图模式下绝不画 canvas 版式 —— 那一版会把 RECEIPT.brand 当文字画在
       最上面，和成品图里的 logo 叠在一起（就是「logo 上面多出一个 KANDy」）。
       图还没到就先铺一张白纸，等图到了再换。 */
    if (this.receipt.imageUrl && !this._imgFailed && !this._receiptImg) {
      this._applyTexSize();
      const { width: w, height: h } = this.texCanvas;
      this.texCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.texCtx.fillStyle = '#FCFCFA';
      this.texCtx.fillRect(0, 0, w, h);
      if (this.tex) this.tex.needsUpdate = true;
      return;
    }
    if (this._receiptImg) {
      this._canonicalH = TEX_WIDTH * this._receiptImg.height / this._receiptImg.width;
      this._printLen = this.cfg.paper.WIDTH * this._canonicalH / TEX_WIDTH;
      this._applyTexSize();
      drawReceiptImage(this.texCtx, this._receiptImg);
    } else {
      const logoImg = this._logo || null;
      const m = layoutMetrics(this.receipt, this.cfg.texture.leader, logoImg);
      this._canonicalH = m.canonicalH;
      this._printLen = this.cfg.paper.WIDTH * m.canonicalH / TEX_WIDTH;
      this._applyTexSize();
      drawReceipt(this.texCtx, this.receipt, {
        texH: this.texCanvas.height, canonicalH: m.canonicalH,
        offsetY: m.offsetY, logoImg
      });
    }
    if (this.tex) { this.tex.needsUpdate = true; this.tex.needsPMREMUpdate = true; }
    this._documentSample = null;
    if (this.ready && this._documentAnchor) this.progress();
  }

  /** 纸的总长：'auto' = 跟着收据内容走 */
  _maxLen() {
    const v = this.cfg.paper.MAXLEN;
    return (v === 'auto' || v == null) ? (this._printLen || 1) : v;
  }

  _loadLogo(url) {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => { if (this.disposed) return; this._logo = im; this._drawTexture(); this._dirty = true; };
    im.src = url;
  }

  _buildGeometry() {
    const t = this._tier();
    this.SX = t.sx; this.SY = t.sy;
    this.ribGeo?.dispose();
    this.ribGeo = new THREE.BufferGeometry();
    const nv = (this.SX + 1) * (this.SY + 1);
    this.ribGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    this.ribGeo.setAttribute('normal',   new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    this.ribGeo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
    this.ribGeo.setAttribute('aOcc',     new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
    Object.values(this.ribGeo.attributes).forEach(attribute => attribute.setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let j = 0; j < this.SY; j++) {
      for (let i = 0; i < this.SX; i++) {
        const a = j * (this.SX + 1) + i, b = a + 1, c = a + (this.SX + 1), d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.ribGeo.setIndex(idx);
    if (this.ribbon) this.ribbon.geometry = this.ribGeo;
  }

  /* ============================ 数学 ============================ */

  /** 已垂下来的直段长度。p=1 时纸全部放平，卷曲段归零。 */
  _hangOf(p) {
    const P = this.cfg.paper;
    const t = P.START + (1 - P.START) * Math.max(0, Math.min(1, p));
    return this._maxLen() * Math.min(1, t);
  }

  /**
   * 卷曲段的螺线参数。
   *
   * 阿基米德螺线，层与层之间留 CURL_GAP 的空隙（松卷）：
   *   r(u) = sqrt(R² − 2·b·u)      u = 从过渡点往里量的弧长，b = GAP/2π
   *   φ(u) = (R − r(u)) / b        转过的角度
   * 外半径 R 平时就是 CURL_R；纸多到这个半径装不下时（内半径会小于
   * CURL_MIN），R 自己长大 —— 卷得越多筒越粗，和真纸一样。
   */
  _curl(curlLen) {
    const P = this.cfg.paper;
    const b = Math.max(1e-5, P.CURL_GAP / (2 * Math.PI));
    const need = 2 * b * curlLen + P.CURL_MIN * P.CURL_MIN;
    const R = Math.max(P.CURL_R, Math.sqrt(need));
    return { b, R };
  }

  /**
   * 中心线：给定弧长 s（0 = 卷在最里面的那个撕口，也就是收据开头），
   * 返回位置和单位切线。
   *
   * 纸从筒的**后面**（ψ = −90°，z = −R）垂下来 —— 参考视频里垂下来的
   * 那段是被筒挡住一截的。这样一来卷曲段的法线处处指向圆心，
   * 印刷面在筒上朝里，外面看到的就是反过来的透印。
   */
  _pointAt(s, curlLen, cg) {
    const pt = this._pt;
    if (s < curlLen) {
      const u = curlLen - s;
      const r = Math.sqrt(Math.max(cg.R * cg.R - 2 * cg.b * u, 1e-6));
      const psi = -TH_E + (cg.R - r) / cg.b;
      const cs = Math.cos(psi), sn = Math.sin(psi);
      pt.y = r * cs; pt.z = r * sn;
      /* dP/ds，b/r 是半径随弧长的变化率。这个径向分量在接缝处不为零，
         直段的切线却是纯竖直的 —— 不收掉的话法线在接缝跳 ~2.5°。
         SEAM_FADE 内把它淡出，两段的切线在接缝处就完全一致了。 */
      const k = (cg.b / r) * smoothstep(0, SEAM_FADE, u);
      let ty = k * cs + sn, tz = k * sn - cs;
      const il = 1 / Math.hypot(ty, tz);
      pt.ty = ty * il; pt.tz = tz * il;
      pt.r = r; pt.phi = (cg.R - r) / cg.b; pt.inCurl = 1;
    } else {
      pt.y = -(s - curlLen); pt.z = -cg.R;
      pt.ty = -1; pt.tz = 0;
      pt.r = cg.R; pt.phi = 0; pt.inCurl = 0;
    }
    return pt;
  }

  /**
   * 每帧重建纸带顶点。法线全部解析算出来，不用 computeVertexNormals。
   *
   * 沿法线方向的总位移 w 由三项叠加，每一项的 ∂/∂x 和 ∂/∂s 也一并算出来，
   * 这样法线始终是准的：
   *   1. wave —— 垂下来那段的长波摆动
   *   2. wobble —— 筒不是正圆，捏扁一点
   *   3. bow —— 横向微微内凹，越靠近筒越明显（纸还记得自己被卷过）
   */
  _updateRibbon(hang, curlLen, cg) {
    const P = this.cfg.paper, SX = this.SX, SY = this.SY, L = this._maxLen();
    const CAM = this.cfg.camera;
    const pos = this.ribGeo.attributes.position.array;
    const nor = this.ribGeo.attributes.normal.array;
    const uv  = this.ribGeo.attributes.uv.array;
    const occ = this.ribGeo.attributes.aOcc.array;

    const wave = this._tier().wave && !this.reduce;
    const time = wave ? (performance.now() - this._t0) * 0.0009 : 0;
    const flowWave = wave && CAM.FLOW_WIND
      ? smoothstep(0.025, 0.22, this._documentFlow || 0)
      : 0;
    const A1 = wave ? P.AMP + flowWave * (CAM.WIND_WAVE_DEPTH ?? 0.11) : 0;
    const A2 = A1 * 0.35;
    const F1 = P.WAVE_1, F2 = P.WAVE_2;
    const LAT_AMP = flowWave * (CAM.WIND_WAVE_X ?? 0.24);
    const LAT_FREQ = CAM.WIND_WAVE_FREQ ?? 1.35;
    const LAT_SPEED = CAM.WIND_WAVE_SPEED ?? 1.25;
    const WOB = P.CURL_WOBBLE, BOW = P.CROSS_BOW, FALL = Math.max(0.05, P.BOW_FALL);
    const HW = P.WIDTH * 0.5;
    const M = this.cfg.material;
    const AO_CAV = M.curlCavity, AO_CON = M.curlContact, AO_FALL = Math.max(0.05, M.curlFall);

    /* 遮蔽只有在纸真的卷成筒的时候才成立。放到最后只剩一个浅浅的钩子时，
       既没有内腔也没有东西挡在纸前面 —— 这时候还压暗，看起来就像纸上蒙了
       一层灰膜（正是卷到后半段会看到的那个「透明的东西」）。
       所以用整体圈数当闸门：不足 0.35 圈完全不遮蔽，1.1 圈以上才给满。 */
    const rIn = Math.sqrt(Math.max(cg.R * cg.R - 2 * cg.b * curlLen, 0));
    const totalTurns = cg.b > 0 ? (cg.R - rIn) / (cg.b * 2 * Math.PI) : 0;
    const encl = smoothstep(0.35, 1.10, totalTurns);
    const aoCav = AO_CAV * encl, aoCon = AO_CON * encl;

    /* 卷曲段占掉更多分段 —— 一两圈的螺线要够密才不会显出棱 */
    const CJ = Math.max(2, Math.round(SY * (this._tier().curlFrac ?? 0.5)));
    const total = curlLen + hang;
    /* Feed the paper along one continuous curved route. The tail reaches the
       turn first; the header later follows that same turn and tangent rather
       than keeping its upright pose while sliding sideways. */
    const exitFlow = this._documentAnchor && CAM.FLOW_EXIT_LEFT && !this.reduce
      ? this._documentFlow || 0 : 0;
    const bend = (CAM.FLOW_EXIT_BEND ?? 52) * DEG;
    const bendStart = L;
    const bendSpan = Math.max(0.001, L * 0.62);
    const advance = exitFlow * L * (CAM.FLOW_EXIT_TRAVEL ?? 2.8);
    let bendX = 0, bendY = 0, previousHangS = 0;
    /* Integrate the route already travelled by the header. bendY is only the
       correction to the existing downward flow, not extra layout movement.
       A fixed-size quadrature keeps this cheap and reversible on scroll. */
    const headArc = Math.min(bendSpan, Math.max(0, advance - bendStart));
    if (headArc > 0) {
      const step = headArc / 32;
      for (let n = 0; n < 32; n++) {
        const theta = bend * smoothstep(0, bendSpan, (n + 0.5) * step);
        bendX -= step * Math.sin(theta);
        bendY += step * (1 - Math.cos(theta));
      }
      const afterTurn = Math.max(0, advance - bendStart - bendSpan);
      bendX -= afterTurn * Math.sin(bend);
      bendY += afterTurn * (1 - Math.cos(bend));
    }

    for (let j = 0; j <= SY; j++) {
      const s = (j <= CJ)
        ? curlLen * (j / CJ)
        : curlLen + hang * ((j - CJ) / (SY - CJ));
      const pt = this._pointAt(s, curlLen, cg);
      const ty = pt.ty, tz = pt.tz, py = pt.y, pz = pt.z;
      const ny = tz, nz = -ty;
      const hangS = Math.max(0, s - curlLen);
      const bendT = Math.min(1, Math.max(0, (advance + hangS - bendStart) / bendSpan));
      const angle = bend * bendT * bendT * (3 - 2 * bendT);
      const angleS = bend * 6 * bendT * (1 - bendT) / bendSpan;
      const bendSin = Math.sin(angle), bendCos = Math.cos(angle);
      if (bend && hangS > previousHangS) {
        const midS = advance + (hangS + previousHangS) * 0.5;
        const midAngle = bend * smoothstep(bendStart, bendStart + bendSpan, midS);
        const ds = hangS - previousHangS;
        bendX -= ds * Math.sin(midAngle);
        bendY += ds * (1 - Math.cos(midAngle));
      }
      previousHangS = hangS;

      /* 摆动只作用在垂下来那一段，并且要缓缓起来。
         用 smoothstep 而不是线性 clamp：线性斜坡两端的导数是突变的，
         而 w 的 s 方向导数必须连续，否则法线会在斜坡尽头跳一下 ——
         纸上就会横着出现一道假折痕。 */
      const RAMP = 2.4;
      let rt = (s - curlLen) / RAMP;
      rt = rt < 0 ? 0 : (rt > 1 ? 1 : rt);
      const out  = rt * rt * (3 - 2 * rt);
      const dout = 6 * rt * (1 - rt) / RAMP;      // d(out)/ds
      const a1 = A1 * out,  a2 = A2 * out;
      const da1 = A1 * dout, da2 = A2 * dout;     // ★ 振幅本身也随 s 变，不能漏

      /* Wind wave: move each cross-section sideways by a different amount,
         so the opened sheet forms a travelling S-curve instead of swinging
         as one rigid object. The same ramp keeps the attached top steady. */
      const lp = s * LAT_FREQ - time * LAT_SPEED;
      const latWave = Math.sin(lp) + 0.32 * Math.sin(lp * 1.73 + 1.1);
      const latWaveS = LAT_FREQ * Math.cos(lp)
        + 0.32 * 1.73 * LAT_FREQ * Math.cos(lp * 1.73 + 1.1);
      const lateral = LAT_AMP * out * latWave;
      const lateralS = LAT_AMP * (dout * latWave + out * latWaveS);

      /* 筒的不圆：只在卷曲段，随转角变化。用 sin²(φ) 而不是 sin(2φ+φ₀)：
         频率同样是 2φ（椭圆压扁），但相位锁在接缝上 —— φ=0 处位移和
         导数天然双双为零，和直段（恒为零）无缝接上。任意相位的版本
         在接缝处两者都不为零，接缝横在画面里时（比如正卡在订单号那行）
         字会被顶得错位，还横着一道明暗突变的假折痕；用淡出窗口去压
         位移也不行 —— 斜率会挤进窗口里，折痕只是摊成一条窄带。 */
      const sinPhi = pt.inCurl ? Math.sin(pt.phi) : 0;
      const wob   = pt.inCurl ? WOB * pt.r * sinPhi * sinPhi : 0;
      const wob_s = pt.inCurl ? -WOB * Math.sin(2 * pt.phi) : 0;   // dφ/ds = −1/r

      /* 横向内凹：离开筒之后逐渐消失 */
      const q    = Math.max(0, s - curlLen) / FALL;
      const dec  = Math.exp(-q);
      const dec_s = (s > curlLen) ? -dec / FALL : 0;

      /* ★ v 从尾巴往上量 —— 内容粘在纸上，末端永远是 RECEIPT.site 那一行 */
      let vv = (total - s) / L;
      if (vv < 0) vv = 0; else if (vv > 1) vv = 1;

      /* 遮蔽（正面 / 背面）。卷曲段的法线朝里，所以「正面」就是朝着内腔那一侧。 */
      let oF, oB;
      if (pt.inCurl) {
        const turns = pt.phi / (2 * Math.PI);
        oF = aoCav * (1 - Math.exp(-turns / 0.30));           // 越往里越暗
        oB = aoCav * 0.85 * Math.min(1, Math.max(0, (turns - 0.85) / 1.10)); // 夹在层与层之间的才暗
      } else {
        const dy = (s - curlLen) - cg.R;                       // 离筒底还有多远
        const band = aoCon * Math.exp(-Math.max(0, dy) / AO_FALL);
        oF = band;
        oB = band * 0.45;
      }

      for (let i = 0; i <= SX; i++) {
        const u = i / SX, x = (u - 0.5) * P.WIDTH;
        const xn = x / HW;                       // −1 … 1

        const p1 = s * F1 + x * 0.85 + time;
        const p2 = s * F2 - x * 0.45 - time * 0.7;

        const w  = a1 * Math.sin(p1) + a2 * Math.sin(p2)
                 + wob + BOW * xn * xn * dec;
        const wx = a1 * 0.85 * Math.cos(p1) - a2 * 0.45 * Math.cos(p2)
                 + BOW * 2 * xn * dec / HW;
        const ws = a1 * F1 * Math.cos(p1) + a2 * F2 * Math.cos(p2)
                 + da1 * Math.sin(p1) + da2 * Math.sin(p2)
                 + wob_s + BOW * xn * xn * dec_s;

        const b1 = ty + ny * ws, b2 = tz + nz * ws;
        const e1 = ny * wx,      e2 = nz * wx;
        // Derivatives of the bent surface keep the lighting continuous too.
        const rowX = x + lateral;
        const dx = bendCos, dy = e1 - bendSin;
        const sx = -bendSin + lateralS * bendCos - rowX * bendSin * angleS;
        const sy = b1 + 1 - bendCos - lateralS * bendSin - rowX * bendCos * angleS;
        const nx = -(dy * b2 - e2 * sy);
        const nyy = dx * b2 - e2 * sx;
        const nzz = -dx * sy + dy * sx;
        const il = 1 / Math.sqrt(nx * nx + nyy * nyy + nzz * nzz);

        const k = (j * (SX + 1) + i) * 3, m = (j * (SX + 1) + i) * 2;
        pos[k] = bendX + rowX * bendCos;
        pos[k + 1] = py + ny * w + bendY - rowX * bendSin;
        pos[k + 2] = pz + nz * w;
        nor[k] = nx * il; nor[k + 1] = nyy * il; nor[k + 2] = nzz * il;
        uv[m] = u; uv[m + 1] = vv;
        occ[m] = oF; occ[m + 1] = oB;
      }
    }

    this.ribGeo.attributes.position.needsUpdate = true;
    this.ribGeo.attributes.normal.needsUpdate = true;
    this.ribGeo.attributes.uv.needsUpdate = true;
    this.ribGeo.attributes.aOcc.needsUpdate = true;
    this.ribGeo.boundingSphere = null;

    const e = this._pointAt(total, curlLen, cg);
    this._tail.set(0, e.y, e.z);
    this.rig.updateMatrixWorld(true);
    this._tail.applyMatrix4(this.rig.matrixWorld);
    return this._tail;
  }

  /* ============================ 循环 ============================ */

  progress() {
    if (this.cfg.layout.mode === 'fixed') return this._p || 0;
    if (this._documentAnchor && this.camera) return this._documentProgress();
    const r = this.track.getBoundingClientRect();
    const t = r.height - innerHeight;
    /* 展开必须和 sticky 接管发生在同一条线上。旧算法写死 r.top=0，
       页面把 sticky 放到较低的构图锚点时，卷心会先随页面移动，随后才展开，
       视觉上就是用户看到的“掉下来”。computed top 会把 vh/calc 换成 px。 */
    const stickyTop = this.sticky
      ? (parseFloat(getComputedStyle(this.sticky).top) || 0)
      : 0;
    return t <= 0 ? 0 : Math.max(0, Math.min(1, (stickyTop - r.top) / t));
  }

  /** fixed 模式下由外部驱动进度（调参窗口、时间轴、任何东西） */
  setProgress(p) {
    this._p = Math.max(0, Math.min(1, p));
    this._dirty = true;
  }

  /* A document attachment and a viewport pin are different constraints.
     Keep the roll attached to its DOM landmark. Solve the unrolled length
     so the free tail stays on its viewing line while that landmark scrolls
     upward. A page may optionally add a second, post-unroll phase in which
     the complete sheet travels down through the viewport with the scroll. */
  _documentProgress() {
    const CAM = this.cfg.camera, S = this.cfg.stage;
    const frame = this.canvasEl.getBoundingClientRect();
    if (!frame.height) return 0;
    const anchor = this._documentAnchor.getBoundingClientRect();
    const trackTop = this.track.getBoundingClientRect().top;
    const previous = this._documentSample;
    if (previous && previous.top === frame.top && previous.height === frame.height
      && previous.anchor === anchor.bottom && previous.trackTop === trackTop
      && previous.length === this._maxLen()) return previous.progress;
    const remember = progress => {
      this._documentSample = {top:frame.top,height:frame.height,anchor:anchor.bottom,
        trackTop,length:this._maxLen(),progress};
      return progress;
    };
    const rawCoreY = anchor.bottom + (CAM.ANCHOR_OFFSET || 0);
    this._dirty = true; // DOM can move even while the unroll is clamped at 0/1.
    this.rig.rotation.set(S.PITCH * DEG, S.YAW * DEG, S.TILT * DEG);
    this.rig.updateMatrixWorld(true);
    const span = p => {
      const hang = this._hangOf(p), curlLen = this._maxLen() - hang;
      const pt = this._pointAt(this._maxLen(), curlLen, this._curl(curlLen));
      this._tail.set(0, pt.y, pt.z).applyMatrix4(this.rig.matrixWorld);
      this._aimCamera(this._tail);
      this._coreNdc.setFromMatrixPosition(this.rig.matrixWorld).project(this.camera);
      this._tailNdc.copy(this._tail).project(this.camera);
      return (this._coreNdc.y - this._tailNdc.y) * frame.height / 2;
    };
    const tailViewY = innerHeight * (CAM.TAIL_VIEW_Y ?? 0.89);
    const wanted = tailViewY - rawCoreY;
    const startSpan = span(0), endSpan = span(1);
    /* After the last curl opens, rawCoreY would keep travelling upward with
       the stats landmark and clip the top of the receipt. Give the page a
       bounded runway and counter that upward motion with a larger downward
       projection shift. FLOW_SPEED=1 means one viewport pixel of scroll
       moves the finished sheet down by one pixel. */
    const flowRunway = CAM.FLOW_AFTER_UNROLL
      ? innerHeight * Math.max(0, CAM.FLOW_RUNWAY ?? 1.15)
      : 0;
    const releaseCoreY = tailViewY - endSpan;
    const flowTravel = Math.min(flowRunway,
      Math.max(0, releaseCoreY - rawCoreY));
    const flowSpeed = Math.max(0, CAM.FLOW_SPEED ?? 1);
    const coreY = rawCoreY + flowTravel * (1 + flowSpeed);
    this._documentFlow = flowRunway > 0 ? flowTravel / flowRunway : 0;
    this._documentFlowTravel = flowTravel;
    this._documentPinY = 1 - 2 * (coreY - frame.top) / frame.height;

    /* Publish the extra sticky runway separately from the base receipt
       footprint. Embedding pages can cancel only this amount with a negative
       margin, letting following content keep its original document position
       while the finished receipt floats over it as a foreground layer. */
    const flowOverlap = Math.ceil(flowRunway);
    if (this._documentFlowOverlap !== flowOverlap) {
      this._documentFlowOverlap = flowOverlap;
      this.track.style.setProperty('--ru-flow-overlap', `${flowOverlap}px`);
    }

    // The sticky element still needs the full runway even when its layout
    // footprint is visually overlapped by the embedding page.
    const needed = Math.ceil(Math.max(innerHeight,
      rawCoreY - trackTop + endSpan + 140 + flowRunway));
    if (this._documentHeight !== needed) {
      this._documentHeight = needed;
      this.track.style.height = `${needed}px`;
    }
    if (wanted <= startSpan) return remember(0);
    if (wanted >= endSpan) return remember(1);
    let lo = 0, hi = 1;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (span(mid) < wanted) lo = mid; else hi = mid;
    }
    return remember((lo + hi) / 2);
  }

  _aimCamera(tail) {
    const CAM = this.cfg.camera, follow = CAM.mode === 'follow';
    const wantY = tail.y + CAM.FOLLOW;
    const locked = follow && (CAM.FOLLOW_ALWAYS || wantY < CAM.START_Y);
    const camY = locked ? wantY : CAM.START_Y;
    const camX = follow ? tail.x * 0.85 : 0;
    const camZ = follow ? tail.z + CAM.DIST : CAM.DIST;
    this.camera.fov = CAM.FOV;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(camX, camY + CAM.LOOK, follow ? tail.z : 0);
    this.camera.updateMatrixWorld(true);
    return locked;
  }

  _inView() {
    const r = this.track.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.width > 0 && r.height > 0;
  }

  _render() {
    if (!this.ready) return;
    const p = this.progress();
    if (p !== this._lastP) { this._lastP = p; this._dirty = true; }
    if (this._tier().wave && !this.reduce) this._dirty = true;
    if (!this._dirty) return;
    this._dirty = false;

    const C = this.cfg, S = C.stage, CAM = C.camera;
    this.rig.rotation.set(S.PITCH * DEG, S.YAW * DEG, S.TILT * DEG);

    /* Every part of the paper follows the scroll-driven route in the mesh.
       The camera stays horizontally anchored; it must not slide the header. */
    const flow = this._documentFlow || 0;
    this._windMix = CAM.FLOW_WIND && !this.reduce
      ? smoothstep(0.025, 0.22, flow)
      : 0;

    const hang = this._hangOf(p);
    const curlLen = Math.max(0, this._maxLen() - hang);
    const cg = this._curl(curlLen);
    this.curlR = cg.R;
    const tail = this._updateRibbon(hang, curlLen, cg);

    const follow = CAM.mode === 'follow';
    const locked = this._aimCamera(tail);

    /* Project the roll origin onto the chosen attachment. For a document
       anchor this NDC moves with the cards; only legacy PIN_CORE is a
       constant viewport coordinate. Tail tracking uses the moving anchor. */
    if (follow && (CAM.PIN_CORE || this._documentAnchor)) {
      this._coreNdc.setFromMatrixPosition(this.rig.matrixWorld).project(this.camera);
      const pinX = Number.isFinite(CAM.PIN_X) ? CAM.PIN_X : 0;
      const pinY = (this._documentAnchor ? this._documentPinY
        : (Number.isFinite(CAM.PIN_Y) ? CAM.PIN_Y : 0.43));
      const pe = this.camera.projectionMatrix.elements;
      pe[8] += this._coreNdc.x - pinX;
      pe[9] += this._coreNdc.y - pinY;
      this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    }

    updatePaperLight(this.paperMat, this.key, this._transDir, this.camera);
    this.renderer.render(this.scene, this.camera);

    if (this.onFrame) {
      const ml = this._maxLen();
      const remPct = Math.max(0, Math.min(1, curlLen / ml));
      const turns = cg.b > 0 ? (cg.R - Math.sqrt(Math.max(cg.R * cg.R - 2 * cg.b * curlLen, 0))) / (cg.b * 2 * Math.PI) : 0;
      this.onFrame({ p, hang, curlLen, remPct, turns, radius: cg.R, locked,
        flow: this._documentFlow || 0,
        flowPx: this._documentFlowTravel || 0,
        windWave: this._windMix || 0,
        fps: this.fps });
    }
  }

  _schedule() {
    if (this.disposed || document.hidden || !this._visible) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      this._frames = 0;
      this._fpsLast = performance.now();
      if (this.grainEl) this.grainEl.style.animationPlayState = 'paused';
      return;
    }
    if (this.grainEl) this.grainEl.style.animationPlayState = 'running';
    if (!this._raf) this._raf = requestAnimationFrame(this._loop);
  }

  _loop(now) {
    this._raf = 0;
    if (this.disposed || document.hidden || !this._visible) return;
    this._schedule();
    /* 滚出可视区、或者页面在后台 → 不渲染也不统计帧率。
       后台标签页的 rAF 被浏览器压到 ~1fps，照统计会误触发降级。 */
    if (!this._observer && !this._inView()) { this._frames = 0; this._fpsLast = now; return; }

    this._frames++;
    const span = now - this._fpsLast;
    if (span >= 500) {
      /* 只有采样窗口正常、且窗口里确实跑了几帧，这次统计才算数。
         浏览器把后台/不可见页面的 rAF 压到 ~1fps，那种样本会误触发降级；
         真的只有 10fps 的机器在 500ms 里也有 5 帧，照样能采到。 */
      if (span > 1200 || this._frames < 3) {
        this._frames = 0; this._fpsLast = now; this._render(); return;
      }
      this.fps = Math.round(this._frames * 1000 / span);
      this._frames = 0; this._fpsLast = now;
      if (this.cfg.quality.autoDegrade) this._checkDegrade();
    }
    this._render();
  }

  /* 连续 2 秒低于 38fps 就降一档 */
  _checkDegrade() {
    if (this._degraded) return;
    if (this.fps < 38) this._lowStreak++; else this._lowStreak = 0;
    if (this._lowStreak < 4) return;
    this._lowStreak = 0;
    const order = ['hi', 'md', 'lo'];
    const i = order.indexOf(this.cfg.quality.tier);
    if (i < order.length - 1) {
      this.setQuality(order[i + 1], true);
    } else {
      this._degraded = true;
      this.onQualityChange?.('lo', true, true);
    }
  }

  /* ============================ 公开 API ============================ */

  setQuality(tier, auto = false) {
    if (!this.cfg.quality.tiers[tier]) return;
    this.cfg.quality.tier = tier;
    if (!auto) { this._degraded = false; this._lowStreak = 0; }
    const t = this._tier();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, t.dpr));
    if (this._applyTexSize()) this._drawTexture();
    this._buildGeometry();
    this._resize();
    this._dirty = true;
    this.onQualityChange?.(tier, auto, false);
  }

  /** 观感开关 —— 预览页的 A/B 对照用 */
  setLook(patch) {
    this.cfg.look = mergeConfig(this.cfg.look, patch);
    const L = this.cfg.look;
    if ('environment' in patch) this._applyEnvironment();
    if ('background' in patch || 'bgGradient' in patch) this._applyBackground();
    if ('toneMapping' in patch || 'exposure' in patch) this._applyToneMapping();
    if ('envIntensity' in patch) this.paperMat.envMapIntensity = L.envIntensity;
    if ('keyIntensity' in patch) this.key.intensity = L.keyIntensity;
    if ('keyPosition' in patch) this.key.position.set(...L.keyPosition);
    if ('transDirection' in patch) this._transDir.set(...L.transDirection);
    if ('backIntensity' in patch) this.back.intensity = L.backIntensity;
    if ('backPosition' in patch) this.back.position.set(...L.backPosition);
    this._dirty = true;
  }

  setMaterial(patch) {
    this.cfg.material = mergeConfig(this.cfg.material, patch);
    if ('roughness' in patch) this.paperMat.roughness = this.cfg.material.roughness;
    setPaperTranslucency(this.paperMat, this.cfg.material);
    this._lastP = -1;          // 遮蔽是烤在顶点里的，要重建一次几何
    this._dirty = true;
  }

  setGrain(patch) {
    this.cfg.grain = mergeConfig(this.cfg.grain, patch);
    this._applyGrain();
  }

  setParams(patch) {
    this._documentSample = null;
    this.cfg = mergeConfig(this.cfg, patch);
    if (patch.layout && this.cfg.layout.mode !== 'fixed' && this.sticky) {
      const top = this.cfg.layout.stickyTop;
      this.sticky.style.top = typeof top === 'number' ? `${top}px` : (top || '0px');
      if (this.cfg.layout.trackHeight) this.track.style.height = this.cfg.layout.trackHeight;
      this._resize();
    }
    this._dirty = true;
  }

  setAspect(a) {
    this.cfg.layout.aspect = a;
    this._resize();
  }

  /** 换收据内容，重画贴图 */
  setReceipt(patch) {
    this.receipt = mergeConfig(this.receipt, patch);
    this._drawTexture();
    this._dirty = true;
  }

  _resize() {
    if (!this.renderer) return;
    this._documentSample = null;
    const aw = this.sticky.clientWidth, ah = this.sticky.clientHeight;
    const A = this.cfg.layout.aspect;
    let w, h;
    if (A <= 0)                { w = aw; h = ah; }
    else if (aw / ah > A)      { h = ah; w = h * A; }
    else                       { w = aw; h = w / A; }
    w = Math.round(w); h = Math.round(h);
    this.frame.style.width = w + 'px';
    this.frame.style.height = h + 'px';
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._dirty = true;
  }
}

export { RECEIPT, DEFAULTS };
