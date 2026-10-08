import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildCandyWordmark } from './candy-wordmark.js?v=geometry-cache-1';
import { addCandyDecorations } from './kandy-logo-decorations.js';
import { separateCandyLetters } from './kandy-separated-letters.js';

const clamp01 = value => THREE.MathUtils.clamp(value, 0, 1);

/**
 * Transparent, fixed-to-the-viewport letter layer used only during the handoff
 * between the meadow and the marquee. The letters are driven by scroll rather
 * than time, so reversing the scroll reconstructs the wordmark exactly.
 */
export function createLetterFall({ canvas, onReady } = {}) {
  if (!canvas) throw new Error('createLetterFall requires a canvas.');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    powerPreference: 'high-performance'
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .84;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(29, 1, .1, 60);
  camera.position.set(0, .12, 15.2);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), .035);
  scene.environment = environment.texture;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xfff8fa, 0xd878a2, .52));
  const key = new THREE.DirectionalLight(0xfff1df, 1.45);
  key.position.set(-5.5, 7.5, 7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xf3a8c9, .55);
  rim.position.set(5, 2, -6);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffe8f1, .16);
  fill.position.set(-4, -2, 4);
  scene.add(fill);

  let logo = null;
  let letters = [];
  let progress = 0;
  let ready = false;
  let lastWidth = 0;
  let lastHeight = 0;
  let lastDrawnProgress = -1;
  let renderDirty = true;
  // The launch point is frozen when the fall starts, while the marquee's
  // occlusion edge keeps moving upward with normal page scroll. Keeping these
  // separate prevents the strip's motion from cancelling the downward fall.
  let launchY = innerHeight;
  let occlusionY = innerHeight;

  // A deliberately uneven fall: no two letters share a start, finish, drift,
  // or rotation. Values are deterministic so scroll reversal never jitters.
  const motion = [
    { start:.00, end:.76, dx:-.82, rx: 1.8, ry:-2.4, rz:-1.35 },
    { start:.12, end:.86, dx: .34, rx:-2.6, ry: 1.7, rz: 1.05 },
    { start:.05, end:.72, dx:-.24, rx: 2.2, ry: 2.8, rz:-.72 },
    { start:.20, end:.95, dx: .72, rx:-1.5, ry:-3.2, rz: 1.28 },
    { start:.09, end:.80, dx: 1.08, rx: 2.9, ry: 1.9, rz: 1.72 }
  ];

  function frameHeight() {
    return 2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.z;
  }

  function applyOcclusion() {
    const viewportHeight = Math.max(lastHeight || canvas.clientHeight || innerHeight, 1);
    const revealY = THREE.MathUtils.clamp(occlusionY, 0, viewportHeight);
    const inset = `${revealY.toFixed(2)}px 0px 0px 0px`;
    canvas.style.clipPath = `inset(${inset})`;
    canvas.style.webkitClipPath = `inset(${inset})`;
  }

  function positionAtLaunch() {
    if (!logo) return;
    const viewportHeight = Math.max(lastHeight || canvas.clientHeight || innerHeight, 1);
    const revealY = THREE.MathUtils.clamp(launchY, 0, viewportHeight);
    // Keep a small hidden lead-in so the first visible pixels travel out from
    // under the strip instead of appearing exactly on its edge.
    const hiddenBottomY = Math.max(0, revealY - 10);
    const sourceWorldY = camera.position.y
      + (.5 - hiddenBottomY / viewportHeight) * frameHeight();
    const halfHeight = logo.userData.halfExtent.y * logo.scale.y;
    logo.position.set(0, sourceWorldY + halfHeight, 0);
  }

  function fitLogo() {
    if (!logo) return;
    const naturalWidth = logo.userData.halfExtent.x * 2;
    const naturalHeight = logo.userData.halfExtent.y * 2;
    const height = frameHeight();
    const width = height * camera.aspect;
    const portrait = camera.aspect < .78;
    const scale = Math.min(
      width * (portrait ? .84 : .78) / naturalWidth,
      height * (portrait ? .34 : .54) / naturalHeight
    );
    logo.scale.setScalar(scale);
    positionAtLaunch();
    applyOcclusion();
  }

  function applyProgress(value) {
    progress = clamp01(Number(value) || 0);
    // No fade-in: the marquee edge itself reveals the geometry. This removes
    // the impression that the letters materialise in front of the page.
    canvas.style.opacity = ready && progress > .0005 && progress < .999
      ? '1'
      : '0';
    canvas.style.visibility = ready && progress > .0005 && progress < .999 ? 'visible' : 'hidden';
    if (!ready || !logo) return;
    // At both ends the entire viewport canvas is invisible. Don't clear,
    // traverse and submit a multi-million-pixel frame on every page scroll.
    if (document.hidden || progress <= .0005 || progress >= .999) return;
    if (!renderDirty && progress === lastDrawnProgress) return;
    renderDirty = false;
    lastDrawnProgress = progress;

    const localFall = frameHeight() * 1.46 / Math.max(logo.scale.y, .0001);
    const localDrift = 1 / Math.max(logo.scale.x, .0001);
    letters.forEach((letter, index) => {
      const spec = motion[index];
      const t = clamp01((progress - spec.start) / (spec.end - spec.start));
      // Gravity acceleration with a tiny middle wobble. It is a pure function
      // of progress, not accumulated velocity, so scrolling upward is exact.
      const gravity = t * t;
      const sway = Math.sin(t * Math.PI) * .18;
      const base = letter.userData.basePosition;
      letter.position.set(
        base.x + (spec.dx * gravity + sway * Math.sign(spec.dx || 1)) * localDrift,
        base.y - localFall * gravity,
        base.z + Math.sin(t * Math.PI) * (index % 2 ? .18 : -.14) * localDrift
      );
      letter.rotation.set(
        spec.rx * gravity,
        spec.ry * gravity,
        spec.rz * gravity + sway * .35,
        'YXZ'
      );
    });
    renderer.render(scene, camera);
  }

  function resize() {
    const width = canvas.clientWidth || innerWidth;
    const height = canvas.clientHeight || innerHeight;
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    // The separated wordmark grows to nearly the full viewport width during
    // the mission handoff. At DPR 1 its transparent silhouette is rasterised
    // too close to its final display size, so the browser has no extra samples
    // to smooth the long candy curves. Render this small, five-letter layer at
    // native device resolution, capped at 2x. Don't force a 1x/1.5x display to
    // shade a supersampled full-screen buffer on every scrolling frame.
    const smoothDpr = Math.min(devicePixelRatio || 1, 2);
    renderer.setPixelRatio(smoothDpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.fov = camera.aspect < .78 ? 36 : 29;
    camera.updateProjectionMatrix();
    renderDirty = true;
    fitLogo();
    applyProgress(progress);
  }

  buildCandyWordmark({
    cooperative:true,
    prebuiltGeometryUrl:`./assets/models/letters-${innerWidth<720?'mobile':'desktop'}.geometry.bin.gz`,
    logoUrl:'../Logo/kandy-logo-separated.png', widthUnits:8.4,
    geometryMode:'inflated', materialMode:'physical', inflateStep:innerWidth<720?3:2,
    referenceFrontTexture:true, referencePillowGeometry:true, referenceSidePhysical:true,
    referenceSurfaceBlend:true, referenceSurfaceBlendStart:.28, referenceSurfaceBlendEnd:.78,
    unifiedInflatedBody:true, unifiedVoxelStepPx:innerWidth<720?1.65:1.35,
    unifiedDepthSegments:innerWidth<720?60:72, unifiedSurfaceBlend:.04,
    unifiedSdfSmoothPasses:4, unifiedSdfSmoothStrength:.92, unifiedNormalRadius:3,
    unifiedNormalSmoothPasses:5, unifiedNormalSmoothStrength:.62,
    unifiedTangentialSmoothPasses:8, unifiedTangentialSmoothStrength:.40,
    unifiedTangentialSmoothLimit:.20, unifiedProjectionLimit:.06,
    preserveReferenceDecorations:false, frontInflate:.78, backInflate:.72,
    waistDepth:.46, creaseDepth:0, contourSmooth:5, contourSpacing:.20,
    contourSimplify:.05, sideCurveSegments:24, smoothSideNormals:true,
    sideOutlineOverlapPx:1.65, sideFrontOverlap:.22, sideProfileSegments:32,
    sideBulgePx:.68, physicalColor:0xf18aae, physicalRoughness:.30,
    physicalTransmission:0, physicalThickness:1.12, attenuationColor:0xe65b86,
    attenuationDistance:.48, ior:1.35, backBumpScale:.18, sideRoughness:.33,
    sideClearcoat:.44, sideClearcoatRoughness:.38, sideSpecularIntensity:.58,
    sideEnvMapIntensity:.78, edgeGlowColor:0xffd6e5, edgeGlowIntensity:.018,
    sideColor:0xf18aae, sideTransmission:0, alphaTest:.08, finish:'glossy'
  }).then(async group => {
    logo = group;
    const bodyPink = new THREE.Color(0xf18aae);
    for (const material of new Set((group.userData.materials || []).flat())) {
      if (!material) continue;
      material.color?.copy(bodyPink);
      material.roughness = .30;
      material.clearcoat = .68;
      material.clearcoatRoughness = .21;
      material.specularIntensity = .70;
      material.envMapIntensity = .86;
      if (material.isMeshPhysicalMaterial) {
        material.emissive.copy(bodyPink);
        material.emissiveIntensity = .08;
      }
    }
    await addCandyDecorations(group, {
      logoUrl:'../Logo/kandy-logo-separated.png', widthUnits:8.4, analysisWidth:700
    });
    letters = separateCandyLetters(group).letterGroups;
    letters.forEach(letter => letter.rotation.order = 'YXZ');
    scene.add(group);
    fitLogo();
    // Warm the visible materials once while the loader is still present.
    // Subsequent hidden scroll states are skipped by applyProgress().
    renderer.render(scene,camera);
    ready = true;
    canvas.dataset.ready = 'true';
    applyProgress(progress);
    onReady?.();
  }).catch(error => {
    canvas.dataset.error = error?.message || String(error);
    canvas.style.visibility = 'hidden';
    console.error('Separated letter fall failed', error);
    // The decorative handoff failing must not lock the entire website at 98%.
    onReady?.({degraded:true});
  });

  addEventListener('resize', resize);
  resize();
  applyProgress(0);

  return {
    setProgress: applyProgress,
    setRelease({ launchY: nextLaunchY, occlusionY: nextOcclusionY, progress: nextProgress } = {}) {
      const nextLaunch = Number.isFinite(Number(nextLaunchY)) ? Number(nextLaunchY) : innerHeight;
      const nextOcclusion = Number.isFinite(Number(nextOcclusionY)) ? Number(nextOcclusionY) : innerHeight;
      renderDirty ||= launchY !== nextLaunch || occlusionY !== nextOcclusion;
      launchY = nextLaunch;
      occlusionY = nextOcclusion;
      positionAtLaunch();
      applyOcclusion();
      applyProgress(nextProgress);
    },
    setLaunchY(value) {
      launchY = Number.isFinite(Number(value)) ? Number(value) : innerHeight;
      positionAtLaunch();
      renderDirty = true;
      applyProgress(progress);
    },
    setOcclusionY(value) {
      occlusionY = Number.isFinite(Number(value)) ? Number(value) : innerHeight;
      applyOcclusion();
      renderDirty = true;
      applyProgress(progress);
    },
    resize,
    render() { renderDirty = true; applyProgress(progress); },
    get ready() { return ready; },
    get progress() { return progress; },
    get letters() { return letters; },
    dispose() {
      removeEventListener('resize', resize);
      environment.dispose();
      renderer.dispose();
    }
  };
}
