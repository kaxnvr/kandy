/* ═══════════════════════════════════════════════════════════════════════
   KANDy hero meadow — the three.js scene from Main page html/kandy-hero-3d.html,
   originally extracted from the standalone demo. The website preserves its
   meadow, lighting and candy geometry, with bounded render targets, a softer
   low-resolution post-processing path and visibility-controlled rendering.
   ═══════════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { EffectComposer }   from 'three/addons/postprocessing/EffectComposer.js';
import { MeadowBloomPass } from './meadow-bloom-pass.js?v=continuous-glow-1';
import { MeadowOutputPass } from './meadow-output-pass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildCandyWordmark } from './candy-wordmark.js?v=geometry-cache-1';
import { addCandyDecorations } from './kandy-logo-decorations.js';

export function createMeadow(opts = {}){
const hostCanvas = opts.canvas;
const LOGO_URL   = opts.logoUrl || "../Logo/kandy-logo-1600.png";
const UI = (id) => (opts.panel ? document.getElementById(id) : null);
// Opt-in for the website's phone composition; other mounts and desktops keep
// the approved camera. Resizing still reads the canvas's real CSS box.
const centeredPhoneLogo = opts.centeredPhoneLogo
  ? matchMedia('(max-width:700px) and (orientation:portrait), (max-width:950px) and (max-aspect-ratio:2/3)') : null;

/* ═══════════════════════════════════════════════════════════════════════
   THE ONE RULE IN THIS FILE
   Every ambient animation is a pure function of the loop phase φ = fract(t/T).
   Nothing accumulates (no `rot += dt`), because an accumulating value never
   returns to where it started and would leave a visible jump at the seam.
   Anything periodic in φ — sin/cos of 2πnφ, or fract(kφ) with integer k —
   is automatically identical at φ=1 and φ=0. That is what makes the shot
   loop forever, and what would make it export as a seamless video.
   The mouse parallax is deliberately OUTSIDE this rule: it is interactive,
   not part of the loop.
   ═══════════════════════════════════════════════════════════════════════ */
const T = 24;                          // loop period, seconds
const TAU = Math.PI * 2;

const canvas   = hostCanvas;
const reduced  = matchMedia('(prefers-reduced-motion:reduce)').matches;

/* ─────────────────────────── quality tier ───────────────────────────
   Picked once from what the device actually reports, then allowed to drift
   downwards at runtime. Blade count is fixed at build time — rebuilding 38k
   instances mid-flight costs a visible hitch — so everything the adaptive loop
   touches (resolution, DOF, bloom) is something that is free to change between
   frames. Nothing here alters a single colour. */
// `ridge` is the second grass field: the ground behind and either side of
// the mound. It covers more of the frame than the name suggests — it is what
// fills the wedges left and right of the mound that used to be bare sky —
// but each blade out there is scaled up with distance, so it still needs
// fewer than the meadow for the same apparent density.
const TIERS = {
  high: { blades:38000, ridge:170000, dpr:1.75, bloom:true, dof:true, blurSamples:24, blurScale:.5, bladeSegments:5, shadowSize:2048, minDprScale:.62, daisies:190, petals:11, flutters:0, fg:14 },
  mid:  { blades:22000, ridge:95000,  dpr:1.60, bloom:true, dof:true, blurSamples:12, blurScale:.4, bladeSegments:4, shadowSize:1536, minDprScale:.72, daisies:120, petals:8, flutters:0, fg:10 },
  // Portrait puts the camera much closer to the turf than landscape does, and
  // below ~12k the dome starts showing through between the blades.
  low:  { blades:12000, ridge:45000,  dpr:1.35, bloom:false, dof:true, blurSamples:8, blurScale:.33, bladeSegments:3, shadowSize:1024, minDprScale:.78, daisies:70, petals:5, flutters:0, fg:7 }
};
const tierName = (() => {
  // Explicit override for isolated quality comparisons; normal pages auto-detect.
  if (Object.hasOwn(TIERS, opts.qualityTier)) return opts.qualityTier;
  const coarse = matchMedia('(pointer:coarse)').matches;
  const small  = Math.min(innerWidth, innerHeight) < 820;
  const cores  = navigator.hardwareConcurrency || 4;
  let gpu = '';
  try {
    const g = document.createElement('canvas').getContext('webgl2') ||
              document.createElement('canvas').getContext('webgl');
    const dbg = g && g.getExtension('WEBGL_debug_renderer_info');
    if (dbg) gpu = String(g.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).toLowerCase();
  } catch(e){}
  // Software rasterisers and older mobile parts cannot hold 60fps with 38k
  // blades plus two full-screen passes; demote them before the first frame
  // rather than letting the adaptive path stutter its way down.
  const weak = /swiftshader|llvmpipe|software|mali|adreno [1-5]|powervr|intel.*(hd|uhd) graphics (5|6)/.test(gpu);
  if (weak || (coarse && small)) return 'low';
  // Window size is deliberately NOT a signal on its own: a desktop user who
  // drags the window narrow has not changed GPUs.
  if (coarse || cores <= 4) return 'mid';
  return 'high';
})();
const Q = { ...TIERS[tierName] };
// The low-tier override also exposes the real phone turf treatment to the
// isolated quality preview; ordinary fine-pointer desktops keep their finish.
const mobileMeadow = tierName === 'low' || matchMedia('(pointer:coarse)').matches;

// Identical to the standalone demo's renderer, deliberately. An earlier
// revision added preserveDrawingBuffer:true here to stop a paused frame from
// compositing against a cleared buffer — but that turned out to be reasoning
// about a problem setPaused already solves by painting immediately on resume,
// and preserveDrawingBuffer is itself a known source of flicker and lost
// throughput on several drivers. The demo does not have it and does not
// flicker; the mounted copy should differ from it as little as possible.
const renderer = new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
// Only the logo key casts shadows. Its shadow camera is isolated to the logo
// layer below, so this restores the standalone candy's self-shadowing without
// adding a shadow-rendering cost to the meadow.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Camera motion does not change a light-space shadow. Rebuild only when the
// candy itself moves, rather than once for every post-processing scene pass.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

const scene = new THREE.Scene();
// Optional top layer for airborne elements that deliberately stay outside the
// meadow's DOF/bloom chain. Dandelion seeds belong to the main scene instead,
// so their own distance from the camera naturally controls how sharp they are.
const flutterScene = new THREE.Scene();
const airFill = new THREE.HemisphereLight(0xFFFFFF, 0xE8EEF2, 2.1);
const airKey = new THREE.DirectionalLight(0xFFFFFF, 1.35);
airKey.position.set(4, 7, 6);
flutterScene.add(airFill, airKey);
const SKY_TOP = 0x4F91CE, SKY_MID = 0x9AC8EA, SKY_LOW = 0xDCF2F7;
// Warm horizon glow, sky-dome only. Kept separate from SKY_LOW (which still
// drives fog/ridge-haze) so the richer, more photographic sky gradient does
// not also tint the distant grass warm.
const SKY_HORIZON = 0xF6ECD6;
// A resize temporarily exposes freshly allocated render targets. Clear them to
// the existing horizon colour so even a missed draw cannot present black.
// This is only a fallback clear; every normal frame is painted over it.
renderer.setClearColor(SKY_LOW, 1);
// Safety net behind the gradient plane: when the pointer swings the camera the
// frustum can just clear the plane's edge, and the fallback there must not be
// the default black clear colour.
scene.background = new THREE.Color(SKY_MID);
scene.fog = new THREE.Fog(new THREE.Color(SKY_LOW), 14, 62);

// near/far are pulled in tight around what the shot actually contains: the DOF
// pass reads the depth buffer, and a 0.1→200 range wastes almost all of its
// precision on empty space in front of the nearest blade.
const camera = new THREE.PerspectiveCamera(38, 1, 1.0, 130);
const CAM_BASE = new THREE.Vector3(0, 0.95, 7.5);
const LOOK_BASE = new THREE.Vector3(0, 0.80, 0);
camera.position.copy(CAM_BASE);

/* ─────────────────────────── canvas-drawn textures ───────────────────────
   Generated rather than loaded: five extra PNG round-trips for shapes this
   simple would cost more than the few ms of 2D canvas work, and it keeps the
   whole hero to a single image dependency (the wordmark). */
function tex(size, draw){
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const wingTex = tex(160, (g,s)=>{
  g.clearRect(0,0,s,s);
  // Restore the original pearl-white identity, now with enough cool translucency
  // and fine veining to keep the wings dimensional instead of leaf-like.
  const grd = g.createLinearGradient(s*0.04,s*0.5,s*0.94,s*0.5);
  grd.addColorStop(0,'rgba(255,255,255,0.99)');
  grd.addColorStop(0.55,'rgba(248,252,255,0.96)');
  grd.addColorStop(1,'rgba(206,234,246,0.78)');
  g.fillStyle = grd;
  // One complete side of a swallowtail-like butterfly, hinged at the body.
  // Mirroring this mesh makes the two wings naturally symmetrical.
  g.beginPath();
  g.moveTo(s*0.04, s*0.50);
  g.bezierCurveTo(s*0.07, s*0.13, s*0.42, s*0.04, s*0.83, s*0.14);
  g.bezierCurveTo(s*0.98, s*0.22, s*0.88, s*0.40, s*0.43, s*0.50);
  g.bezierCurveTo(s*0.83, s*0.61, s*0.91, s*0.80, s*0.72, s*0.93);
  g.bezierCurveTo(s*0.56, s*0.98, s*0.29, s*0.76, s*0.04, s*0.50);
  g.closePath(); g.fill();
  g.strokeStyle='rgba(140,190,212,0.46)'; g.lineWidth=s*0.026; g.stroke();

  // Fine veins radiate from the hinge. They remain subtle when the insect is
  // far away but give the wing a membrane structure in its closer passes.
  g.strokeStyle='rgba(132,174,194,0.28)'; g.lineWidth=s*0.010;
  for (const [x,y,cx,cy] of [
    [0.78,0.18,0.34,0.30], [0.70,0.36,0.38,0.42],
    [0.65,0.68,0.36,0.57], [0.59,0.86,0.31,0.67]
  ]){
    g.beginPath();
    g.moveTo(s*0.07,s*0.50);
    g.quadraticCurveTo(s*cx,s*cy,s*x,s*y);
    g.stroke();
  }

  // Small low-contrast spots, closer to what is visible on a brimstone wing.
  g.fillStyle='rgba(255,255,255,0.82)';
  g.beginPath(); g.arc(s*0.62,s*0.27,s*0.027,0,TAU); g.fill();
  g.beginPath(); g.arc(s*0.57,s*0.72,s*0.021,0,TAU); g.fill();
});

const daisyTex = tex(128, (g,s)=>{
  g.clearRect(0,0,s,s);
  g.translate(s/2,s/2);
  g.fillStyle='rgba(255,255,255,0.97)';
  for(let i=0;i<5;i++){
    g.save(); g.rotate(i/5*TAU);
    g.beginPath(); g.ellipse(0,-s*0.24,s*0.11,s*0.21,0,0,TAU); g.fill();
    g.restore();
  }
  g.fillStyle='#F3D45A';
  g.beginPath(); g.arc(0,0,s*0.11,0,TAU); g.fill();
});

// Heavy blur turned these into fog banks. A tight blur keeps a readable
// cumulus silhouette; the softness belongs at the edges, not the whole shape.
// Flat white on a flat sky reads as a sticker. Real cumulus has a lit,
// almost-white crown and a cool grey-blue underside — that value contrast is
// what sells "puffy 3D cloud" instead of "translucent blob", so the shadow
// puffs are drawn first (lower, cooler, wider) and the lit puffs on top
// (higher, whiter, tighter) rather than trying to fake it with mesh opacity.
//
// Reference is a rounded, domed cumulus mass (tall relative to its width,
// bumpy crown, flatter base) — not a horizontal wisp.
//
// One shared texture scaled to different sizes made every cloud on screen
// the same shape, just bigger or smaller — obviously repeated once two were
// visible at once. makeCloudTex() bakes the shading (white crown → cream →
// sun-warmed gold base) once and takes a different puff layout per call, so
// each of the three variants below is a genuinely different silhouette:
// tall single dome, wide twin-lobed mass, compact single blob.
// The puff layouts below are authored across the full 0-1 range, then squashed
// horizontally into the middle CLOUD_INSET of the canvas so a transparent
// margin is left on the left and right.
//
// That margin is not cosmetic — it is what stops the morph warp from tearing.
// The warp in cloudFrag shifts the sample coordinate by up to +/-0.10 in UV,
// and textures are ClampToEdge, so any sample pushed past the border repeats
// the border texel as a flat vertical streak that then ends dead-straight at
// the quad edge. Measured on the widest layout (twin) before this inset: alpha
// 32/255 at column 0, 92 at 2%, 250 at 10% — i.e. very nearly opaque right up
// to the border, which is exactly why the LARGEST cloud was the one showing a
// straight "cut" through it.
//
// 0.72 puts the nearest content edge at ~0.135 in UV (0.158 after the squash,
// minus the 6px blur bleed), comfortably clear of the 0.10 warp. The meshes
// divide their width by the same constant, so on-screen cloud size is
// unchanged. Raising the warp amplitude means lowering this to match.
const CLOUD_INSET = 0.72;

function makeCloudTex(body, crown){
  return tex(256, (g,s)=>{
    g.clearRect(0,0,s,s);
    // Squash about the horizontal centre. Applied to the coordinates rather
    // than via a canvas transform so the blur stays isotropic in device space.
    const ix = x => 0.5 + (x - 0.5) * CLOUD_INSET;
    // A two-layer flat-color shadow/highlight split left the warm tone mostly
    // hidden behind the white layer — only a thin rim showed. A single
    // vertical gradient across the whole mass (white crown → cream →
    // soft peach base) reads immediately instead of needing to be
    // looked for, and matches the reference's sun-warmed underside.
    //
    // The base was rgb(247,171,99) — a saturated gold that read as orange
    // against the blue sky rather than as sunlit white cloud. Lightening it to
    // (251,210,180) lifts it from 68% to 85% luminance and cuts the channel
    // spread from 148 to 71, so the warmth still reads but the cloud stays a
    // cloud. Going much paler than this loses the tint entirely, which was the
    // complaint two revisions before this one.
    const grad = g.createLinearGradient(0, s*0.22, 0, s*0.70);
    grad.addColorStop(0.00, 'rgba(255,255,255,0.98)');
    grad.addColorStop(0.45, 'rgba(255,243,230,0.94)');
    grad.addColorStop(1.00, 'rgba(251,210,180,0.86)');
    g.filter = 'blur(6px)';
    g.fillStyle = grad;
    for (const [x,y,r] of body){
      g.beginPath(); g.ellipse(ix(x)*s, y*s, r*CLOUD_INSET*s, r*s, 0, 0, TAU); g.fill();
    }

    // Bright crown highlight. This used to be a half-circle arc, which canvas
    // auto-closes with a dead-straight line across its flat bottom — a hard,
    // barely-blurred edge that the UV warp below could shear sideways into a
    // visible straight "cut" through the cloud. A full ellipse has no straight
    // edge anywhere for the warp to tear, and the extra blur keeps it soft.
    g.filter = 'blur(6px)';
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath();
    g.ellipse(ix(crown[0])*s, crown[1]*s, crown[2]*CLOUD_INSET*s, crown[2]*s*0.72, 0, 0, TAU);
    g.fill();
  });
}

// Tall single dome: big central mass, two flanking shoulders, small crown
// bumps on top so the silhouette reads round rather than as a flat streak.
const cloudTexDome = makeCloudTex(
  [[0.50,0.46,0.215],[0.34,0.53,0.175],[0.66,0.53,0.175],
   [0.22,0.60,0.135],[0.78,0.60,0.135],[0.42,0.36,0.140],[0.58,0.36,0.140],
   [0.50,0.29,0.105],[0.30,0.44,0.105],[0.70,0.44,0.105]],
  [0.50,0.30,0.11]
);

// Wide twin-lobed mass: two fused domes side by side, lower and flatter —
// the "big sprawling cumulus" silhouette.
const cloudTexTwin = makeCloudTex(
  [[0.38,0.48,0.195],[0.64,0.46,0.205],[0.22,0.56,0.150],[0.80,0.54,0.155],
   [0.50,0.58,0.170],[0.30,0.38,0.115],[0.50,0.34,0.120],[0.70,0.36,0.115],
   [0.12,0.62,0.095],[0.88,0.60,0.095]],
  [0.42,0.28,0.09]
);

// Compact single blob, for the smaller supporting clouds — fewer lobes so it
// doesn't just read as a shrunk dome.
const cloudTexBlob = makeCloudTex(
  [[0.50,0.50,0.230],[0.34,0.56,0.150],[0.66,0.56,0.150],
   [0.46,0.36,0.130],[0.58,0.38,0.120],[0.50,0.30,0.090]],
  [0.50,0.32,0.085]
);

// The blur stays baked into this texture even though there is a real DOF pass
// now. The pass reads the depth buffer, and this blade is transparent with
// depthWrite off, so it never writes a depth for the pass to defocus — the
// lens sees the mound BEHIND it, decides that is nearly in focus, and would
// leave a razor-sharp dark wedge in the corner of the frame. Anything that
// does not write depth has to carry its own softness.
const blurBladeTex = mobileMeadow ? null : tex(256, (g,s)=>{
  g.clearRect(0,0,s,s);
  g.filter = 'blur(11px)';
  g.fillStyle = '#1E3F17';
  g.beginPath();
  g.moveTo(s*0.40, s);
  g.quadraticCurveTo(s*0.30, s*0.45, s*0.52, s*0.06);
  g.quadraticCurveTo(s*0.66, s*0.45, s*0.62, s);
  g.closePath(); g.fill();
});

/* ─────────────────────────── sky ─────────────────────────── */
{
  const g = new THREE.PlaneGeometry(1,1);
  const m = new THREE.ShaderMaterial({
    depthWrite:false, fog:false,
    uniforms:{ uTop:{value:new THREE.Color(SKY_TOP)},
               uMid:{value:new THREE.Color(SKY_MID)},
               uHorizon:{value:new THREE.Color(SKY_HORIZON)} },
    vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader:`
      varying vec2 vUv; uniform vec3 uTop,uMid,uHorizon;
      void main(){
        float y=vUv.y;
        // Warm horizon band is kept narrow (0-0.30) so most of the dome reads
        // as saturated blue like a real clear-day sky, with the glow only
        // showing as a thin strip where sky meets ground.
        vec3 c = y>0.30 ? mix(uMid,uTop,smoothstep(0.30,1.0,y))
                        : mix(uHorizon,uMid,smoothstep(0.0,0.30,y));
        gl_FragColor=vec4(c,1.);
      }`
  });
  const sky = new THREE.Mesh(g,m);
  sky.position.z = -90;
  sky.renderOrder = -10;
  scene.add(sky);
  scene.userData.sky = sky;
}

/* ─────────────────────────── lights ─────────────────────────── */
// The hero sun now sits behind-left of the letters, matching the reference:
// its warm light can travel through the logo's thin gummy skin, while the sky
// hemisphere keeps the foreground grass naturally visible.
const SUN_DIR = new THREE.Vector3(-0.30, 0.64, -0.71).normalize();
scene.add(new THREE.HemisphereLight(0xBFEAFA, 0x4E7A38, 1.5));
const sun = new THREE.DirectionalLight(0xFFF6E2, 2.5);
sun.position.copy(SUN_DIR).multiplyScalar(20);
scene.add(sun);
// The meadow keeps its established afternoon lighting. The candy uses the
// standalone viewer's exact four-light rig on its own layer; the background
// therefore cannot recolour or flatten the logo, and the meadow is unchanged.
const LOGO_LIGHT_LAYER = 1;
camera.layers.enable(LOGO_LIGHT_LAYER);
const logoHemi = new THREE.HemisphereLight(0xFFF8FA, 0xD878A2, .52);
logoHemi.layers.set(LOGO_LIGHT_LAYER);
scene.add(logoHemi);
const logoKey = new THREE.DirectionalLight(0xFFF1DF, 1.45);
logoKey.position.set(-5.5, 7.5, 7);
logoKey.castShadow = true;
logoKey.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
logoKey.shadow.camera.near = .5;
logoKey.shadow.camera.far = 35;
logoKey.shadow.camera.left = -7;
logoKey.shadow.camera.right = 7;
logoKey.shadow.camera.top = 5;
logoKey.shadow.camera.bottom = -5;
logoKey.shadow.camera.layers.set(LOGO_LIGHT_LAYER);
logoKey.shadow.bias = -.0005;
logoKey.shadow.normalBias = .025;
logoKey.layers.set(LOGO_LIGHT_LAYER);
scene.add(logoKey);
const logoRim = new THREE.DirectionalLight(0xF3A8C9, .55);
logoRim.position.set(5, 2, -6);
logoRim.layers.set(LOGO_LIGHT_LAYER);
scene.add(logoRim);
const logoFill = new THREE.DirectionalLight(0xFFE8F1, .16);
logoFill.position.set(-4, -2, 4);
logoFill.layers.set(LOGO_LIGHT_LAYER);
scene.add(logoFill);

/* ─────────────────────────── clouds ─────────────────────────── */
// A couple of bold, sculpted cumulus masses plus a few smaller supporting
// ones — matching the reference's composition of two dominant clouds rather
// than many thin wisps. Aspect is rounder (0.68) to match the domed texture
// above (was 0.52, tuned for the old horizontal-streak shape).
// k stays 1 for every entry: build() drives position with
// fract(phi*k+off), and the hero loops seamlessly over phi 0→1 only when
// phi*k returns to the same fractional value at both ends, which requires
// integer k.
//
// Shape isn't static: the fragment shader warps the texture-sample
// coordinate with two sine terms driven by uPhase, so the puffy silhouette
// bulges and settles over the loop instead of being a rigid decal. First
// pass used a single period-24s term at 0.03 amplitude and read as
// motionless — the rate of change near a sine's peak is tiny, so most of the
// loop showed almost no visible reshaping. The multipliers on uPhase must
// stay integers — that is what makes sin(uPhase*N*TAU + uOff*TAU) return to
// the same value at uPhase=0 and uPhase=1 regardless of uOff, closing the loop.
//
// The warp MUST vanish at the cloud's centre, which is why it is written as
// uv.x * k rather than as a plain sin(...) offset. A warp that is constant
// across x displaces the whole silhouette sideways, and since it oscillates,
// that displacement adds and subtracts from the steady drift — the previous
// version modulated apparent velocity by roughly +/-75% (drift 6.25 units/s
// against a warp contribution peaking near 4.8), which is what read as clouds
// lurching fast then slow. Scaling by uv.x makes it a breathe: the centre is
// pinned, the edges move in and out, the centroid never shifts, so drift stays
// perfectly even while the outline still changes.
const cloudVert = `
  varying vec2 vUv;
  void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;
const cloudFrag = `
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform float uOpacity, uPhase, uOff, uFade;
  void main(){
    vec2 uv = vUv - 0.5;
    float p  = uPhase + uOff;
    float t1 = p * 2.0 * ${TAU.toFixed(6)};
    float t2 = p * 3.0 * ${TAU.toFixed(6)};
    // Horizontal-only: a vertical component made the puffs slide up and down
    // inside the silhouette, which read as the whole cloud bobbing even though
    // its mesh position.y never moved.
    //
    // k is the breathe amount — see the note above on why this is multiplied
    // by uv.x instead of being added. The uv.y term makes different heights
    // breathe out of step with each other, so the outline genuinely reshapes
    // rather than just pumping wider and narrower as a rigid whole.
    //
    // Amplitudes are bounded on purpose: max |k| = 0.11 + 0.08 = 0.19, so max
    // |warp.x| = 0.5 * 0.19 = 0.095, just inside the 0.105 transparent margin
    // the widest texture has (see CLOUD_INSET). Raising either amplitude means
    // lowering CLOUD_INSET to match, or the smear returns.
    float k = sin(t1) * 0.11 + sin(t2 + uv.y*1.6) * 0.08;
    vec2 warp = vec2(uv.x * k, 0.0);
    // Belt and braces against the streak described at CLOUD_INSET: the inset
    // already guarantees the border texels are transparent, but masking any
    // sample that leaves 0-1 means a future amplitude bump can only shrink the
    // cloud, never smear a solid edge texel sideways into a hard-edged bar.
    vec2 wuv = uv + warp + 0.5;
    float inside = step(0.0, wuv.x) * step(wuv.x, 1.0)
                 * step(0.0, wuv.y) * step(wuv.y, 1.0);
    vec4 c = texture2D(uMap, clamp(wuv, 0.0, 1.0));
    c.a *= inside;
    gl_FragColor = vec4(c.rgb, c.a * uOpacity * uFade);
  }
`;
// Travel per loop, as a multiple of the cloud's distance from the camera.
// Apparent crossing time is (visible width / world speed), and both sides
// carry a factor of distance, so this constant alone sets how long a cloud
// takes to cross the frame: about 22s at a 1.53 viewport aspect, 27s at 1.9.
// The old flat span of 150 worked out to ~2.9 here, i.e. an 8-9s crossing,
// which is what read as too fast.
//
// It is deliberately small enough that the u=1 -> u=0 wrap now happens ON
// screen, so CLOUD_FADE below has to hide it. Raising this back above ~2.0
// would put the wrap off screen again and make the fade redundant. That
// threshold is 1.31 (a frame width, at aspect 1.9) plus the widest cloud's
// width over its distance, so it moves whenever the largest w in defs does.
const CLOUD_SPAN_PER_UNIT = 1.15;
// Fraction of the run spent fading in, and again fading out. Clouds forming
// and dissipating is the one bit of cloud behaviour that can be faked with
// opacity without looking wrong, and it is the same trick the petals already
// use for their wrap.
const CLOUD_FADE = 0.18;

const clouds = [];
{
  const geo = new THREE.PlaneGeometry(1,1);
  // off is the ONLY thing that sets a cloud's horizontal place in the sky, and
  // that placement never changes. Screen x is proportional to (u - 0.5) where
  // u = fract(phi + off), and since span scales with distance the perspective
  // divide cancels out — so two clouds with neighbouring offs sit side by side
  // permanently rather than drifting apart later. The previous offs sorted to
  // 0.05 / 0.18 / 0.30 / 0.52 / 0.78 / 0.90, which left the two widest (both
  // the twin texture, and both high in the frame) only 0.15 apart and reading
  // as one crowded mass.
  //
  // These are spaced ~1/6 apart with a little jitter so the spread does not
  // look metronomic, ordered so that large and small alternate around the
  // cycle and the two biggest sit exactly opposite each other at 0.00/0.50.
  // Apparent size is w/distance; it is listed per row to make that ordering
  // checkable without re-deriving it.
  const defs = [
    { w:26, y:11.0, z:-44, op:0.92, off:0.00, tex:cloudTexTwin },  // 0.505 biggest
    { w:13, y:5.0,  z:-58, op:0.66, off:0.15, tex:cloudTexDome },  // 0.198 smallest
    { w:19, y:12.5, z:-48, op:0.80, off:0.34, tex:cloudTexTwin },  // 0.342
    { w:27, y:7.0,  z:-52, op:0.88, off:0.50, tex:cloudTexDome },  // 0.454 2nd biggest
    { w:11, y:3.6,  z:-34, op:0.58, off:0.66, tex:cloudTexBlob },  // 0.265
    { w:16, y:9.5,  z:-38, op:0.72, off:0.85, tex:cloudTexBlob },  // 0.352
  ];
  for (const d of defs){
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      transparent:true, depthWrite:false, fog:false,
      uniforms:{ uMap:{value:d.tex}, uOpacity:{value:d.op}, uPhase:{value:0},
                 uOff:{value:d.off}, uFade:{value:1} },
      vertexShader: cloudVert, fragmentShader: cloudFrag
    }));
    // Width is divided by CLOUD_INSET because the texture's silhouette was
    // squashed into that fraction of the canvas; the two cancel, so d.w still
    // means the same on-screen width it did before the inset was introduced.
    // Height is untouched — the squash is horizontal only.
    m.scale.set(d.w / CLOUD_INSET, d.w*0.68, 1);
    m.position.z = d.z;
    // span scales with distance from the camera, which is what makes every
    // cloud drift at the same APPARENT speed. Screen speed is world speed over
    // distance, so a fixed world span (the old flat 150) had the nearest cloud
    // at z=-34 crossing the frame ~1.6x faster than the one at z=-58 — the
    // clouds visibly disagreeing about how windy it was. span proportional to
    // distance cancels the divide exactly, leaving one shared angular rate.
    m.userData = { y: d.y, span: CLOUD_SPAN_PER_UNIT * (CAM_BASE.z - d.z),
                   off: d.off, k: 1 };
    m.renderOrder = -9;
    scene.add(m); clouds.push(m);
  }
}

/* ─────────────────────────── distant ridges ───────────────────────────
   Three bands instead of two flat discs. Each gets a wandering crest line
   displaced along its own silhouette and a vertical haze gradient, so the
   distance reads as layered land rather than as stacked paper cut-outs.
   The displacement is a pure function of position — nothing here animates, so
   it cannot break the loop. The two original colours are kept exactly; the
   third band is a new, paler layer further back. */
function ridge(r, y, z, near, far, hazeAmt, bump, seed, opts = {}){
  const m = new THREE.ShaderMaterial({
    fog:false,
    uniforms:{
      uNear:{value:new THREE.Color(near)}, uFar:{value:new THREE.Color(far)},
      uHaze:{value:new THREE.Color(SKY_LOW)}, uHazeAmt:{value:hazeAmt},
      uBump:{value:bump}, uSeed:{value:seed}, uR:{value:r},
      uCenterGrassFix:{value:opts.centerGrassFix || 0},
      // Rolling-hill amplitude, in world units. Zero for the two distant
      // bands, which keep the azimuth crest and nothing else; the ground in
      // front needs real relief, and relief on ground you can see the near
      // end of has to be a function of world position, not of angle around
      // a sphere axis 250 units below you.
      uRoll:{value:opts.roll || 0}
    },
    vertexShader:`
      uniform float uBump, uSeed, uR, uRoll;
      varying float vTop;
      varying vec2 vWorldXZ;

      // Broad rounded hills. The wavelengths are set against how much world
      // the skyline actually spans, which is much less than it looks: the
      // horizon sits ~38 units out, so across the full frame it covers only
      // about 40 units of x (and barely 5 of z — the horizon is nearly an arc
      // of constant range, so it is x that shapes the skyline). A first pass
      // used wavelengths of 58 to 140 units and measured as a single
      // monotonic ramp, 349px down to 424px across the frame, because less
      // than one period fitted on screen. ~27 units puts one and a half
      // swells in view, which is the reference.
      float roll(vec2 w){
        return sin(w.x*0.235 + 0.9) * cos(w.y*0.180 - 0.4) * 1.00
             + sin(w.x*0.128 - 2.1) * cos(w.y*0.105 + 1.7) * 0.62
             + sin((w.x*0.8 + w.y*0.6) * 0.150 + 2.6) * 0.55;
      }
      // Octaves keyed to the angle around the dome, so the crest wanders the
      // way a treeline does instead of being a clean arc. The top three are
      // the original silhouette; the last two are much finer and much
      // smaller, and exist because a perfectly smooth skyline is the single
      // clearest tell that a hill is a cut-out — vegetation makes an edge
      // slightly ragged. They stop at 31 harmonics because the sphere is
      // built with 240 width segments and anything past ~a*40 has fewer
      // than six segments per period, where it stops being a bumpy edge and
      // starts being aliasing.
      float crest(float a){
        return sin(a*3.0 + uSeed)*0.55 + sin(a*7.0 + uSeed*2.3)*0.28
             + sin(a*13.0 + uSeed*4.1)*0.13
             + sin(a*19.0 + uSeed*5.7)*0.055
             + sin(a*31.0 + uSeed*7.9)*0.030;
      }
      void main(){
        vec3 p = position;
        // The epsilon is load-bearing. A sphere's pole vertices are exactly
        // (0, ±r, 0), so both arguments are zero there and this driver
        // returns NaN. That was survivable while the angle only drove the
        // crest displacement — the vertex went NaN, the triangle dropped
        // out, and the fragment stage never saw it — but it is now also
        // handed to the fragment shader as vAz, and one NaN fragment is
        // enough for bloom's gaussian pyramid to smear it over the entire
        // frame (the whole hero rendered solid black). Verified by
        // bisection: this epsilon is the difference between a black frame
        // and a clean one.
        float a = atan(p.x, p.z + 1e-6);
        float up = clamp(p.y/uR, -1.0, 1.0);
        // only push the part of the sphere that forms the visible skyline
        float band = smoothstep(0.55, 1.0, up);
        p.y += crest(a) * uBump * band;
        if (uRoll > 0.0){
          vec2 w = (modelMatrix * vec4(position, 1.0)).xz;
          // Faded in with distance from the mound rather than from the
          // camera: hills belong in the middle distance, and the ground
          // immediately around the meadow has to stay flat or it would rise
          // through the mound in front of it. Anchored to the origin and not
          // to the camera on purpose — the camera drifts with the pointer
          // and breathes with the loop, and terrain that moved with it would
          // be both wrong and a seam in a loop that must close exactly.
          p.y += roll(w) * uRoll * smoothstep(8.0, 34.0, length(w));
        }
        vTop = up;
        vWorldXZ = (modelMatrix * vec4(p,1.0)).xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
      }`,
    fragmentShader:`
      uniform vec3 uNear,uFar,uHaze;
      uniform float uHazeAmt, uCenterGrassFix;
      varying float vTop;
      varying vec2 vWorldXZ;

      void main(){
        vec3 c = mix(uFar, uNear, smoothstep(0.60, 1.0, vTop));
        // No procedural turf here any more. An earlier pass mottled this
        // surface with warm/cool value noise to try to make it read as
        // grass; it never did — what makes grass read as grass is blades
        // catching light — and pushed hard enough to be visible at all it
        // threw pale, near-white patches that were worse than flat colour.
        // The ground behind now carries real blades (see the second grass
        // field), so this shell only has to be the soil under them, exactly
        // like the mound's plain dark green under the near meadow.

        // haze pools at the base of the range, the way real distance does
        c = mix(c, uHaze, uHazeAmt * (1.0 - smoothstep(0.62, 0.99, vTop)));
        // Only the rear-centre hill needs lifting. Keep the side ground and
        // the near mound unchanged, while brightening the soil visible in the
        // small gaps between this hill's blades to the surrounding grass level.
        float centerHill = uCenterGrassFix
          * (1.0 - smoothstep(18.0, 32.0, abs(vWorldXZ.x)))
          * (1.0 - smoothstep(0.0, 6.0, vWorldXZ.y));
        c *= 1.0 + centerHill*0.44;
        // Net kept even though the noise is gone: this pass feeds bloom, and
        // one NaN there costs the whole frame (it has happened here — see
        // the epsilon on the atan above). GLSL ES 1.0 has no isnan(), and
        // max(NaN, 0.0) returning 0.0 on a compare-based GPU is the only
        // filter available — so max MUST come first; min only clips Inf.
        // Every legitimate colour here is well inside [0,1], so this cannot
        // move a pixel that was already valid.
        gl_FragColor = vec4(min(max(c, vec3(0.0)), vec3(64.0)), 1.0);
      }`
  });
  // 240 width segments rather than 140: the crest function now carries
  // harmonics up to a*31, and 140 segments cannot resolve them.
  //
  // thetaLength exists for the ground, and it is the difference between
  // rolling hills and a flat plain. A full sphere spreads its 48 height
  // rings over the whole 180 degrees, and the ground's visible cap is only
  // about 17 degrees of that — three rings of vertices across everything you
  // can see, which cannot carry a displacement of any shape at all. Building
  // only the cap and giving it its own ring count puts the vertices where
  // the camera is actually looking.
  const geo = opts.thetaLength
    ? new THREE.SphereGeometry(r, opts.wSeg || 300, opts.hSeg || 150,
                               0, Math.PI*2, 0, opts.thetaLength)
    : new THREE.SphereGeometry(r, 240, 48);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(0, y, z);
  mesh.renderOrder = -8;
  scene.add(mesh);
  return mesh;
}
ridge(38, -37.0, -60, 0xD6E7EC, 0xC8DDE8, 0.62, 3.4, 0.0);   // furthest, almost sky
ridge(30, -29.4, -46, 0xBFDCC4, 0xCBE2D2, 0.34, 2.6, 2.1);

/* ─────────────────────────── the ground behind ───────────────────────────
   This was the third and nearest of the painted ridge bands, a 24 unit
   sphere. As a band it left the frame's outer thirds as bare sky: raycast
   against the live scene at 1585x900 put its skyline at y=782 on the left
   edge and off-frame entirely on the right, so the wedges either side of
   the mound fell through to the pale bottom of the sky gradient. That pale
   green-white was never turf — it was sky.

   Enlarging it to 250, solving y = crest − r so the middle of the skyline
   does not move, turns the band into a broad, gently curved plain. The
   horizon then measures y = 530 / 518 / 488 / 530 / 548 across five sample
   columns — near enough level, and above the corners that were bare. 250 is
   where that converges: 500, 900 and 1600 all measure identically, so
   anything larger buys nothing and only costs depth precision.

   The colours move with the job. A distant range is mostly haze and reads
   pale sage; ground whose near end you are standing on has to be the same
   green as the meadow, so this takes soil tones close to the mound's own
   0x2F5522 and nearly all the haze comes off. It is the soil under the
   second grass field now, not scenery in its own right. */
// thetaLength 0.40 rad against a visible cap measured at 0.30: the camera
// sits 252.9 units from the sphere's centre against a radius of 250, so the
// cap it can see reaches acos(250/252.9) = 8.7 degrees around a centre
// itself tilted 8.5 degrees off the pole — 17.2 degrees, 0.30 rad, all in.
// The rest is margin for the pointer swing.
ridge(250, 0.8 - 250, -30, 0x3F6E2B, 0x355E23, 0.06, 1.9, 4.7,
      { roll: 2.0, thetaLength: 0.40, wSeg: 320, hSeg: 160,
        centerGrassFix: 1 });

/* ─────────────────────────── wordmark ─────────────────────────── */
const LOGO_Z = -2.6;

function makeLogoEnvironment(){
  const pmrem=new THREE.PMREMGenerator(renderer);
  // Identical neutral studio reflection used by kandy-logo-3d.html. It is
  // assigned only to logo materials, never to the meadow scene.
  const rt=pmrem.fromScene(new RoomEnvironment(), .035);
  pmrem.dispose();
  return rt;
}

const logoEnvRT=makeLogoEnvironment();

let logo = null, fallbackLogo = null, meadowDisposed = false;
// The hero canvas scrolls with the page. The page gives us that exact CSS-pixel
// displacement and only the logo is moved down by the matching projected
// amount, so its viewport position stays fixed while everything else rises.
let logoTrackPixels = 0;
const logoTex = new THREE.TextureLoader().load(LOGO_URL, () => fitLogo());
logoTex.colorSpace = THREE.SRGBColorSpace;
logoTex.anisotropy = 8;
{
  // alphaTest matters here because of the DOF pass, not because of blending.
  // A transparent quad still writes depth across its WHOLE rectangle, so the
  // empty space between the letters was being reported to the depth buffer at
  // the wordmark's distance — and the DOF focuses on exactly that distance.
  // The background inside the quad therefore came back sharp while the same
  // ground either side of it was defocused, drawing a visible rectangle
  // around the wordmark. It only showed up once there was real grass behind
  // the letters to be sharp or soft; against plain sky there was nothing to
  // give it away. Discarding the empty pixels lets the depth there belong to
  // whatever is actually behind, while the letters keep writing their own
  // depth and stay in focus. The threshold is low so the soft edge survives.
  const m = new THREE.MeshBasicMaterial({map:logoTex, transparent:true, fog:true, alphaTest:0.05});
  fallbackLogo = new THREE.Mesh(new THREE.PlaneGeometry(1, 616/1600), m);
  logo = fallbackLogo;
  // Sits low enough that the crown and its blades bite into the lower strokes —
  // a clean horizontal edge would read as a sticker pasted on the sky.
  logo.position.set(0, 0.82, LOGO_Z);
  scene.add(logo);
}
function logoRestY(){ return portrait() ? 0.52 : 0.82; }
function logoSinkDistance(){
  if (!logo) return 2.8;
  let visibleHeight = 2.8;
  if (logo.userData.halfExtent){
    visibleHeight = logo.userData.halfExtent.y * 2 * logo.scale.y;
  } else if (logo.geometry){
    if (!logo.geometry.boundingBox) logo.geometry.computeBoundingBox();
    const box = logo.geometry.boundingBox;
    if (box) visibleHeight = (box.max.y - box.min.y) * logo.scale.y;
  }
  return Math.max(2.8, visibleHeight * 1.18 + .48);
}
const logoTrackRestNdc = new THREE.Vector3();
const logoTrackSinkNdc = new THREE.Vector3();
const logoTrackNear = new THREE.Vector3();
const logoTrackFar = new THREE.Vector3();
const logoTrackDir = new THREE.Vector3();
function logoTrackLimitPixels(){
  const cssHeight = Math.max(renderer.domElement.clientHeight || innerHeight || 1, 1);
  if (!logo) return cssHeight * .52;
  camera.updateMatrixWorld(true);
  logoTrackRestNdc.set(0, logoRestY(), LOGO_Z).project(camera);
  logoTrackSinkNdc.set(0, logoRestY() - logoSinkDistance(), LOGO_Z).project(camera);
  return Math.max(1, (logoTrackRestNdc.y - logoTrackSinkNdc.y) * cssHeight * .5);
}
function applyLogoTrack(){
  if (!logo) return;
  const oldX = logo.position.x, oldY = logo.position.y;
  const cssHeight = Math.max(renderer.domElement.clientHeight || innerHeight || 1, 1);
  const px = Math.min(logoTrackPixels, logoTrackLimitPixels());
  camera.updateMatrixWorld(true);
  logoTrackRestNdc.set(0, logoRestY(), LOGO_Z).project(camera);
  const desiredY = logoTrackRestNdc.y - 2 * px / cssHeight;
  logoTrackNear.set(logoTrackRestNdc.x, desiredY, -1).unproject(camera);
  logoTrackFar.set(logoTrackRestNdc.x, desiredY, 1).unproject(camera);
  logoTrackDir.copy(logoTrackFar).sub(logoTrackNear);
  const dz = Math.abs(logoTrackDir.z) < 1e-6 ? 1e-6 : logoTrackDir.z;
  const t = (LOGO_Z - logoTrackNear.z) / dz;
  logo.position.copy(logoTrackNear).addScaledVector(logoTrackDir, t);
  logo.position.z = LOGO_Z;
  if (Math.abs(logo.position.x-oldX) + Math.abs(logo.position.y-oldY) > 1e-5) {
    renderer.shadowMap.needsUpdate = true;
  }
}
function fitLogo(){
  if (!logo) return;
  // Sized off the camera frustum at the wordmark's own depth so it holds its
  // proportion of the frame on any aspect, instead of a fixed world width.
  const dist = camera.position.z - LOGO_Z;
  const h = 2 * Math.tan(camera.fov * Math.PI/360) * dist;
  const w = h * camera.aspect;
  // Portrait has no width to spare, so the wordmark is sized off the frame
  // width alone and simply sits higher up the mound.
  const targetW = portrait() ? w * 0.86 : Math.min(w * 0.80, h * 1.55);
  const naturalW = logo.userData.halfExtent ? logo.userData.halfExtent.x * 2 : 1;
  logo.scale.setScalar(targetW / naturalW);
  applyLogoTrack();
  renderer.shadowMap.needsUpdate=true;
}

// Use the same continuous, fully decorated candy object as kandy-logo-3d.html.
// This stays in the meadow scene (rather than embedding the viewer) so it
// shares the camera, depth buffer, grass occlusion and dandelion layers.
const wordmarkReady = buildCandyWordmark({
  cooperative:true,
  prebuiltGeometryUrl:`./assets/models/hero-${tierName==='low'?'low':'high'}.geometry.bin.gz`,
  logoUrl:'../Logo/kandy-logo-1600.png', widthUnits:8.4,
  geometryMode:'inflated', materialMode:'physical', inflateStep:tierName==='low'?3:2,
  // Match the standalone 3D logo literally, including the reference-derived
  // shallow colour/relief variation that keeps the candy from looking like a
  // perfectly smooth plastic extrusion.
  referenceFrontTexture:true, referencePillowGeometry:true, referenceSidePhysical:true,
  referenceSurfaceBlend:true, referenceSurfaceBlendStart:.28, referenceSurfaceBlendEnd:.78,
  unifiedInflatedBody:true,
  unifiedVoxelStepPx:tierName==='low'?1.9:1.65, unifiedDepthSegments:tierName==='low'?60:72,
  unifiedSurfaceBlend:.04,
  unifiedSdfSmoothPasses:4, unifiedSdfSmoothStrength:.92, unifiedNormalRadius:3.0,
  unifiedNormalSmoothPasses:5, unifiedNormalSmoothStrength:.62,
  unifiedTangentialSmoothPasses:8, unifiedTangentialSmoothStrength:.40,
  unifiedTangentialSmoothLimit:.20, unifiedProjectionLimit:.06,
  unifiedCapSubdivisions:2, unifiedProfileSegments:18,
  preserveReferenceDecorations:false,
  frontInflate:.78, backInflate:.72, waistDepth:.46, creaseDepth:0,
  contourSmooth:4, contourSpacing:tierName==='low'?.30:.25,
  contourSimplify:tierName==='low'?.12:.08, sideCurveSegments:16,
  smoothSideNormals:true, sideOutlineOverlapPx:1.65, sideFrontOverlap:.22,
  sideProfileSegments:24, sideBulgePx:.68,
  physicalColor:0xF18AAE, physicalRoughness:.30, physicalTransmission:0,
  physicalThickness:1.12, attenuationColor:0xE65B86, attenuationDistance:.48, ior:1.35,
  backBumpScale:.18,
  sideRoughness:.33, sideClearcoat:.44, sideClearcoatRoughness:.38,
  sideSpecularIntensity:.58, sideEnvMapIntensity:.78,
  edgeGlowColor:0xFFD6E5, edgeGlowIntensity:.018,
  sideColor:0xF18AAE, sideTransmission:0, alphaTest:.08,
  finish:'glossy'
}).then(async group => {
  if (meadowDisposed){
    group.traverse(o=>{if(o.isMesh){o.geometry?.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m?.dispose())}});
    return;
  }
  // The source image's printed sprinkles are deliberately removed from the
  // body texture above and rebuilt here as tiny raised candy pieces, exactly
  // as in the standalone 3D-logo study.
  await addCandyDecorations(group, {
    logoUrl:'../Logo/kandy-logo-1600.png', widthUnits:8.4, analysisWidth:700
  });
  if (meadowDisposed){
    group.traverse(o=>{if(o.isMesh){o.geometry?.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m?.dispose())}});
    return;
  }
  group.layers.set(LOGO_LIGHT_LAYER);
  group.traverse(o=>{
    o.layers.set(LOGO_LIGHT_LAYER);
    if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }
  });
  const mats=group.userData.materials||[group.userData.material];
  const [frontMat,sideMat,backMat]=mats;
  const contourSealMat=group.getObjectByName('KANDy_Contour_Seal')?.material;
  const bodyPink=new THREE.Color(0xF18AAE);
  if(frontMat?.isMeshPhysicalMaterial){
    frontMat.clearcoat=.46; frontMat.clearcoatRoughness=.25;
    frontMat.specularIntensity=.64; frontMat.envMapIntensity=.72;
  }
  for(const bodyMat of [sideMat,backMat,contourSealMat]){
    if(!bodyMat) continue;
    bodyMat.color.copy(bodyPink);
    bodyMat.roughness=.30; bodyMat.clearcoat=.72; bodyMat.clearcoatRoughness=.20;
    bodyMat.specularIntensity=.72; bodyMat.envMapIntensity=.88;
    if(bodyMat.isMeshPhysicalMaterial){
      bodyMat.emissive.copy(bodyPink); bodyMat.emissiveIntensity=.10;
    }
    bodyMat.needsUpdate=true;
  }

  // The continuous body uses the physical side material all the way around
  // its silhouette. At grazing angles that material can fall to a grey
  // one-pixel rim even though the candy itself is pink. Lift only normals that
  // turn fully sideways; the broad front shading and its food-like texture are
  // left untouched.
  if(group.userData.referenceSurfaceBlend && sideMat?.isMeshPhysicalMaterial){
    const previousCompile=sideMat.onBeforeCompile;
    const previousCacheKey=sideMat.customProgramCacheKey;
    sideMat.onBeforeCompile=shader=>{
      previousCompile?.(shader);
      shader.uniforms.uKandySilhouettePink={value:new THREE.Color(0xF18AAE)};
      shader.fragmentShader=shader.fragmentShader
        .replace('#include <colorspace_fragment>',`
          float kandySilhouette = 1.0 - smoothstep( 0.10, 0.42, abs( vKandyObjectNormalZ ) );
          gl_FragColor.rgb = mix( gl_FragColor.rgb, uKandySilhouettePink,
                                  kandySilhouette * 0.42 );
          #include <colorspace_fragment>
        `)
        .replace('#include <common>','#include <common>\nuniform vec3 uKandySilhouettePink;');
    };
    sideMat.customProgramCacheKey=()=>
      `${previousCacheKey?previousCacheKey():''}-hero-silhouette-pink-v2`;
    sideMat.needsUpdate=true;
  }

  const old=logo;
  logo=group;
  logo.position.set(0, portrait()?0.52:0.82, LOGO_Z);
  scene.add(logo);
  fitLogo();
  if(old){
    scene.remove(old);
    old.geometry?.dispose();
    const ms=Array.isArray(old.material)?old.material:[old.material];
    ms.forEach(m=>m?.dispose());
  }
  fallbackLogo=null;
  logoTex.dispose();
  repaint();
}).catch(err=>{
  console.error('3D candy wordmark failed; keeping PNG fallback',err);
});

/* ─────────────────────────── the mound ───────────────────────────
   A sphere sunk below frame: its silhouette is the soft hill crown from the
   reference, and solving it for y lets every blade and flower sit exactly on
   the surface instead of being eyeballed. */
const R = 6.6, CY = -6.38;             // crown lands at y = 0.22
const surfaceY = (x,z) => CY + Math.sqrt(Math.max(0, R*R - x*x - z*z));

// The grass must have soil underneath it, not a smooth green billiard-ball
// shell. Both maps are deterministic canvas textures: broad warm/cool patches
// break up the colour, while the much finer height map gives the grazing sun
// thousands of tiny clods and pits to catch. This belongs only to the near
// mound; the distant ridges keep their existing green ground materials.
function makeSoilTextures(){
  const S = 512;
  const colorCanvas = document.createElement('canvas');
  const heightCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = S;
  heightCanvas.width = heightCanvas.height = S;
  const cg = colorCanvas.getContext('2d');
  const hg = heightCanvas.getContext('2d');
  // A deeper loam base keeps the small gaps between foreground blades from
  // reading as bright orange-brown when the camera looks down in portrait.
  cg.fillStyle = '#653F28'; cg.fillRect(0,0,S,S);
  hg.fillStyle = 'rgb(126,126,126)'; hg.fillRect(0,0,S,S);

  let state = 0x4b414e44;
  const rnd = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const palette = ['#55311F','#73452C','#805437','#4A2B1D','#8D603F','#61402A'];

  // Soft, overlapping earth patches keep the ground from becoming one flat
  // brown swatch. Their alpha is deliberately low so it still reads as soil,
  // not camouflage.
  for(let i=0;i<260;i++){
    const x=rnd()*S, y=rnd()*S;
    const rx=10+rnd()*46, ry=7+rnd()*32;
    cg.globalAlpha=0.12+rnd()*0.18;
    cg.fillStyle=palette[(rnd()*palette.length)|0];
    cg.beginPath(); cg.ellipse(x,y,rx,ry,rnd()*TAU,0,TAU); cg.fill();
    const v=100+((rnd()*58)|0);
    hg.globalAlpha=0.10+rnd()*0.16;
    hg.fillStyle=`rgb(${v},${v},${v})`;
    hg.beginPath(); hg.ellipse(x,y,rx,ry,0,0,TAU); hg.fill();
  }

  // Pebbly granules, compacted specks and tiny damp pits. These are what make
  // the exposed patches look irregular at close range instead of merely
  // having a photographic colour pattern painted onto a smooth surface.
  cg.globalAlpha=1; hg.globalAlpha=1;
  for(let i=0;i<6400;i++){
    const x=rnd()*S, y=rnd()*S;
    const r=0.35+Math.pow(rnd(),2.0)*2.8;
    const high=rnd()>0.43;
    const c=high ? 118+((rnd()*52)|0) : 60+((rnd()*48)|0);
    cg.fillStyle=high
      ? `rgba(${c+20},${Math.max(55,c-20)},${Math.max(38,c-43)},${0.12+rnd()*0.30})`
      : `rgba(${c+12},${Math.max(36,c-7)},${Math.max(24,c-22)},${0.16+rnd()*0.30})`;
    cg.beginPath(); cg.arc(x,y,r,0,TAU); cg.fill();
    const h=high ? 145+((rnd()*76)|0) : 42+((rnd()*64)|0);
    hg.fillStyle=`rgb(${h},${h},${h})`;
    hg.beginPath(); hg.arc(x,y,r*0.82,0,TAU); hg.fill();
  }

  const color = new THREE.CanvasTexture(colorCanvas);
  color.colorSpace = THREE.SRGBColorSpace;
  color.wrapS = color.wrapT = THREE.RepeatWrapping;
  color.repeat.set(4.4,2.8);
  color.anisotropy = 8;

  const height = new THREE.CanvasTexture(heightCanvas);
  height.colorSpace = THREE.NoColorSpace;
  height.wrapS = height.wrapT = THREE.RepeatWrapping;
  height.repeat.copy(color.repeat);
  height.anisotropy = 8;
  return {color,height};
}
const soilTex = makeSoilTextures();
const mound = new THREE.Mesh(
  // Extra subdivisions let the height map move the silhouette itself. The
  // previous bump-only surface changed highlights but left the exposed bank
  // geometrically smooth, so from the camera it still looked flat.
  new THREE.SphereGeometry(R, 144, 96),
  new THREE.MeshStandardMaterial({
    map:soilTex.color,
    bumpMap:soilTex.height,
    bumpScale:0.105,
    displacementMap:soilTex.height,
    // Keep genuine soil relief, but not enough to make the foreground read
    // as one big protruding dirt dome once the camera looks down at it.
    displacementScale:0.045,
    displacementBias:-0.015,
    color:0xFFFFFF,
    roughness:0.97,
    metalness:0,
    // A tiny warm bounce keeps the soil brown under the meadow's green lower
    // hemisphere light without making it look self-lit.
    emissive:0x24150C,
    emissiveIntensity:0.045
  })
);
mound.position.y = CY;
scene.add(mound);

/* ─────────────────────────── grass ─────────────────────────── */
const BLADES = Q.blades;
// This extra carpet is always built once, then toggled in resize() from the
// live aspect ratio. That matters for someone dragging a desktop browser into
// a tall narrow shape: it cannot rely on the aspect ratio from page load.
let narrowUnderGrowth = null;
let narrowGrassMat = null;
{
  const SEG = Q.bladeSegments;
  const pos = [], idx = [];
  for (let i=0;i<=SEG;i++){
    const v = i/SEG, w = 0.5 * (1 - v*v*0.82) * (1-v*0.15);
    pos.push(-w, v, 0, w, v, 0);
  }
  for (let i=0;i<SEG;i++){
    const a=i*2;
    idx.push(a,a+1,a+2, a+1,a+3,a+2);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  geo.setIndex(idx);

  const iPos=[], iNrm=[], iRot=[], iSize=[], iTint=[];
  let placed = 0;
  let frontPlaced = 0;
  for (let n=0; n<BLADES*3 && placed<BLADES; n++){
    const a = Math.random()*TAU, rr = Math.sqrt(Math.random()) * R*0.94;
    const x = Math.cos(a)*rr, z = Math.sin(a)*rr;
    const d2 = x*x + z*z;
    if (d2 > R*R*0.90) continue;
    if (z > 4.6) continue;                        // nothing behind the camera
    const y = surfaceY(x,z);
    const nx = x/R, ny = (y-CY)/R, nz = z/R;
    iPos.push(x,y,z); iNrm.push(nx,ny,nz);
    iRot.push(Math.random()*TAU);
    // Blades nearer the camera are taller: gives the crown a readable edge
    // instead of a uniform fur that flattens the silhouette.
    const near = THREE.MathUtils.clamp((z + 2.0) / 6.0, 0, 1);
    // Lower tiers widen each blade to keep the dome covered. Compensating by
    // the full square root restores the exact coverage but looks like plastic
    // cutlery; a gentler exponent trades a little bare dome for blades that
    // still read as blades.
    const fat = Math.pow(38000 / BLADES, 0.35);
    iSize.push(0.20 + Math.random()*0.20 + near*0.14, (0.020 + Math.random()*0.016) * fat);
    iTint.push(Math.random());
    placed++;
  }
  const ia = (arr,n) => new THREE.InstancedBufferAttribute(new Float32Array(arr), n);
  geo.setAttribute('iPos',  ia(iPos,3));
  geo.setAttribute('iNrm',  ia(iNrm,3));
  geo.setAttribute('iRot',  ia(iRot,1));
  geo.setAttribute('iSize', ia(iSize,2));
  geo.setAttribute('iTint', ia(iTint,1));
  geo.instanceCount = placed;
  { const el = UI('pBlades'); if (el) el.textContent = placed.toLocaleString(); }

  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms:{
      uPhase:{value:0},
      uLight:{value:SUN_DIR.clone()},
      uBase:{value:new THREE.Color(0x2C6B22)},
      uTip:{value:new THREE.Color(0xC4E86B)},
      uFogColor:{value:new THREE.Color(SKY_LOW)},
      uFogNear:{value:14}, uFogFar:{value:62},
      // Enabled only on the cloned rear field, where the old separable patch
      // pattern reads as vertical stripes on the centre hill.
      uFarHillFix:{value:0},
      uMobileSoftness:{value:mobileMeadow ? 1 : 0},
      // Gravity straightens only the sloped front of the near mound. The
      // distant field receives a clone with this disabled below.
      uUprightNear:{value:1},
      // Separate multiplier lets the extra-dense portrait carpet retain
      // visible self-shadow instead of averaging into one bright green field.
      uCanopyShadow:{value:0.85}
    },
    vertexShader:`
      attribute vec3 iPos, iNrm; attribute float iRot, iTint; attribute vec2 iSize;
      uniform float uPhase, uUprightNear, uCanopyShadow, uFarHillFix, uMobileSoftness;
      varying float vV, vTint, vPatch, vFrontShadow, vWorldX, vWorldZ;
      varying vec3 vN; varying float vFogDepth;

      // Wind is built only from integer harmonics of the loop frequency, so it
      // is exactly the same gust at phase 0 and phase 1.
      float wind(vec3 p, float phi){
        float s = p.x*0.55 + p.z*0.40;
        float w = sin(6.2831853*(2.0*phi) + s)            * 0.55
                + sin(6.2831853*(3.0*phi) + s*1.7 + 1.3)  * 0.30
                + sin(6.2831853*(5.0*phi) + s*2.6 + 2.7)  * 0.16;
        float gust = 0.55 + 0.45*sin(6.2831853*phi + p.x*0.16);
        return w * gust;
      }
      void main(){
        float v = position.y;
        vec3 surfaceUp = normalize(iNrm);

        // Keep the root planted and aligned with the mound, then progressively
        // pull the blade toward world-up along its length. The correction is
        // restricted to the near, steep face of the sphere: at v=0 the mix is
        // exactly zero, while the tip becomes almost vertical. This is the
        // grass equivalent of gravitropism and closes the camera-facing gaps
        // without moving a single root or adding another opaque ground layer.
        float frontZone = smoothstep(0.80, 4.90, iPos.z);
        float slope = smoothstep(0.035, 0.30, 1.0 - surfaceUp.y);
        float alongBlade = smoothstep(0.02, 0.88, v);
        float upright = uUprightNear * frontZone * slope * alongBlade * 0.96;
        vec3 up = normalize(mix(surfaceUp, vec3(0.,1.,0.), upright));
        // A helper selected from the changing tip direction can switch axes
        // halfway up a blade, twisting its ribbon into a dark angular channel.
        // On phones, choose it once from the root and keep the frame continuous.
        float helperY = mix(up.y, surfaceUp.y, uMobileSoftness);
        vec3 helper = abs(helperY) < 0.985 ? vec3(0.,1.,0.) : vec3(1.,0.,0.);
        vec3 t = normalize(cross(helper, up));
        vec3 b = cross(up, t);
        float c = cos(iRot), s = sin(iRot);
        vec3 T =  t*c + b*s;
        vec3 B = -t*s + b*c;

        vV = v; vTint = iTint;
        vPatch = 0.5 + 0.5*sin(iPos.x*0.9 + 1.7)*cos(iPos.z*1.1 - 0.6);
        // Carry the soft overlap shadow only on the near mound; the coherent
        // long-shadow pattern is evaluated from the final world position in
        // the fragment shader, not independently at each random grass root.
        vFrontShadow = uUprightNear * uCanopyShadow
                     // Reach full strength before the copy block so the same
                     // lane remains visible through the closest bottom rim.
                     * smoothstep(0.70, 3.25, iPos.z)
                     * (1.0 - uMobileSoftness);

        // The rear-centre hill is seen almost head-on, so the ordinary broad
        // wind wave stacks thousands of blades into coherent screen-space
        // columns there. That is the faint vertical banding visible in the
        // circled area. Calm only this hill (the side and foreground grass
        // retain the full breeze) and feather the boundary generously.
        float centerHillMotion = uFarHillFix
          * (1.0 - smoothstep(18.0, 32.0, abs(iPos.x)))
          * (1.0 - smoothstep(0.0, 6.0, iPos.z));
        float w = wind(iPos, uPhase) * mix(1.0, 0.16, centerHillMotion)
                + 0.16;
        float bend = w * v * v;                      // base stays planted
        vec3 wp = iPos
                + T * (position.x * iSize.y)
                + up * (v * iSize.x * (1.0 - 0.16*bend*bend))
                + B * (bend * iSize.x * 0.85);
        vWorldX = wp.x;
        vWorldZ = wp.z;

        // The blade normal follows a little of the wind bend, so its sunlit
        // and shaded faces change as it sways instead of remaining uniformly
        // bright while the geometry moves.
        vN = normalize(B - up*bend*0.42*uUprightNear);
        vec4 mv = modelViewMatrix * vec4(wp,1.0);
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader:`
      precision highp float;
      varying float vV, vTint, vPatch, vFrontShadow, vWorldX, vWorldZ, vFogDepth;
      varying vec3 vN;
      uniform vec3 uLight, uBase, uTip, uFogColor;
      uniform float uFogNear, uFogFar, uCanopyShadow, uFarHillFix, uUprightNear, uMobileSoftness;
      void main(){
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        vec3 col = mix(uBase, uTip, pow(vV, 1.30));
        float centerHill = uFarHillFix
          * (1.0 - smoothstep(18.0, 32.0, abs(vWorldX)))
          * (1.0 - smoothstep(0.0, 6.0, vWorldZ));
        float mobileNear = uMobileSoftness * uUprightNear
          * smoothstep(1.0, 4.5, vWorldZ);
        // Per-blade tint alone gives an even "fur". Keep that variation on
        // the repaired hill, but narrow its value range so random clusters do
        // not resolve as dark vertical columns after depth-of-field blur.
        float bladeTint = 0.72 + 0.42*vTint;
        float calmHillTint = 0.94 + 0.12*vTint;
        col *= mix(bladeTint, calmHillTint, centerHill);
        // Remove the separable x/z wave completely inside the circled hill.
        // Per-blade tint, lighting and wind still keep it naturally varied,
        // but there is no coherent field left that can form straight lanes.
        float regularPatch = 0.80 + 0.34*vPatch;
        regularPatch = mix(regularPatch, 1.0, mobileNear*0.45);
        float softHillPatch = 1.0;
        col *= mix(regularPatch, softHillPatch, centerHill);
        // Match the lighter surrounding meadow. This is deliberately a
        // colour lift, not a new flat overlay, so individual blade tips and
        // natural per-blade variation remain visible.
        col *= 1.0 + centerHill*0.48;
        // Soft canopy/contact shadow: strongest near the root, still visible
        // through the tips, and varied by the same broad grass clumps rather
        // than painted as one dark band behind the interface.
        // Use the final spatial x of every fragment, so blades layered at
        // different depths share one continuous shadow lane. No z term means
        // these soft, warped bands cannot terminate before the bottom rim.
        float shadowCoord = vWorldX*1.25;
        float longShadowWave = 0.5 + 0.5*sin(
          shadowCoord + 0.55*sin(vWorldX*0.47 + 1.20)
        );
        float longShadow = smoothstep(0.20, 0.84, longShadowWave);
        // A second, finer set of offset lanes fills the conspicuously bright
        // gaps between the main shadows. It stays softer than the broad lanes
        // so the mound still reads as naturally uneven instead of striped.
        float fineShadowWave = 0.5 + 0.5*sin(
          shadowCoord*1.87 + 2.05
          + 0.30*sin(vWorldX*0.71 - 0.55)
        );
        float fineShadow = 1.0 - smoothstep(0.26, 0.84, fineShadowWave);
        float shadowField = clamp(
          0.10*(1.0 - vPatch)
          + 0.78*(1.0 - longShadow)
          + 0.52*fineShadow,
          0.0, 1.0
        );
        // The closest portrait-only infill layer used to fade its shadow too
        // aggressively toward the blade tips. Those bright tips then covered
        // the continuous lanes underneath and made the shadow look as if it
        // stopped halfway down the frame. Keep ordinary/far grass unchanged,
        // but retain nearly all of the shadow through this dense near canopy.
        float tipShadowRetention = mix(
          0.64, 0.94, smoothstep(0.90, 2.00, uCanopyShadow)
        );
        float overlapShadow = vFrontShadow * (0.36 + 0.64*shadowField)
                            * mix(1.0, tipShadowRetention,
                                  smoothstep(0.0, 1.0, vV));
        col *= 1.0 - overlapShadow*0.30;
        float ndl  = max(dot(n, uLight), 0.0);
        float back = max(dot(n, -uLight), 0.0);
        float bladeLight = mix(0.58, 0.72, mobileNear) + mix(0.62, 0.48, mobileNear)*ndl;
        float calmHillLight = 0.90 + 0.14*ndl;
        col *= mix(bladeLight, calmHillLight, centerHill);
        // Light coming through the blade from behind — the tips glowing is the
        // single detail that separates real grass from green sticks.
        col += uTip * back * 0.42 * pow(vV, 2.2);
        float rootShade = mix(mix(0.42, 0.64, mobileNear), 1.0, smoothstep(0.0, 0.55, vV));
        float calmHillRoot = mix(0.76, 1.0, smoothstep(0.0, 0.55, vV));
        col *= mix(rootShade, calmHillRoot, centerHill);
        float f = smoothstep(uFogNear, uFogFar, vFogDepth);
        gl_FragColor = vec4(mix(col, uFogColor, f), 1.0);
      }`
  });
  scene.add(new THREE.Mesh(geo, mat));

  /* ────────────── dense, low grass fringe on the near mound ──────────────
     Random coverage in the main field left a wide smooth patch around world
     z=2.4..3.7 — the strip that projects to the bottom of the hero. A second
     overlapping distribution fills only that visible strip. Keeping these
     blades varied in height and slightly wider makes a natural ragged edge
     without creating a new wall of oversized foreground grass. */
  {
    // This band is the lower part of the mound that is actually visible at the
    // bottom of the hero. The old 3.95..5.25 range projected mostly below the
    // viewport, which is why adding blades there appeared to do nothing.
    // Dense, short undergrowth covers the foreground soil without creating a
    // sharp grass wall: it is deliberately more numerous but lower than the
    // meadow blades behind it.
    const FRONT_FILL = Math.round(BLADES * 0.18);
    const fgeo = new THREE.InstancedBufferGeometry();
    fgeo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
    fgeo.setIndex(idx);
    const fPos=[], fNrm=[], fRot=[], fSize=[], fTint=[];
    const fat = Math.pow(38000 / BLADES, 0.35);
    for(let n=0;n<FRONT_FILL*4 && frontPlaced<FRONT_FILL;n++){
      // Scatter across the real screen-bottom band rather than on one world-z
      // line. The broad range and varied height form an uneven grass fringe,
      // while the incomplete coverage leaves small soil pockets visible.
      const q = Math.pow(Math.random(), 1.12);
      const z = 2.38 + q*1.34;
      const maxX = Math.sqrt(Math.max(0, R*R*0.90 - z*z));
      if(maxX<0.08) continue;
      const x = (Math.random()*2-1) * maxX*0.98;
      const d2=x*x+z*z;
      if(d2>R*R*0.90) continue;
      const y=surfaceY(x,z);
      fPos.push(x,y+0.006,z);
      fNrm.push(x/R,(y-CY)/R,z/R);
      fRot.push(Math.random()*TAU);
      const near=THREE.MathUtils.clamp((z-2.38)/1.34,0,1);
      fSize.push(0.17+Math.random()*0.18+near*0.035,
                 (0.029+Math.random()*0.021)*fat*(1+near*0.08));
      fTint.push(Math.random());
      frontPlaced++;
    }
    fgeo.setAttribute('iPos', ia(fPos,3));
    fgeo.setAttribute('iNrm', ia(fNrm,3));
    fgeo.setAttribute('iRot', ia(fRot,1));
    fgeo.setAttribute('iSize',ia(fSize,2));
    fgeo.setAttribute('iTint',ia(fTint,1));
    fgeo.instanceCount=frontPlaced;
    const fringe=new THREE.Mesh(fgeo,mat);
    fringe.frustumCulled=false;
    scene.add(fringe);
  }

  /* ───────────── responsive close-up undergrowth for narrow screens ─────────────
     A portrait camera looks farther down over the near mound. Enlarging the
     same desktop blade distribution exposes its normal little soil gaps as
     large brown holes. This is a separate, low, broad-bladed carpet spanning
     that close-up zone. It is hidden in landscape and switched on only once
     the viewport becomes narrow, so desktop keeps the existing airy meadow. */
  {
    // Portrait exposes the extreme near rim of the mound as well, so it needs
    // materially more coverage than a landscape frame. Keeping this in one
    // instanced draw is still inexpensive, even at the mobile quality tier.
    const NARROW_FILL = Math.min(32000, Math.round(BLADES * 2.60));
    const ngeo = new THREE.InstancedBufferGeometry();
    ngeo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
    ngeo.setIndex(idx);
    const nPos=[], nNrm=[], nRot=[], nSize=[], nTint=[];
    let narrowPlaced=0;
    const fat = Math.pow(38000 / BLADES, 0.35);
    for(let n=0;n<NARROW_FILL*4 && narrowPlaced<NARROW_FILL;n++){
      // Spread through the close lower half of the mound rather than along a
      // single strip, with a mild bias towards the part nearest the camera.
      const q=Math.pow(Math.random(),0.62);
      // Continue into the closest rim. This is the part a tall viewport
      // magnifies into the lower third and where the remaining brown holes
      // were visible in the portrait check.
      const z=0.90 + q*4.75;
      const maxX=Math.sqrt(Math.max(0,R*R*0.90-z*z));
      if(maxX<0.08) continue;
      const x=(Math.random()*2-1)*maxX*0.985;
      if(x*x+z*z>R*R*0.90) continue;
      const y=surfaceY(x,z);
      nPos.push(x,y+0.008,z);
      nNrm.push(x/R,(y-CY)/R,z/R);
      nRot.push(Math.random()*TAU);
      // Match the main meadow's blade length at the same depth. This layer
      // used to be intentionally short undergrowth, which created the visible
      // step in height the user marked even after its tips were made upright.
      // Width stays generous so the now full-length blades continue to hide
      // the small soil gaps rather than becoming another sparse row.
      const near=THREE.MathUtils.clamp((z+2.0)/6.0,0,1);
      nSize.push(0.20+Math.random()*0.20+near*0.14,
                 (0.055+Math.random()*0.038)*fat);
      nTint.push(Math.random());
      narrowPlaced++;
    }
    ngeo.setAttribute('iPos', ia(nPos,3));
    ngeo.setAttribute('iNrm', ia(nNrm,3));
    ngeo.setAttribute('iRot', ia(nRot,1));
    ngeo.setAttribute('iSize',ia(nSize,2));
    ngeo.setAttribute('iTint',ia(nTint,1));
    ngeo.instanceCount=narrowPlaced;
    narrowGrassMat=mat.clone();
    // The dense portrait carpet doubled up the broad shadow lanes, turning
    // them into dark vertical streaks behind the opening copy. Let the real
    // blade lighting provide depth and keep only a soft canopy shadow here.
    narrowGrassMat.uniforms.uCanopyShadow.value=0.65;
    narrowUnderGrowth=new THREE.Mesh(ngeo,narrowGrassMat);
    narrowUnderGrowth.frustumCulled=false;
    narrowUnderGrowth.visible=(canvas.clientWidth||innerWidth)/(canvas.clientHeight||innerHeight)<0.92;
    scene.add(narrowUnderGrowth);
  }
  // Both fields have to be advanced together every frame — see build().
  scene.userData.grassMats = [mat, narrowGrassMat];

  /* ────────────── the same grass, on the ground behind and beside ──────────
     Everything outside the mound used to be painted shell or bare sky, and
     it read as a different substance from the meadow in front: no blades, no
     wind, its own flat green. Texturing the shell procedurally only ever
     produced a better-painted shell — measured at 4/255 peak-to-peak, and
     pushed until it was clearly visible it looked like brush strokes, since
     what makes grass read as grass is blades catching light, not mottling.
     What makes this ground belong to the same field is being the same field:
     identical blade geometry, identical shader, so the wind, the per-blade
     tint, the light coming through from behind and the tip glow are not an
     imitation of the near grass — they are the near grass. */
  {
    const GR = 250, GY = 0.8 - 250, GZ = -30, GBUMP = 1.9, GSEED = 4.7;
    // Must reproduce the shell's crest() and its band term exactly, or the
    // blades stand off the ground they are supposed to be growing out of.
    const crestAt = (a) =>
        Math.sin(a*3.0  + GSEED)*0.55  + Math.sin(a*7.0  + GSEED*2.3)*0.28
      + Math.sin(a*13.0 + GSEED*4.1)*0.13 + Math.sin(a*19.0 + GSEED*5.7)*0.055
      + Math.sin(a*31.0 + GSEED*7.9)*0.030;
    const bandAt = (up) => {
      const t = THREE.MathUtils.clamp((up - 0.55) / 0.45, 0, 1);
      return t*t*(3 - 2*t);
    };
    // And the rolling hills, likewise character for character. If these two
    // ever drift apart the grass floats above the skyline on one hump and
    // sinks under it on the next.
    const rollAt = (x, z) =>
        Math.sin(x*0.235 + 0.9) * Math.cos(z*0.180 - 0.4) * 1.00
      + Math.sin(x*0.128 - 2.1) * Math.cos(z*0.105 + 1.7) * 0.62
      + Math.sin((x*0.8 + z*0.6) * 0.150 + 2.6) * 0.55;
    // Must equal the ground shell's `roll` option. Swept against the
    // rendered silhouette: 1.55 measured 8.2% of frame height, 3.4 measured
    // 12.6%. 3.4 matched the reference sketch but read as too pronounced in
    // place, so this sits between them — the shape is unchanged, only how far
    // it swings.
    const GROLL = 2.0;
    const rollFade = (x, z) => {
      const t = THREE.MathUtils.clamp((Math.hypot(x, z) - 8) / 26, 0, 1);
      return t*t*(3 - 2*t);
    };
    const fat = Math.pow(38000 / BLADES, 0.35);

    const rgeo = new THREE.InstancedBufferGeometry();
    rgeo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
    rgeo.setIndex(idx);
    const jPos=[], jNrm=[], jRot=[], jSize=[], jTint=[];
    let rplaced = 0;
    // Seeded in world x/z now that the surface under it is a plain rather
    // than a band — (azimuth, elevation) was the right parameterisation for
    // a 24 unit sphere seen edge-on and is useless on a 250 unit one, where
    // everything visible sits inside elevation 0.999..1.0.
    for (let n=0; n<Q.ridge*3 && rplaced<Q.ridge; n++){
      // Seeded for uniform density ON SCREEN, which is not the same as
      // uniform density on the ground. A patch of ground at range d subtends
      // screen area proportional to 1/d^2, and the strip planted at each
      // depth already widens proportionally to d, so blades per unit of
      // depth have to go as 1/d. Drawing d geometrically between 6 and 76
      // units is exactly that law. Earlier passes used a power law on z
      // instead and left the body of the far hill 78% bare while the crest
      // looked fine — the crest is a thin strip that any distribution fills,
      // and it hid how empty everything below it was.
      const d0 = 6, d1 = 76;
      const dist = d0 * Math.pow(d1/d0, Math.random());
      const z = CAM_BASE.z - dist;
      // Width tracks the frustum instead of a fixed slope. tan(19 deg) is the
      // half-angle of the landscape lens; 1.9 is the widest aspect worth
      // planting for. The old fixed slope was ~35% wider than this at depth,
      // and every one of those blades landed off the side of the frame.
      const halfW = 5 + 0.344 * 1.9 * 1.08 * dist;
      const x  = (Math.random()*2 - 1) * halfW;
      // Overlap with the mound rather than butt up against it. The meadow's
      // own blades stop at radius R*sqrt(0.90) = 6.26; excluding this field
      // out to R*1.05 (6.76) left a 0.5 unit ring where NEITHER field
      // planted anything — measured on the live scene as the worst bare
      // patch on screen, 16% right around the mound's silhouette, because
      // that ring sits dead centre where the camera looks the most square
      // on. Pulling the exclusion in to R*0.75 (4.95) means this field's
      // blades grow well inside the meadow's own edge; the redundant ones
      // end up buried under the meadow's denser turf exactly like the
      // instruction above already assumes, and the two fields now overlap
      // instead of leaving a gap between them.
      if (x*x + z*z < R*R*0.75) continue;
      const dz = z - GZ;
      const rad2 = GR*GR - x*x - dz*dz;
      if (rad2 <= 0) continue;
      const yr = Math.sqrt(rad2);
      const up = yr / GR;
      const a  = Math.atan2(x, dz);
      jPos.push(x,
                GY + yr + crestAt(a)*GBUMP*bandAt(up)
                        + rollAt(x, z)*GROLL*rollFade(x, z),
                z);
      jNrm.push(x/GR, up, dz/GR);
      jRot.push(Math.random()*TAU);
      // Blade size tracks distance, but width and height do NOT track it
      // equally, and that asymmetry is the whole fix for the hollow-looking
      // skyline. Scaling both together made the far blades ~16px tall and
      // ~2px wide: tall enough to stand well clear of the ground silhouette,
      // thin enough that the gaps between their tips showed raw sky, which
      // is what read as sparse and unfinished. Working back from the screen,
      // the far field wants roughly 12px tall by 4px wide — a dense low mat,
      // which is also what grass a long way off actually looks like once you
      // cannot resolve one blade. So height keeps almost its natural size and
      // width absorbs nearly all of the distance compensation. Both are 1.0
      // at close range so this field starts exactly where the meadow's own
      // blades leave off.
      const d  = Math.hypot(x, dist);
      const S  = THREE.MathUtils.clamp(d / 11, 1.0, 2.3);
      const Sh = 1.0 + (S - 1.0) * 0.15;
      const Sw = 1.0 + (S - 1.0) * 2.85;
      jSize.push((0.20 + Math.random()*0.20) * Sh,
                 (0.020 + Math.random()*0.016) * fat * Sw);
      jTint.push(Math.random());
      rplaced++;
    }
    rgeo.setAttribute('iPos',  ia(jPos,3));
    rgeo.setAttribute('iNrm',  ia(jNrm,3));
    rgeo.setAttribute('iRot',  ia(jRot,1));
    rgeo.setAttribute('iSize', ia(jSize,2));
    rgeo.setAttribute('iTint', ia(jTint,1));
    rgeo.instanceCount = rplaced;

    const rmat = mat.clone();
    // Keep the far rolling field unchanged; the upright correction is only
    // for the near spherical mound whose front face points at the camera.
    rmat.uniforms.uUprightNear.value = 0;
    rmat.uniforms.uCanopyShadow.value = 0;
    rmat.uniforms.uFarHillFix.value = 1;
    // Same shader, but not the same fog. The meadow's band (14..62) is what
    // seats it in space, and this field reaches 74 units — under that band
    // everything past the mound would dissolve to flat sky, which is exactly
    // the "it looks miles away" the painted shell had. Pushed out so the
    // grass keeps its colour all the way to the horizon and reads as the
    // same field continuing, with only the last of it going hazy.
    rmat.uniforms.uFogNear.value = 58;
    rmat.uniforms.uFogFar.value  = 190;
    const rmesh = new THREE.Mesh(rgeo, rmat);
    // An InstancedBufferGeometry's bounding sphere is computed from the blade
    // shape alone — a ~1 unit ball at the origin — so three would frustum
    // test this field against a point nowhere near where it actually is. The
    // meadow gets away with it by being centred on the origin; this spreads
    // from z=+6 to z=-68 and does not.
    rmesh.frustumCulled = false;
    scene.add(rmesh);
    scene.userData.grassMats.push(rmat);
    { const el = UI('pBlades'); if (el) el.textContent = (placed + frontPlaced + rplaced).toLocaleString(); }
  }
}

/* ─────────────────────────── daisies on the mound ─────────────────────────── */
{
  const N = Q.daisies, geo = new THREE.PlaneGeometry(1,1);
  const mesh = new THREE.InstancedMesh(geo,
    new THREE.MeshBasicMaterial({map:daisyTex, transparent:true, depthWrite:false, side:THREE.DoubleSide}), N);
  const d = new THREE.Object3D();
  let k = 0;
  for (let i=0;i<N*4 && k<N;i++){
    const a = Math.random()*TAU, rr = Math.sqrt(Math.random())*R*0.80;
    const x = Math.cos(a)*rr, z = Math.sin(a)*rr;
    if (z > 4.2) continue;
    const y = surfaceY(x,z);
    d.position.set(x, y + 0.10, z);
    d.rotation.set(-0.5 + Math.random()*0.3, Math.random()*TAU, 0);
    d.scale.setScalar(0.13 + Math.random()*0.10);
    d.updateMatrix(); mesh.setMatrixAt(k++, d.matrix);
  }
  mesh.count = k;
  scene.add(mesh);
}

/* ─────────────────────────── drifting dandelion seeds ───────────────────
   Each seed moves on its own closed air loop. Its position is therefore
   identical at φ=1 and φ=0 with no off-screen reset or opacity transition. */
const petals = [];
{
  // A small, deliberately separated foreground set lives close to the turf
  // along the wordmark's lower edge. These are not part of the airy high
  // flock: their shallow loops make the meadow feel continuous in front of
  // the candy without lining up across the logo or crossing its geometry.
  const FRONT_GRASS_SEEDS = [
    { cx:-3.18, ax:0.20, y0:0.54, z:-1.02, clearance:0.48, off:0.14, scale:0.40, yAmp:0.055, lift:0.075 },
    { cx: 1.02, ax:0.18, y0:0.80, z:-0.94, clearance:0.57, off:0.47, scale:0.37, yAmp:0.050, lift:0.070 },
    { cx: 3.08, ax:0.21, y0:0.49, z:-1.07, clearance:0.44, off:0.79, scale:0.41, yAmp:0.060, lift:0.080 },
    // A compact loop in the marked K/A pocket. Its Z value keeps it in front
    // of the wordmark while the small radii stop it wandering out of place.
    { cx:-1.67, ax:0.17, y0:0.75, z:-0.36, clearance:0.20, off:0.36, scale:0.46, yAmp:0.045, lift:0.070 }
  ];
  // One genuinely volumetric seed shared by every instance. The pappus is a
  // shallow 3D dome of fibres rather than pixels on a quad, so perspective and
  // rotation reveal depth from every viewing angle.
  const HUB_Y = 0.13;
  const hairPos = [];
  // Fibonacci distribution over a shallow hemisphere: every fibre occupies a
  // different x/y/z direction, so the pappus keeps volume while rotating.
  const HAIRS=92, GOLDEN=2.39996323;
  for (let j=0;j<HAIRS;j++){
    const t=(j+0.5)/HAIRS;
    const ny=-0.04 + t*0.88;
    const radial=Math.sqrt(Math.max(0,1-ny*ny));
    const a=j*GOLDEN;
    const len=0.255 + Math.sin(j*2.17)*0.014;
    const ex=Math.cos(a)*radial*len;
    const ey=HUB_Y + ny*len;
    const ez=Math.sin(a)*radial*len;
    hairPos.push(0,HUB_Y,0, ex,ey,ez);

    if (j%3===0){
      const bx=ex*0.74, by=HUB_Y+(ey-HUB_Y)*0.74, bz=ez*0.74;
      const tx=-Math.sin(a)*0.020, tz=Math.cos(a)*0.020;
      hairPos.push(bx,by,bz, ex+tx,ey+0.006,ez+tz);
      hairPos.push(bx,by,bz, ex-tx,ey-0.005,ez-tz);
    }
  }
  const pappusGeo = new THREE.BufferGeometry();
  pappusGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(hairPos),3));
  const pappusMat = new THREE.LineBasicMaterial({
    color:0xFFFFFF, transparent:true, opacity:0.54,
    depthTest:true, depthWrite:true, toneMapped:false
  });
  const stemMat = new THREE.MeshStandardMaterial({
    color:0xF1EEE8, roughness:0.96, metalness:0,
    transparent:true, opacity:0.86, depthTest:true, depthWrite:true, toneMapped:false
  });
  const seedMat = new THREE.MeshStandardMaterial({
    color:0xDDD8D0, roughness:1, metalness:0,
    transparent:true, opacity:0.90, depthTest:true, depthWrite:true, toneMapped:false
  });
  const seedTemplate = new THREE.Group();
  seedTemplate.add(new THREE.LineSegments(pappusGeo,pappusMat));

  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.015,8,6),stemMat);
  hub.position.y=HUB_Y; seedTemplate.add(hub);
  const beakPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0,HUB_Y-0.005,0),
    new THREE.Vector3(0.010,0.025,-0.004),
    new THREE.Vector3(-0.006,-0.105,0.006),
    new THREE.Vector3(0,-0.215,0)
  ]);
  const beak = new THREE.Mesh(new THREE.TubeGeometry(beakPath,8,0.0055,5,false),stemMat);
  seedTemplate.add(beak);
  const achene = new THREE.Mesh(new THREE.SphereGeometry(0.031,9,7),seedMat);
  achene.position.y=-0.258;
  achene.scale.set(0.72,1.75,0.72);
  seedTemplate.add(achene);

  const petalCount = Q.petals + FRONT_GRASS_SEEDS.length;
  for (let i=0;i<petalCount;i++){
    const m = seedTemplate.clone(true);
    const opacityParts=[];
    m.traverse(obj=>{
      if (!obj.material) return;
      obj.material=obj.material.clone();
      opacityParts.push({material:obj.material, base:obj.material.opacity});
      obj.material.opacity=0;
    });
    const frontGrassSeed = FRONT_GRASS_SEEDS[i - Q.petals] || null;
    const lowerCornerX = frontGrassSeed ? null : i === 0 ? -4.85 : i === Q.petals - 1 ? 4.85 : null;
    const lowerCorner = lowerCornerX !== null;
    const s = frontGrassSeed ? frontGrassSeed.scale : lowerCorner ? 0.42 + Math.random()*0.07 : 0.36 + Math.random()*0.16;
    m.scale.setScalar(s);
    // Use evenly spaced travel phases rather than independent random starts.
    // They can still drift naturally, but cannot repeatedly bunch at one spot.
    const spreadPhase = frontGrassSeed
      ? frontGrassSeed.off
      : ((i + 0.5) / Q.petals + (Math.random() - 0.5) * 0.055 + 1) % 1;
    const depthBand = (i + 0.5) / Q.petals;
    const lowerCenter = !frontGrassSeed && i === Math.floor(Q.petals / 2) - 1;
    // These are deliberately uneven altitude pockets, not a gradient across
    // the screen. They place a few seeds high at the left/right, while keeping
    // quiet lower pockets in the grass at both corners and near the wordmark.
    const altitudePockets = [
      1.08, 3.22, 1.74, 2.52, 1.12, 2.10,
      1.58, 2.80, 1.42, 3.16, 1.08
    ];
    const pocketY = altitudePockets[i % altitudePockets.length];
    // The two grass corners and the low centre pocket need to read in front
    // of the logo; all remaining seeds retain alternating depth layers.
    const foregroundLane = !!frontGrassSeed || i % 2 === 1 || lowerCorner || lowerCenter;
    const innerBand = (i - 1) / Math.max(1, Q.petals - 3);
    m.userData = {
      k: 1,                                  // shared wind speed keeps spacing stable
      off: spreadPhase,
      // Evenly distributed home positions keep the flock visible and loose.
      cx: frontGrassSeed ? frontGrassSeed.cx : lowerCorner ? lowerCornerX : -4.0 + innerBand*8.0 + (Math.random() - 0.5)*0.12,
      ax: frontGrassSeed ? frontGrassSeed.ax : lowerCorner ? 0.20 + Math.random()*0.08 : 0.25 + Math.random()*0.20,
      // Each seed stays in a distinct air pocket, so the swarm reads as a
      // loose cloud rather than a line. The low pockets have a gentler bob,
      // which keeps them above grass without bouncing through the logo.
      y0: frontGrassSeed ? frontGrassSeed.y0 : pocketY + (Math.random() - 0.5)*0.12,
      yAmp: frontGrassSeed ? frontGrassSeed.yAmp ?? 0.035 + Math.random()*0.025 : (lowerCorner || lowerCenter) ? 0.06 + Math.random()*0.07 : 0.12 + Math.random()*0.20,
      lift: frontGrassSeed ? frontGrassSeed.lift ?? 0.045 + Math.random()*0.030 : (lowerCorner || lowerCenter) ? 0.08 + Math.random()*0.09 : 0.14 + Math.random()*0.26,
      // Matching variation in the turf clearance preserves that vertical
      // spread even when a seed crosses over the foreground mound.
      clearance: frontGrassSeed ? frontGrassSeed.clearance : 1.10 + Math.random()*0.94,
      // Half travel in front of the logo and half clearly behind it. Their
      // Z bands do not overlap the physical wordmark volume.
      foregroundLane,
      z: frontGrassSeed
        ? frontGrassSeed.z
        : lowerCorner
        ? -0.30 + (Math.random() - 0.5)*0.24
        : foregroundLane
        ? -1.25 + (Math.random() - 0.5)*0.42
        : -3.35 - depthBand*0.55 + (Math.random() - 0.5)*0.20,
      rot0: Math.random()*TAU,
      // Twelve to sixteen full turns per 24-second loop: a quicker, visibly
      // airy self-spin while remaining perfectly seamless at the loop seam.
      spin: (12 + (i % 5)) * (Math.random()<0.5 ? -1 : 1),
      lean: 0.10 + Math.random()*0.12,
      opacityParts,
      wob: Math.random()*TAU
    };
    scene.add(m); petals.push(m);
  }
}

/* ─────────────────────────── butterflies ───────────────────────────
   A butterfly does not change direction on unrelated x/y/z rhythms. Each one
   follows a single gentle oval, with a small two-beat rise and fall layered on
   top; that keeps its heading continuous and reads like a real garden hover. */
const flutters = [];
{
  const wingGeo = new THREE.PlaneGeometry(1,1);
  wingGeo.translate(0.5, 0, 0);                 // hinge on the body, not centre
  wingGeo.rotateX(-Math.PI * 0.5);               // real wings lie across x/z
  for (let i=0;i<Q.flutters;i++){
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      map:wingTex, transparent:true, depthTest:false, depthWrite:false,
      side:THREE.DoubleSide, opacity:0.96, toneMapped:false
    });
    const L = new THREE.Mesh(wingGeo, mat), Rw = new THREE.Mesh(wingGeo, mat);
    Rw.scale.x = -1;                             // mirror across the body axis
    g.add(L, Rw);
    // A small body and antennae provide the central visual cue the old
    // wing-only sprite lacked, especially while the wings are edge-on.
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 8),
      new THREE.MeshBasicMaterial({
        color:0x4A423A, transparent:true, opacity:0.96,
        depthTest:false, depthWrite:false, toneMapped:false
      })
    );
    // The abdomen runs fore/aft along local z; yawing the group now points the
    // animal's body into the analytic flight tangent instead of merely turning
    // a vertical card around its centre.
    body.scale.set(0.34, 0.34, 1.85);
    body.position.z = 0.015;
    g.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.064, 10, 8),
      new THREE.MeshBasicMaterial({
        color:0x2B2620, depthTest:false, depthWrite:false, toneMapped:false
      })
    );
    head.position.z = -0.22;
    g.add(head);
    const antennae = new THREE.Group();
    const antennaMat = new THREE.LineBasicMaterial({
      color:0x4A423A, transparent:true, opacity:0.86,
      depthTest:false, depthWrite:false, toneMapped:false
    });
    for (const side of [-1,1]){
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(side*0.018, 0.012, -0.24),
          new THREE.Vector3(side*0.075, 0.018, -0.35),
          new THREE.Vector3(side*0.15, 0.010, -0.42)
        ]), antennaMat
      );
      antennae.add(line);
    }
    g.add(antennae);
    const s = 0.24 + Math.random()*0.16;
    g.scale.setScalar(s);
    // Depth is kept well off the lens: a butterfly that drifts to z≈6 sits
    // 1.5 units from the camera and fills a quarter of the screen as two white
    // leaves. Capping cz+az at ~3 keeps every one of them insect-sized.
    g.userData = {
      L, R:Rw,
      cx:(Math.random()-0.5)*5.4, cy:0.9+Math.random()*1.15, cz:-1.2+Math.random()*2.1,
      ax:1.15+Math.random()*0.70, ay:0.13+Math.random()*0.17, az:0.40+Math.random()*0.28,
      orbit:Math.random()*TAU, bob:Math.random()*TAU,
      flap: 26 + (i%5)*4,                       // integer flaps per loop
      off: Math.random()
    };
    flutterScene.add(g); flutters.push(g);
  }
}

/* ─────────────────────────── foreground blades ───────────────────────────
   The cheapest layer and the most convincing: something soft and dark in front
   of you is what tells the brain it is inside the space, not looking at a picture. */
const fg = [];
// Phone depth-of-field already softens the dense real grass. These oversized
// transparent billboards cannot supply their own depth and appear as dark
// vertical wedges over it, so retain this decorative layer only on desktop.
if (!mobileMeadow) {
  const geo = new THREE.PlaneGeometry(1,1);
  geo.translate(0, 0.5, 0);
  for (let i=0;i<Q.fg;i++){
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map:blurBladeTex, transparent:true, depthWrite:false, side:THREE.DoubleSide,
      opacity:0.62 + Math.random()*0.32, fog:false
    }));
    // Confined to the lower half: out-of-focus blades reading up into the sky
    // look like smudges on the lens, not like grass in front of the camera.
    const h = 1.9 + Math.random()*1.1;
    m.scale.set(h*0.26, h, 1);
    m.position.set(0, -2.05, 3.2 + Math.random()*1.1);
    // x is stored as a fraction of the frustum half-width at this blade's own
    // depth, not as a world value: three units from the lens the frame is only
    // ~3 units wide, so fixed world coordinates threw most of them off screen.
    m.userData = { u:(Math.random()*2-1)*1.05, rot0:(Math.random()-0.5)*0.35,
                   amp:0.10+Math.random()*0.14, k:1+(i%2), off:Math.random() };
    scene.add(m); fg.push(m);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   DEPTH OF FIELD
   This pass renders the scene itself rather than sitting behind a RenderPass,
   because it needs a depth buffer alongside the colour and the two must come
   from the same draw. three's BokehPass re-renders the scene with a depth
   material, which would place every blade of grass at its UN-DISPLACED
   position — the wind lives in a custom vertex shader that a depth override
   throws away, so the grass would be defocused against a depth map that does
   not match the grass you can see.
   ═══════════════════════════════════════════════════════════════════════ */
const logoDofCorner = new THREE.Vector3();
const logoDofCentre = new THREE.Vector3();
function updateLogoDofRegion(uniforms){
  if (!logo || !logo.userData.halfExtent) return;
  const half = logo.userData.halfExtent;
  logo.updateWorldMatrix(true, false);
  camera.updateMatrixWorld();

  let minX=2, minY=2, maxX=-1, maxY=-1;
  for (const sx of [-1,1]) for (const sy of [-1,1]){
    logoDofCorner.set(sx*half.x, sy*half.y, 0);
    logo.localToWorld(logoDofCorner).project(camera);
    const u=logoDofCorner.x*.5+.5, v=logoDofCorner.y*.5+.5;
    minX=Math.min(minX,u); minY=Math.min(minY,v);
    maxX=Math.max(maxX,u); maxY=Math.max(maxY,v);
  }

  // Padding is deliberately larger vertically: it turns the logo-sized box
  // into one calm focus zone and hides any small parallax motion at its edge.
  uniforms.uLogoRegion.value.set(
    Math.max(-0.08,minX-.025), Math.max(-0.08,minY-.045),
    Math.min( 1.08,maxX+.025), Math.min( 1.08,maxY+.045)
  );
  logo.getWorldPosition(logoDofCentre).applyMatrix4(camera.matrixWorldInverse);
  uniforms.uLogoDepth.value=Math.max(camera.near,-logoDofCentre.z);
}

class SceneDofPass extends Pass {
  constructor(scene, camera){
    super();
    this.scene = scene; this.camera = camera;
    this.dof = true;
    this.blurScale = Q.blurScale;
    const depthTexture = new THREE.DepthTexture(1,1);
    depthTexture.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(1,1,{
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType, depthTexture, depthBuffer: true
    });
    // Only the soft lens blur is reduced-resolution. Scene colour/depth, the
    // in-focus pixels and the separately composited candy remain full-size.
    this.blurRT = new THREE.WebGLRenderTarget(1,1,{
      minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
      type:THREE.HalfFloatType, depthBuffer:false
    });
    this.material = new THREE.ShaderMaterial({
      defines: { DOF_SAMPLES: Q.blurSamples },
      uniforms:{
        tDiffuse:{value:null}, tDepth:{value:null}, tBlur:{value:null}, uResolve:{value:0},
        uNear:{value:1}, uFar:{value:130},
        // The mound runs from ~2.9 to ~13.5 units out, so a tight near range
        // throws the whole bottom half of the frame out of focus and the grass
        // stops reading as blades. 9.0 keeps the turf crisp and leaves the
        // defocus where it belongs: the ridges and the foreground fringe.
        uFocus:{value:9.0}, uNearRange:{value:9.0}, uFarRange:{value:20.0},
        uMaxCoc:{value:0.010},
        // Split from uMaxCoc so the far side can be dialled without touching
        // the foreground fringe, which shares the near cap. Kept only a
        // little above it: at 0.024 the blur radius was ~38px, wider than
        // the ridge band is tall, which smeared the band into the sky and
        // made the hill read as miles away instead of as the far end of the
        // same meadow. The grass out there is real geometry now and wants to
        // stay legible as grass.
        //
        // It cannot go to zero either, tempting as that is while inspecting
        // the far grass: the near foreground keeps its own blur, so with the
        // far side sharp the distance ends up CRISPER than the ground at
        // your feet. Measured on the live scene, mean local contrast of the
        // far ground against the near meadow: 14.98 vs 3.49, a ratio of
        // 4.29, and the inverted depth cue is instantly readable as fake.
        // The same sweep gives 1.41 at 0.010, 1.20 at 0.013 and 1.08 at
        // 0.018 — 0.013 is where the far side stops out-reading the near one
        // without going soft enough to look distant again.
        // Keep far dandelions recognisable: this is only a soft depth cue,
        // not enough blur to dissolve their fine pappus fibres.
        uMaxCocFar:{value:0.010},
        // A single soft screen-space region behind the complete wordmark.
        // This deliberately follows the wordmark's overall bounds, not its
        // letter silhouette, so the background cannot look as if a KANDy-
        // shaped blur mask was cut out of it.
        uLogoRegion:{value:new THREE.Vector4(0.06,0.32,0.94,0.72)},
        uLogoDepth:{value:10.0}, uLogoCoc:{value:0.0090},
        uAspect:{value:1}, uOn:{value:1}
      },
      vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
      fragmentShader:`
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tDiffuse, tDepth, tBlur;
        uniform float uResolve;
        uniform float uNear,uFar,uFocus,uNearRange,uFarRange,uMaxCoc,uMaxCocFar,uAspect,uOn;
        uniform vec4 uLogoRegion;
        uniform float uLogoDepth,uLogoCoc;
        float viewDist(vec2 uv){
          float d = texture2D(tDepth, uv).x * 2.0 - 1.0;      // window → NDC
          return (2.0*uNear*uFar) / (uFar + uNear - d*(uFar - uNear));
        }
        float cocAt(float dist){
          // Asymmetric on purpose: the far side stays gentle so the mound keeps
          // its texture and only the ridges go to haze.
          if (dist < uFocus){
            float s = (uFocus - dist)/uNearRange;
            return clamp(s, 0.0, 1.0) * uMaxCoc;
          }
          float s = (dist - uFocus)/uFarRange;
          return clamp(s, 0.0, 1.0) * uMaxCocFar;
        }
        // Bloom spreads one non-finite texel across its mip chain and the
        // whole output can resolve black. Finite scene colours pass unchanged.
        vec3 clean(vec3 v){ return min(max(v, vec3(0.0)), vec3(64.0)); }
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          c.rgb = clean(c.rgb);
          if (uOn < 0.5){ gl_FragColor = c; return; }
          float dist = viewDist(vUv);
          float coc = cocAt(dist);

          // Feather one continuous rectangle covering the whole logo. Only
          // geometry genuinely behind the logo plane receives this uniform
          // CoC; grass and dandelions in front retain their own focus. The
          // separable edge fade keeps the transition broad and lens-like.
          vec2 feather = vec2(0.040, 0.055);
          vec2 enter = smoothstep(uLogoRegion.xy,
                                  uLogoRegion.xy + feather, vUv);
          vec2 leave = 1.0 - smoothstep(uLogoRegion.zw - feather,
                                        uLogoRegion.zw, vUv);
          float region = enter.x * enter.y * leave.x * leave.y;
          float behind = smoothstep(uLogoDepth + 0.10,
                                    uLogoDepth + 0.85, dist);
          coc = mix(coc, uLogoCoc, region * behind);
          if (coc < 0.0012){ gl_FragColor = c; return; }
          if (uResolve > 0.5){
            gl_FragColor = vec4(texture2D(tBlur, vUv).rgb, c.a);
            return;
          }
          vec3 sum = c.rgb; float wsum = 1.0;
          for (int i=0;i<DOF_SAMPLES;i++){
            float t = (float(i)+0.5)/float(DOF_SAMPLES);
            float r = sqrt(t);
            float a = float(i)*2.39996323;                   // golden angle
            vec2 o = vec2(cos(a), sin(a)) * r * coc;
            o.x /= uAspect;                                  // keep bokeh round
            vec2 uv = clamp(vUv + o, vec2(0.0), vec2(1.0));
            float sd = viewDist(uv);
            float sc = cocAt(sd);
            // A sharp thing in front of a blurred thing must not smear back
            // over it: a nearer sample only contributes if its own circle of
            // confusion is actually wide enough to reach here.
            float w = (sd < dist - 0.05) ? step(r*coc*0.98, sc) : 1.0;
            sum += texture2D(tDiffuse, uv).rgb * w;
            wsum += w;
          }
          gl_FragColor = vec4(clean(sum / max(wsum, 1e-4)), c.a);
        }`
    });
    this.fsq = new FullScreenQuad(this.material);
  }
  setSize(w,h){
    this.rt.setSize(w,h);
    this.blurRT.setSize(Math.max(1,Math.ceil(w*this.blurScale)),Math.max(1,Math.ceil(h*this.blurScale)));
    this.material.uniforms.uAspect.value = w/h;
  }
  render(renderer, writeBuffer){
    renderer.setRenderTarget(this.rt);
    renderer.clear(true,true,true);
    renderer.render(this.scene, this.camera);
    const u = this.material.uniforms;
    u.tDiffuse.value = this.rt.texture;
    u.tDepth.value   = this.rt.depthTexture;
    u.uOn.value      = this.dof ? 1 : 0;
    u.uNear.value    = this.camera.near;
    u.uFar.value     = this.camera.far;
    // focus tracks the wordmark: it is the one thing that must stay razor sharp
    u.uFocus.value   = this.camera.position.z - LOGO_Z - 1.1;
    updateLogoDofRegion(u);
    u.uResolve.value = 0;
    // Never leave the previous frame's blur texture bound while writing it.
    u.tBlur.value = null;
    if(this.dof){
      renderer.setRenderTarget(this.blurRT);
      this.fsq.render(renderer);
      u.tBlur.value = this.blurRT.texture;
      u.uResolve.value = 1;
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.fsq.render(renderer);
  }
  dispose(){
    this.rt.dispose(); this.blurRT.dispose();
    this.material.dispose(); this.fsq.dispose();
  }
}

/* ─────────────────────────── post ─────────────────────────── */
const composer = new EffectComposer(renderer);
const dofPass = new SceneDofPass(scene, camera);
dofPass.dof = Q.dof;
composer.addPass(dofPass);
const bloom = new MeadowBloomPass(0.32,0.86);
bloom.enabled = Q.bloom;
composer.addPass(bloom);
const outputPass = new MeadowOutputPass();
composer.addPass(outputPass);

// Render the glossy logo into its own HDR target before EffectComposer touches
// renderer state. The meadow is then composited normally without the logo, and
// a tiny depth-aware full-screen pass puts the logo back only where it is
// closer than the meadow/dandelion depth. This preserves the standalone look
// and the real front/behind relationships at the same time.
const logoDepthTexture=new THREE.DepthTexture(1,1);
logoDepthTexture.type=THREE.UnsignedIntType;
const logoRenderTarget=new THREE.WebGLRenderTarget(1,1,{
  type:THREE.HalfFloatType,
  minFilter:THREE.LinearFilter,
  magFilter:THREE.LinearFilter,
  depthBuffer:true,
  depthTexture:logoDepthTexture
});
logoRenderTarget.samples=Math.min(
  tierName==='high'?4:tierName==='mid'?2:0,
  renderer.capabilities.maxSamples||4
);
const logoCompositeMaterial=new THREE.ShaderMaterial({
  uniforms:{
    tLogo:{value:logoRenderTarget.texture},
    tLogoDepth:{value:logoDepthTexture},
    tSceneDepth:{value:dofPass.rt.depthTexture},
    uLogoTexel:{value:new THREE.Vector2(1,1)},
    // Less than one physical pixel: enough to remove the cut-out edge without
    // making the candy surface or its decorations look soft.
    uLogoFeatherPx:{value:0.65}
  },
  depthTest:false,
  depthWrite:false,
  transparent:true,
  toneMapped:false,
  vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tLogo,tLogoDepth,tSceneDepth;
    uniform vec2 uLogoTexel;
    uniform float uLogoFeatherPx;
    vec4 visibleLogo(vec2 uv){
      vec4 s=texture2D(tLogo,uv);
      float logoDepth=texture2D(tLogoDepth,uv).x;
      float sceneDepth=texture2D(tSceneDepth,uv).x;
      float hasLogo=1.0-step(0.999999,logoDepth);
      float inFront=step(logoDepth,sceneDepth+0.000008);
      float visible=hasLogo*inFront;
      s.rgb*=visible;
      s.a*=visible;
      return s;
    }
    void main(){
      vec2 p=uLogoTexel*uLogoFeatherPx;
      vec4 c=visibleLogo(vUv);
      vec4 l=visibleLogo(vUv-vec2(p.x,0.0));
      vec4 r=visibleLogo(vUv+vec2(p.x,0.0));
      vec4 d=visibleLogo(vUv-vec2(0.0,p.y));
      vec4 u=visibleLogo(vUv+vec2(0.0,p.y));
      float weight=c.a*4.0+l.a+r.a+d.a+u.a;
      float alpha=weight/8.0;
      if(alpha<0.001) discard;
      // MSAA resolves the transparent logo target into premultiplied edge
      // colours already. Multiplying those colours by alpha a second time is
      // what created the dark one-pixel fringe.
      vec3 rgb=(c.rgb*4.0+l.rgb+r.rgb+d.rgb+u.rgb)
              / max(weight,0.00001);
      gl_FragColor=vec4(rgb,alpha);
      #include <colorspace_fragment>
    }`
});
const logoCompositeQuad=new FullScreenQuad(logoCompositeMaterial);

function renderComposite(){
  const directLogo=logo && logo!==fallbackLogo &&
    (logo.layers.mask & (1<<LOGO_LIGHT_LAYER))!==0;
  if(!directLogo){
    composer.render();
    const oldAutoClear=renderer.autoClear;
    renderer.autoClear=false;
    renderer.setRenderTarget(null);
    renderer.clearDepth();
    renderer.render(flutterScene,camera);
    renderer.autoClear=oldAutoClear;
    return;
  }

  const logoWasVisible=logo.visible;
  const oldEnvironment=scene.environment;
  const oldBackground=scene.background;
  const oldExposure=renderer.toneMappingExposure;
  const oldCameraMask=camera.layers.mask;
  const oldTarget=renderer.getRenderTarget();
  const oldClearColor=renderer.getClearColor(new THREE.Color()).clone();
  const oldClearAlpha=renderer.getClearAlpha();
  scene.environment=logoEnvRT.texture;
  scene.background=null;
  renderer.toneMappingExposure=.84;
  camera.layers.set(LOGO_LIGHT_LAYER);
  renderer.setRenderTarget(logoRenderTarget);
  renderer.setClearColor(0x000000,0);
  renderer.clear(true,true,true);
  renderer.render(scene,camera);
  renderer.setClearColor(oldClearColor,oldClearAlpha);
  renderer.setRenderTarget(oldTarget);
  camera.layers.mask=oldCameraMask;
  renderer.toneMappingExposure=oldExposure;
  scene.background=oldBackground;
  scene.environment=oldEnvironment;

  logo.visible=false;
  composer.render();
  logo.visible=logoWasVisible;

  const oldAutoClear=renderer.autoClear;
  renderer.autoClear=false;
  renderer.setRenderTarget(null);
  logoCompositeQuad.render(renderer);
  renderer.clearDepth();
  renderer.render(flutterScene,camera);
  renderer.autoClear=oldAutoClear;
}

/* ─────────────────────────── pointer (NOT part of the loop) ───────────────
   Apple's Spatial Scene look comes from moving the CAMERA through a real
   parallax volume, not from sliding flat layers: only a camera move produces
   genuine perspective shift and lets the mound actually occlude more or less
   of the wordmark as you lean. */
const ptr = {x:0, y:0, sx:0, sy:0};
addEventListener('pointermove', e => {
  // A page swipe is navigation, not an instruction to swing the camera.
  if (e.pointerType === 'touch') return;
  ptr.x = (e.clientX/innerWidth)*2 - 1;
  ptr.y = (e.clientY/innerHeight)*2 - 1;
}, {passive:true});
addEventListener('pointerleave', () => { ptr.x = 0; ptr.y = 0; });

/* ─────────────────────────── resize ─────────────────────────── */
const portrait = () => camera.aspect < 0.92;
let dprScale = 1, painting = false;
let lastW = 0, lastH = 0, lastDprScale = -1;

function resize(){
  // Sized off the canvas's own box, not the window: mounted in the page the
  // hero is a section, and on mobile its 100dvh changes when the URL bar
  // slides away without the window ever firing a resize.
  const w = canvas.clientWidth  || innerWidth;
  const h = canvas.clientHeight || innerHeight;
  // Rebuilding every render target — the composer's pair, the DOF target with
  // its depth texture, and bloom's eleven mip levels — is the single most
  // expensive thing in this file, and a page mounts a ResizeObserver that can
  // fire on events that did not actually change the box. Doing that work for a
  // size we are already at is pure jank, so bail unless something moved.
  if (w === lastW && h === lastH && dprScale === lastDprScale) return;
  lastW = w; lastH = h; lastDprScale = dprScale;
  camera.aspect = w/h;
  // The close-up grass carpet is deliberately portrait-only. Toggle it from
  // the current box, not from a one-time startup value, so a manually
  // narrowed desktop window receives the same ground coverage as a phone.
  if (narrowUnderGrowth) narrowUnderGrowth.visible = camera.aspect < 0.92;
  // Portrait: a wider lens and a step back, because the wordmark plus a
  // readable amount of mound cannot both fit a 38° cone on a phone.
  // The wordmark is 2.6:1, so once it spans the width of a phone it can only
  // ever be ~15% of the height — that ratio is fixed and no camera setting
  // changes it. What the camera CAN do is decide how much sky sits above it,
  // so the aim drops well below the horizon to lift the crown of the mound
  // into the upper third, where it catches the letters instead of leaving
  // them stranded in the middle of an empty sky.
  if (camera.aspect < 0.92){
    camera.fov = 52; CAM_BASE.set(0, 1.15, 8.7); LOOK_BASE.set(0, -0.35, 0);
    if (centeredPhoneLogo?.matches) {
      // Aim the centre ray at the existing logo's resting position. Move the
      // framing, not the candy in the grass, preserving its natural occlusion.
      LOOK_BASE.y = CAM_BASE.y + (logoRestY() - CAM_BASE.y)
        * CAM_BASE.z / (CAM_BASE.z - LOGO_Z);
    }
    // Keep the established desktop portrait focus range. Phones expose wider
    // low-tier blades close to the lens, so retain a softer foreground there.
    dofPass.material.uniforms.uNearRange.value = mobileMeadow ? 9.0 : 16.0;
  } else {
    camera.fov = 38; CAM_BASE.set(0, 0.95, 7.5); LOOK_BASE.set(0, 0.80, 0);
    dofPass.material.uniforms.uNearRange.value = 9.0;
  }
  // The closer phone turf needs a broader soft-focus footprint. The candy is
  // rendered separately at full size, so this does not soften its lettering.
  dofPass.material.uniforms.uMaxCoc.value = mobileMeadow ? 0.012 : 0.010;
  camera.updateProjectionMatrix();

  // Retina-sized windows otherwise allocate several multi-million-pixel HDR
  // buffers for each frame. Keep their total area bounded, not just the DPR.
  const dpr = Math.min(devicePixelRatio||1, Q.dpr, Math.sqrt(2500000/(w*h))) * dprScale;
  // Browser interpolation attenuates dithering when the bounded canvas is
  // upscaled on Retina. Compensate without increasing any render target.
  outputPass.uniforms.uDitherStrength.value = 1.5 * Math.min(2,(devicePixelRatio||1)/dpr);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w,h,false);
  // Taken from the renderer rather than recomputed, so the DOF target matches
  // the composer's buffers exactly — a one-pixel disagreement shifts every
  // depth lookup by half a texel.
  const db = renderer.getDrawingBufferSize(new THREE.Vector2());
  // EffectComposer otherwise stores fractional CSS-size × DPR dimensions on
  // some window sizes while WebGL floors the drawing buffer to integers. That
  // mismatch can leave most of a post-processing frame black after resize.
  composer.setPixelRatio(1);
  composer.setSize(db.x, db.y);
  dofPass.setSize(db.x, db.y);
  logoRenderTarget.setSize(db.x,db.y);
  logoCompositeMaterial.uniforms.uLogoTexel.value.set(1/db.x,1/db.y);
  // The bloom pass allocates its own low-resolution daylight glow buffers.
  { const el = UI('pDpr'); if (el) el.textContent = dpr.toFixed(2); }

  if (logo) fitLogo();
  for (const b of fg){
    const halfH = Math.tan(camera.fov*Math.PI/360) * (CAM_BASE.z - b.position.z);
    b.position.x = b.userData.u * halfH * camera.aspect;
  }
  const sky = scene.userData.sky;
  const d = camera.position.z - sky.position.z;
  const sh = 2*Math.tan(camera.fov*Math.PI/360)*d;
  sky.scale.set(sh*camera.aspect*1.9, sh*1.6, 1);

  // WebGLRenderTarget.setSize disposes its framebuffer and recreates it lazily
  // on first bind. Allocate and clear every target now, then repaint twice: the
  // browser never gets a freshly cleared buffer between resize and the next
  // animation frame, including during mobile URL-bar height changes.
  const prevRT = renderer.getRenderTarget();
  const targets = [composer.renderTarget1, composer.renderTarget2, dofPass.rt, dofPass.blurRT, logoRenderTarget,
                   bloom.prefiltered,bloom.horizontal,bloom.vertical];
  for (const rt of targets){
    if (!rt || !rt.width || !rt.height) continue;
    renderer.setRenderTarget(rt);
    renderer.clear(true, true, true);
  }
  renderer.setRenderTarget(prevRT);

  repaint();
  repaint();
}
function repaint(){
  // resize() can be called by adaptive quality from inside the frame loop.
  if (painting) return;
  painting = true;
  try { build(phase); cameraUpdate(phase); renderComposite(); }
  finally { painting = false; }
}
addEventListener('resize', resize);

/* ─────────────────────────── the frame ─────────────────────────── */
const fract = v => v - Math.floor(v);
let phase = 0, fps = '—';

function build(phi){
  for (const gm of scene.userData.grassMats) gm.uniforms.uPhase.value = phi;

  for (const c of clouds){
    const u = fract(phi * c.userData.k + c.userData.off);
    c.position.x = -c.userData.span/2 + u * c.userData.span;
    c.position.y = c.userData.y;
    c.material.uniforms.uPhase.value = phi;
    // Fade in over the first CLOUD_FADE of the run and out over the last, so
    // the wrap back to the start happens at zero opacity. u is a fract() of
    // phi, so this is identical at phi=0 and phi=1 and cannot open a seam.
    const ss = t => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t*t*(3 - 2*t); };
    c.material.uniforms.uFade.value = ss(u/CLOUD_FADE) * ss((1 - u)/CLOUD_FADE);
  }

  for (const p of petals){
    const u = fract(phi * p.userData.k + p.userData.off);
    const d = p.userData;
    const a = TAU*u;
    p.position.x = d.cx + Math.cos(a)*d.ax;
    p.position.z = d.z + Math.sin(a + d.wob)*0.26;
    // A closed three-dimensional breeze path has no entrance, exit, or
    // phase jump. The mound clamp only protects the physical turf below it.
    const flightY = d.y0
      + Math.sin(a + d.wob) * d.lift
      + Math.sin(2*a + d.wob) * d.yAmp;
    const moundY = (p.position.x*p.position.x + p.position.z*p.position.z < R*R)
      ? surfaceY(p.position.x,p.position.z) + d.clearance
      : -Infinity;
    const baseY = Math.max(flightY,moundY);
    // Depth, rather than an artificial vertical detour, establishes the
    // natural relationship to the logo: front seeds overlay it; back seeds
    // disappear behind it without intersecting the geometry.
    p.position.y = baseY;
    // The pappus stays above the seed like a parachute. Integer full turns make
    // the self-spin obvious while keeping the φ=1 → φ=0 loop seamless.
    p.rotation.set(
      Math.sin(TAU*u + d.wob)*d.lean,
      d.rot0 + TAU*u*d.spin,
      Math.cos(TAU*u + d.wob)*d.lean*0.72
    );
    // Closed loops stay fully visible; no opacity threshold can flicker.
    p.visible = true;
    for (const part of d.opacityParts) part.material.opacity=part.base;
  }

  for (const g of flutters){
    const d = g.userData, u = fract(phi + d.off), a = TAU*u + d.orbit;
    const x = d.cx + Math.cos(a)*d.ax;
    const z = d.cz + Math.sin(a)*d.az;
    const y = d.cy + Math.sin(a*2 + d.bob)*d.ay;
    // Derivatives of that single oval give one unbroken, natural turn.
    const dx = -Math.sin(a)*d.ax;
    const dz =  Math.cos(a)*d.az;
    const dy =  Math.cos(a*2 + d.bob)*d.ay*2;
    g.position.set(x,y,z);
    // The anatomical head and antennae live at local -Z, so local -Z—not +Z—
    // must point into the velocity tangent. The missing half-turn here was
    // making the butterfly travel tail-first around the entire oval.
    const yaw = Math.atan2(dx, dz) + Math.PI;
    const pitch = THREE.MathUtils.clamp(-dy*0.18, -0.16, 0.16);
    const bank = Math.sin(a) * 0.10;
    g.rotation.set(pitch, yaw, bank, 'YXZ');
    // Signed flapping around the body axis gives a complete up/down wingbeat.
    const flap = Math.sin(TAU * d.flap * u) * 0.72 - 0.06;
    d.L.rotation.z =  flap;
    d.R.rotation.z = -flap;
  }

  for (const b of fg){
    const d = b.userData;
    b.rotation.z = d.rot0 + Math.sin(TAU*(d.k*phi) + d.off*TAU)*d.amp;
  }
}

function cameraUpdate(phi){
  ptr.sx += (ptr.x - ptr.sx) * 0.055;
  ptr.sy += (ptr.y - ptr.sy) * 0.055;
  const breath = Math.sin(TAU*phi) * 0.16;          // periodic, so it loops too
  // A phone is held, not hovered: the same swing that reads as a gentle lean
  // with a mouse reads as a wobble under a thumb.
  const SWING = portrait() ? 0.55 : 0.85;
  camera.position.set(
    CAM_BASE.x + ptr.sx * SWING,
    CAM_BASE.y - ptr.sy * 0.42,
    CAM_BASE.z + breath
  );
  camera.lookAt(LOOK_BASE.x + ptr.sx*0.10, LOOK_BASE.y - ptr.sy*0.05, LOOK_BASE.z);
  camera.rotation.z = -ptr.sx * 0.012;               // the tiny roll sells the tilt
  applyLogoTrack();
}

/* ─────────────────────────── adaptive quality ───────────────────────────
   Only touches things that are free to change between frames. Resolution goes
   first within a tier-specific clarity floor. Keep depth of field: turning it
   off exposes hard grass edges. Optional bloom and blur resolution can fall. */
let slow = 0, fast = 0;
function adapt(){
  // A throttled tab looks exactly like a GPU that cannot keep up. Measured
  // here: the scene reported 20fps and demoted itself to dpr 1.19 while the
  // GPU was only 3.3ms/frame busy. Never judge performance on frames the
  // compositor never asked for.
  if (document.hidden){ slow = 0; fast = 0; return; }
  // document.hidden is not enough. An embedded preview pane — or any occluded
  // window — can keep reporting visibilityState 'visible' while the compositor
  // has quietly stopped requesting frames; rAF was measured at 1.1Hz with
  // hidden === false.
  // It cannot be caught from `fps` either, because dt is clamped to 50ms
  // before it is accumulated: at 1Hz that clamp makes the counter report a
  // plausible-looking 20fps. The raw, unclamped gap is the only honest signal,
  // and a >120ms gap means frames are not being requested — no GPU that draws
  // this scene at all is that slow, since the hardware that would be is
  // already sorted into the low tier before the first frame.
  if (maxRawDt > 0.12){ slow = 0; fast = 0; maxRawDt = 0; return; }
  maxRawDt = 0;
  if (fps < 46){
    slow++; fast = 0;
    if (slow > 3){
      slow = 0;
      if (dprScale > Q.minDprScale){ dprScale = Math.max(Q.minDprScale, dprScale - 0.12); resize(); }
      else if (bloom.enabled){ bloom.enabled = false; }
      else if (dofPass.blurScale > .25){
        dofPass.blurScale = Math.max(.25, dofPass.blurScale - .05);
        dofPass.setSize(dofPass.rt.width, dofPass.rt.height);
      }
    }
  } else if (fps > 58){
    fast++; slow = 0;
    // Recovering in 0.12 steps every 3s rather than 0.06 every 6s: coming back
    // from a spurious demotion should not take half a minute.
    if (fast > 6){
      fast = 0;
      if (dprScale < 1){ dprScale = Math.min(1, dprScale + 0.12); resize(); }
      else if (dofPass.blurScale < Q.blurScale){
        dofPass.blurScale = Math.min(Q.blurScale, dofPass.blurScale + .05);
        dofPass.setSize(dofPass.rt.width, dofPass.rt.height);
      }
    }
  }
}
// Returning to the tab should not inherit the stale verdict from the frames
// that were throttled while it was away.
addEventListener('visibilitychange', () => { slow = 0; fast = 0; });

let last = performance.now(), acc = 0, frames = 0, seamJump = 0, maxRawDt = 0;
let raf = 0, paused = false;
const startupOverlay = document.getElementById('siteLoader');
function loop(now){
  raf = 0;
  if (paused || meadowDisposed) return;
  raf = requestAnimationFrame(loop);
  // The opaque loader hides this entire scene. Don't compete with its input
  // and background model jobs; the onReady repaint still prepares the first
  // complete frame. Resume live meadow motion as soon as the fade starts.
  const covered = startupOverlay?.isConnected && !startupOverlay.classList.contains('is-done');
  if (paused || covered){ last = now; return; }
  const rawDt = (now-last)/1000;
  // The clamp keeps a long stall from lurching the animation forward; the raw
  // value is kept because adapt() needs to tell "slow GPU" from "no frames
  // requested", and the clamped one cannot express the difference.
  const dt = Math.min(0.05, rawDt); last = now;
  if (rawDt > maxRawDt) maxRawDt = rawDt;

  phase = fract(((now/1000) * (reduced ? 0.35 : 1) / T) + seamJump);
  build(phase);
  cameraUpdate(phase);
  renderComposite();

  frames++; acc += dt;
  if (acc >= 0.5){
    fps = Math.round(frames/acc);
    { const el = UI('pFps'); if (el) el.textContent = fps; }
    frames = 0; acc = 0;
    adapt();
  }
  { const el = UI('pPhase'); if (el) el.textContent = phase.toFixed(3); }
  { const el = UI('pBar');   if (el) el.style.width = (phase*100).toFixed(1) + '%'; }
}

if (opts.panel){
  const set = (id,v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('pT', T + 's'); set('pTier', tierName); set('pDof', Q.dof ? 'on' : 'off');
  const seamBtn = document.getElementById('seamBtn');
  if (seamBtn) seamBtn.onclick = () => { seamJump = fract(0.97 - fract((performance.now()/1000)/T)); };
  const panel = document.getElementById('panel');
  const hideBtn = document.getElementById('hideBtn');
  if (hideBtn && panel) hideBtn.onclick = () => panel.classList.add('hide');
  if (panel) addEventListener('keydown', e => { if (e.key === 'h' || e.key === 'H') panel.classList.toggle('hide'); });
}

resize();
raf = requestAnimationFrame(loop);
// The first grass frame can precede the asynchronous candy geometry by
// seconds. Only release the loading screen after the complete logo is drawn.
wordmarkReady.then(() => requestAnimationFrame(() => {
  if (meadowDisposed) return;
  repaint();
  canvas.dataset.ready = 'true';
  opts.onReady?.();
}));

// Exposed so the loop can be inspected/stepped without depending on the tab
// being foregrounded (rAF is throttled when it is not).
return {
  THREE, renderer, composer, scene, flutterScene, camera, T, dofPass, bloom, tier:tierName,
  look(x,y){ ptr.x = ptr.sx = x; ptr.y = ptr.sy = y; },
  setLogoTrack(value){
    logoTrackPixels = Math.max(0, Number(value) || 0);
    // The visible animation loop owns painting. Scroll must not repaint a
    // paused, off-screen meadow (or render it twice in the same frame).
    return Math.min(logoTrackPixels, logoTrackLimitPixels());
  },
  get logoTrack(){ return Math.min(logoTrackPixels, logoTrackLimitPixels()); },
  get logoTrackLimit(){ return logoTrackLimitPixels(); },
  set phase(p){ seamJump = fract(p - fract((performance.now()/1000)/T)); },
  render(p){ build(p); cameraUpdate(p); renderComposite(); return p; },
  resize,
  setPaused(v){
    const was = paused;
    paused = !!v;
    if (paused) { cancelAnimationFrame(raf); raf = 0; }
    // Waking up: paint immediately rather than waiting for the next rAF. The
    // observer fires while the hero is already scrolling back into view.
    if (was && !paused){
      last = performance.now();
      build(phase); cameraUpdate(phase); renderComposite();
      if (!raf) raf = requestAnimationFrame(loop);
    }
  },
  dispose(){
    meadowDisposed=true;
    cancelAnimationFrame(raf);
    logoCompositeQuad.dispose();
    logoCompositeMaterial.dispose();
    logoRenderTarget.dispose();
    dofPass.dispose();
    bloom.dispose();
    outputPass.dispose();
    composer.dispose();
    logoEnvRT.dispose();
    renderer.dispose();
  }
};
}
