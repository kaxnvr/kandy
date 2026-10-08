import * as THREE from 'three';

// Only geometry is baked. Materials, textures, decorations and interactions
// are still built by the original code, so the approved appearance is retained.
export function geometrySignature(options) {
  return JSON.stringify(Object.fromEntries(Object.keys(options).sort()
    .filter(key => !['cooperative','prebuiltGeometryUrl'].includes(key))
    .map(key => [key,options[key]])));
}

export function imageFingerprint(pixels) {
  let hash = 2166136261;
  for (let i=0;i<pixels.length;i++) hash = Math.imul(hash ^ pixels[i],16777619);
  return (hash >>> 0).toString(16);
}

export async function fetchWordmarkGeometry(url) {
  if (!url || !globalThis.DecompressionStream) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),30000);
  try {
    const response = await fetch(new URL(url,import.meta.url),{signal:controller.signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // Also tolerate hosts that transparently decompress .gz responses.
    const body = new Blob([bytes]).stream();
    const stream = bytes[0]===0x1f && bytes[1]===0x8b
      ? body.pipeThrough(new DecompressionStream('gzip')) : body;
    const buffer = await new Response(stream).arrayBuffer();
    const headerSize = new DataView(buffer).getUint32(0,true);
    const data = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,8,headerSize)));
    const start = 8 + Math.ceil(headerSize/8)*8;
    const types = {Float32Array,Float64Array,Uint32Array,Uint16Array,Uint8Array,Int32Array,Int16Array,Int8Array};
    for (const attribute of [data.geometry.data.index,...Object.values(data.geometry.data.attributes)]) {
      if (!attribute) continue;
      const Type = types[attribute.type];
      if (!Type) throw new Error('Unsupported geometry attribute');
      attribute.array = new Type(buffer,start+attribute.array.byteOffset,attribute.array.length);
    }
    return data;
  } catch(error) {
    console.warn('Prebuilt wordmark unavailable; using procedural geometry.',error);
    return null;
  } finally { clearTimeout(timer); }
}

export function restoreWordmarkGeometry(data,signature,fingerprint) {
  if (!data) return null;
  if (data.version!==1 || data.signature!==signature || data.fingerprint!==fingerprint) {
    console.warn('Prebuilt wordmark does not match the current sculpt or artwork; rebuilding.');
    return null;
  }
  try { return new THREE.BufferGeometryLoader().parse(data.geometry); }
  catch(error) { console.warn('Invalid prebuilt wordmark; rebuilding.',error); return null; }
}
