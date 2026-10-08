/**
 * 收据展开动效 — 配置
 *
 * 所有可调参数集中在这里，渲染代码不硬编码任何数值。
 * 调用方可以传一个同结构的对象进去覆盖（深合并）。
 */

/* ---------------------------------------------------------------
 * 收据内容 — 数据驱动，改这里就够了，不用碰渲染代码
 * ------------------------------------------------------------- */
export const RECEIPT = {
  /* ★ 成品图。设了这个就直接拿它当纸的贴图，下面那些字段不参与绘制。
     纸的长度由图片自己的长宽比决定（这张 640×2216 → 3.46 个纸宽）。
     想回到「改价钱不用重新导图」的数据驱动模式，把这行设成 null。

     用 import.meta.url 解析 —— 相对路径会按「引用它的 HTML」算，
     页面放在 Website/ 之后就 404 了；按模块自己的位置算才跟目录无关。 */
  imageUrl: new URL('./assets/receipt-kandy.png', import.meta.url).href,

  /* 以下是数据驱动模式（imageUrl = null）用的，成品图模式下不生效 */
  brand:   'KANDy',
  logoUrl: null,
  tagline: 'THANKS FOR SHOPPING',
  orderNo: '6705',
  date:    '2026 / 07 / 29',
  site:    'KAXNIOR@GMAIL.COM',
  location:'CRAFTED IN NORTHERN CALIFORNIA',
  barcodeText: '0  15267  53669  2',
  policyTitle: null,
  policyBody: null,
  photoUrl: null,
  watermark: false,
  items: [
    { qty: 3, name: 'WOODLAND TOADSTOOLS',      price: 29.70 },
    { qty: 2, name: 'MANOR OAK BARK',           price: 25.80 },
    { qty: 4, name: 'MEADOW DAISIES',           price: 39.60 },
    { qty: 2, name: 'GARDEN SNAIL SWIRLS',      price: 39.80 },
    { qty: 1, name: "THE GARDENER'S SELECTION", price: 29.90 }
  ],
  taxRate: 0
};

/* ---------------------------------------------------------------
 * 渲染配置
 * ------------------------------------------------------------- */
export const DEFAULTS = {
  /* 几何 / 卷曲
   *
   * 没有卷芯，也没有卷筒 —— 就是一张已经印好、撕下来的收据纸，
   * 前段自己松松地卷成一个空心的筒。纸从筒的**后面**垂下来，
   * 所以印刷面在筒上是朝里的，从外面只能看到反过来的透印。
   * 这一套是照参考视频量出来的。
   */
  paper: {
    WIDTH:       1.85,   // 纸宽
    /* 'auto' = 纸长跟着收据内容走，印刷刚好铺满整张纸、不被拉伸。
       参考视频那张大约是 5.0 × 纸宽。 */
    MAXLEN:      'auto',
    CURL_R:      0.44,   // 卷曲外半径
    CURL_GAP:    0.12,   // 相邻两圈之间的径向间隙 —— 松卷，层与层不贴着
    CURL_MIN:    0.22,   // 纸能卷到的最紧半径
    CURL_WOBBLE: 0.07,   // 筒不是正圆，稍微捏扁一点
    CROSS_BOW:   0,      // 横向内凹（关掉了）
    BOW_FALL:    1.90,   // 横向内凹沿纸长衰减的距离
    START:       0.34,   // 第一帧已放出的比例 —— 开场卷约 2 圈
    AMP:         0.09,   // 摆动幅度（prefers-reduced-motion 下强制为 0）
    WAVE_1:      0.78,   // 摆动波长
    WAVE_2:      1.20
  },

  /* 贴图版式 */
  texture: {
    leader: 0.025       // 印刷开始前的空白引带，占印刷高度的比例
  },

  /* 整体姿态 */
  stage: {
    TILT:  -6.5,    // 整条纸侧倾
    YAW:  -12,      // 侧转，让人看得到筒口那个椭圆开口
    PITCH: -35.5    // 俯仰 —— 纸往后躺，看起来是从斜上方看下去
  },

  /* 相机 */
  camera: {
    FOV:     34,
    DIST:    15.5,
    FOLLOW:  2.75,   // 锁定线高低 —— 末端锁在画面 70% 处，照参考的构图
    LOOK:   -2.30,   // 构图偏移
    START_Y: 0.35,    // 锁定前相机停留高度
    mode:   'follow', // 'follow' | 'static'
    FOLLOW_ALWAYS: false, // true = 从第一帧开始持续追踪纸尾
    /* follow 相机本身仍追踪纸尾；需要把卷心钉在固定屏幕坐标时，
       再由投影补偿抵消卷心漂移。默认关闭，嵌入页面可按版式开启。 */
    PIN_CORE: false,
    PIN_X: 0,         // NDC：0 = 水平正中
    PIN_Y: 0.43,      // NDC：约为画面上方 28.5%
    DOCUMENT_ANCHOR: null, // Optional DOM selector: attach core to its bottom edge.
    ANCHOR_OFFSET: 18,     // Pixels below that edge, measured at the roll centre.
    TAIL_VIEW_Y: 0.89      // Viewport fraction for the free tail during unrolling.
  },

  /* 观感 —— 第 2 步（环境贴图 + ACES）在这里 */
  look: {
    background:      '#2E312E',
    bgGradient:      true,   // true = 用柔和径向渐变代替纯色（更接近实拍参考）
    /* true = 画布透明，背景交给页面 CSS。
       嵌进网站时画幅是 9:16、比视口窄，画布自己画背景的话
       画幅边缘会和页面底色错开一道缝；透明就没这问题。 */
    transparent:     false,
    bgGradientEdge:  0.72,    // 渐变边缘相对中心的明度倍数
    environment:     true,    // RoomEnvironment + PMREM
    envIntensity:    0.90,
    toneMapping:     true,    // ACESFilmicToneMapping
    exposure:        0.65,

    /* 关键光：正面偏左上，给纸一点方向感和高光，强度压得很低
       —— 大部分照明来自环境贴图 */
    keyIntensity:    0.78,
    keyPosition:     [-3.2, 4.6, 5.2],
    keyColor:        '#FFF6EC',

    /* 背光：纸的斜后上方。这盏是半透的主角 —— 光穿过纸，
       所以卷曲段的过渡会软下来、边缘发亮。和 transDirection 保持一致。 */
    backIntensity:   0.88,
    backPosition:    [-1.8, 3.6, -5.2],
    backColor:       '#FFF3E4',
    transDirection:  [-1.8, 3.6, -5.2]   // shader 背透项的光方向（世界坐标）
  },

  /* 纸的材质 —— 第 3 步（半透）在这里 */
  material: {
    roughness:      0.51,
    translucent:    true,
    wrap:           0.50,   // diffuse = (N·L + wrap) / (1 + wrap)
    wrapStrength:   0.85,   // wrap 相对 lambert 多出来那部分的强度
    transStrength:  0.27,   // 背透强度
    transPower:     2.0,
    transColor:     '#FFEEDC',
    /* 遮蔽 —— 筒是空心的，筒里面暗；筒又挡在垂下来那段纸的前面，
       紧挨着筒的下方有一道柔和的暗带。用解析式算，比 shadow map 便宜，
       而且这里的遮挡关系是固定的、算得准。
       （试过 shadow map：环境贴图占了大部分照明，而环境光不投影，
         所以阴影几乎看不出来，还多一遍深度 pass。）

       两项都由「整条卷曲段的总圈数」闸门控制：不足 0.35 圈完全不遮蔽。
       没有这道闸门的话，纸快放平时那个浅钩子还在压暗，
       看起来就像 logo 上蒙了一层灰膜。 */
    curlCavity:     0.72,   // 筒内腔的暗度
    curlContact:    0,      // 筒正下方那道暗带 —— 目前关着，想要就调到 0.4~0.7
    curlFall:       0.10,   // 暗带往下衰减的距离（世界单位）
    backInk:        0.38,   // 从纸背面看到的印刷内容浓度（镜像）—— 筒的外壁全靠这个

    /* 印刷深浅。1 = 和贴图一模一样，不动它就没有任何改变。
       inkDensity 整体加深，inkGamma < 1 把淡的笔画提上来（字更「实」）。 */
    inkDensity:     1.06,
    inkGamma:       0.42,
    paperTint:      '#FAFAF7'
  },

  /* 胶片颗粒 —— 第 3 步 */
  grain: {
    enabled:  true,
    opacity:  0.018,
    tile:     170,    // 噪点平铺尺寸(px)
    animate:  true,   // 8fps 抖动；reduced-motion 下自动关
    blend:    'overlay'
  },

  /* 画质档位 */
  quality: {
    tier: 'md',              // 'hi' | 'md' | 'lo'
    autoDegrade: true,
    tiers: {
      /* texW = 贴图宽度；高度按收据的长宽比算出来，横竖分辨率才一致 */
      hi: { sx: 10, sy: 340, dpr: 2,   texW: 640, wave: true,  curlFrac: 0.52 },
      md: { sx: 7,  sy: 230, dpr: 1.5, texW: 640, wave: true,  curlFrac: 0.52 },
      lo: { sx: 5,  sy: 140, dpr: 1,   texW: 480, wave: false, curlFrac: 0.52 }
    }
  },

  /* 版面 */
  layout: {
    mode: 'scroll',   // 'scroll' = 滚动驱动；'fixed' = 铺满容器，进度由 setProgress() 给
    aspect: 0.5625,   // 9:16；0 = 铺满容器
    trackHeight: '800vh',
    /* sticky 开始钉住的视口位置。它也是滚动进度 p=0 的触发线，
       所以卷心抵达这一线的同一刻才开始展开，不会先漂走再锁定。 */
    stickyTop: '0px'
  }
};

/* 深合并：只合并普通对象，数组整体替换 */
export function mergeConfig(base, patch) {
  if (!patch) return structuredClone(base);
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(patch)) {
    const a = out[k], b = patch[k];
    out[k] = (a && b && typeof a === 'object' && typeof b === 'object' &&
              !Array.isArray(a) && !Array.isArray(b))
      ? mergeConfig(a, b)
      : b;
  }
  return out;
}
