import * as THREE from 'three';

const LETTERS = ['K', 'A', 'N', 'D', 'y'];

class UnionFind {
  constructor(size) {
    this.parent = new Int32Array(size);
    this.rank = new Uint8Array(size);
    for (let index = 0; index < size; index++) this.parent[index] = index;
  }
  find(index) {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[index] !== index) {
      const next = this.parent[index];
      this.parent[index] = root;
      index = next;
    }
    return root;
  }
  union(a, b) {
    let rootA = this.find(a), rootB = this.find(b);
    if (rootA === rootB) return;
    if (this.rank[rootA] < this.rank[rootB]) [rootA, rootB] = [rootB, rootA];
    this.parent[rootB] = rootA;
    if (this.rank[rootA] === this.rank[rootB]) this.rank[rootA]++;
  }
}

function materialForIndex(groups, indexOffset) {
  for (const group of groups) {
    if (indexOffset >= group.start && indexOffset < group.start + group.count) return group.materialIndex;
  }
  return 0;
}

function copyAttribute(attribute, vertexIndices) {
  const ArrayType = attribute.array.constructor;
  const values = new ArrayType(vertexIndices.length * attribute.itemSize);
  for (let target = 0; target < vertexIndices.length; target++) {
    const source = vertexIndices[target];
    for (let channel = 0; channel < attribute.itemSize; channel++) {
      values[target * attribute.itemSize + channel] = attribute.array[source * attribute.itemSize + channel];
    }
  }
  return new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized);
}

function extractComponentGeometry(source, triangles) {
  const vertices = [...new Set(triangles.flatMap(triangle => triangle.indices))];
  const remap = new Map(vertices.map((sourceIndex, targetIndex) => [sourceIndex, targetIndex]));
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    geometry.setAttribute(name, copyAttribute(attribute, vertices));
  }

  const byMaterial = new Map();
  for (const triangle of triangles) {
    if (!byMaterial.has(triangle.materialIndex)) byMaterial.set(triangle.materialIndex, []);
    byMaterial.get(triangle.materialIndex).push(...triangle.indices.map(index => remap.get(index)));
  }
  const indices = [];
  for (const materialIndex of [...byMaterial.keys()].sort((a, b) => a - b)) {
    const materialIndices = byMaterial.get(materialIndex);
    const start = indices.length;
    indices.push(...materialIndices);
    geometry.addGroup(start, materialIndices.length, materialIndex);
  }
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.closedSurface = source.userData.closedSurface;
  geometry.userData.openEdgeCount = 0;
  geometry.userData.nonManifoldEdgeCount = 0;
  return geometry;
}

function splitGeometryByConnectivity(geometry) {
  const index = geometry.index;
  if (!index) throw new Error('Separated KANDy body must use indexed geometry.');
  const unionFind = new UnionFind(geometry.getAttribute('position').count);
  for (let offset = 0; offset < index.count; offset += 3) {
    const a = index.getX(offset), b = index.getX(offset + 1), c = index.getX(offset + 2);
    unionFind.union(a, b); unionFind.union(b, c);
  }

  const components = new Map();
  for (let offset = 0; offset < index.count; offset += 3) {
    const indices = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    const root = unionFind.find(indices[0]);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push({ indices, materialIndex: materialForIndex(geometry.groups, offset) });
  }
  return [...components.values()]
    .filter(triangles => triangles.length > 100)
    .map(triangles => extractComponentGeometry(geometry, triangles));
}

function edgeAudit(geometry) {
  const edges = new Map();
  const index = geometry.index;
  const add = (a, b) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    edges.set(key, (edges.get(key) || 0) + 1);
  };
  for (let offset = 0; offset < index.count; offset += 3) {
    const a = index.getX(offset), b = index.getX(offset + 1), c = index.getX(offset + 2);
    add(a, b); add(b, c); add(c, a);
  }
  let openEdges = 0, nonManifoldEdges = 0;
  for (const count of edges.values()) {
    if (count === 1) openEdges++;
    else if (count !== 2) nonManifoldEdges++;
  }
  return { openEdges, nonManifoldEdges };
}

/**
 * Convert the five disconnected islands inside the implicit body into five
 * real Object3D parts. Decorations are re-parented to the nearest letter so a
 * letter can move, pulse, or explode without leaving its sweets behind.
 */
export function separateCandyLetters(wordmark) {
  const sourceBody = wordmark.getObjectByName('KANDy_Inflated_Body');
  if (!sourceBody?.isMesh) throw new Error('KANDy inflated body was not found.');
  const componentGeometries = splitGeometryByConnectivity(sourceBody.geometry);
  if (componentGeometries.length !== LETTERS.length) {
    componentGeometries.forEach(geometry => geometry.dispose());
    throw new Error(`Expected five disconnected letters, found ${componentGeometries.length}.`);
  }

  componentGeometries.sort((a, b) => {
    const centreA = a.boundingBox.getCenter(new THREE.Vector3());
    const centreB = b.boundingBox.getCenter(new THREE.Vector3());
    return centreA.x - centreB.x;
  });

  const letterGroups = componentGeometries.map((geometry, index) => {
    const letter = LETTERS[index];
    const centre = geometry.boundingBox.getCenter(new THREE.Vector3());
    geometry.translate(-centre.x, -centre.y, -centre.z);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, sourceBody.material);
    mesh.name = `KANDy_Letter_${letter}_Body`;
    mesh.userData.partId = `letter-${letter}`;
    mesh.userData.componentId = `letter-${letter}-body`;
    mesh.userData.continuousBody = true;
    mesh.userData.surfaceTopology = 'closed-independent-solid';
    mesh.castShadow = sourceBody.castShadow;
    mesh.receiveShadow = sourceBody.receiveShadow;

    const group = new THREE.Group();
    group.name = `KANDy_Letter_${letter}`;
    group.position.copy(centre);
    group.userData.partId = `letter-${letter}`;
    group.userData.componentId = `letter-${letter}-body`;
    group.userData.letter = letter;
    group.userData.basePosition = centre.clone();
    group.userData.baseScale = new THREE.Vector3(1, 1, 1);
    group.userData.edgeAudit = edgeAudit(geometry);
    group.add(mesh);
    wordmark.add(group);
    return group;
  });

  wordmark.remove(sourceBody);
  const decorations = [...(wordmark.userData.decorationGroup?.children || [])];
  wordmark.updateMatrixWorld(true);
  for (const decoration of decorations) {
    let owner = letterGroups[0];
    let bestDistance = Infinity;
    const worldPosition = decoration.getWorldPosition(new THREE.Vector3());
    for (const letterGroup of letterGroups) {
      const letterPosition = letterGroup.getWorldPosition(new THREE.Vector3());
      const distance = Math.abs(worldPosition.x - letterPosition.x);
      if (distance < bestDistance) { bestDistance = distance; owner = letterGroup; }
    }
    owner.attach(decoration);
    decoration.userData.parentPartId = owner.userData.partId;
    decoration.userData.explodeWithParent = true;
  }
  if (wordmark.userData.decorationGroup) wordmark.remove(wordmark.userData.decorationGroup);

  const layoutCentre = letterGroups.reduce((sum, group) => sum.add(group.userData.basePosition), new THREE.Vector3())
    .multiplyScalar(1 / letterGroups.length);
  const setExploded = amount => {
    const scale = 1 + THREE.MathUtils.clamp(amount, 0, 1) * 0.42;
    for (const group of letterGroups) {
      group.position.copy(group.userData.basePosition).sub(layoutCentre).multiplyScalar(scale).add(layoutCentre);
    }
  };
  const resetLayout = () => letterGroups.forEach(group => group.position.copy(group.userData.basePosition));

  wordmark.userData.letterGroups = letterGroups;
  wordmark.userData.letterMeshes = letterGroups.map(group => group.children.find(child => child.isMesh));
  wordmark.userData.decorationMeshes = decorations;
  wordmark.userData.pillowMeshes = wordmark.userData.letterMeshes;
  wordmark.userData.setExploded = setExploded;
  wordmark.userData.resetLetterLayout = resetLayout;
  wordmark.userData.componentId = 'letter-assembly';
  wordmark.userData.sculptRuntime = {
    ...(wordmark.userData.sculptRuntime || {}),
    actionReady: true,
    nodes: { root: wordmark, ...Object.fromEntries(letterGroups.map(group => [group.userData.partId, group])) },
    meshes: Object.fromEntries(letterGroups.map(group => [group.userData.partId, group.children.find(child => child.isMesh)])),
    clickableParts: letterGroups.map(group => group.userData.partId),
    explodableParts: letterGroups.map(group => group.userData.partId),
    destructionGroups: Object.fromEntries(letterGroups.map(group => [group.userData.partId, [group.userData.partId]])),
    colliders: letterGroups.map(group => ({ id: `${group.userData.partId}-bounds`, type: 'box', parentPartId: group.userData.partId }))
  };
  return { letterGroups, decorations, setExploded, resetLayout };
}

