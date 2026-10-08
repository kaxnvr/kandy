/* ═══════════════════════════════════════════════════════════════════════
   CANDY WORDMARK — the KANDy logo as real, lit, translucent geometry.

   Extracted from `Main page html/kandy-hero-3d-option2.html`, where it was
   built and tuned, so the two cannot drift apart. Nothing about how it works
   changed in the move; only the couplings became arguments.

   Why it exists: the main page draws the wordmark as a PNG on a flat plane with
   an unlit material, and that is the right call for that PNG — it is a finished
   render, and re-lighting a finished render turns its pink grey. But a flat
   unlit plane can never be reflective and can never transmit light, which is
   exactly what the reference frame asks for. The default route never touches
   the PNG's RGB. The optional referenceFrontTexture route used by the 360°
   study also admits a cleaned front projection when likeness is more important
   than relighting a single-view reference. Both routes use:

     the ALPHA      traced by marching squares into closed outlines, smoothed,
                    simplified, nested into shapes and holes, then extruded —
                    real geometry with real side walls that grass can occlude.
     the LUMINANCE  only as a shape cue for where one letter overlaps the next.
                    KANDy's letters touch, so the alpha merges them into two or
                    three blobs; without the seam the wordmark extrudes into an
                    unreadable pink slab. The sprinkles are masked out by hue
                    and inpainted away first so they do not survive as bumps.

   The colour comes from a flat candy albedo that is then lit for real.
   ═══════════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { createStartupBudget } from './startup-budget.js?v=background-2';
import { geometrySignature, imageFingerprint, fetchWordmarkGeometry, restoreWordmarkGeometry } from './wordmark-geometry-cache.js';

const TAU = Math.PI * 2;
const col = hex => new THREE.Color(hex);



function envTexture(size, blurPx, SKY, SUN_DIR){
  const w = size, h = size/2;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');

  // v = 0 is straight down, v = 1 straight up; the horizon is the middle row.
  const sky = g.createLinearGradient(0, 0, 0, h*0.5);
  sky.addColorStop(0.00, SKY.top);
  sky.addColorStop(0.42, SKY.mid);
  sky.addColorStop(1.00, SKY.low);
  g.fillStyle = sky; g.fillRect(0, 0, w, h*0.5);

  const ground = g.createLinearGradient(0, h*0.5, 0, h);
  ground.addColorStop(0.00, '#CBD9C6');    // the hazy far turf at the horizon
  ground.addColorStop(0.22, '#7FA84C');
  ground.addColorStop(0.60, '#3C7220');
  ground.addColorStop(1.00, '#1C4410');
  g.fillStyle = ground; g.fillRect(0, h*0.5, w, h*0.5);

  // Sun, placed at SUN_DIR so the specular highlight lands where the key light
  // says it should instead of somewhere merely pretty.
  const su = (Math.atan2(SUN_DIR.z, SUN_DIR.x) / TAU + 0.5) * w;
  const sv = (0.5 - Math.asin(SUN_DIR.y) / Math.PI) * h;
  const glare = g.createRadialGradient(su, sv, 0, su, sv, h*0.42);
  glare.addColorStop(0.00, 'rgba(255,252,238,1.00)');
  glare.addColorStop(0.06, 'rgba(255,247,222,0.96)');
  glare.addColorStop(0.30, 'rgba(255,238,206,0.34)');
  glare.addColorStop(1.00, 'rgba(255,238,206,0.00)');
  g.fillStyle = glare; g.fillRect(0, 0, w, h);

  // A handful of cloud smudges so the mirror layer has something to travel
  // across as the letters breathe — a perfectly smooth gradient reflection
  // reads as plastic, not as glass.
  g.globalAlpha = 0.75;
  g.fillStyle = '#FFFFFF';
  g.filter = `blur(${Math.max(2, size/60)}px)`;
  const puffs = [[0.14,0.24,0.10],[0.20,0.28,0.07],[0.62,0.18,0.12],
                 [0.68,0.24,0.08],[0.86,0.30,0.06],[0.40,0.30,0.05]];
  for (const [px,py,pr] of puffs){
    g.beginPath(); g.ellipse(px*w, py*h, pr*w, pr*h*0.9, 0, 0, TAU); g.fill();
  }
  g.filter = 'none'; g.globalAlpha = 1;

  if (blurPx > 0){
    const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
    const g2 = c2.getContext('2d');
    g2.filter = `blur(${blurPx}px)`;
    g2.drawImage(c, 0, 0);
    const t2 = new THREE.CanvasTexture(c2);
    t2.colorSpace = THREE.SRGBColorSpace;
    // No mipmaps on purpose: the equirect seam at u=0/1 has a discontinuous
    // derivative, and any mip selection based on it draws a hard vertical line
    // straight down the middle of every reflective surface.
    t2.minFilter = t2.magFilter = THREE.LinearFilter;
    t2.generateMipmaps = false;
    t2.wrapS = THREE.RepeatWrapping;
    return t2;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

const GLSL_ENV = `
  uniform sampler2D uEnvSharp, uEnvBlur;
  uniform float uEnvRot;
  vec2 equirect(vec3 d){
    // atan(0,0) is undefined in GLSL and returns NaN on some drivers. A
    // reflection vector pointing straight up hits exactly that case, and a
    // single NaN pixel is not a local defect here: the bloom pass blurs it
    // across the whole pyramid and the entire frame composites to black.
    float a = atan(d.z, d.x + 1e-8) + uEnvRot;
    return vec2(a * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  }
  vec3 envSharp(vec3 d){ return texture2D(uEnvSharp, equirect(d)).rgb; }
  vec3 envBlur (vec3 d){ return texture2D(uEnvBlur,  equirect(d)).rgb; }
`;

const MS_TABLE = [
  [], [[3,0]], [[0,1]], [[3,1]], [[1,2]], [[3,0],[1,2]], [[0,2]], [[3,2]],
  [[2,3]], [[2,0]], [[0,1],[2,3]], [[2,1]], [[1,3]], [[1,0]], [[0,3]], []
];
function traceContours(mask, W, H){
  // Edge index 0=top 1=right 2=bottom 3=left, as doubled-integer keys.
  const keyOf = (x, y, e) =>
    e===0 ? (2*y)*(2*W+2) + (2*x+1) :
    e===1 ? (2*y+1)*(2*W+2) + (2*x+2) :
    e===2 ? (2*y+2)*(2*W+2) + (2*x+1) :
            (2*y+1)*(2*W+2) + (2*x);
  const adj = new Map();
  const link = (a,b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b); adj.get(b).push(a);
  };
  const inside = (x,y) => (x<0||y<0||x>=W||y>=H) ? 0 : mask[y*W+x];
  for (let y=-1; y<H; y++){
    for (let x=-1; x<W; x++){
      const c = inside(x,y) | (inside(x+1,y)<<1) | (inside(x+1,y+1)<<2) | (inside(x,y+1)<<3);
      if (c === 0 || c === 15) continue;
      for (const [ea, eb] of MS_TABLE[c]) link(keyOf(x,y,ea), keyOf(x,y,eb));
    }
  }
  const stride = 2*W+2;
  const pt = k => [ (k % stride) * 0.5, Math.floor(k / stride) * 0.5 ];
  const seen = new Set();
  const loops = [];
  for (const start of adj.keys()){
    if (seen.has(start)) continue;
    const loop = [];
    let cur = start, prev = -1;
    while (cur !== undefined && !seen.has(cur)){
      seen.add(cur); loop.push(pt(cur));
      const nbrs = adj.get(cur);
      const next = nbrs.find(n => n !== prev && !seen.has(n));
      prev = cur; cur = next;
    }
    if (loop.length >= 6) loops.push(loop);
  }
  return loops;
}
function signedArea(p){
  let a = 0;
  for (let i=0, j=p.length-1; i<p.length; j=i++) a += (p[j][0]*p[i][1] - p[i][0]*p[j][1]);
  return a * 0.5;
}
function chaikin(p, iterations){
  for (let it=0; it<iterations; it++){
    const out = [];
    for (let i=0; i<p.length; i++){
      const a = p[i], b = p[(i+1) % p.length];
      out.push([a[0]*0.75 + b[0]*0.25, a[1]*0.75 + b[1]*0.25]);
      out.push([a[0]*0.25 + b[0]*0.75, a[1]*0.25 + b[1]*0.75]);
    }
    p = out;
  }
  return p;
}
function resampleClosed(p, spacing=1){
  if(p.length<3)return p;
  const seg=[],cum=[0];let total=0;
  for(let i=0;i<p.length;i++){
    const a=p[i],b=p[(i+1)%p.length];
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
    seg.push(len);total+=len;cum.push(total);
  }
  const count=Math.max(12,Math.round(total/spacing)),out=[];
  let edge=0;
  for(let k=0;k<count;k++){
    const d=k*total/count;
    while(edge<seg.length-1&&cum[edge+1]<d)edge++;
    const a=p[edge],b=p[(edge+1)%p.length];
    const t=seg[edge]>1e-6?(d-cum[edge])/seg[edge]:0;
    out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);
  }
  return out;
}
// ExtrudeGeometry intentionally duplicates vertices for every quad and bevel
// strip. Its stock computeVertexNormals therefore leaves a flat normal on each
// tiny side panel. Average normals by spatial position (without merging UV
// seams or material groups) so the candy reads as one polished cast surface.
function smoothNormalsByPosition(geometry, tolerance=1e-5){
  const pos=geometry.getAttribute('position');
  const tri=geometry.index;
  const faceNormals=new Float32Array(pos.count*3);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const ab=new THREE.Vector3(),ac=new THREE.Vector3(),n=new THREE.Vector3();
  const addTri=(ia,ib,ic)=>{
    a.fromBufferAttribute(pos,ia);b.fromBufferAttribute(pos,ib);c.fromBufferAttribute(pos,ic);
    ab.subVectors(b,a);ac.subVectors(c,a);n.crossVectors(ab,ac);
    for(const i of [ia,ib,ic]){faceNormals[i*3]+=n.x;faceNormals[i*3+1]+=n.y;faceNormals[i*3+2]+=n.z;}
  };
  if(tri){for(let i=0;i<tri.count;i+=3)addTri(tri.getX(i),tri.getX(i+1),tri.getX(i+2));}
  else{for(let i=0;i<pos.count;i+=3)addTri(i,i+1,i+2);}
  const buckets=new Map(),q=1/tolerance;
  for(let i=0;i<pos.count;i++){
    const key=`${Math.round(pos.getX(i)*q)},${Math.round(pos.getY(i)*q)},${Math.round(pos.getZ(i)*q)}`;
    let bucket=buckets.get(key);if(!bucket){bucket=[0,0,0,[]];buckets.set(key,bucket);}
    bucket[0]+=faceNormals[i*3];bucket[1]+=faceNormals[i*3+1];bucket[2]+=faceNormals[i*3+2];bucket[3].push(i);
  }
  const normals=new Float32Array(pos.count*3);
  for(const bucket of buckets.values()){
    n.set(bucket[0],bucket[1],bucket[2]);
    if(n.lengthSq()<1e-12)n.set(0,0,1);else n.normalize();
    for(const i of bucket[3]){normals[i*3]=n.x;normals[i*3+1]=n.y;normals[i*3+2]=n.z;}
  }
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
  geometry.attributes.normal.needsUpdate=true;
}
function rdp(p, eps){
  // Closed loop: split at the two most distant points so the recursion has
  // fixed endpoints, then simplify each half.
  const dist = (pt, a, b) => {
    const dx = b[0]-a[0], dy = b[1]-a[1];
    const L2 = dx*dx + dy*dy;
    if (L2 === 0) return Math.hypot(pt[0]-a[0], pt[1]-a[1]);
    let t = ((pt[0]-a[0])*dx + (pt[1]-a[1])*dy) / L2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(pt[0]-(a[0]+t*dx), pt[1]-(a[1]+t*dy));
  };
  const simp = (pts) => {
    if (pts.length < 3) return pts;
    let maxD = -1, idx = 0;
    for (let i=1; i<pts.length-1; i++){
      const d = dist(pts[i], pts[0], pts[pts.length-1]);
      if (d > maxD){ maxD = d; idx = i; }
    }
    if (maxD <= eps) return [pts[0], pts[pts.length-1]];
    const a = simp(pts.slice(0, idx+1)), b = simp(pts.slice(idx));
    return a.slice(0, -1).concat(b);
  };
  const half = Math.floor(p.length/2);
  const A = simp(p.slice(0, half+1));
  const B = simp(p.slice(half).concat([p[0]]));
  return A.slice(0, -1).concat(B.slice(0, -1));
}
function pointInPoly(pt, poly){
  let inside = false;
  for (let i=0, j=poly.length-1; i<poly.length; j=i++){
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) &&
        (pt[0] < (xj-xi) * (pt[1]-yi) / (yj-yi) + xi)) inside = !inside;
  }
  return inside;
}

/* ---- exact euclidean distance transform (Felzenszwalb & Huttenlocher) ----
   Used instead of a chamfer approximation because the inflation height is
   sqrt-shaped in this distance: a 3-4 chamfer's octagonal error shows up as
   faint octagonal facets running along every stroke once the surface is
   glossy. This is O(n) and runs in a few ms at this resolution. */
function edt1d(f, n, d, v, z){
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q=1; q<n; q++){
    let s;
    while (true){
      s = ((f[q] + q*q) - (f[v[k]] + v[k]*v[k])) / (2*q - 2*v[k]);
      if (s <= z[k]) k--; else break;
    }
    k++; v[k] = q; z[k] = s; z[k+1] = Infinity;
  }
  k = 0;
  for (let q=0; q<n; q++){
    while (z[k+1] < q) k++;
    d[q] = (q - v[k])*(q - v[k]) + f[v[k]];
  }
}
function edt2d(mask, W, H){
  const INF = 1e12;
  const f = new Float64Array(Math.max(W,H));
  const d = new Float64Array(Math.max(W,H));
  const v = new Int32Array(Math.max(W,H));
  const z = new Float64Array(Math.max(W,H)+1);
  const out = new Float64Array(W*H);
  for (let i=0;i<W*H;i++) out[i] = mask[i] ? INF : 0;   // seeds are the OUTSIDE
  for (let x=0;x<W;x++){
    for (let y=0;y<H;y++) f[y] = out[y*W+x];
    edt1d(f, H, d, v, z);
    for (let y=0;y<H;y++) out[y*W+x] = d[y];
  }
  for (let y=0;y<H;y++){
    for (let x=0;x<W;x++) f[x] = out[y*W+x];
    edt1d(f, W, d, v, z);
    for (let x=0;x<W;x++) out[y*W+x] = Math.sqrt(d[x]);
  }
  return out;
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2*t);
};


/* Defaults describe the reference frame's light. A host that already has its own
   sun and sky passes them in so the wordmark is lit by the same one. */
const DEFAULTS = {
  logoUrl: '../Logo/kandy-logo-1600.png',
  widthUnits: 6.0,
  sky:  { top:'#7CB1E5', mid:'#C6D9EE', low:'#E2EAED' },
  sunDir:   new THREE.Vector3(-0.30, 0.64, -0.71).normalize(),
  sunColor: 0xFFF3DC,
  // Optional, physically-inspired back-scattering for hosts that cannot use
  // Three's screen-space refraction buffer (for example, a custom DOF pass).
  // It is added only on the lit face material and uses the same distance-field
  // thickness ramp as real transmission: dense centres stay pink while the
  // thin skin warms up when the sun sits behind the candy.
  sunScatter: 0,
  sunScatterColor: 0xFFF0D5,
  // A weak second source in FRONT. It lights nothing — only the specular lobes
  // read it — and it is there because the reference's letters are visibly wet
  // on the side facing the viewer, which a key light behind them cannot do.
  fillDir:   new THREE.Vector3(-0.46, 0.60, 0.66).normalize(),
  fillColor: 0xF2F8FF,
  skyFill:   0xBFD8EE,
  // CANDY_CORE is the colour the light carries THROUGH the letter, so it is what
  // the front faces read as — not an albedo, which is why it is so much lighter
  // than the PNG's own pink.
  core: 0xFFB2CD, skin: 0xFBBCCE, deep: 0xE06A94, rim: 0xFFF0E4,
  fogColor: 0xDCE6EA, fogNear: 62, fogFar: 200,
  /* 'frosted' is the reference: smooth all over, satin rather than mirror, and
     lit from behind so the body glows. 'glossy' is the wetter original. */
  finish: 'frosted'
};

let _envSharp = null, _envBlur = null, _envKey = '';
function envPair(sky, sunDir){
  const key = sky.top + sky.mid + sky.low + sunDir.toArray().join(',');
  if (key !== _envKey){
    _envSharp = envTexture(1024, 0, sky, sunDir);
    _envBlur  = envTexture(256,  9, sky, sunDir);
    _envKey = key;
  }
  return [_envSharp, _envBlur];
}

export async function buildCandyWordmark(opts = {}){
  const prebuiltGeometry = fetchWordmarkGeometry(opts.prebuiltGeometryUrl);
  const O = { ...DEFAULTS, ...opts };
  const buildBudget = createStartupBudget(Boolean(O.cooperative));
  const LOGO_URL     = O.logoUrl;
  const LOGO_W_UNITS = O.widthUnits;
  const SUN_DIR = O.sunDir, SUN_COLOR = O.sunColor;
  const FILL_DIR = O.fillDir, FILL_COLOR = O.fillColor;
  const SKY_FILL = O.skyFill;
  const CANDY_CORE = O.core, CANDY_SKIN = O.skin, CANDY_DEEP = O.deep, CANDY_RIM = O.rim;
  const HAZE = O.fogColor, FOG_NEAR = O.fogNear, FOG_FAR = O.fogFar;
  const [ENV_SHARP, ENV_BLUR] = envPair(O.sky, SUN_DIR);
  // Frosted trades the mirror for a wide satin sheen and lets more light through
  // the body; glossy keeps the wet highlight. Everything else is shared.
  const F = O.finish === 'glossy'
    ? { mirrorMix:0.55, reflBase:0.17, reflFres:0.70, specTight:260.0, specTightAmt:1.45,
        specBroad:30.0, specBroadAmt:0.16, fillTight:190.0, fillTightAmt:1.30,
        fillBroad:22.0, fillBroadAmt:0.13, through:0.78, rimAmt:0.42 }
    // Frosted is a SOFT SHEEN, not a wash. The first attempt at it used broad
    // lobes (exponent 9-12) at 0.22-0.26 amplitude, and a broad lobe that wide
    // covers the whole surface — every letter came out a white ghost with the
    // pink barely visible under it. Frosted means the highlight is spread and
    // dim, so the exponents come up and the amplitudes come a long way down.
    : { mirrorMix:0.18, reflBase:0.10, reflFres:0.44, specTight:60.0,  specTightAmt:0.18,
        specBroad:16.0, specBroadAmt:0.07, fillTight:52.0,  fillTightAmt:0.20,
        fillBroad:14.0, fillBroadAmt:0.06, through:0.80, rimAmt:0.30 };

  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = LOGO_URL;
  });
  const MW = 700, MH = Math.round(MW * img.height / img.width);
  const c = document.createElement('canvas'); c.width = MW; c.height = MH;
  const g = c.getContext('2d', { willReadFrequently:true });
  g.drawImage(img, 0, 0, MW, MH);
  const px = g.getImageData(0, 0, MW, MH).data;
  const useReferenceFront = O.materialMode === 'physical' && Boolean(O.referenceFrontTexture);
  const useReferencePillow = useReferenceFront && Boolean(O.referencePillowGeometry);
  const cleanReferenceDecorations=useReferenceFront&&!O.preserveReferenceDecorations;

  /* --- 1. masks ------------------------------------------------------- */
  const N = MW*MH;
  const mask = new Uint8Array(N);          // 1 = inside the wordmark
  const lum  = new Float32Array(N);
  const sprk = new Uint8Array(N);          // 1 = a sprinkle, to be inpainted away
  // Keep a colour copy alongside luminance. When referenceFrontTexture is
  // enabled these channels become a decoration-free projection for the front
  // face: the original broad pink gradients remain exact. A host may either
  // keep the reference decorations in that projection or rebuild them as real
  // meshes with kandy-logo-decorations.js.
  const bodyR = cleanReferenceDecorations ? new Float32Array(N) : null;
  const bodyG = cleanReferenceDecorations ? new Float32Array(N) : null;
  const bodyB = cleanReferenceDecorations ? new Float32Array(N) : null;
  for (let i=0;i<N;i++){
    if (buildBudget.exhausted()) await buildBudget.yield();
    const r = px[i*4]/255, gg = px[i*4+1]/255, b = px[i*4+2]/255, a = px[i*4+3]/255;
    mask[i] = a > 0.5 ? 1 : 0;
    lum[i]  = 0.299*r + 0.587*gg + 0.114*b;
    if(cleanReferenceDecorations){bodyR[i]=px[i*4];bodyG[i]=px[i*4+1];bodyB[i]=px[i*4+2];}
    if (!mask[i]) continue;
    const mx = Math.max(r,gg,b), mn = Math.min(r,gg,b), dl = mx - mn;
    const sat = mx <= 0 ? 0 : dl/mx;
    let hue = 0;
    if (dl > 1e-6){
      if (mx === r)      hue = ((gg-b)/dl) % 6;
      else if (mx === gg) hue = (b-r)/dl + 2;
      else                hue = (r-gg)/dl + 4;
      hue = (hue*60 + 360) % 360;
    }
    // The letters are pink (hue ≈ 300–360 and the first few degrees past the
    // wrap) or nearly white where the highlight is. Anything else that is
    // actually saturated is a sprinkle: orange ~25°, yellow ~50°, green ~90°,
    // blue ~200°. Low-saturation pixels are never touched, which is what keeps
    // the white specular streaks on the letters intact.
    // Measured hue histogram of the saturated pixels inside the mask:
    // 84,791 at 320°, 5,794 at 300°, 2,312 at 340° — that is the pink. Then
    // 3,338 at 0–20°, 1,430 at 40°, 1,084 at 80°, 1,321 at 100°, 966 at 200°:
    // orange, yellow, green and blue sprinkles. An earlier version also called
    // 0–16° pink to be safe about the wrap and handed the orange sprinkles
    // straight through.
    const pinkish = hue >= 295;
    if (sat > 0.13 && !pinkish) sprk[i] = 1;
  }
  // The geometry-only crease detector needs a generous erase mask because a
  // decoration's desaturated contact shadow must not become a dent. The colour
  // projection uses the undilated core instead: leaving the original soft
  // shadow beneath each optional real 3D decoration anchors it to the surface
  // and avoids the large diffusion patches produced by erasing six pixels past
  // its edge.
  const bodyErase=cleanReferenceDecorations?sprk.slice():null;
  // Dilate hard. Every sprinkle is drawn with its own dark contact shadow, and
  // that shadow is DESATURATED — the hue test above cannot see it, so at three
  // passes each sprinkle survived as a dark ring, which the crease detector
  // below then read as a seam and carved into the surface as a little worm.
  // Six passes is wider than the shadow and still narrower than a stroke.
  for (let pass=0; pass<6; pass++){
    if (buildBudget.exhausted()) await buildBudget.yield();
    const nxt = sprk.slice();
    for (let y=1;y<MH-1;y++) for (let x=1;x<MW-1;x++){
      if (buildBudget.exhausted()) await buildBudget.yield();
      const i = y*MW+x;
      if (sprk[i]) continue;
      if (sprk[i-1]||sprk[i+1]||sprk[i-MW]||sprk[i+MW]) nxt[i] = 1;
    }
    sprk.set(nxt);
  }
  // Diffusion inpaint: repeatedly replace each masked pixel with the mean of
  // its unmasked-or-already-filled neighbours. Slow to converge in general,
  // but the holes here are ~20px across and 26 passes cover that comfortably.
  {
    const filled = new Uint8Array(N);
    for (let i=0;i<N;i++) filled[i] = sprk[i] ? 0 : 1;
    for (let pass=0; pass<44; pass++){
      if (buildBudget.exhausted()) await buildBudget.yield();
      const src = lum.slice(), fs = filled.slice();
      for (let y=1;y<MH-1;y++) for (let x=1;x<MW-1;x++){
        if (buildBudget.exhausted()) await buildBudget.yield();
        const i = y*MW+x;
        if (filled[i] || !mask[i]) continue;
        let s = 0, n = 0;
        for (const o of [-1, 1, -MW, MW, -MW-1, -MW+1, MW-1, MW+1]){
          if (fs[i+o] && mask[i+o]){
            s += src[i+o];
            n++;
          }
        }
        if (n){
          lum[i] = s/n;
          filled[i] = 1;
        }
      }
    }
  }
  if(cleanReferenceDecorations){
    const filled=new Uint8Array(N);
    for(let i=0;i<N;i++)filled[i]=bodyErase[i]?0:1;
    for(let pass=0;pass<28;pass++){
      if (buildBudget.exhausted()) await buildBudget.yield();
      const fs=filled.slice(),srcR=bodyR.slice(),srcG=bodyG.slice(),srcB=bodyB.slice();
      for(let y=1;y<MH-1;y++)for(let x=1;x<MW-1;x++){
        if (buildBudget.exhausted()) await buildBudget.yield();
        const i=y*MW+x;
        if(filled[i]||!mask[i])continue;
        let sr=0,sg=0,sb=0,n=0;
        for(const o of [-1,1,-MW,MW,-MW-1,-MW+1,MW-1,MW+1]){
          if(fs[i+o]&&mask[i+o]){sr+=srcR[i+o];sg+=srcG[i+o];sb+=srcB[i+o];n++;}
        }
        if(n){bodyR[i]=sr/n;bodyG[i]=sg/n;bodyB[i]=sb/n;filled[i]=1;}
      }
    }
  }

  /* --- 2. distance field and the derived channels ---------------------- */
  const sdf = edt2d(mask, MW, MH);
  // Tube radius from the field itself rather than a guess: the 88th percentile
  // of the interior distance is about the half-thickness of a normal stroke,
  // and using the maximum instead would let one fat junction flatten the rest.
  const inside = [];
  for (let i=0;i<N;i++) if (mask[i]) inside.push(sdf[i]);
  inside.sort((a,b)=>a-b);
  const R_TUBE = Math.max(6, inside[Math.floor(inside.length*0.88)]);

  // Crease map: a dark thin line inside the shape is where one letter's outline
  // was drawn over its neighbour. A box blur minus the original lights exactly
  // those up and ignores the broad shading gradient.
  const blur = new Float32Array(N);
  {
    const rad = 7, tmp = new Float32Array(N);
    for (let y=0;y<MH;y++){
      if (buildBudget.exhausted()) await buildBudget.yield();
      let acc = 0, cnt = 0;
      for (let x=-rad; x<MW; x++){
        if (buildBudget.exhausted()) await buildBudget.yield();
        if (x+rad < MW){ const i=y*MW+x+rad; if (mask[i]){ acc += lum[i]; cnt++; } }
        if (x-rad-1 >= 0){ const i=y*MW+x-rad-1; if (mask[i]){ acc -= lum[i]; cnt--; } }
        if (x >= 0) tmp[y*MW+x] = cnt ? acc/cnt : 0;
      }
    }
    for (let x=0;x<MW;x++){
      if (buildBudget.exhausted()) await buildBudget.yield();
      let acc = 0, cnt = 0;
      for (let y=-rad; y<MH; y++){
        if (buildBudget.exhausted()) await buildBudget.yield();
        if (y+rad < MH){ const i=(y+rad)*MW+x; if (mask[i]){ acc += tmp[i]; cnt++; } }
        if (y-rad-1 >= 0){ const i=(y-rad-1)*MW+x; if (mask[i]){ acc -= tmp[i]; cnt--; } }
        if (y >= 0) blur[y*MW+x] = cnt ? acc/cnt : 0;
      }
    }
  }

  // Pack: R = inflation height, G = normalised distance, B = crease, A = coverage.
  const data = new Uint8Array(N*4);
  const geomHeight = new Float32Array(N);
  for (let y=0;y<MH;y++){
    if (buildBudget.exhausted()) await buildBudget.yield();
    for (let x=0;x<MW;x++){
      if (buildBudget.exhausted()) await buildBudget.yield();
      const i = y*MW + x;
      // Flip vertically so texture v runs the same way as world y and the
      // shader's gradient does not need a sign fix it could get wrong silently.
      const o = ((MH-1-y)*MW + x) * 4;
      const dn = Math.min(sdf[i] / R_TUBE, 1);
      // The binary iso-contour lies half-way between the first inside texel and
      // the outside texel. Give that first inside ring zero height so the
      // interpolated pillow actually reaches the side wall at z=0 instead of
      // being alpha-cut while it is still floating slightly in front of it.
      const geomDn = Math.min(Math.max(sdf[i]-1,0) / Math.max(R_TUBE-1,1), 1);
      // Circular tube profile: height = sin(acos(1-d)) for a unit radius. Gives
      // a normal that swings all the way to horizontal at the outline, which is
      // what makes the rim light wrap the way it does in the reference.
      const pillow = mask[i] ? Math.sqrt(Math.max(0, 1 - (1-geomDn)*(1-geomDn))) : 0;
      // Thresholded, not linear. The raw high-pass averages 0.053 across the
      // wordmark — that floor is the PNG's painted texture and its compression
      // noise, and carving it into the surface made every letter look grubby.
      // Only a real drawn seam gets past 0.30. Sprinkle pixels are excluded
      // outright: the inpaint above removes them from the luminance, but any
      // residue at their edge would be read as a seam, and a seam is the one
      // thing this map is allowed to say.
      const rawCrease = mask[i] ? (blur[i] - lum[i]) * 5.0 : 0;
      const crease = sprk[i] ? 0 : smoothstep(0.30, 0.80, rawCrease);
      const h = Math.max(0, pillow - crease * (O.creaseDepth ?? 0.62));
      geomHeight[i] = h;
      data[o]   = Math.round(h * 255);
      data[o+1] = Math.round(dn * 255);
      data[o+2] = Math.round(crease * 255);
      data[o+3] = mask[i] ? 255 : 0;
    }
  }
  // The EDT is exact but is sampled on the square source-pixel lattice. Two
  // very light 3x3 passes remove that microscopic lattice from specular light
  // while retaining the zero-height collar and the original outline.
  for(let pass=0;pass<2;pass++){
    if (buildBudget.exhausted()) await buildBudget.yield();
    const src=geomHeight.slice();
    for(let y=1;y<MH-1;y++)for(let x=1;x<MW-1;x++){
      if (buildBudget.exhausted()) await buildBudget.yield();
      const i=y*MW+x;
      if(!mask[i]||sdf[i]<=1){geomHeight[i]=0;continue;}
      geomHeight[i]=(src[i]*4+src[i-1]+src[i+1]+src[i-MW]+src[i+MW]
        +.5*(src[i-MW-1]+src[i-MW+1]+src[i+MW-1]+src[i+MW+1]))/10;
    }
  }
  const formTex = new THREE.DataTexture(data, MW, MH, THREE.RGBAFormat);
  formTex.minFilter = THREE.LinearMipmapLinearFilter;
  formTex.magFilter = THREE.LinearFilter;
  formTex.generateMipmaps = true;
  formTex.wrapS = formTex.wrapT = THREE.ClampToEdgeWrapping;
  formTex.needsUpdate = true;

  /* --- 3. outlines → shapes -------------------------------------------- */
  const contourSmooth=O.contourSmooth ?? 2;
  const contourSpacing=O.contourSpacing ?? .9;
  const contourSimplify=O.contourSimplify ?? .42;
  let loops = traceContours(mask, MW, MH)
    // Smooth the pixel staircase before simplification, then redistribute
    // points uniformly. Equal arc-length segments prevent long flat polygons
    // beside clusters of tiny ones, which is what made the side-wall highlight
    // look faceted even though the front pillow was dense.
    .map(l => chaikin(l, contourSmooth))
    .map(l => resampleClosed(l, contourSpacing))
    .map(l => rdp(l, contourSimplify))
    .map(l => resampleClosed(l, contourSpacing))
    .filter(l => l.length >= 8 && Math.abs(signedArea(l)) > 14);
  // Biggest first, so a container is always tested before the things inside it.
  loops.sort((a,b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));

  const depth = [];
  for (let i=0;i<loops.length;i++){
    if (buildBudget.exhausted()) await buildBudget.yield();
    let d = 0;
    for (let j=0;j<i;j++) if (pointInPoly(loops[i][0], loops[j])) d++;
    depth.push(d);
  }

  const S = LOGO_W_UNITS / MW;                 // pixels → world units
  const toWorld = p => new THREE.Vector2((p[0] - MW/2) * S, (MH/2 - p[1]) * S);
  const shapes = [];
  for (let i=0;i<loops.length;i++){
    if (buildBudget.exhausted()) await buildBudget.yield();
    if (depth[i] % 2 !== 0) continue;          // odd nesting = a hole
    const sh = new THREE.Shape(loops[i].map(toWorld));
    for (let j=0;j<loops.length;j++){
      if (depth[j] !== depth[i] + 1) continue;
      if (!pointInPoly(loops[j][0], loops[i])) continue;
      sh.holes.push(new THREE.Path(loops[j].map(toWorld)));
    }
    shapes.push(sh);
  }

  /* --- 4. geometry ------------------------------------------------------ */
  // bevelSize is a little under half the tube half-width. Above that the
  // inward offset of two opposite walls crosses inside a stroke and the cap
  // folds through itself; below it the silhouette goes hard and the rim light
  // has nothing to sit on.
  const halfStroke = R_TUBE * S;
  const inflated = O.geometryMode === 'inflated';
  const geo = new THREE.ExtrudeGeometry(shapes, {
    // Inflated faces already provide almost the whole circular cross-section.
    // Their connector must therefore be a narrow waist, not the deep slab used
    // by the legacy flat-cap version.
    depth: halfStroke * (inflated ? (O.waistDepth ?? 0.22) : 1.30),
    // The pillow normal is already horizontal at its outline, so a second
    // extruded bevel makes a visible ring around the letter. In inflated mode
    // the connector is a plain narrow wall placed exactly on the contour; its
    // normal continues the pillow's curve without adding another silhouette.
    bevelEnabled: !inflated,
    bevelThickness: halfStroke * (inflated ? 0.18 : 0.42),
    bevelSize: halfStroke * (inflated ? 0 : 0.40),
    bevelOffset: 0,
    bevelSegments: inflated ? 1 : 7,
    curveSegments: O.sideCurveSegments ?? (inflated ? 4 : 12),
    steps: 1
  });
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const size = new THREE.Vector3(); bb.getSize(size);
  const ctr  = new THREE.Vector3(); bb.getCenter(ctr);
  // Centre on x/y but keep z as extruded, then push the whole thing back by
  // half its depth so the FRONT face lands on the plane the camera focuses on.
  geo.translate(-ctr.x, -ctr.y, -size.z);
  // half-extent is returned on grp.userData instead

  /* Optional real pillow surfaces. ExtrudeGeometry can round an outline, but
     its caps contain no interior vertices, so their centres can never bulge in
     actual geometry. In inflated mode a dense indexed surface follows the
     exact distance field on both faces. It meets the bevel at zero height and
     turns continuously from front to side like a cast gummy, rather than a
     flat sign with a rounded rim. Kept opt-in so existing hero variants do not
     change when this material study evolves. */
  function makePillow(front){
    const step = Math.max(1, O.inflateStep || 3);
    const xs = []; for (let x=0;x<MW;x+=step) xs.push(x); if (xs.at(-1)!==MW-1) xs.push(MW-1);
    const ys = []; for (let y=0;y<MH;y+=step) ys.push(y); if (ys.at(-1)!==MH-1) ys.push(MH-1);
    const ids = new Int32Array(xs.length*ys.length); ids.fill(-1);
    const pos = [], uv = [], idx = [];
    const lift = halfStroke * (front ? (O.frontInflate || 1.18) : (O.backInflate || 0.72));
    const baseZ = front ? 0 : -size.z;
    const fullSurface = O.materialMode === 'physical';
    for (let gy=0;gy<ys.length;gy++) for (let gx=0;gx<xs.length;gx++){
      const x=xs[gx], y=ys[gy], i=y*MW+x;
      if (!fullSurface && !mask[i]) continue;
      const h=mask[i]?geomHeight[i]:0;
      const id=pos.length/3; ids[gy*xs.length+gx]=id;
      pos.push((x-MW/2)*S-ctr.x,(MH/2-y)*S-ctr.y,baseZ+(front?1:-1)*h*lift);
      // DataTexture texel centres are (n+.5)/size. The old x/(size-1)
      // mapping was half a texel out at both ends, so its alpha boundary could
      // never sit exactly on the marching-squares side contour.
      uv.push((x+.5)/MW,1-(y+.5)/MH);
    }
    const addCell=(corners)=>{
      const present=corners.filter(c=>c.id>=0); if(present.length<3)return;
      const cx=present.reduce((s,c)=>s+c.x,0)/present.length;
      const cy=present.reduce((s,c)=>s+c.y,0)/present.length;
      present.sort((a,b)=>Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx));
      for(let k=1;k<present.length-1;k++){
        const tri=[present[0].id,present[k].id,present[k+1].id];
        if(front) idx.push(...tri); else idx.push(tri[0],tri[2],tri[1]);
      }
    };
    for(let gy=0;gy<ys.length-1;gy++) for(let gx=0;gx<xs.length-1;gx++){
      const w=xs.length;
      addCell([
        {id:ids[gy*w+gx],x:xs[gx],y:-ys[gy]},
        {id:ids[gy*w+gx+1],x:xs[gx+1],y:-ys[gy]},
        {id:ids[(gy+1)*w+gx+1],x:xs[gx+1],y:-ys[gy+1]},
        {id:ids[(gy+1)*w+gx],x:xs[gx],y:-ys[gy+1]}
      ]);
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }

  function makeReferenceCap(front){
    const cap=new THREE.ShapeGeometry(shapes,O.sideCurveSegments ?? 12);
    const pos=cap.getAttribute('position');
    const uv=new Float32Array(pos.count*2);
    for(let i=0;i<pos.count;i++){
      const wx=pos.getX(i),wy=pos.getY(i);
      uv[i*2]=wx/LOGO_W_UNITS+.5;
      uv[i*2+1]=wy/(LOGO_W_UNITS*MH/MW)+.5;
      pos.setXYZ(i,wx-ctr.x,wy-ctr.y,front?0:-size.z);
    }
    cap.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    if(!front){
      const indices=cap.index.array;
      for(let i=0;i<indices.length;i+=3){const b=indices[i+1];indices[i+1]=indices[i+2];indices[i+2]=b;}
      const normal=cap.getAttribute('normal');
      for(let i=0;i<normal.count;i++)normal.setXYZ(i,0,0,-1);
      cap.index.needsUpdate=true;normal.needsUpdate=true;
    }
    cap.computeBoundingSphere();
    return cap;
  }

  function makeSmoothSideWall(){
    const pos=[],idx=[];
    for(let li=0;li<loops.length;li++){
      let ring=loops[li].map(toWorld).map(p=>[p.x-ctr.x,p.y-ctr.y]);
      if(ring.length<3)continue;
      const area=signedArea(ring);
      const outer=depth[li]%2===0;
      // Outer rings run CCW in world xy; holes run CW. With the winding below
      // that points every side normal away from the candy volume.
      if((outer&&area<0)||(!outer&&area>0))ring=ring.reverse();
      const outlinePad=(O.sideOutlineOverlapPx ?? 0)*S;
      const normals=ring.map((p,i,src)=>{
        const prev=src[(i-1+src.length)%src.length],next=src[(i+1)%src.length];
        const tx=next[0]-prev[0],ty=next[1]-prev[1],len=Math.hypot(tx,ty)||1;
        // Oriented outer/inner rings both use the right-hand planar normal as
        // the direction away from the candy volume.
        return [ty/len,-tx/len];
      });
      const frontZ=halfStroke*(O.sideFrontOverlap ?? 0);
      const base=pos.length/3;
      const profileSegments=useReferenceFront?(O.sideProfileSegments ?? 8):1;
      const bulge=(useReferenceFront?(O.sideBulgePx ?? .62):0)*S;
      for(let s=0;s<=profileSegments;s++){
        const t=s/profileSegments;
        const extra=Math.sin(Math.PI*t)*bulge;
        const pad=outlinePad+extra;
        const z=THREE.MathUtils.lerp(frontZ,-size.z,t);
        for(let i=0;i<ring.length;i++)pos.push(ring[i][0]+normals[i][0]*pad,ring[i][1]+normals[i][1]*pad,z);
      }
      for(let s=0;s<profileSegments;s++)for(let i=0;i<ring.length;i++){
        const j=(i+1)%ring.length;
        const a=base+s*ring.length+i,b=base+(s+1)*ring.length+i;
        const c=base+s*ring.length+j,d=base+(s+1)*ring.length+j;
        idx.push(a,b,c,c,b,d);
      }
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    g.setIndex(idx);g.computeVertexNormals();g.computeBoundingSphere();
    return g;
  }

  /* Build the inflated logo as one indexed, closed surface.  The previous
     study used three independently sampled meshes (front pillow, connector
     wall and rear pillow).  They could overlap, but they could never share a
     normal or an edge, so an oblique view exposed the join as stacked strips.

     This route triangulates each traced 2D island once, refines that cap so the
     distance-field swell has real interior vertices, duplicates it for the
     rear, and connects the cap boundary with shared profile rings.  Front,
     wall and rear may still use different material groups, but geometrically
     they are one watertight BufferGeometry. */
  function makeUnifiedInflatedBody(){
    const positions=[];
    const uvs=[];
    const frontIndices=[];
    const sideIndices=[];
    const backIndices=[];
    const contourStep=Math.max(.7,O.unifiedContourSpacingPx ?? 1.35);
    const bodyLoops=loops.map(loop=>resampleClosed(loop,contourStep));
    const capSubdivisions=THREE.MathUtils.clamp(Math.round(O.unifiedCapSubdivisions ?? 2),0,3);
    const profileSegments=Math.max(6,Math.round(O.unifiedProfileSegments ?? 18));
    const sideBulge=(O.unifiedSideBulgePx ?? O.sideBulgePx ?? .68)*S;
    const frontLift=halfStroke*(O.frontInflate ?? 1.18);
    const backLift=halfStroke*(O.backInflate ?? .72);
    let boundaryLoopCount=0;

    const sampleField=(field,pxX,pxY)=>{
      const x=THREE.MathUtils.clamp(pxX,0,MW-1);
      const y=THREE.MathUtils.clamp(pxY,0,MH-1);
      const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(MW-1,x0+1),y1=Math.min(MH-1,y0+1);
      const tx=x-x0,ty=y-y0;
      const a=field[y0*MW+x0]*(1-tx)+field[y0*MW+x1]*tx;
      const b=field[y1*MW+x0]*(1-tx)+field[y1*MW+x1]*tx;
      return a*(1-ty)+b*ty;
    };
    const worldToPixel=(x,y)=>[
      (x+ctr.x)/S+MW/2,
      MH/2-(y+ctr.y)/S
    ];
    const heightAt=(x,y)=>{
      const [pxX,pxY]=worldToPixel(x,y);
      return sampleField(geomHeight,pxX,pxY);
    };
    const uvAt=(x,y)=>{
      const [pxX,pxY]=worldToPixel(x,y);
      return [(pxX+.5)/MW,1-(pxY+.5)/MH];
    };
    const edgeKey=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;

    for(let outerIndex=0;outerIndex<bodyLoops.length;outerIndex++){
      if(depth[outerIndex]%2!==0)continue;
      const contour=bodyLoops[outerIndex].map(toWorld).map(p=>new THREE.Vector2(p.x-ctr.x,p.y-ctr.y));
      const holes=[];
      for(let holeIndex=0;holeIndex<bodyLoops.length;holeIndex++){
        if(depth[holeIndex]!==depth[outerIndex]+1)continue;
        if(!pointInPoly(bodyLoops[holeIndex][0],bodyLoops[outerIndex]))continue;
        holes.push(bodyLoops[holeIndex].map(toWorld).map(p=>new THREE.Vector2(p.x-ctr.x,p.y-ctr.y)));
      }
      const localVertices=contour.concat(...holes).map(p=>[p.x,p.y]);
      let localTriangles=THREE.ShapeUtils.triangulateShape(contour,holes).map(face=>{
        const tri=[face[0],face[1],face[2]];
        const a=localVertices[tri[0]],b=localVertices[tri[1]],c=localVertices[tri[2]];
        const cross=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
        if(cross<0)[tri[1],tri[2]]=[tri[2],tri[1]];
        return tri;
      });

      // Earcut only gives boundary vertices. Repeated 4-way subdivision adds
      // the interior samples needed for a broad pillow swell. A per-level
      // midpoint cache keeps adjacent triangles conforming (no T-junctions).
      for(let level=0;level<capSubdivisions;level++){
        const midpointCache=new Map();
        const midpoint=(a,b)=>{
          const key=edgeKey(a,b);
          if(midpointCache.has(key))return midpointCache.get(key);
          const va=localVertices[a],vb=localVertices[b];
          const id=localVertices.length;
          localVertices.push([(va[0]+vb[0])*.5,(va[1]+vb[1])*.5]);
          midpointCache.set(key,id);
          return id;
        };
        const refined=[];
        for(const [a,b,c] of localTriangles){
          const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);
          refined.push([a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]);
        }
        localTriangles=refined;
      }

      // An oriented cap triangle exposes its boundary direction. Edges seen
      // once form the outer contour and holes; interior edges are seen twice.
      const edgeUse=new Map();
      for(const tri of localTriangles){
        for(const [a,b] of [[tri[0],tri[1]],[tri[1],tri[2]],[tri[2],tri[0]]]){
          const key=edgeKey(a,b);
          const entry=edgeUse.get(key);
          if(entry)entry.count++;
          else edgeUse.set(key,{count:1,a,b});
        }
      }
      const boundaryEdges=[...edgeUse.values()].filter(edge=>edge.count===1);
      const nextByVertex=new Map(boundaryEdges.map(edge=>[edge.a,edge.b]));
      const visitedEdges=new Set();
      const boundaryLoops=[];
      for(const edge of boundaryEdges){
        const firstKey=`${edge.a}:${edge.b}`;
        if(visitedEdges.has(firstKey))continue;
        const loop=[];
        const start=edge.a;
        let current=start;
        for(let guard=0;guard<=boundaryEdges.length;guard++){
          const next=nextByVertex.get(current);
          if(next===undefined)break;
          const directedKey=`${current}:${next}`;
          if(visitedEdges.has(directedKey))break;
          visitedEdges.add(directedKey);
          loop.push(current);
          current=next;
          if(current===start)break;
        }
        if(loop.length>=3)boundaryLoops.push(loop);
      }
      boundaryLoopCount+=boundaryLoops.length;

      const frontVertexIds=[];
      const backVertexIds=[];
      for(const [x,y] of localVertices){
        const [u,v]=uvAt(x,y);
        frontVertexIds.push(positions.length/3);
        positions.push(x,y,heightAt(x,y)*frontLift);
        uvs.push(u,v);
        backVertexIds.push(positions.length/3);
        positions.push(x,y,-size.z-heightAt(x,y)*backLift);
        uvs.push(u,v);
      }
      for(const [a,b,c] of localTriangles){
        frontIndices.push(frontVertexIds[a],frontVertexIds[b],frontVertexIds[c]);
        backIndices.push(backVertexIds[a],backVertexIds[c],backVertexIds[b]);
      }

      for(const loop of boundaryLoops){
        const normals=loop.map((id,index)=>{
          const prev=localVertices[loop[(index-1+loop.length)%loop.length]];
          const next=localVertices[loop[(index+1)%loop.length]];
          const tx=next[0]-prev[0],ty=next[1]-prev[1],len=Math.hypot(tx,ty)||1;
          // The directed boundary is CCW for an outer contour and CW for a
          // hole. The right-hand planar normal points out of the solid in both.
          return [ty/len,-tx/len];
        });
        const rings=[];
        rings.push(loop.map(id=>frontVertexIds[id]));
        for(let segment=1;segment<profileSegments;segment++){
          const t=segment/profileSegments;
          const z=THREE.MathUtils.lerp(0,-size.z,t);
          const pad=Math.sin(Math.PI*t)*sideBulge;
          rings.push(loop.map((id,index)=>{
            const [x,y]=localVertices[id];
            const [nx,ny]=normals[index];
            const wx=x+nx*pad,wy=y+ny*pad;
            const [u,v]=uvAt(wx,wy);
            const vertexId=positions.length/3;
            positions.push(wx,wy,z);
            uvs.push(u,v);
            return vertexId;
          }));
        }
        rings.push(loop.map(id=>backVertexIds[id]));
        for(let segment=0;segment<rings.length-1;segment++){
          const ringA=rings[segment],ringB=rings[segment+1];
          for(let index=0;index<loop.length;index++){
            const next=(index+1)%loop.length;
            const a=ringA[index],b=ringB[index],c=ringA[next],d=ringB[next];
            sideIndices.push(a,b,c,c,b,d);
          }
        }
      }
    }

    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    const allIndices=[...frontIndices,...sideIndices,...backIndices];
    geometry.setIndex(allIndices);
    geometry.clearGroups();
    geometry.addGroup(0,frontIndices.length,0);
    geometry.addGroup(frontIndices.length,sideIndices.length,1);
    geometry.addGroup(frontIndices.length+sideIndices.length,backIndices.length,2);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.closedSurface=true;
    geometry.userData.boundaryLoopCount=boundaryLoopCount;
    geometry.userData.capSubdivisions=capSubdivisions;
    const manifoldEdges=new Map();
    for(let i=0;i<allIndices.length;i+=3){
      const a=allIndices[i],b=allIndices[i+1],c=allIndices[i+2];
      for(const [x,y] of [[a,b],[b,c],[c,a]]){
        const key=edgeKey(x,y);
        manifoldEdges.set(key,(manifoldEdges.get(key)||0)+1);
      }
    }
    let openEdgeCount=0,nonManifoldEdgeCount=0;
    for(const count of manifoldEdges.values()){
      if(count===1)openEdgeCount++;
      else if(count!==2)nonManifoldEdgeCount++;
    }
    geometry.userData.openEdgeCount=openEdgeCount;
    geometry.userData.nonManifoldEdgeCount=nonManifoldEdgeCount;
    if(openEdgeCount||nonManifoldEdgeCount){
      throw new Error(`KANDy unified body is not watertight: ${openEdgeCount} open / ${nonManifoldEdgeCount} non-manifold edges`);
    }
    return geometry;
  }

  /* The wordmark alpha is allowed to touch itself where hand-drawn letters
     overlap. A global polygon triangulator can legally return a manifold mesh
     for that outline while still bridging transparent regions with enormous
     cap triangles. Extracting the zero-set of the signed distance volume keeps
     every triangle local to one grid cell, so those cross-letter ribbons are
     impossible by construction. */
  async function makeImplicitInflatedBody(){
    const inverseMask=new Uint8Array(N);
    for(let i=0;i<N;i++)inverseMask[i]=mask[i]?0:1;
    const outsideDistance=edt2d(inverseMask,MW,MH);
    const rawSignedDistance=new Float32Array(N);
    for(let i=0;i<N;i++){
      if (buildBudget.exhausted()) await buildBudget.yield();
      rawSignedDistance[i]=mask[i]
        ?Math.max(.5,sdf[i]-.5)
        :-Math.max(.5,outsideDistance[i]-.5);
    }
    // EDT values inherit one-pixel changes from the alpha mask. At a grazing
    // angle those tiny changes become repeated highlight bands. Blur the
    // signed-distance magnitudes with a separable binomial kernel, then
    // keep the blur sub-pixel and sign-aware so counters remain intact while
    // the zero contour can move continuously instead of snapping back to the
    // binary alpha grid.
    const sdfSmoothPasses=THREE.MathUtils.clamp(Math.round(O.unifiedSdfSmoothPasses ?? 2),0,4);
    const sdfSmoothStrength=THREE.MathUtils.clamp(O.unifiedSdfSmoothStrength ?? .86,0,1);
    let filteredSigned=rawSignedDistance.slice();
    const blurTemp=new Float32Array(N);
    for(let pass=0;pass<sdfSmoothPasses;pass++){
      if (buildBudget.exhausted()) await buildBudget.yield();
      for(let y=0;y<MH;y++)for(let x=0;x<MW;x++){
        if (buildBudget.exhausted()) await buildBudget.yield();
        const left=filteredSigned[y*MW+Math.max(0,x-1)];
        const centre=filteredSigned[y*MW+x];
        const right=filteredSigned[y*MW+Math.min(MW-1,x+1)];
        blurTemp[y*MW+x]=(left+centre*2+right)*.25;
      }
      const next=new Float32Array(N);
      for(let y=0;y<MH;y++)for(let x=0;x<MW;x++){
        if (buildBudget.exhausted()) await buildBudget.yield();
        const top=blurTemp[Math.max(0,y-1)*MW+x];
        const centre=blurTemp[y*MW+x];
        const bottom=blurTemp[Math.min(MH-1,y+1)*MW+x];
        next[y*MW+x]=(top+centre*2+bottom)*.25;
      }
      filteredSigned=next;
    }
    const signedDistance=new Float32Array(N);
    for(let i=0;i<N;i++){
      if (buildBudget.exhausted()) await buildBudget.yield();
      const blended=THREE.MathUtils.lerp(rawSignedDistance[i],filteredSigned[i],sdfSmoothStrength);
      signedDistance[i]=blended;
    }
    const sampleSigned=(pxX,pxY)=>{
      const x=THREE.MathUtils.clamp(pxX,0,MW-1);
      const y=THREE.MathUtils.clamp(pxY,0,MH-1);
      const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(MW-1,x0+1),y1=Math.min(MH-1,y0+1);
      const tx=x-x0,ty=y-y0;
      const a=signedDistance[y0*MW+x0]*(1-tx)+signedDistance[y0*MW+x1]*tx;
      const b=signedDistance[y1*MW+x0]*(1-tx)+signedDistance[y1*MW+x1]*tx;
      return a*(1-ty)+b*ty;
    };
    const xyStep=THREE.MathUtils.clamp(O.unifiedVoxelStepPx ?? 2.2,1.5,5);
    const pad=xyStep*2;
    const nx=Math.ceil((MW+pad*2)/xyStep)+1;
    const ny=Math.ceil((MH+pad*2)/xyStep)+1;
    const depthSegments=Math.max(24,Math.round(O.unifiedDepthSegments ?? 42));
    const frontLift=halfStroke*(O.frontInflate ?? 1.18);
    const backLift=halfStroke*(O.backInflate ?? .72);
    const zPad=halfStroke*.16;
    const zMin=-size.z-backLift-zPad;
    const zMax=frontLift+zPad;
    const nz=depthSegments+1;
    const pxAt=x=>-pad+x*(MW+pad*2)/(nx-1);
    const pyAt=y=>-pad+y*(MH+pad*2)/(ny-1);
    const zAt=z=>zMin+z*(zMax-zMin)/(nz-1);
    const worldX=pxX=>(pxX-MW/2)*S-ctr.x;
    const worldY=pxY=>(MH/2-pxY)*S-ctr.y;
    const scalar=new Float32Array(nx*ny*nz);
    const gridIndex=(x,y,z)=>(z*ny+y)*nx+x;
    const surfaceBlend=THREE.MathUtils.clamp(
      O.unifiedSurfaceBlend ?? xyStep*S*.76,
      0,
      halfStroke*.18
    );
    const smoothMin=(a,b,k)=>{
      if(k<=1e-8)return Math.min(a,b);
      const h=THREE.MathUtils.clamp(.5+.5*(b-a)/k,0,1);
      return THREE.MathUtils.lerp(b,a,h)-k*h*(1-h);
    };
    for(let z=0;z<nz;z++){
      if (buildBudget.exhausted()) await buildBudget.yield();
      const wz=zAt(z);
      for(let y=0;y<ny;y++){
        if (buildBudget.exhausted()) await buildBudget.yield();
        const py=pyAt(y);
        for(let x=0;x<nx;x++){
          if (buildBudget.exhausted()) await buildBudget.yield();
          const pxX=pxAt(x);
          const signedPx=(pxX<0||py<0||pxX>MW-1||py>MH-1)
            ?-Math.hypot(Math.max(-pxX,pxX-(MW-1),0),Math.max(-py,py-(MH-1),0))-.5
            :sampleSigned(pxX,py);
          const dn=THREE.MathUtils.clamp(signedPx/Math.max(R_TUBE,1),0,1);
          const pillow=Math.sqrt(Math.max(0,1-(1-dn)*(1-dn)));
          const frontZ=frontLift*pillow;
          const backZ=-size.z-backLift*pillow;
          // Positive means inside the candy. The tiny bias avoids an iso point
          // landing exactly on a grid corner, which would create zero-area
          // tetrahedron intersections and duplicate non-manifold vertices.
          const sideField=signedPx*S;
          const frontField=frontZ-wz;
          const backField=wz-backZ;
          scalar[gridIndex(x,y,z)]=smoothMin(smoothMin(sideField,frontField,surfaceBlend),backField,surfaceBlend)-1e-5;
        }
      }
    }

    /* Surface Nets places one shared vertex in every active voxel and makes
       one quad around every sign-changing grid edge. Unlike independently
       intersected tetrahedron edges, adjacent cells cannot create coincident
       but differently indexed seams when browsers decode antialiased alpha a
       fraction differently. The result is compact, watertight and especially
       stable under the grazing highlights that expose the candy's side. */
    const buildSurfaceNetGeometry=async()=>{
      const netPositions=[];
      const netUvs=[];
      const netFrontIndices=[];
      const netSideIndices=[];
      const netBackIndices=[];
      const cellNx=nx-1,cellNy=ny-1,cellNz=nz-1;
      const cellVertices=new Int32Array(cellNx*cellNy*cellNz);
      cellVertices.fill(-1);
      const cellIndex=(x,y,z)=>(z*cellNy+y)*cellNx+x;
      const cubeEdges=[
        [0,1],[1,2],[2,3],[3,0],
        [4,5],[5,6],[6,7],[7,4],
        [0,4],[1,5],[2,6],[3,7]
      ];
      const cubeOffsets=[
        [0,0,0],[1,0,0],[1,1,0],[0,1,0],
        [0,0,1],[1,0,1],[1,1,1],[0,1,1]
      ];
      const gridPoint=(x,y,z)=>[worldX(pxAt(x)),worldY(pyAt(y)),zAt(z)];
      let activeCells=0,maxTriangleEdge=0;

      for(let z=0;z<cellNz;z++)for(let y=0;y<cellNy;y++)for(let x=0;x<cellNx;x++){
        if (buildBudget.exhausted()) await buildBudget.yield();
        const corners=cubeOffsets.map(([ox,oy,oz])=>gridIndex(x+ox,y+oy,z+oz));
        let insideCount=0;
        for(const id of corners)if(scalar[id]>0)insideCount++;
        if(insideCount===0||insideCount===8)continue;
        let sx=0,sy=0,sz=0,crossings=0;
        for(const [ca,cb] of cubeEdges){
          const a=corners[ca],b=corners[cb];
          const va=scalar[a],vb=scalar[b];
          if((va>0)===(vb>0))continue;
          const denominator=va-vb;
          const t=Math.abs(denominator)>1e-12?THREE.MathUtils.clamp(va/denominator,0,1):.5;
          const [aox,aoy,aoz]=cubeOffsets[ca];
          const [box,boy,boz]=cubeOffsets[cb];
          const pa=gridPoint(x+aox,y+aoy,z+aoz);
          const pb=gridPoint(x+box,y+boy,z+boz);
          sx+=THREE.MathUtils.lerp(pa[0],pb[0],t);
          sy+=THREE.MathUtils.lerp(pa[1],pb[1],t);
          sz+=THREE.MathUtils.lerp(pa[2],pb[2],t);
          crossings++;
        }
        if(!crossings)continue;
        const wx=sx/crossings,wy=sy/crossings,wz=sz/crossings;
        const id=netPositions.length/3;
        netPositions.push(wx,wy,wz);
        const pxX=(wx+ctr.x)/S+MW/2;
        const pxY=MH/2-(wy+ctr.y)/S;
        netUvs.push((pxX+.5)/MW,1-(pxY+.5)/MH);
        cellVertices[cellIndex(x,y,z)]=id;
        activeCells++;
      }

      const tempA=new THREE.Vector3(),tempB=new THREE.Vector3(),tempC=new THREE.Vector3();
      const ab=new THREE.Vector3(),ac=new THREE.Vector3(),faceNormal=new THREE.Vector3();
      const emitNetTriangle=(a,b,c,outward)=>{
        if(a<0||b<0||c<0||a===b||b===c||c===a)return;
        tempA.fromArray(netPositions,a*3);
        tempB.fromArray(netPositions,b*3);
        tempC.fromArray(netPositions,c*3);
        ab.subVectors(tempB,tempA);ac.subVectors(tempC,tempA);
        faceNormal.crossVectors(ab,ac);
        if(faceNormal.lengthSq()<1e-16)return;
        const flip=faceNormal.dot(outward)<0;
        if(flip)[b,c]=[c,b];
        maxTriangleEdge=Math.max(maxTriangleEdge,tempA.distanceTo(tempB),tempB.distanceTo(tempC),tempC.distanceTo(tempA));
        const nzFace=faceNormal.normalize().z*(flip?-1:1);
        if(nzFace>.34)netFrontIndices.push(a,b,c);
        else if(nzFace<-.34)netBackIndices.push(a,b,c);
        else netSideIndices.push(a,b,c);
      };
      const emitNetQuad=(ids,outward)=>{
        if(ids.some(id=>id<0))return;
        const [a,b,c,d]=ids;
        tempA.fromArray(netPositions,a*3);tempB.fromArray(netPositions,b*3);
        tempC.fromArray(netPositions,c*3);
        const diagonalAC=tempA.distanceTo(tempC);
        tempA.fromArray(netPositions,b*3);tempC.fromArray(netPositions,d*3);
        const diagonalBD=tempA.distanceTo(tempC);
        if(diagonalAC<=diagonalBD){
          emitNetTriangle(a,b,c,outward);emitNetTriangle(a,c,d,outward);
        }else{
          emitNetTriangle(a,b,d,outward);emitNetTriangle(b,c,d,outward);
        }
      };
      const outwardAlong=(x0,y0,z0,x1,y1,z1)=>{
        const a=gridIndex(x0,y0,z0),b=gridIndex(x1,y1,z1);
        const pa=gridPoint(x0,y0,z0),pb=gridPoint(x1,y1,z1);
        const direction=new THREE.Vector3(pb[0]-pa[0],pb[1]-pa[1],pb[2]-pa[2]).normalize();
        if(scalar[a]<=0)direction.negate();
        return direction;
      };

      // X-directed grid edges; the surrounding cell cycle has +X winding in
      // grid coordinates. emitNetTriangle corrects it in world coordinates.
      for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++)for(let x=0;x<nx-1;x++){
        if (buildBudget.exhausted()) await buildBudget.yield();
        const a=gridIndex(x,y,z),b=gridIndex(x+1,y,z);
        if((scalar[a]>0)===(scalar[b]>0))continue;
        emitNetQuad([
          cellVertices[cellIndex(x,y-1,z-1)],cellVertices[cellIndex(x,y,z-1)],
          cellVertices[cellIndex(x,y,z)],cellVertices[cellIndex(x,y-1,z)]
        ],outwardAlong(x,y,z,x+1,y,z));
      }
      // Y-directed edges.
      for(let z=1;z<nz-1;z++)for(let y=0;y<ny-1;y++)for(let x=1;x<nx-1;x++){
        if (buildBudget.exhausted()) await buildBudget.yield();
        const a=gridIndex(x,y,z),b=gridIndex(x,y+1,z);
        if((scalar[a]>0)===(scalar[b]>0))continue;
        emitNetQuad([
          cellVertices[cellIndex(x-1,y,z-1)],cellVertices[cellIndex(x-1,y,z)],
          cellVertices[cellIndex(x,y,z)],cellVertices[cellIndex(x,y,z-1)]
        ],outwardAlong(x,y,z,x,y+1,z));
      }
      // Z-directed edges.
      for(let z=0;z<nz-1;z++)for(let y=1;y<ny-1;y++)for(let x=1;x<nx-1;x++){
        if (buildBudget.exhausted()) await buildBudget.yield();
        const a=gridIndex(x,y,z),b=gridIndex(x,y,z+1);
        if((scalar[a]>0)===(scalar[b]>0))continue;
        emitNetQuad([
          cellVertices[cellIndex(x-1,y-1,z)],cellVertices[cellIndex(x,y-1,z)],
          cellVertices[cellIndex(x,y,z)],cellVertices[cellIndex(x-1,y,z)]
        ],outwardAlong(x,y,z,x,y,z+1));
      }

      const allIndices=[...netFrontIndices,...netSideIndices,...netBackIndices];
      const sampleScalarGrid=(gx,gy,gz)=>{
        const x=THREE.MathUtils.clamp(gx,0,nx-1),y=THREE.MathUtils.clamp(gy,0,ny-1),z=THREE.MathUtils.clamp(gz,0,nz-1);
        const x0=Math.floor(x),y0=Math.floor(y),z0=Math.floor(z);
        const x1=Math.min(nx-1,x0+1),y1=Math.min(ny-1,y0+1),z1=Math.min(nz-1,z0+1);
        const tx=x-x0,ty=y-y0,tz=z-z0;
        const c000=scalar[gridIndex(x0,y0,z0)],c100=scalar[gridIndex(x1,y0,z0)];
        const c010=scalar[gridIndex(x0,y1,z0)],c110=scalar[gridIndex(x1,y1,z0)];
        const c001=scalar[gridIndex(x0,y0,z1)],c101=scalar[gridIndex(x1,y0,z1)];
        const c011=scalar[gridIndex(x0,y1,z1)],c111=scalar[gridIndex(x1,y1,z1)];
        const c00=THREE.MathUtils.lerp(c000,c100,tx),c10=THREE.MathUtils.lerp(c010,c110,tx);
        const c01=THREE.MathUtils.lerp(c001,c101,tx),c11=THREE.MathUtils.lerp(c011,c111,tx);
        return THREE.MathUtils.lerp(THREE.MathUtils.lerp(c00,c10,ty),THREE.MathUtils.lerp(c01,c11,ty),tz);
      };
      const gridStepX=(MW+pad*2)*S/(nx-1),gridStepY=(MH+pad*2)*S/(ny-1),gridStepZ=(zMax-zMin)/(nz-1);
      const normalRadius=THREE.MathUtils.clamp(O.unifiedNormalRadius ?? 1.65,.75,3);
      const worldFieldGradient=(wx,wy,wz,radius,out)=>{
        const pxX=(wx+ctr.x)/S+MW/2,pxY=MH/2-(wy+ctr.y)/S;
        const gx=(pxX+pad)*(nx-1)/(MW+pad*2),gy=(pxY+pad)*(ny-1)/(MH+pad*2),gz=(wz-zMin)*(nz-1)/(zMax-zMin);
        out[0]=sampleScalarGrid(gx,gy,gz);
        out[1]=(sampleScalarGrid(gx+radius,gy,gz)-sampleScalarGrid(gx-radius,gy,gz))/(2*radius*gridStepX);
        out[2]=-(sampleScalarGrid(gx,gy+radius,gz)-sampleScalarGrid(gx,gy-radius,gz))/(2*radius*gridStepY);
        out[3]=(sampleScalarGrid(gx,gy,gz+radius)-sampleScalarGrid(gx,gy,gz-radius))/(2*radius*gridStepZ);
        return out;
      };

      /* The average edge-crossing position used by Surface Nets is sealed and
         stable, but it can still wander slightly from cell to cell. Under a
         grazing glossy highlight that reads as a faintly hammered side wall.
         Relax only along the implicit surface's tangent plane, then project
         the result back onto the same zero-set. This removes the residual
         waviness without shrinking the wordmark or flattening its pillow cap. */
      const tangentialSmoothPasses=THREE.MathUtils.clamp(Math.round(O.unifiedTangentialSmoothPasses ?? 4),0,8);
      const tangentialSmoothStrength=THREE.MathUtils.clamp(O.unifiedTangentialSmoothStrength ?? .32,0,.6);
      const cellSize=Math.min(gridStepX,gridStepY,gridStepZ);
      const maxTangentialStep=cellSize*THREE.MathUtils.clamp(O.unifiedTangentialSmoothLimit ?? .16,.04,.3);
      const maxProjectionStep=cellSize*THREE.MathUtils.clamp(O.unifiedProjectionLimit ?? .08,.02,.2);
      const gradientScratch=new Float64Array(4);
      const vertexCount=netPositions.length/3;
      let smoothedPositions=Float64Array.from(netPositions);
      let maxTangentialDisplacement=0,maxProjectionDisplacement=0;
      for(let pass=0;pass<tangentialSmoothPasses;pass++){
        if (buildBudget.exhausted()) await buildBudget.yield();
        const sumX=new Float64Array(vertexCount),sumY=new Float64Array(vertexCount),sumZ=new Float64Array(vertexCount);
        const neighborWeight=new Uint32Array(vertexCount);
        const addNeighbor=(target,neighbor)=>{
          sumX[target]+=smoothedPositions[neighbor*3];
          sumY[target]+=smoothedPositions[neighbor*3+1];
          sumZ[target]+=smoothedPositions[neighbor*3+2];
          neighborWeight[target]++;
        };
        for(let i=0;i<allIndices.length;i+=3){
          if (buildBudget.exhausted()) await buildBudget.yield();
          const a=allIndices[i],b=allIndices[i+1],c=allIndices[i+2];
          addNeighbor(a,b);addNeighbor(a,c);
          addNeighbor(b,a);addNeighbor(b,c);
          addNeighbor(c,a);addNeighbor(c,b);
        }
        const next=smoothedPositions.slice();
        for(let id=0;id<vertexCount;id++){
          if (buildBudget.exhausted()) await buildBudget.yield();
          const count=neighborWeight[id];
          if(!count)continue;
          const base=id*3;
          const wx=smoothedPositions[base],wy=smoothedPositions[base+1],wz=smoothedPositions[base+2];
          worldFieldGradient(wx,wy,wz,normalRadius,gradientScratch);
          const gx=gradientScratch[1],gy=gradientScratch[2],gz=gradientScratch[3];
          const gradientLength=Math.hypot(gx,gy,gz);
          if(gradientLength<1e-8)continue;
          const nxOut=-gx/gradientLength,nyOut=-gy/gradientLength,nzOut=-gz/gradientLength;
          // Polish the full rounded shoulder, not only the near-vertical wall.
          // Only the almost-flat cap centre is locked to preserve the approved
          // puffy face and rear depth.
          const sideWeight=1-THREE.MathUtils.smoothstep(Math.abs(nzOut),.72,.995);
          if(sideWeight<1e-4)continue;
          let dx=sumX[id]/count-wx,dy=sumY[id]/count-wy,dz=sumZ[id]/count-wz;
          const normalComponent=dx*nxOut+dy*nyOut+dz*nzOut;
          dx=(dx-normalComponent*nxOut)*tangentialSmoothStrength*sideWeight;
          dy=(dy-normalComponent*nyOut)*tangentialSmoothStrength*sideWeight;
          dz=(dz-normalComponent*nzOut)*tangentialSmoothStrength*sideWeight;
          const tangentialLength=Math.hypot(dx,dy,dz);
          if(tangentialLength>maxTangentialStep){
            const scale=maxTangentialStep/tangentialLength;
            dx*=scale;dy*=scale;dz*=scale;
          }
          let candidateX=wx+dx,candidateY=wy+dy,candidateZ=wz+dz;
          maxTangentialDisplacement=Math.max(maxTangentialDisplacement,Math.hypot(dx,dy,dz));

          worldFieldGradient(candidateX,candidateY,candidateZ,normalRadius,gradientScratch);
          const field=gradientScratch[0],pgx=gradientScratch[1],pgy=gradientScratch[2],pgz=gradientScratch[3];
          const projectionGradientSq=pgx*pgx+pgy*pgy+pgz*pgz;
          if(projectionGradientSq>1e-12){
            let projectionScale=-field/projectionGradientSq;
            const projectionLength=Math.abs(projectionScale)*Math.sqrt(projectionGradientSq);
            if(projectionLength>maxProjectionStep)projectionScale*=maxProjectionStep/projectionLength;
            projectionScale*=sideWeight;
            const pdx=pgx*projectionScale,pdy=pgy*projectionScale,pdz=pgz*projectionScale;
            candidateX+=pdx;candidateY+=pdy;candidateZ+=pdz;
            maxProjectionDisplacement=Math.max(maxProjectionDisplacement,Math.hypot(pdx,pdy,pdz));
          }
          next[base]=candidateX;next[base+1]=candidateY;next[base+2]=candidateZ;
        }
        smoothedPositions=next;
      }
      for(let i=0;i<netPositions.length;i++)netPositions[i]=smoothedPositions[i];
      netUvs.length=0;
      for(let id=0;id<vertexCount;id++){
        if (buildBudget.exhausted()) await buildBudget.yield();
        const wx=netPositions[id*3],wy=netPositions[id*3+1];
        const pxX=(wx+ctr.x)/S+MW/2,pxY=MH/2-(wy+ctr.y)/S;
        netUvs.push((pxX+.5)/MW,1-(pxY+.5)/MH);
      }
      maxTriangleEdge=0;
      for(let i=0;i<allIndices.length;i+=3){
        if (buildBudget.exhausted()) await buildBudget.yield();
        const a=allIndices[i]*3,b=allIndices[i+1]*3,c=allIndices[i+2]*3;
        const abLength=Math.hypot(netPositions[a]-netPositions[b],netPositions[a+1]-netPositions[b+1],netPositions[a+2]-netPositions[b+2]);
        const bcLength=Math.hypot(netPositions[b]-netPositions[c],netPositions[b+1]-netPositions[c+1],netPositions[b+2]-netPositions[c+2]);
        const caLength=Math.hypot(netPositions[c]-netPositions[a],netPositions[c+1]-netPositions[a+1],netPositions[c+2]-netPositions[a+2]);
        maxTriangleEdge=Math.max(maxTriangleEdge,abLength,bcLength,caLength);
      }

      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(netPositions,3));
      geometry.setAttribute('uv',new THREE.Float32BufferAttribute(netUvs,2));
      geometry.setIndex(allIndices);
      geometry.addGroup(0,netFrontIndices.length,0);
      geometry.addGroup(netFrontIndices.length,netSideIndices.length,1);
      geometry.addGroup(netFrontIndices.length+netSideIndices.length,netBackIndices.length,2);

      let normals=new Float32Array(netPositions.length);
      for(let id=0;id<netPositions.length/3;id++){
        if (buildBudget.exhausted()) await buildBudget.yield();
        const wx=netPositions[id*3],wy=netPositions[id*3+1],wz=netPositions[id*3+2];
        worldFieldGradient(wx,wy,wz,normalRadius,gradientScratch);
        const dx=gradientScratch[1],dy=gradientScratch[2],dz=gradientScratch[3];
        const length=Math.hypot(dx,dy,dz)||1;
        normals[id*3]=-dx/length;normals[id*3+1]=-dy/length;normals[id*3+2]=-dz/length;
      }
      // Average the already-correct scalar normals over the shared topology.
      // This removes the last depth-slice highlight band without touching the
      // watertight vertex positions or the approved candy thickness.
      const normalSmoothPasses=THREE.MathUtils.clamp(Math.round(O.unifiedNormalSmoothPasses ?? 4),0,8);
      const normalSmoothStrength=THREE.MathUtils.clamp(O.unifiedNormalSmoothStrength ?? .58,0,1);
      for(let pass=0;pass<normalSmoothPasses;pass++){
        if (buildBudget.exhausted()) await buildBudget.yield();
        const sumX=new Float64Array(vertexCount),sumY=new Float64Array(vertexCount),sumZ=new Float64Array(vertexCount);
        const neighborWeight=new Uint32Array(vertexCount);
        const addNormalNeighbor=(target,neighbor)=>{
          sumX[target]+=normals[neighbor*3];
          sumY[target]+=normals[neighbor*3+1];
          sumZ[target]+=normals[neighbor*3+2];
          neighborWeight[target]++;
        };
        for(let i=0;i<allIndices.length;i+=3){
          if (buildBudget.exhausted()) await buildBudget.yield();
          const a=allIndices[i],b=allIndices[i+1],c=allIndices[i+2];
          addNormalNeighbor(a,b);addNormalNeighbor(a,c);
          addNormalNeighbor(b,a);addNormalNeighbor(b,c);
          addNormalNeighbor(c,a);addNormalNeighbor(c,b);
        }
        const next=new Float32Array(normals.length);
        for(let id=0;id<vertexCount;id++){
          if (buildBudget.exhausted()) await buildBudget.yield();
          const base=id*3,count=neighborWeight[id];
          const ox=normals[base],oy=normals[base+1],oz=normals[base+2];
          if(!count){next[base]=ox;next[base+1]=oy;next[base+2]=oz;continue;}
          let ax=(sumX[id]+ox*2)/(count+2),ay=(sumY[id]+oy*2)/(count+2),az=(sumZ[id]+oz*2)/(count+2);
          const averageLength=Math.hypot(ax,ay,az)||1;
          ax/=averageLength;ay/=averageLength;az/=averageLength;
          let nx=THREE.MathUtils.lerp(ox,ax,normalSmoothStrength);
          let ny=THREE.MathUtils.lerp(oy,ay,normalSmoothStrength);
          let nz=THREE.MathUtils.lerp(oz,az,normalSmoothStrength);
          const mixedLength=Math.hypot(nx,ny,nz)||1;
          next[base]=nx/mixedLength;next[base+1]=ny/mixedLength;next[base+2]=nz/mixedLength;
        }
        normals=next;
      }
      geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
      geometry.computeBoundingBox();geometry.computeBoundingSphere();

      const edgeUse=new Map();
      const edgeKey=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
      for(let i=0;i<allIndices.length;i+=3){
        if (buildBudget.exhausted()) await buildBudget.yield();
        const a=allIndices[i],b=allIndices[i+1],c=allIndices[i+2];
        for(const [ea,eb] of [[a,b],[b,c],[c,a]]){
          const key=edgeKey(ea,eb);edgeUse.set(key,(edgeUse.get(key)||0)+1);
        }
      }
      let openEdgeCount=0,nonManifoldEdgeCount=0;
      for(const count of edgeUse.values()){
        if(count===1)openEdgeCount++;else if(count!==2)nonManifoldEdgeCount++;
      }
      Object.assign(geometry.userData,{
        // Surface Nets can produce a closed count-4 self-contact edge where a
        // one-cell diagonal in the 2D silhouette pinches. It is still sealed
        // (no boundary edge and no visible gap), so report manifoldness
        // separately instead of rejecting the entire render.
        closedSurface:openEdgeCount===0,
        manifoldSurface:nonManifoldEdgeCount===0,
        openEdgeCount,nonManifoldEdgeCount,selfContactEdgeCount:nonManifoldEdgeCount,maxTriangleEdge,
        emittedTriangles:allIndices.length/3,activeCells,
        voxelStepPx:xyStep,depthSegments,sdfSmoothPasses,sdfSmoothStrength,surfaceBlend,
        normalMethod:'scalar-gradient-topology-smoothed',normalRadius,normalSmoothPasses,normalSmoothStrength,
        tangentialSmoothPasses,tangentialSmoothStrength,maxTangentialStep,maxProjectionStep,
        maxTangentialDisplacement,maxProjectionDisplacement,
        extraction:'signed-distance-surface-nets'
      });
      if(openEdgeCount){
        throw new Error(`KANDy surface-net body has ${openEdgeCount} open edges`);
      }
      return geometry;
    };
    return buildSurfaceNetGeometry();

    const positions=[];
    const uvs=[];
    let frontIndices=[];
    let sideIndices=[];
    let backIndices=[];
    const edgeVertices=new Map();
    const gridPosition=id=>{
      const x=id%nx;
      const yz=Math.floor(id/nx);
      const y=yz%ny;
      const z=Math.floor(yz/ny);
      return [worldX(pxAt(x)),worldY(pyAt(y)),zAt(z)];
    };
    const edgeKey=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
    const vertexOnEdge=(a,b)=>{
      const key=edgeKey(a,b);
      if(edgeVertices.has(key))return edgeVertices.get(key);
      const va=scalar[a],vb=scalar[b];
      const denominator=va-vb;
      const t=Math.abs(denominator)>1e-12?THREE.MathUtils.clamp(va/denominator,0,1):.5;
      const pa=gridPosition(a),pb=gridPosition(b);
      const x=THREE.MathUtils.lerp(pa[0],pb[0],t);
      const y=THREE.MathUtils.lerp(pa[1],pb[1],t);
      const z=THREE.MathUtils.lerp(pa[2],pb[2],t);
      const id=positions.length/3;
      positions.push(x,y,z);
      const pxX=(x+ctr.x)/S+MW/2;
      const pxY=MH/2-(y+ctr.y)/S;
      uvs.push((pxX+.5)/MW,1-(pxY+.5)/MH);
      edgeVertices.set(key,id);
      return id;
    };
    const tempA=new THREE.Vector3(),tempB=new THREE.Vector3(),tempC=new THREE.Vector3();
    const ab=new THREE.Vector3(),ac=new THREE.Vector3(),faceNormal=new THREE.Vector3();
    let maxTriangleEdge=0,skippedDegenerateTriangles=0,emittedTriangles=0;
    const emitTriangle=(a,b,c,outward)=>{
      if(a===b||b===c||c===a){skippedDegenerateTriangles++;return;}
      tempA.fromArray(positions,a*3);
      tempB.fromArray(positions,b*3);
      tempC.fromArray(positions,c*3);
      ab.subVectors(tempB,tempA);
      ac.subVectors(tempC,tempA);
      faceNormal.crossVectors(ab,ac);
      if(faceNormal.lengthSq()<1e-16){skippedDegenerateTriangles++;return;}
      const flip=faceNormal.dot(outward)<0;
      if(flip)[b,c]=[c,b];
      maxTriangleEdge=Math.max(
        maxTriangleEdge,
        tempA.distanceTo(tempB),
        tempB.distanceTo(tempC),
        tempC.distanceTo(tempA)
      );
      const nzFace=faceNormal.normalize().z*(flip?-1:1);
      if(nzFace>.34)frontIndices.push(a,b,c);
      else if(nzFace<-.34)backIndices.push(a,b,c);
      else sideIndices.push(a,b,c);
      emittedTriangles++;
    };
    const TETS=[
      [0,5,1,6],[0,1,2,6],[0,2,3,6],
      [0,3,7,6],[0,7,4,6],[0,4,5,6]
    ];
    const cornerOffsets=[
      [0,0,0],[1,0,0],[1,1,0],[0,1,0],
      [0,0,1],[1,0,1],[1,1,1],[0,1,1]
    ];
    const insideCentre=new THREE.Vector3(),outsideCentre=new THREE.Vector3();
    for(let z=0;z<nz-1;z++)for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){
      const corners=cornerOffsets.map(([ox,oy,oz])=>gridIndex(x+ox,y+oy,z+oz));
      for(const tet of TETS){
        const ids=tet.map(index=>corners[index]);
        const insideLocal=[];
        const outsideLocal=[];
        for(let local=0;local<4;local++){
          (scalar[ids[local]]>0?insideLocal:outsideLocal).push(local);
        }
        if(insideLocal.length===0||insideLocal.length===4)continue;
        const inside=insideLocal.map(local=>ids[local]);
        const outside=outsideLocal.map(local=>ids[local]);
        insideCentre.set(0,0,0);
        for(const id of inside)insideCentre.add(tempA.fromArray(gridPosition(id)));
        insideCentre.multiplyScalar(1/inside.length);
        outsideCentre.set(0,0,0);
        for(const id of outside)outsideCentre.add(tempA.fromArray(gridPosition(id)));
        outsideCentre.multiplyScalar(1/outside.length);
        const outward=new THREE.Vector3().subVectors(outsideCentre,insideCentre).normalize();
        // Use the three explicit tetrahedron cases instead of sorting an
        // arbitrary intersection polygon. The generic fan occasionally chose
        // a near-collinear first diagonal at the rounded front/side blend,
        // skipped that zero-area triangle and left a visible crack. These
        // cases have a deterministic boundary order and therefore agree on
        // every shared tetrahedron face.
        if(insideLocal.length===1||insideLocal.length===3){
          const lone=insideLocal.length===1?insideLocal[0]:outsideLocal[0];
          const others=(insideLocal.length===1?outsideLocal:insideLocal);
          const a=vertexOnEdge(ids[lone],ids[others[0]]);
          const b=vertexOnEdge(ids[lone],ids[others[1]]);
          const c=vertexOnEdge(ids[lone],ids[others[2]]);
          emitTriangle(a,b,c,outward);
        }else{
          const [i0,i1]=insideLocal;
          const [o0,o1]=outsideLocal;
          const a=vertexOnEdge(ids[i0],ids[o0]);
          const b=vertexOnEdge(ids[i0],ids[o1]);
          const c=vertexOnEdge(ids[i1],ids[o0]);
          const d=vertexOnEdge(ids[i1],ids[o1]);
          emitTriangle(a,b,d,outward);
          emitTriangle(a,d,c,outward);
        }
      }
    }

    // When the iso-surface passes numerically through the meeting point of two
    // different tetrahedron edges, their cached edge vertices can land at the
    // same world position while retaining different indices. Weld only those
    // sub-micron coincidences before testing the boundary. The tolerance is
    // four orders of magnitude below a visible voxel, so separate strokes and
    // counters cannot be joined by this operation.
    const coincidentTolerance=Math.min(xyStep*S*.005,1e-4);
    let weldedCoincidentVertices=0;
    const coincidentParent=new Int32Array(positions.length/3);
    for(let i=0;i<coincidentParent.length;i++)coincidentParent[i]=i;
    const coincidentBuckets=new Map();
    const bucketKey=(x,y,z)=>`${x}:${y}:${z}`;
    for(let id=0;id<coincidentParent.length;id++){
      const px=positions[id*3],py=positions[id*3+1],pz=positions[id*3+2];
      const qx=Math.floor(px/coincidentTolerance);
      const qy=Math.floor(py/coincidentTolerance);
      const qz=Math.floor(pz/coincidentTolerance);
      let match=-1;
      for(let dz=-1;dz<=1&&match<0;dz++)for(let dy=-1;dy<=1&&match<0;dy++)for(let dx=-1;dx<=1;dx++){
        const candidates=coincidentBuckets.get(bucketKey(qx+dx,qy+dy,qz+dz));
        if(!candidates)continue;
        for(const candidate of candidates){
          const cx=positions[candidate*3],cy=positions[candidate*3+1],cz=positions[candidate*3+2];
          if(Math.hypot(px-cx,py-cy,pz-cz)<=coincidentTolerance){match=candidate;break;}
        }
      }
      if(match>=0){coincidentParent[id]=match;weldedCoincidentVertices++;}
      else{
        const key=bucketKey(qx,qy,qz);
        const bucket=coincidentBuckets.get(key);
        if(bucket)bucket.push(id);else coincidentBuckets.set(key,[id]);
      }
    }
    if(weldedCoincidentVertices){
      const seenTriangles=new Set();
      const remapCoincident=indices=>{
        const result=[];
        for(let i=0;i<indices.length;i+=3){
          const a=coincidentParent[indices[i]],b=coincidentParent[indices[i+1]],c=coincidentParent[indices[i+2]];
          if(a===b||b===c||c===a){skippedDegenerateTriangles++;continue;}
          const signature=[a,b,c].sort((u,v)=>u-v).join(':');
          if(seenTriangles.has(signature)){skippedDegenerateTriangles++;continue;}
          seenTriangles.add(signature);
          result.push(a,b,c);
        }
        return result;
      };
      frontIndices=remapCoincident(frontIndices);
      sideIndices=remapCoincident(sideIndices);
      backIndices=remapCoincident(backIndices);
      emittedTriangles=(frontIndices.length+sideIndices.length+backIndices.length)/3;
    }

    // The min-composed signed-distance field can graze a tetrahedron corner at
    // the front/side transition and leave a microscopic sliver. Those slivers
    // are many orders of magnitude smaller than a visible voxel, but skipping
    // their zero-area triangles would technically leave pinholes. Collapse
    // only open-edge components below 0.05 voxel; this repairs the numerical
    // singularity without welding neighboring letters or changing the visible
    // silhouette.
    const sliverTolerance=Math.min(xyStep*S*.05,.001);
    let repairedSliverComponents=0;
    const cleanSliverBoundaries=()=>{
      const combined=[...frontIndices,...sideIndices,...backIndices];
      const edgeUse=new Map();
      for(let i=0;i<combined.length;i+=3){
        const a=combined[i],b=combined[i+1],c=combined[i+2];
        for(const [ea,eb] of [[a,b],[b,c],[c,a]]){
          const key=edgeKey(ea,eb);
          edgeUse.set(key,(edgeUse.get(key)||0)+1);
        }
      }
      const parent=new Int32Array(positions.length/3);
      for(let i=0;i<parent.length;i++)parent[i]=i;
      const find=value=>{
        let root=value;
        while(parent[root]!==root)root=parent[root];
        while(parent[value]!==value){const next=parent[value];parent[value]=root;value=next;}
        return root;
      };
      const join=(a,b)=>{
        const ra=find(a),rb=find(b);
        if(ra===rb)return false;
        parent[rb]=ra;
        return true;
      };
      let joined=0;
      for(const [key,count] of edgeUse){
        if(count!==1)continue;
        const split=key.indexOf(':');
        const a=Number(key.slice(0,split)),b=Number(key.slice(split+1));
        tempA.fromArray(positions,a*3);
        tempB.fromArray(positions,b*3);
        if(tempA.distanceTo(tempB)<=sliverTolerance&&join(a,b))joined++;
      }
      if(!joined)return false;
      repairedSliverComponents+=joined;
      const seenTriangles=new Set();
      const remap=indices=>{
        const result=[];
        for(let i=0;i<indices.length;i+=3){
          const a=find(indices[i]),b=find(indices[i+1]),c=find(indices[i+2]);
          if(a===b||b===c||c===a){skippedDegenerateTriangles++;continue;}
          const signature=[a,b,c].sort((u,v)=>u-v).join(':');
          if(seenTriangles.has(signature)){skippedDegenerateTriangles++;continue;}
          seenTriangles.add(signature);
          result.push(a,b,c);
        }
        return result;
      };
      frontIndices=remap(frontIndices);
      sideIndices=remap(sideIndices);
      backIndices=remap(backIndices);
      emittedTriangles=(frontIndices.length+sideIndices.length+backIndices.length)/3;
      return true;
    };
    for(let pass=0;pass<3;pass++)if(!cleanSliverBoundaries())break;

    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    const allIndices=[...frontIndices,...sideIndices,...backIndices];
    geometry.setIndex(allIndices);
    geometry.addGroup(0,frontIndices.length,0);
    geometry.addGroup(frontIndices.length,sideIndices.length,1);
    geometry.addGroup(frontIndices.length+sideIndices.length,backIndices.length,2);
    // Marching tetrahedra gives correct topology, but triangle-averaged normals
    // still reveal every tetrahedron in glossy light. Evaluate the continuous
    // scalar field around each vertex instead. The negative gradient points
    // out of our positive-inside volume and produces one broad molded-candy
    // highlight across front, side, and rear.
    const sampleScalarGrid=(gx,gy,gz)=>{
      const x=THREE.MathUtils.clamp(gx,0,nx-1),y=THREE.MathUtils.clamp(gy,0,ny-1),z=THREE.MathUtils.clamp(gz,0,nz-1);
      const x0=Math.floor(x),y0=Math.floor(y),z0=Math.floor(z);
      const x1=Math.min(nx-1,x0+1),y1=Math.min(ny-1,y0+1),z1=Math.min(nz-1,z0+1);
      const tx=x-x0,ty=y-y0,tz=z-z0;
      const c000=scalar[gridIndex(x0,y0,z0)],c100=scalar[gridIndex(x1,y0,z0)];
      const c010=scalar[gridIndex(x0,y1,z0)],c110=scalar[gridIndex(x1,y1,z0)];
      const c001=scalar[gridIndex(x0,y0,z1)],c101=scalar[gridIndex(x1,y0,z1)];
      const c011=scalar[gridIndex(x0,y1,z1)],c111=scalar[gridIndex(x1,y1,z1)];
      const c00=THREE.MathUtils.lerp(c000,c100,tx),c10=THREE.MathUtils.lerp(c010,c110,tx);
      const c01=THREE.MathUtils.lerp(c001,c101,tx),c11=THREE.MathUtils.lerp(c011,c111,tx);
      return THREE.MathUtils.lerp(THREE.MathUtils.lerp(c00,c10,ty),THREE.MathUtils.lerp(c01,c11,ty),tz);
    };
    const gridStepX=(MW+pad*2)*S/(nx-1);
    const gridStepY=(MH+pad*2)*S/(ny-1);
    const gridStepZ=(zMax-zMin)/(nz-1);
    const normalRadius=THREE.MathUtils.clamp(O.unifiedNormalRadius ?? 1.65,.75,3);
    const normals=new Float32Array(positions.length);
    for(let id=0;id<positions.length/3;id++){
      const wx=positions[id*3],wy=positions[id*3+1],wz=positions[id*3+2];
      const pxX=(wx+ctr.x)/S+MW/2;
      const pxY=MH/2-(wy+ctr.y)/S;
      const gx=(pxX+pad)*(nx-1)/(MW+pad*2);
      const gy=(pxY+pad)*(ny-1)/(MH+pad*2);
      const gz=(wz-zMin)*(nz-1)/(zMax-zMin);
      const dx=(sampleScalarGrid(gx+normalRadius,gy,gz)-sampleScalarGrid(gx-normalRadius,gy,gz))/(2*normalRadius*gridStepX);
      const dy=-(sampleScalarGrid(gx,gy+normalRadius,gz)-sampleScalarGrid(gx,gy-normalRadius,gz))/(2*normalRadius*gridStepY);
      const dz=(sampleScalarGrid(gx,gy,gz+normalRadius)-sampleScalarGrid(gx,gy,gz-normalRadius))/(2*normalRadius*gridStepZ);
      const length=Math.hypot(dx,dy,dz)||1;
      normals[id*3]=-dx/length;
      normals[id*3+1]=-dy/length;
      normals[id*3+2]=-dz/length;
    }
    geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const edgeUse=new Map();
    for(let i=0;i<allIndices.length;i+=3){
      const a=allIndices[i],b=allIndices[i+1],c=allIndices[i+2];
      for(const [ea,eb] of [[a,b],[b,c],[c,a]]){
        const key=edgeKey(ea,eb);
        edgeUse.set(key,(edgeUse.get(key)||0)+1);
      }
    }
    let openEdgeCount=0,nonManifoldEdgeCount=0;
    for(const count of edgeUse.values()){
      if(count===1)openEdgeCount++;
      else if(count!==2)nonManifoldEdgeCount++;
    }
    geometry.userData.closedSurface=openEdgeCount===0&&nonManifoldEdgeCount===0;
    geometry.userData.openEdgeCount=openEdgeCount;
    geometry.userData.nonManifoldEdgeCount=nonManifoldEdgeCount;
    geometry.userData.maxTriangleEdge=maxTriangleEdge;
    geometry.userData.skippedDegenerateTriangles=skippedDegenerateTriangles;
    geometry.userData.emittedTriangles=emittedTriangles;
    geometry.userData.repairedSliverComponents=repairedSliverComponents;
    geometry.userData.sliverTolerance=sliverTolerance;
    geometry.userData.weldedCoincidentVertices=weldedCoincidentVertices;
    geometry.userData.coincidentTolerance=coincidentTolerance;
    geometry.userData.voxelStepPx=xyStep;
    geometry.userData.depthSegments=depthSegments;
    geometry.userData.sdfSmoothPasses=sdfSmoothPasses;
    geometry.userData.sdfSmoothStrength=sdfSmoothStrength;
    geometry.userData.surfaceBlend=surfaceBlend;
    geometry.userData.normalMethod='scalar-gradient';
    geometry.userData.normalRadius=normalRadius;
    geometry.userData.extraction='signed-distance-marching-tetrahedra';
    if(openEdgeCount||nonManifoldEdgeCount){
      throw new Error(`KANDy implicit body is not watertight: ${openEdgeCount} open / ${nonManifoldEdgeCount} non-manifold edges`);
    }
    return geometry;
  }

  /* --- 5. material ------------------------------------------------------ */
  let maskTex=null, thicknessTex=null, edgeTex=null, referenceBodyTex=null;
  if (O.materialMode === 'physical'){
    const maskData=new Uint8Array(N*4), thickData=new Uint8Array(N*4), edgeData=new Uint8Array(N*4);
    for(let y=0;y<MH;y++) for(let x=0;x<MW;x++){
      const src=y*MW+x, dst=((MH-1-y)*MW+x)*4;
      const cover=mask[src]?255:0;
      // Preserve the PNG's original antialiased coverage for the visible face
      // edge. Geometry tracing still uses its 0.5 iso-contour, so both meet at
      // the same location without turning the silhouette back into pixel art.
      const alphaCover=px[src*4+3];
      maskData[dst]=maskData[dst+1]=maskData[dst+2]=alphaCover; maskData[dst+3]=255;
      const dn=mask[src]?Math.min(sdf[src]/R_TUBE,1):0;
      // A real thickness ramp: the first few pixels inside the silhouette are
      // thin enough for warm light to pass; the stroke core rapidly becomes a
      // dense, milky pink volume. Keeping the minimum near 12% (rather than the
      // previous 22%) makes transmission visible without lowering opacity.
      const thick=Math.round(cover ? (32+223*Math.pow(dn,.82)) : 0);
      thickData[dst]=thickData[dst+1]=thickData[dst+2]=thick; thickData[dst+3]=255;
      // A narrow, soft translucency band. This is not opacity: it visualises
      // warm light scattered through the thin candy perimeter even when the
      // host canvas itself is transparent and has no background to refract.
      // Keep the glow *inside* the body. Emitting at dn=0 reads as a detached
      // white outline (and, from the side, as an empty seam). The two ramps put
      // the peak just under the skin and fade it before the dense core.
      const edgeBand=smoothstep(.015,.06,dn)*(1-smoothstep(.10,.38,dn));
      const edge=Math.round(cover ? 255*Math.pow(Math.max(0,edgeBand),.8) : 0);
      edgeData[dst]=edgeData[dst+1]=edgeData[dst+2]=edge; edgeData[dst+3]=255;
    }
    maskTex=new THREE.DataTexture(maskData,MW,MH,THREE.RGBAFormat);
    thicknessTex=new THREE.DataTexture(thickData,MW,MH,THREE.RGBAFormat);
    edgeTex=new THREE.DataTexture(edgeData,MW,MH,THREE.RGBAFormat);
    // The silhouette mask must not choose a different mip level as the logo
    // rotates; that was the source of the crawling pink/white pixel rhythm.
    maskTex.minFilter=maskTex.magFilter=THREE.LinearFilter;
    maskTex.generateMipmaps=false;maskTex.wrapS=maskTex.wrapT=THREE.ClampToEdgeWrapping;maskTex.needsUpdate=true;
    for(const t of [thicknessTex,edgeTex]){
      t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;
      t.generateMipmaps=true;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.needsUpdate=true;
    }
    if(useReferenceFront){
      const bodyData=new Uint8Array(N*4);
      // DataTexture bytes below are sRGB source bytes. Do not pass this colour
      // through THREE.Color first: its components live in the renderer's linear
      // working space and would be decoded a second time by the sRGB texture.
      const fallbackHex=O.physicalColor || 0xE88BB6;
      const fr=(fallbackHex>>16)&255,fg=(fallbackHex>>8)&255,fb=fallbackHex&255;
      for(let y=0;y<MH;y++)for(let x=0;x<MW;x++){
        const src=y*MW+x,dst=((MH-1-y)*MW+x)*4;
        // Transparent source pixels must still carry pink RGB. Otherwise their
        // black RGB leaks through the texture mip chain as a dirty outline.
        const hasSourceColour=px[src*4+3]>8;
        bodyData[dst]=hasSourceColour?Math.round(cleanReferenceDecorations?bodyR[src]:px[src*4]):fr;
        bodyData[dst+1]=hasSourceColour?Math.round(cleanReferenceDecorations?bodyG[src]:px[src*4+1]):fg;
        bodyData[dst+2]=hasSourceColour?Math.round(cleanReferenceDecorations?bodyB[src]:px[src*4+2]):fb;
        bodyData[dst+3]=255;
      }
      referenceBodyTex=new THREE.DataTexture(bodyData,MW,MH,THREE.RGBAFormat);
      referenceBodyTex.colorSpace=THREE.SRGBColorSpace;
      referenceBodyTex.flipY=false;
      referenceBodyTex.minFilter=THREE.LinearMipmapLinearFilter;
      referenceBodyTex.magFilter=THREE.LinearFilter;
      referenceBodyTex.generateMipmaps=true;
      referenceBodyTex.wrapS=referenceBodyTex.wrapT=THREE.ClampToEdgeWrapping;
      referenceBodyTex.needsUpdate=true;
    }
  }

  const shaderMat = new THREE.ShaderMaterial({
    uniforms:{
      uForm:{ value: formTex },
      uTexel:{ value: new THREE.Vector2(1/MW, 1/MH) },
      uHalf:{ value: new THREE.Vector2(size.x/2, size.y/2) },
      // Height in world units across the tube, over the texel spacing: turns
      // the packed 0..1 height into a real slope instead of a magic number.
      uBump:{ value: (halfStroke * (O.geometryMode === 'inflated' ? 0.16 : 1.05)) / (LOGO_W_UNITS / MW) },
      uEnvSharp:{ value: ENV_SHARP }, uEnvBlur:{ value: ENV_BLUR },
      uEnvRot:{ value: 0 },
      uSun:{ value: SUN_DIR.clone() }, uSunCol:{ value: col(SUN_COLOR) },
      uFill:{ value: FILL_DIR.clone() }, uFillCol:{ value: col(FILL_COLOR) },
      uSkyCol:{ value: col(SKY_FILL) },
      uCore:{ value: col(CANDY_CORE) }, uSkin:{ value: col(CANDY_SKIN) },
      uDeep:{ value: col(CANDY_DEEP) }, uRim:{ value: col(CANDY_RIM) },
      uGloss:{ value: 1.0 },
      uMirrorMix:{value:F.mirrorMix}, uReflBase:{value:F.reflBase}, uReflFres:{value:F.reflFres},
      uSpecTight:{value:F.specTight}, uSpecTightAmt:{value:F.specTightAmt},
      uSpecBroad:{value:F.specBroad}, uSpecBroadAmt:{value:F.specBroadAmt},
      uFillTight:{value:F.fillTight}, uFillTightAmt:{value:F.fillTightAmt},
      uFillBroad:{value:F.fillBroad}, uFillBroadAmt:{value:F.fillBroadAmt},
      uThrough:{value:F.through}, uRimAmt:{value:F.rimAmt},
      uFogCol:{ value: col(HAZE) }, uFogNear:{ value: FOG_NEAR }, uFogFar:{ value: FOG_FAR }
    },
    vertexShader:`
      varying vec3 vW, vNw, vTanW, vBitW, vCapW;
      varying vec2 vLuv; varying float vFace, vFog;
      uniform vec2 uHalf;
      void main(){
        vNw = normalize(mat3(modelMatrix) * normal);
        // The cap's tangent frame, carried into world space here because
        // modelMatrix is a VERTEX-stage built-in — three does not declare it in
        // the fragment prefix, so the bump normal has to be rotated on this side
        // of the pipe rather than on the other.
        vTanW = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
        vBitW = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
        vCapW = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
        vFace = normal.z;
        vLuv = (position.xy + uHalf) / (2.0 * uHalf);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vFog = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader:`
      precision highp float;
      varying vec3 vW, vNw, vTanW, vBitW, vCapW;
      varying vec2 vLuv; varying float vFace, vFog;
      uniform sampler2D uForm;
      uniform vec2 uTexel, uHalf;
      uniform float uBump, uGloss, uFogNear, uFogFar;
      uniform float uMirrorMix, uReflBase, uReflFres;
      uniform float uSpecTight, uSpecTightAmt, uSpecBroad, uSpecBroadAmt;
      uniform float uFillTight, uFillTightAmt, uFillBroad, uFillBroadAmt;
      uniform float uThrough, uRimAmt;
      uniform vec3 uSun, uSunCol, uFill, uFillCol, uSkyCol, uCore, uSkin, uDeep, uRim, uFogCol;
      ${GLSL_ENV}

      void main(){
        vec4 form = texture2D(uForm, vLuv);
        float dn = form.g;                       // 0 at the outline, 1 at the core
        float crease = form.b;

        // Normal across the flat cap, from the packed height. Central
        // difference rather than dFdx: the cap is one plane, so the screen-space
        // derivative of the height is fine in the middle and garbage at the
        // silhouette where the geometry turns away.
        float hL = texture2D(uForm, vLuv - vec2(uTexel.x, 0.0)).r;
        float hR = texture2D(uForm, vLuv + vec2(uTexel.x, 0.0)).r;
        float hD = texture2D(uForm, vLuv - vec2(0.0, uTexel.y)).r;
        float hU = texture2D(uForm, vLuv + vec2(0.0, uTexel.y)).r;
        vec3 bump = normalize(vec3(-(hR-hL) * uBump, -(hU-hD) * uBump, 2.0));

        // Only the cap gets the bump; the bevel and the walls already have real
        // geometry saying which way they face, and overriding them with a
        // texture lookup that has no idea about the third dimension is what
        // makes this kind of material look like a decal.
        float capness = smoothstep(0.35, 0.92, abs(vFace));
        // NOT sign(): on the extruded side walls normal.z is exactly 0, sign()
        // returns 0, the whole vector collapses and normalize() yields NaN.
        // capness is 0 there so the value looks discarded — but mix(a, NaN, 0.0)
        // is NaN, not a, and one NaN pixel turns the entire bloom pyramid and
        // therefore the entire frame black.
        float faceSign = vFace >= 0.0 ? 1.0 : -1.0;
        vec3 bumpW = normalize(bump.x*vTanW + bump.y*vBitW + bump.z*vCapW*faceSign);
        // The outlines are traced from the PNG's alpha and then simplified, and
        // simplification can leave slivers whose vertices are effectively
        // coincident. computeVertexNormals() hands those a zero-length normal,
        // normalize() turns that into NaN, and mix(NaN, x, t) is NaN for every t
        // — including t=1, because NaN*0 is NaN. A handful of such fragments is
        // invisible on its own and fatal once bloom blurs them across the frame.
        float nLen = length(vNw);
        vec3 nGeo = nLen > 1e-5 ? vNw / nLen : vCapW * faceSign;
        vec3 N = normalize(mix(nGeo, bumpW, capness));

        vec3 V = normalize(cameraPosition - vW);
        vec3 L = uSun;
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float ndl = dot(N, L);
        float fres = pow(1.0 - ndv, 4.0);

        // ── transmission ──────────────────────────────────────────────
        // The key light is behind the wordmark, so almost everything the front
        // faces show is light that came THROUGH them. Thick centres absorb and
        // go deep rose; thin edges pass nearly everything and go cream. This
        // term, not the diffuse one, is what carries the colour.
        float thin = 1.0 - dn;
        // Absorption is deliberately shallow (0.42, not 0.85). The letters are
        // shallow relative to their width, so a thick centre is only a little
        // darker than a thin edge — pushing it further gave every stroke a
        // magenta core the reference does not have.
        vec3 absorb = mix(uCore, uDeep, dn * 0.42);
        float through = clamp(-ndl * 0.42 + 0.60, 0.0, 1.05);
        float glowBack = pow(clamp(dot(V, -L), 0.0, 1.0), 2.2);
        vec3 sss = absorb * uSunCol * through * (uThrough + 0.32 * glowBack)
                 + uRim * pow(thin, 2.4) * (0.10 + 0.24 * glowBack);

        // ── surface ───────────────────────────────────────────────────
        float wrapDiff = clamp((ndl + 0.55) / 1.55, 0.0, 1.0);
        // Sky fill kept low for the same reason as on the grass: it is the term
        // that turns a saturated pink shadow into a grey one. Measured p25 came
        // out #E8A3A5 (r−g = 69) against the reference's #F397A6 (r−g = 92).
        vec3 diff = uSkin * (uSunCol * wrapDiff * 0.26 + uSkyCol * (0.42 + 0.30 * N.y) * 0.16);

        // ── reflection ────────────────────────────────────────────────
        // Sky on the upward faces, turf on the downward ones. This is the whole
        // reason the env map is drawn as two hemispheres and not as a studio
        // grey — the green kick along the bottom of every letter is the single
        // most recognisable thing about the reference.
        vec3 Rv = reflect(-V, N);
        vec3 mirror = envSharp(Rv);
        vec3 broad  = envBlur(Rv);
        vec3 refl = mix(broad, mirror, uMirrorMix) * (uReflBase + uReflFres * fres) * uGloss;

        // ── highlights ────────────────────────────────────────────────
        // Two speculars, for the same reason the reference render clearly has
        // two lights. The key is behind the letters, so its highlight only ever
        // lands on the far bevel — it can rim them but it can never make them
        // look WET from the front. uFill is a front-upper-left source that
        // exists purely to put the streak down each tube that says "glass".
        vec3 Hk = normalize(L + V);
        float ndhK = clamp(dot(N, Hk), 0.0, 1.0);
        vec3 Hf = normalize(uFill + V);
        float ndhF = clamp(dot(N, Hf), 0.0, 1.0);
        vec3 spec = (uSunCol  * (pow(ndhK, uSpecTight) * uSpecTightAmt + pow(ndhK, uSpecBroad) * uSpecBroadAmt)
                   + uFillCol * (pow(ndhF, uFillTight) * uFillTightAmt + pow(ndhF, uFillBroad) * uFillBroadAmt)) * uGloss;
        // Rim: the cream outline in the reference sits where the surface turns
        // away AND the letter is thin, i.e. on the bevel, not on the cap.
        float rim = pow(1.0 - ndv, 2.4) * smoothstep(0.0, 0.55, thin);
        vec3 rimC = uRim * rim * uRimAmt;

        vec3 c = sss + diff + refl + spec + rimC;
        c *= 1.0 - crease * 0.42;                 // the seam between two letters
        c = mix(c, uFogCol, smoothstep(uFogNear, uFogFar, vFog));
        gl_FragColor = vec4(c, 1.0);
      }`
  });

  // Real volume transmission for the material-study page. Unlike the shader
  // above, this refracts the already-rendered sky and sun glow through the
  // object. The thickness map is the wordmark's own distance field: edges pass
  // light almost clear, while stroke centres travel through more pink medium
  // and absorb toward rose, matching the reference's milky translucency.
  const mat = O.materialMode === 'physical' ? new THREE.MeshPhysicalMaterial({
    color: O.physicalColor || 0xF6A0BA,
    roughness: O.physicalRoughness ?? 0.34,
    metalness: 0,
    transmission: O.physicalTransmission ?? 0.72,
    thickness: O.physicalThickness ?? 1.55,
    thicknessMap: thicknessTex,
    attenuationColor: new THREE.Color(O.attenuationColor || 0xF47FA5),
    attenuationDistance: O.attenuationDistance ?? 1.15,
    ior: O.ior ?? 1.36,
    emissive: new THREE.Color(O.edgeGlowColor || 0x000000),
    emissiveMap: edgeTex,
    emissiveIntensity: O.edgeGlowIntensity ?? 0,
    specularIntensity: 0.42,
    specularColor: new THREE.Color(0xFFF3F4),
    clearcoat: 0.08,
    clearcoatRoughness: 0.48,
    sheen: 0.18,
    sheenColor: new THREE.Color(0xFFD6E1),
    sheenRoughness: 0.82,
    alphaMap: maskTex,
    // Keep the inflated front overlapping the traced connector wall by a
    // fraction of a source pixel. At oblique angles a 0.5 threshold erodes the
    // minified alpha mask and exposes the transparent clear colour as a white
    // hairline between the two otherwise touching surfaces.
    alphaTest: O.alphaTest ?? 0.5,
    alphaToCoverage: true,
    side: THREE.FrontSide
  }) : shaderMat;
  // The supplied PNG is already a finished studio render. Re-lighting those
  // pixels is precisely what made the logo turn pale and balloon-like, so the
  // front projection is deliberately tone-map independent. Depth, silhouette,
  // and occlusion remain real geometry; the visible front evidence comes
  // directly from the admitted reference.
  const frontMat = referenceBodyTex ? new THREE.MeshBasicMaterial({
    color: O.mapStripped ? (O.sideColor || O.physicalColor || 0xD96A9D) : 0xFFFFFF,
    map: O.mapStripped ? null : referenceBodyTex,
    alphaMap: useReferencePillow ? maskTex : null,
    alphaTest: useReferencePillow ? (O.alphaTest ?? 0.5) : 0,
    // Alpha-to-coverage turns a soft PNG edge into a stippled coverage mask.
    // On a white canvas that reads as the broken white seam seen around the
    // whole wordmark, even when the underlying 3D shell is watertight.
    alphaToCoverage: false,
    side: THREE.FrontSide,
    toneMapped: false
  }) : mat;
  // The studio reference carries its own bright front shading. If the sides
  // are lit separately with PBR they inevitably read as a different pink at
  // grazing angles. This opt-in route deliberately uses the same stable pink
  // on every non-projected surface, so the object reads as one candy colour.
  const unifiedReferenceSides=Boolean(referenceBodyTex&&O.referenceSideUnifiedColor);
  const unifiedReferenceSideMat=unifiedReferenceSides?new THREE.MeshBasicMaterial({
    color:O.physicalColor || 0xE67BAA,
    side:THREE.DoubleSide,
    toneMapped:false
  }):null;
  // The back pillow is a full height-field grid, so it still needs the logo
  // alpha mask. It cannot share the unmasked side material or the whole grid
  // becomes the large rectangular pink plate seen in the failed preview.
  const unifiedReferenceBackMat=unifiedReferenceSides?new THREE.MeshBasicMaterial({
    color:O.physicalColor || 0xE67BAA,
    alphaMap:useReferencePillow?maskTex:null,
    alphaTest:useReferencePillow?(O.alphaTest ?? .08):0,
    alphaToCoverage:false,
    side:THREE.FrontSide,
    toneMapped:false
  }):null;
  const backMat=referenceBodyTex?(unifiedReferenceBackMat || mat.clone()):mat;
  if(referenceBodyTex&&!unifiedReferenceSides){
    backMat.alphaMap=useReferencePillow?maskTex:null;
    backMat.alphaTest=useReferencePillow?(O.alphaTest ?? 0.5):0;
    backMat.alphaToCoverage=false;
    backMat.thicknessMap=null;backMat.transmission=0;
    backMat.emissiveMap=null;backMat.emissive.set(0x000000);backMat.emissiveIntensity=0;
    // Give the inferred rear a broad, continuous molded form without bringing
    // back the stepped alpha height-field silhouette at oblique angles.
    backMat.bumpMap=useReferencePillow?null:formTex;
    backMat.bumpScale=useReferencePillow?0:(O.backBumpScale ?? .16);
  }

  const grp = new THREE.Group();
  grp.name = 'KANDy_3D_Wordmark';
  let triangles = geo.index ? geo.index.count/3 : geo.attributes.position.count/3;
  const smoothSolid = O.geometryMode === 'solid';
  // In one-piece mode the traced, beveled ExtrudeGeometry already owns the
  // complete silhouette. Keeping the PNG alpha mask on it would only carve a
  // second, unrelated pixel edge into an otherwise watertight object.
  if(smoothSolid && mat.isMeshPhysicalMaterial){
    mat.alphaMap=null;mat.alphaTest=0;mat.alphaToCoverage=false;
    mat.thicknessMap=null;mat.emissiveMap=null;
    mat.transmission=0;mat.needsUpdate=true;
  }
  if (O.geometryMode === 'inflated'){
    if(O.unifiedInflatedBody){
      const fingerprint=imageFingerprint(px);
      let bodyGeometry=restoreWordmarkGeometry(await prebuiltGeometry,geometrySignature(opts),fingerprint);
      const precomputed=Boolean(bodyGeometry);
      if (!bodyGeometry) bodyGeometry=await makeImplicitInflatedBody();
      bodyGeometry.userData.sourceImageFingerprint=fingerprint;
      bodyGeometry.userData.precomputed=precomputed;
      const frontSurfaceMat=referenceBodyTex?frontMat.clone():mat;
      if(referenceBodyTex){
        // The geometry already ends exactly on the traced contour. A second
        // alpha cut would create a smaller, unrelated edge and bring the white
        // fringe back even though the mesh itself is closed.
        frontSurfaceMat.alphaMap=null;
        frontSurfaceMat.alphaTest=0;
        frontSurfaceMat.alphaToCoverage=false;
        frontSurfaceMat.transparent=false;
        frontSurfaceMat.depthWrite=true;
        frontSurfaceMat.needsUpdate=true;
      }
      const sideSurfaceMat=O.materialMode==='physical'?mat.clone():mat;
      if(sideSurfaceMat.isMeshPhysicalMaterial){
        sideSurfaceMat.alphaMap=null;
        sideSurfaceMat.alphaTest=0;
        sideSurfaceMat.alphaToCoverage=false;
        sideSurfaceMat.thicknessMap=null;
        sideSurfaceMat.transmission=0;
        sideSurfaceMat.color.set(O.sideColor || O.physicalColor || 0xF18AAE);
        // Broad side highlights read as a polished molded candy. A very sharp
        // clearcoat magnifies sub-pixel normal changes into false dents even
        // when the underlying surface is smooth and watertight.
        sideSurfaceMat.roughness=O.sideRoughness ?? O.physicalRoughness ?? .30;
        sideSurfaceMat.clearcoat=O.sideClearcoat ?? .46;
        sideSurfaceMat.clearcoatRoughness=O.sideClearcoatRoughness ?? .36;
        sideSurfaceMat.specularIntensity=O.sideSpecularIntensity ?? .58;
        sideSurfaceMat.envMapIntensity=O.sideEnvMapIntensity ?? .78;
        sideSurfaceMat.emissiveMap=null;
        sideSurfaceMat.emissive.set(O.sideColor || O.physicalColor || 0xF18AAE);
        sideSurfaceMat.emissiveIntensity=.10;
        sideSurfaceMat.needsUpdate=true;
      }
      const blendReferenceAcrossSurface=Boolean(referenceBodyTex&&O.referenceSurfaceBlend!==false&&sideSurfaceMat.isMeshPhysicalMaterial);
      if(blendReferenceAcrossSurface){
        const blendStart=THREE.MathUtils.clamp(O.referenceSurfaceBlendStart ?? .28,-1,1);
        const blendEnd=THREE.MathUtils.clamp(O.referenceSurfaceBlendEnd ?? .78,blendStart+.01,1);
        sideSurfaceMat.onBeforeCompile=shader=>{
          shader.uniforms.uKandyReferenceMap={value:referenceBodyTex};
          shader.uniforms.uKandyBlendStart={value:blendStart};
          shader.uniforms.uKandyBlendEnd={value:blendEnd};
          shader.vertexShader=shader.vertexShader
            .replace('#include <common>','#include <common>\nvarying vec2 vKandyReferenceUv;\nvarying float vKandyObjectNormalZ;')
            .replace('#include <uv_vertex>','#include <uv_vertex>\nvKandyReferenceUv = uv;')
            .replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nvKandyObjectNormalZ = normalize( objectNormal ).z;');
          shader.fragmentShader=shader.fragmentShader
            .replace('#include <common>','#include <common>\nuniform sampler2D uKandyReferenceMap;\nuniform float uKandyBlendStart;\nuniform float uKandyBlendEnd;\nvarying vec2 vKandyReferenceUv;\nvarying float vKandyObjectNormalZ;')
            .replace('#include <colorspace_fragment>',`
              float kandyReferenceBlend = smoothstep( uKandyBlendStart, uKandyBlendEnd, vKandyObjectNormalZ );
              vec3 kandyReferenceColor = texture2D( uKandyReferenceMap, vKandyReferenceUv ).rgb;
              gl_FragColor.rgb = mix( gl_FragColor.rgb, kandyReferenceColor, kandyReferenceBlend );
              #include <colorspace_fragment>
            `);
        };
        sideSurfaceMat.customProgramCacheKey=()=>`kandy-reference-surface-${blendStart}-${blendEnd}`;
        sideSurfaceMat.needsUpdate=true;
      }
      const backSurfaceMat=blendReferenceAcrossSurface
        ?sideSurfaceMat
        :(sideSurfaceMat.clone?sideSurfaceMat.clone():sideSurfaceMat);
      const bodyMaterials=blendReferenceAcrossSurface
        ?[sideSurfaceMat,sideSurfaceMat,sideSurfaceMat]
        :[frontSurfaceMat,sideSurfaceMat,backSurfaceMat];
      const body=new THREE.Mesh(bodyGeometry,bodyMaterials);
      body.name='KANDy_Inflated_Body';
      body.userData.partId='body-solid';
      body.userData.componentId='body-shell';
      body.userData.continuousBody=true;
      body.userData.surfaceTopology='continuous-sculpt';
      body.userData.sampleAtUv=(u,v)=>{
        const pxX=THREE.MathUtils.clamp(u*MW-.5,0,MW-1);
        const pxY=THREE.MathUtils.clamp((1-v)*MH-.5,0,MH-1);
        const sample=(x,y)=>{
          const sx=THREE.MathUtils.clamp(x,0,MW-1),sy=THREE.MathUtils.clamp(y,0,MH-1);
          const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(MW-1,x0+1),y1=Math.min(MH-1,y0+1);
          const tx=sx-x0,ty=sy-y0;
          const a=geomHeight[y0*MW+x0]*(1-tx)+geomHeight[y0*MW+x1]*tx;
          const b=geomHeight[y1*MW+x0]*(1-tx)+geomHeight[y1*MW+x1]*tx;
          return a*(1-ty)+b*ty;
        };
        const h=sample(pxX,pxY);
        const hL=sample(pxX-1,pxY),hR=sample(pxX+1,pxY);
        const hD=sample(pxX,pxY+1),hU=sample(pxX,pxY-1);
        const lift=halfStroke*(O.frontInflate ?? 1.18);
        const dzdx=(hR-hL)*lift/(2*S);
        const dzdy=(hU-hD)*lift/(2*S);
        return {
          position:new THREE.Vector3((u-.5)*LOGO_W_UNITS-ctr.x,(v-.5)*(LOGO_W_UNITS*MH/MW)-ctr.y,h*lift),
          normal:new THREE.Vector3(-dzdx,-dzdy,1).normalize()
        };
      };
      grp.add(body);
      triangles=bodyGeometry.index.count/3;
      grp.userData.pillowMeshes=[body];
      grp.userData.materials=O.materialMode==='physical'
        ?bodyMaterials
        :[mat];
      grp.userData.referenceProjection=Boolean(referenceBodyTex);
      grp.userData.referenceSurfaceBlend=blendReferenceAcrossSurface;
      grp.userData.continuousBody=true;
      grp.userData.surfaceTopology='continuous-sculpt';
      geo.dispose();
    } else {
    // Physical pillow surfaces are alpha-clipped from a full grid, so their
    // silhouette reaches the traced contour without the gaps produced by a
    // sparse inside-only mesh. Only the rounded connector wall is visible;
    // keeping the old flat caps would create a second refractive layer.
    // The extruded lid stays invisible: a second transmissive cap behind the
    // pillow samples the white transmission buffer and reappears as a pale
    // contour at oblique angles. The lower alpha threshold above already makes
    // the pillow overlap the connector wall by a sub-pixel, so no lid is needed.
    const sideMat=referenceBodyTex
      ? (unifiedReferenceSideMat || (O.referenceSidePhysical ? mat.clone() : new THREE.MeshBasicMaterial({
          color:O.sideColor || O.physicalColor || 0xD96A9D,
          side:THREE.DoubleSide,
          toneMapped:false
        })))
      : (O.materialMode==='physical'?mat.clone():mat);
    if(O.materialMode==='physical'&&sideMat.isMeshPhysicalMaterial){
      sideMat.alphaMap=null;sideMat.alphaTest=0;sideMat.alphaToCoverage=false;
      sideMat.thicknessMap=null;sideMat.thickness=(O.physicalThickness ?? 1.55)*0.62;
      // A low-transmission, non-emissive waist closes the side view in pink.
      // With the main material here the transparent-canvas transmission pass
      // turns the narrow wall white, which looks exactly like an empty gap.
      sideMat.transmission=O.sideTransmission ?? 0.10;
      sideMat.color.set(O.sideColor || O.physicalColor || 0xF6A0BA);
      sideMat.roughness=Math.max(sideMat.roughness,.58);
      sideMat.clearcoat=0;sideMat.specularIntensity=.12;sideMat.envMapIntensity=.24;
      sideMat.sheen=0;
      sideMat.emissiveMap=null;sideMat.emissive.set(0x000000);sideMat.emissiveIntensity=0;
    }
    const sideGeo=makeSmoothSideWall();
    const shell = new THREE.Mesh(sideGeo,sideMat);
    shell.name = 'KANDy_Side_Shell';
    const frontGeo=referenceBodyTex&&!useReferencePillow?makeReferenceCap(true):makePillow(true);
    const backGeo=referenceBodyTex&&!useReferencePillow?makeReferenceCap(false):makePillow(false);
    const frontMesh=new THREE.Mesh(frontGeo,frontMat), backMesh=new THREE.Mesh(backGeo,backMat);
    // Only the alpha-clipped pillow route needs a backup contour cap. The
    // reference-cap route is already a precise closed shape, and adding one
    // there would reintroduce the layered edge we are intentionally removing.
    let contourSeal=null;
    if(useReferencePillow){
      const sealMat=sideMat.clone();
      sealMat.side=THREE.FrontSide;
      sealMat.depthWrite=true;
      contourSeal=new THREE.Mesh(makeReferenceCap(true),sealMat);
      contourSeal.name='KANDy_Contour_Seal';
      contourSeal.position.z=halfStroke*(O.frontSealLift ?? .045);
    }
    frontMesh.name = 'KANDy_Front_Pillow';
    backMesh.name = 'KANDy_Back_Pillow';
    shell.userData.partId = 'shell';
    if(contourSeal)contourSeal.userData.partId = 'contour-seal';
    frontMesh.userData.partId = 'front-face';
    backMesh.userData.partId = 'back-face';
    frontMesh.userData.edgeOnCulls=true;
    backMesh.userData.edgeOnCulls=true;
    shell.userData.componentId = 'side-wall';
    if(contourSeal)contourSeal.userData.componentId = 'side-wall';
    frontMesh.userData.componentId = 'front-skin';
    backMesh.userData.componentId = 'back-skin';
    if(referenceBodyTex&&!useReferencePillow){
      frontMesh.userData.sampleAtUv=(u,v)=>({
        position:new THREE.Vector3((u-.5)*LOGO_W_UNITS-ctr.x,(v-.5)*(LOGO_W_UNITS*MH/MW)-ctr.y,0),
        normal:new THREE.Vector3(0,0,1)
      });
    }
    grp.add(shell);
    if(contourSeal)grp.add(contourSeal);
    grp.add(frontMesh,backMesh);
    triangles = sideGeo.index.count/3 + frontGeo.index.count/3 + backGeo.index.count/3;
    grp.userData.pillowMeshes=[frontMesh,backMesh];
    grp.userData.materials=O.materialMode==='physical'?[frontMat,sideMat,backMat]:[mat];
    grp.userData.referenceProjection=Boolean(referenceBodyTex);
    }
  } else {
    // A single bevelled, closed mesh: unlike the old height-field pillow plus
    // side shell, this has no independently sampled front/side boundary, so
    // its silhouette stays continuous from every orbit angle.
    const solid=new THREE.Mesh(geo,mat);
    solid.name='KANDy_Smooth_Solid';
    solid.userData.partId='body-solid';
    solid.userData.componentId='body-shell';
    solid.userData.sampleAtUv=(u,v)=>({
      position:new THREE.Vector3((u-.5)*LOGO_W_UNITS-ctr.x,(v-.5)*(LOGO_W_UNITS*MH/MW)-ctr.y,0),
      normal:new THREE.Vector3(0,0,1)
    });
    grp.add(solid);
    grp.userData.pillowMeshes=[solid];
    grp.userData.materials=[mat];
    grp.userData.referenceProjection=false;
  }

  // `MeshPhysicalMaterial.transmission` depends on Three's full-screen
  // transmission buffer. Some host post pipelines render their scene into a
  // private target before output, which makes that buffer black. This optional
  // shader addition preserves the *volumetric* part of the reference without
  // sampling the screen: a rear sun scatters warmly through only the thinnest
  // candy. It intentionally stays on the two pillowed faces; the shared side
  // wall remains a dense pink volume, so an oblique view never turns into a
  // bright empty seam.
  if (O.materialMode === 'physical' && O.sunScatter > 0){
    const scatterDir = (O.sunScatterDir || SUN_DIR).clone().normalize();
    const scatterColor = new THREE.Color(O.sunScatterColor || 0xFFF0D5);
    mat.onBeforeCompile = shader => {
      shader.uniforms.uCandySunScatterDir = { value: scatterDir };
      shader.uniforms.uCandySunScatterColor = { value: scatterColor };
      shader.uniforms.uCandySunScatter = { value: O.sunScatter };
      shader.uniforms.uCandyThicknessMap = { value: thicknessTex };
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
uniform vec3 uCandySunScatterDir;
uniform vec3 uCandySunScatterColor;
uniform float uCandySunScatter;
uniform sampler2D uCandyThicknessMap;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        `vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
// A sun behind the front surface illuminates the interior. The distance map is
// deliberately non-linear: the first thin band glows cream, while the core is
// still only faintly lifted and keeps its dense rose-pink colour.
vec3 candyWorldNormal = normalize( inverseTransformDirection( normal, viewMatrix ) );
// The face's alpha mask is the UV source that stays defined on this material
// even when native transmission is disabled by the host pipeline.
float candyThin = 1.0 - texture2D( uCandyThicknessMap, vAlphaMapUv ).r;
float candyBackLit = pow( clamp( dot( -candyWorldNormal, normalize( uCandySunScatterDir ) ), 0.0, 1.0 ), 1.18 );
float candyScatterMask = mix( 0.10, 1.0, smoothstep( 0.06, 0.82, candyThin ) );
outgoingLight += uCandySunScatterColor * candyBackLit * candyScatterMask * uCandySunScatter;`
      );
      mat.userData.candyScatterShader = shader;
    };
    mat.customProgramCacheKey = () => 'kandy-milky-sun-scatter-v1';
    mat.needsUpdate = true;
  }
  grp.userData.material = mat;
  const frontDepth=useReferencePillow?halfStroke*(O.frontInflate || 1.18):0;
  const backDepth=useReferencePillow?halfStroke*(O.backInflate || 0.72):0;
  const totalDepth=size.z+frontDepth+backDepth;
  grp.userData.componentId = 'body-shell';
  grp.userData.halfExtent = { x: size.x/2, y: size.y/2, z: totalDepth/2 };
  grp.userData.depthRange = { min: -size.z-backDepth, max: frontDepth, total: totalDepth };
  grp.userData.triangles = triangles;
  const solidNode=grp.getObjectByName('KANDy_Smooth_Solid');
  const inflatedBodyNode=grp.getObjectByName('KANDy_Inflated_Body');
  const frontNode=grp.getObjectByName('KANDy_Front_Pillow') || inflatedBodyNode || solidNode;
  const sideNode=grp.getObjectByName('KANDy_Side_Shell') || inflatedBodyNode;
  const backNode=grp.getObjectByName('KANDy_Back_Pillow') || inflatedBodyNode;
  const continuousBodyNode=inflatedBodyNode || solidNode;
  grp.userData.sculptRuntime = {
    actionReady: true,
    nodes: { root:grp, frontFace:frontNode, sideShell:sideNode, backFace:backNode },
    meshes: { frontFace:frontNode, sideShell:sideNode, backFace:backNode },
    sockets: {
      frontDecorationSurface: { id:'front-decoration-surface', parentPartId:'front-face', localNormal:[0,0,1] }
    },
    colliders: [{
      id:'wordmark-bounds', type:'box',
      size:[size.x,size.y,totalDepth], center:[0,0,(frontDepth-size.z-backDepth)*.5]
    }],
    destructionGroups: {
      body:continuousBodyNode?['body-solid']:['front-face','shell','back-face']
    },
    clickableParts: continuousBodyNode?['body-solid']:['front-face', 'back-face', 'shell'],
    explodableParts: continuousBodyNode?['body-solid']:['front-face', 'shell', 'back-face'],
    explodeAxis: new THREE.Vector3(0, 0, 1)
  };
  return grp;
}
