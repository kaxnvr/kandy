import * as THREE from 'three';

const LOCAL_Z = new THREE.Vector3(0, 0, 1);

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function dilate(mask, width, height, passes = 1) {
  let source = mask;
  for (let pass = 0; pass < passes; pass++) {
    const next = source.slice();
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (source[i]) continue;
        if (source[i - 1] || source[i + 1] || source[i - width] || source[i + width] ||
            source[i - width - 1] || source[i - width + 1] ||
            source[i + width - 1] || source[i + width + 1]) next[i] = 1;
      }
    }
    source = next;
  }
  return source;
}

function findComponents(mask, colourMask, pixels, width, height) {
  const seen = new Uint8Array(width * height);
  const components = [];
  const stack = [];

  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || seen[seed]) continue;
    seen[seed] = 1;
    stack.push(seed);
    const points = [];
    let minX = width, minY = height, maxX = 0, maxY = 0;

    while (stack.length) {
      const index = stack.pop();
      const x = index % width, y = Math.floor(index / width);
      points.push([x, y]);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (mask[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
        }
      }
    }

    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (points.length < 18 || points.length > 950 || Math.max(bw, bh) < 5 || Math.max(bw, bh) > 48) continue;

    const original = points.filter(([x, y]) => colourMask[y * width + x]);
    if (original.length < 10) continue;
    let cx = 0, cy = 0, rr = 0, gg = 0, bb = 0, count = 0;
    for (const [x, y] of original) {
      cx += x; cy += y;
      const o = (y * width + x) * 4;
      rr += pixels[o]; gg += pixels[o + 1]; bb += pixels[o + 2]; count++;
    }
    cx /= count; cy /= count;

    let xx = 0, yy = 0, xy = 0;
    for (const [x, y] of original) {
      const dx = x - cx, dy = y - cy;
      xx += dx * dx; yy += dy * dy; xy += dx * dy;
    }
    xx /= count; yy /= count; xy /= count;
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    const ax = Math.cos(angle), ay = Math.sin(angle);
    let minMajor = Infinity, maxMajor = -Infinity, minMinor = Infinity, maxMinor = -Infinity;
    for (const [x, y] of original) {
      const dx = x - cx, dy = y - cy;
      const major = dx * ax + dy * ay;
      const minor = -dx * ay + dy * ax;
      minMajor = Math.min(minMajor, major); maxMajor = Math.max(maxMajor, major);
      minMinor = Math.min(minMinor, minor); maxMinor = Math.max(maxMinor, minor);
    }

    const major = maxMajor - minMajor + 1;
    const minor = maxMinor - minMinor + 1;
    const centreX = Math.round((minX + maxX) * 0.5);
    const centreY = Math.round((minY + maxY) * 0.5);
    let centreFilled = false;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const x = centreX + ox, y = centreY + oy;
      if (x >= 0 && y >= 0 && x < width && y < height && colourMask[y * width + x]) centreFilled = true;
    }
    const [hue] = rgbToHsv(rr / count, gg / count, bb / count);
    const aspect = major / Math.max(minor, 1);
    const yellow = hue >= 34 && hue <= 72;
    let type = 'capsule';
    // The coloured centre of a glazed ring can be dark enough to pass the hue
    // mask, so centre coverage alone is not a dependable hole test. In this
    // artwork all compact yellow components are stars; compact components in
    // the other three palettes are the cereal-like rings.
    if (yellow && aspect < 1.55) type = 'star';
    else if (aspect < 1.38 || (aspect < 1.48 && !centreFilled)) type = 'ring';

    components.push({ cx, cy, major, minor, angle, hue, type, area: count });
  }
  return components;
}

function paletteForHue(hue) {
  // Calibrated from the natural-sun reference: bright accents retain their
  // candy colour in shade instead of collapsing into olive or slate.
  if (hue < 34 || hue >= 330) return 0xF06B52;
  if (hue < 72) return 0xF8D75B;
  if (hue < 165) return 0x90D66D;
  return 0x58C8E9;
}

function makeMaterial(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.20,
    metalness: 0,
    clearcoat: 0.58,
    clearcoatRoughness: 0.16,
    specularIntensity: 0.64,
    specularColor: new THREE.Color(0xFFF8F2),
    envMapIntensity: 0.68
  });
}

function makeStarGeometry(radius, depth) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 === 0 ? radius : radius * 0.46;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const bevel = Math.min(depth * 0.46, radius * 0.16);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 8
  });
  geometry.translate(0, 0, -bevel * 0.25);
  geometry.computeVertexNormals();
  return geometry;
}

function nearestSurfaceSample(frontMesh, u, v) {
  if(typeof frontMesh.userData.sampleAtUv==='function')return frontMesh.userData.sampleAtUv(u,v);
  const geometry = frontMesh.geometry;
  const uv = geometry.getAttribute('uv');
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  let nearest = 0, best = Infinity;
  for (let i = 0; i < uv.count; i++) {
    const du = uv.getX(i) - u, dv = uv.getY(i) - v;
    const d = du * du + dv * dv;
    if (d < best) { best = d; nearest = i; }
  }
  return {
    position: new THREE.Vector3().fromBufferAttribute(position, nearest),
    normal: new THREE.Vector3().fromBufferAttribute(normal, nearest).normalize()
  };
}

/**
 * Reconstruct the coloured sweets visible in the supplied PNG as real meshes.
 * The transparent front source supplies decoration positions; the supplied
 * four-view reference confirms that the rear remains a smooth pink surface.
 */
export async function addCandyDecorations(wordmark, options = {}) {
  const frontMesh = wordmark.userData.pillowMeshes?.[0];
  if (!frontMesh) throw new Error('The wordmark needs an inflated front pillow before decorations can be placed.');

  const image = await loadImage(options.logoUrl || '../Logo/kandy-logo-1600.png');
  const width = options.analysisWidth || 700;
  const height = Math.round(width * image.height / image.width);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;

  const colourMask = new Uint8Array(width * height);
  for (let i = 0; i < colourMask.length; i++) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2], a = pixels[i * 4 + 3];
    if (a < 128) continue;
    const [hue, saturation, value] = rgbToHsv(r, g, b);
    const isPinkBody = hue >= 286 && hue <= 359;
    if (saturation > 0.22 && value > 0.26 && !isPinkBody) colourMask[i] = 1;
  }

  const components = findComponents(dilate(colourMask, width, height, 1), colourMask, pixels, width, height)
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const group = new THREE.Group();
  group.name = 'KANDy_Front_Decorations';
  group.userData.partId = 'front-decorations';
  group.userData.source = options.logoUrl || '../Logo/kandy-logo-1600.png';
  group.userData.inferredBack = false;

  const unitPerPixel = (options.widthUnits || 8.4) / width;
  const materialCache = new Map();
  const getMaterial = hue => {
    const colour = paletteForHue(hue);
    if (!materialCache.has(colour)) materialCache.set(colour, makeMaterial(colour));
    return materialCache.get(colour);
  };

  for (let index = 0; index < components.length; index++) {
    const part = components[index];
    const u = (part.cx + 0.5) / width;
    const v = 1 - (part.cy + 0.5) / height;
    const sample = nearestSurfaceSample(frontMesh, u, v);
    const major = THREE.MathUtils.clamp(part.major * unitPerPixel * 1.02, 0.13, 0.30);
    const minor = THREE.MathUtils.clamp(part.minor * unitPerPixel * 1.04, 0.07, 0.18);
    const material = getMaterial(part.hue);
    let geometry, lift, localRotation = -part.angle;

    if (part.type === 'ring') {
      const radius = major * 0.31;
      const tube = THREE.MathUtils.clamp(minor * 0.19, 0.025, 0.050);
      geometry = new THREE.TorusGeometry(radius, tube, 12, 32);
      lift = tube * 0.50;
    } else if (part.type === 'star') {
      const radius = major * 0.52;
      const depth = THREE.MathUtils.clamp(minor * 0.34, 0.035, 0.060);
      geometry = makeStarGeometry(radius, depth);
      lift = 0.018;
    } else {
      const radius = minor * 0.43;
      const length = Math.max(0.018, major - radius * 2);
      geometry = new THREE.CapsuleGeometry(radius, length, 6, 14);
      localRotation += Math.PI / 2;
      lift = radius * 0.52;
    }

    const mesh = new THREE.Mesh(geometry, material);
    // Only increase height above the surface; the detected reference footprint
    // stays pixel-aligned while the sweets read as real raised pieces in orbit.
    mesh.scale.z=part.type==='star'?1.12:1.16;
    mesh.userData.baseScale = mesh.scale.clone();
    mesh.name = `KANDy_Decoration_${String(index + 1).padStart(2, '0')}_${part.type}`;
    mesh.userData.partId = `decoration-${index + 1}`;
    mesh.userData.componentId = `${part.type}-system`;
    mesh.userData.decorationType = part.type;
    mesh.userData.parentPartId = 'front-face';
    mesh.userData.explodeWithParent = true;
    mesh.userData.attachment = {
      parentId: 'front-skin',
      parentSocket: 'front-decoration-surface',
      contactType: 'embedded',
      overlap: Math.max(0.01, lift * 0.45),
      gapTolerance: 0.006
    };
    mesh.userData.sourcePixel = { x: Math.round(part.cx), y: Math.round(part.cy) };
    const align = new THREE.Quaternion().setFromUnitVectors(LOCAL_Z, sample.normal);
    const spin = new THREE.Quaternion().setFromAxisAngle(LOCAL_Z, localRotation);
    mesh.quaternion.copy(align).multiply(spin);
    mesh.position.copy(sample.position).addScaledVector(sample.normal, lift);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  group.userData.componentCount = components.length;
  group.userData.materials = [...materialCache.values()];
  wordmark.add(group);
  wordmark.userData.decorationGroup = group;
  wordmark.userData.sculptRuntime = {
    ...(wordmark.userData.sculptRuntime || {}),
    nodes: {
      ...(wordmark.userData.sculptRuntime?.nodes || {}),
      frontDecorations: group
    },
    meshes: {
      ...(wordmark.userData.sculptRuntime?.meshes || {}),
      ...Object.fromEntries(group.children.map(child => [child.userData.partId, child]))
    },
    destructionGroups: {
      ...(wordmark.userData.sculptRuntime?.destructionGroups || {}),
      frontDecorations: group.children.map(child => child.userData.partId)
    },
    clickableParts: [
      ...new Set([...(wordmark.userData.sculptRuntime?.clickableParts || []), ...group.children.map(child => child.userData.partId)])
    ],
    explodableParts: [
      ...new Set([...(wordmark.userData.sculptRuntime?.explodableParts || []), 'front-decorations'])
    ],
    inferredRegions: []
  };
  return group;
}
