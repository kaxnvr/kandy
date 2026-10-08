/**
 * 收据贴图 — 用 canvas 画出整张收据
 *
 * 贴图约定（渲染端依赖这一条，别改）：
 *   canvas 顶部 = 收据开头（logo）
 *   canvas 底部 = 收据末尾（网址） = 纸的末端
 *
 * 排版画在一个「标准坐标系」里：宽度固定 512，高度由内容决定。
 * drawReceipt() 返回内容的标准高度，渲染端拿它算两件事：
 *   1. 贴图纵向缩放 = 贴图实际像素高 / 标准高（换画质档位布局不会错位）
 *   2. 纸的世界长度 = 纸宽 × 标准高 / 512（印刷不会被拉伸）
 *
 * v5 的老做法是把标准坐标系写死成 512×4096，但这套版式只画到 y≈1780，
 * 结果贴图下面 57% 是空白 —— 而那一段恰好是纸的末端，也就是画面上
 * 一直看得到的部分。所以改成内容驱动。
 */

const REF_W = 512;

/**
 * 成品图模式：整张收据已经是一张导好的图，直接铺满贴图画布。
 * 纸的长度由图片的长宽比决定，印刷不会被拉伸。
 */
export function drawReceiptImage(ctx, img) {
  const { width: w, height: h } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
}

/** 加载成品图。失败就返回 null，调用方退回 canvas 绘制。 */
export function loadReceiptImage(url) {
  return new Promise(resolve => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = url;
  });
}

function seeded(n) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 画一次收据。
 * @param ctx      2d context；ctx.canvas 宽必须是 512
 * @param receipt  内容
 * @param opts.texH        贴图实际像素高；不给就按 1:1 画（测量用）
 * @param opts.canonicalH  标准总高；不给就是测量模式
 * @param opts.offsetY     版式整体下移多少（标准单位）—— 顶部空白引带
 * @param opts.logoImg     logo 图片
 * @returns {number} 标准坐标系里印刷部分的高度（不含引带和上下留白）
 */
export function drawReceipt(ctx, receipt, opts = {}) {
  const w = REF_W;
  const measuring = !opts.canonicalH;

  const K = measuring ? 1 : opts.texH / opts.canonicalH;
  const h = measuring ? 1 : opts.texH;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!measuring) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#FCFCFA';
    ctx.fillRect(0, 0, w, h);
    /* 纸张纵向纤维条纹 */
    for (let i = 0; i < w; i += 3) {
      ctx.fillStyle = 'rgba(20,22,26,' + (seeded(i) * 0.011).toFixed(4) + ')';
      ctx.fillRect(i, 0, 1.6, h);
    }
  }

  ctx.save();
  ctx.scale(1, K);

  const PAD = 46, IW = w - PAD * 2;

  /* offsetY = 印刷开始前的空白引带。版式本身从 TOP_PAD 起算。 */
  const startY = TOP_PAD + (opts.offsetY || 0);
  let y = startY;

  const fs = (px, fam, wt) => { ctx.font = (wt || '400') + ' ' + px + 'px ' + fam; };
  const DISPLAY = '"Space Grotesk", "Helvetica Neue", Arial, sans-serif';
  const MONO    = '"IBM Plex Mono", Menlo, Consolas, monospace';

  const dash = (yy) => {
    ctx.strokeStyle = '#C8CBC4';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(PAD, yy);
    ctx.lineTo(w - PAD, yy);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  /* ---- 抬头 ---- */
  const logoImg = opts.logoImg;
  if (logoImg) {
    const lw = IW * 0.82, lh = lw * logoImg.height / logoImg.width;
    ctx.drawImage(logoImg, (w - lw) / 2, y - lh * 0.55, lw, lh);
    y += lh * 0.55 + 90;
  } else {
    ctx.fillStyle = '#14161A';
    fs(92, DISPLAY, '700');
    ctx.textAlign = 'center';
    ctx.fillText(receipt.brand, w / 2, y);
    y += 96;
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#14161A';
  fs(30, DISPLAY);
  ctx.fillText(receipt.tagline, w / 2, y); y += 78;

  fs(20, MONO); ctx.fillStyle = '#5A6068';
  ctx.fillText('ORDER NO.', w / 2, y); y += 44;

  fs(62, DISPLAY, '700'); ctx.fillStyle = '#14161A';
  ctx.fillText(receipt.orderNo, w / 2, y); y += 40;

  fs(19, MONO); ctx.fillStyle = '#5A6068';
  ctx.fillText(receipt.date, w / 2, y); y += 84;

  dash(y); y += 52;

  /* ---- 明细表 ---- */
  ctx.textAlign = 'left';
  fs(19, MONO, '500'); ctx.fillStyle = '#5A6068';
  ctx.fillText('QTY', PAD, y);
  ctx.fillText('DESCR.', PAD + 74, y);
  ctx.textAlign = 'right';
  ctx.fillText('COST', w - PAD, y);
  y += 40;

  let sub = 0;
  for (const it of receipt.items) {
    ctx.fillStyle = '#14161A';
    fs(22, MONO);
    ctx.textAlign = 'left';
    ctx.fillText(String(it.qty), PAD, y);
    ctx.fillText(it.name, PAD + 74, y);
    ctx.textAlign = 'right';
    ctx.fillText(it.price.toFixed(2), w - PAD, y);
    sub += it.price;
    y += 40;
  }

  y += 26; dash(y); y += 54;

  /* ---- 合计 ---- */
  const tax = sub * receipt.taxRate, tot = sub + tax;
  const row = (k, v, big) => {
    fs(big ? 26 : 22, MONO, big ? '500' : '400');
    ctx.fillStyle = big ? '#14161A' : '#5A6068';
    ctx.textAlign = 'left';  ctx.fillText(k, PAD, y);
    ctx.textAlign = 'right'; ctx.fillStyle = '#14161A'; ctx.fillText(v, w - PAD, y);
    y += big ? 48 : 38;
  };
  row('SUB TOTAL', sub.toFixed(2));
  row('TAX (' + (receipt.taxRate * 100).toFixed(0) + '%)', tax.toFixed(2));
  y += 10;
  row('ORDER TOTAL', tot.toFixed(2), true);
  y += 60; dash(y); y += 70;

  /* ---- 退货条款（参考视频里这一块 + 下面那张图占了后半段的长度） ---- */
  if (receipt.watermark) {
    /* 大字淡水印，压在条款下面。参考视频里几乎看不见但确实在。 */
    ctx.save();
    ctx.globalAlpha = 0.075;
    ctx.fillStyle = '#14161A';
    ctx.textAlign = 'center';
    fs(140, DISPLAY, '700');
    ctx.fillText(receipt.brand, w / 2, y + 92);
    ctx.restore();
  }
  if (receipt.policyTitle) {
    ctx.textAlign = 'center'; ctx.fillStyle = '#14161A';
    fs(30, DISPLAY, '500');
    ctx.fillText(receipt.policyTitle, w / 2, y); y += 46;
  }
  if (receipt.policyBody && receipt.policyBody.length) {
    fs(17, MONO); ctx.fillStyle = '#5A6068'; ctx.textAlign = 'center';
    for (const line of receipt.policyBody) { ctx.fillText(line, w / 2, y); y += 27; }
    y += 44;
  }

  /* ---- 图片：参考视频里是一张内嵌的横幅照片，约 0.65 纸宽 × 0.47 纸宽 ---- */
  {
    const pw = Math.round(w * 0.65), ph = Math.round(w * 0.47);
    const px = Math.round((w - pw) / 2);
    if (opts.photoImg) {
      if (!measuring) drawCover(ctx, opts.photoImg, px, y, pw, ph);
    } else if (!measuring) {
      /* 占位色块 —— 长度和真图一致，客户塞自己的图进来就行 */
      const g2 = ctx.createLinearGradient(px, y, px + pw, y + ph);
      g2.addColorStop(0, '#C9D2D6'); g2.addColorStop(1, '#AFBAC0');
      ctx.fillStyle = g2; ctx.fillRect(px, y, pw, ph);
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      fs(18, MONO, '500'); ctx.textAlign = 'center';
      ctx.fillText('RECEIPT.photoUrl', w / 2, y + ph / 2 + 6);
    }
    y += ph + 74;
  }

  /* ---- 尾部 ---- */
  ctx.textAlign = 'center'; ctx.fillStyle = '#14161A';
  fs(34, DISPLAY, '500');
  ctx.fillText('KEEP FOR YOUR', w / 2, y); y += 58;
  fs(62, 'Georgia, serif');
  ctx.fillText('RECORDS', w / 2, y); y += 100;

  /* 条码目前是装饰性的随机条纹，扫不出东西。
     要能扫就把 drawBarcode 换成 jsbarcode 画到同一个 ctx 上。 */
  if (!measuring) drawBarcode(ctx, PAD, y, w - PAD * 2, 116);
  y += 152;

  fs(22, MONO); ctx.fillStyle = '#14161A';
  ctx.fillText(receipt.barcodeText, w / 2, y); y += 96;

  fs(19, MONO); ctx.fillStyle = '#5A6068';
  ctx.fillText(receipt.location, w / 2, y); y += 40;

  /* ★ 最后一行 = 收据末端。滚动时纸的最下面永远是这一行 */
  ctx.fillStyle = '#14161A';
  fs(24, MONO, '500');
  ctx.fillText(receipt.site, w / 2, y);

  ctx.restore();
  return y - startY;
}

/* 参考视频里 logo 上面几乎没有空白，末端也只留一点 */
const TOP_PAD = 120, BOT_PAD = 92;

/**
 * 量一遍版式，算出贴图的标准坐标系尺寸。
 * @returns {{inkH, canonicalH, offsetY}}
 *   canonicalH —— 贴图代表的标准总高，渲染端据此定纸的世界长度
 *   offsetY    —— 版式下移量（顶部空白引带）
 */
export function layoutMetrics(receipt, leader = 0.05, logoImg = null) {
  const c = document.createElement('canvas');
  c.width = REF_W; c.height = 1;
  const inkH = drawReceipt(c.getContext('2d'), receipt, { canonicalH: 0, logoImg });
  const offsetY = inkH * leader;
  return { inkH, offsetY, canonicalH: offsetY + TOP_PAD + inkH + BOT_PAD };
}

/* object-fit: cover 的等价实现 */
function drawCover(ctx, img, x, y, w, h) {
  const ar = img.width / img.height, box = w / h;
  let sw = img.width, sh = img.height, sx = 0, sy = 0;
  if (ar > box) { sw = img.height * box; sx = (img.width - sw) / 2; }
  else          { sh = img.width / box;  sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawBarcode(ctx, x, y, width, height) {
  ctx.fillStyle = '#14161A';
  let cx = x + 16, i = 0;
  const end = x + width - 3;
  while (cx < end) {
    const bw = 1.5 + seeded(i) * 5.5;
    if (i % 2 === 0) ctx.fillRect(cx, y, bw, height);
    cx += bw + 1.2;
    i++;
  }
}

/** 收据用到的字体先加载好，否则 canvas 会退回系统字体、量出来的高度也不对 */
export function ensureFonts() {
  if (!document.fonts) return Promise.resolve();
  const wanted = [
    '700 92px "Space Grotesk"',
    '500 34px "Space Grotesk"',
    '400 30px "Space Grotesk"',
    '400 22px "IBM Plex Mono"',
    '500 24px "IBM Plex Mono"'
  ];
  return Promise.all(wanted.map(f => document.fonts.load(f).catch(() => {})))
    .then(() => document.fonts.ready)
    .catch(() => {});
}

export const TEX_WIDTH = REF_W;
