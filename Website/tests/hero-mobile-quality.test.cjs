const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The optional override checks a release copy before it is synchronized back.
const sourcePath = process.env.KANDY_MEADOW_SOURCE_PATH
  || path.join(__dirname, '..', 'hero-meadow.js');
const meadow = fs.readFileSync(sourcePath, 'utf8');
const tierStart = meadow.indexOf('const TIERS = {');
const tierEnd = meadow.indexOf('const tierName =', tierStart);
assert.ok(tierStart >= 0 && tierEnd > tierStart, 'quality configuration is present');
const tierSource = meadow.slice(tierStart, tierEnd);
const tiers = vm.runInNewContext(`${tierSource}\nTIERS;`);
const adaptStart = meadow.indexOf('function adapt(){');
const adaptEnd = meadow.indexOf('// Returning to the tab', adaptStart);
assert.ok(adaptStart >= 0 && adaptEnd > adaptStart, 'adaptive function is present');
const adaptSource = meadow.slice(adaptStart, adaptEnd);

function adaptiveHarness(tier = 'low') {
  const calls = {resize:0, blurResize:[]};
  const context = {
    Q:tiers[tier], slow:0, fast:0, maxRawDt:.02, fps:60, dprScale:1,
    document:{hidden:false}, bloom:{enabled:tiers[tier].bloom},
    dofPass:{
      dof:tiers[tier].dof, blurScale:tiers[tier].blurScale,
      rt:{width:540,height:1026},
      setSize(w,h) { calls.blurResize.push([w,h]); },
    },
    resize() { calls.resize++; }, UI() { return null; },
  };
  vm.createContext(context);
  vm.runInContext(adaptSource, context);
  return {
    context, calls,
    sample(fps, rawDt = 1 / fps) {
      context.fps = fps;
      context.maxRawDt = rawDt;
      vm.runInContext('adapt();', context);
    },
  };
}

test('phone quality retains soft focus and grass coverage with a smaller GPU budget', () => {
  for (const name of ['low','mid','high']) {
    const tier = tiers[name];
    assert.equal(tier.dof,true, `${name} must keep the meadow soft`);
    assert.ok(tier.blurSamples > 0 && Number.isInteger(tier.blurSamples));
    assert.ok(tier.blurScale > 0 && tier.blurScale <= .5);
  }
  assert.equal(tiers.low.blades,12000);
  assert.equal(tiers.low.ridge,45000);
  assert.ok(tiers.low.dpr * tiers.low.minDprScale >= 1);
  assert.ok(tiers.low.bladeSegments < tiers.high.bladeSegments);
  assert.ok(tiers.low.shadowSize < tiers.high.shadowSize);
  const blurCost = tier => tier.blurSamples * tier.blurScale ** 2;
  assert.ok(blurCost(tiers.low) < blurCost(tiers.high) / 4);
  assert.deepEqual(
    [tiers.high.blades,tiers.high.ridge,tiers.high.dpr,tiers.high.bloom,
      tiers.high.blurSamples,tiers.high.blurScale,tiers.high.bladeSegments,tiers.high.shadowSize],
    [38000,170000,1.75,true,24,.5,5,2048],
    'approved desktop quality remains unchanged',
  );
});

test('sustained mobile load reaches its clarity floor without disabling depth of field', () => {
  for (const tier of ['low','mid']) {
    const {context:c,calls,sample} = adaptiveHarness(tier);
    for (let i = 0; i < 100; i++) sample(30);
    assert.equal(c.dprScale,tiers[tier].minDprScale);
    assert.equal(c.dofPass.dof,true);
    assert.equal(c.dofPass.blurScale,.25);
    assert.equal(c.bloom.enabled,false);
    assert.ok(calls.resize > 0);
    assert.ok(calls.blurResize.length > 0);
    assert.ok(calls.blurResize.every(([w,h]) => w === 540 && h === 1026),
      'blur adaptation must retain the full-size scene/depth dimensions');
    const settled = {resize:calls.resize, blurResize:calls.blurResize.length};
    for (let i = 0; i < 20; i++) sample(30);
    assert.equal(calls.resize,settled.resize);
    assert.equal(calls.blurResize.length,settled.blurResize);
  }
});

test('one slow burst does not immediately reduce mobile rendering quality', () => {
  const {context:c,calls,sample} = adaptiveHarness();
  for (let i = 0; i < 3; i++) sample(30);
  assert.equal(c.dprScale,1);
  assert.equal(calls.resize,0);
  sample(60);
  for (let i = 0; i < 3; i++) sample(30);
  assert.equal(c.dprScale,1, 'fast sampling clears the previous slow streak');
});

test('hidden or throttled frames do not cause quality demotions', () => {
  const {context:c,calls,sample} = adaptiveHarness();
  c.slow = 3;
  c.fast = 3;
  c.document.hidden = true;
  for (let i = 0; i < 12; i++) sample(20);
  assert.equal(c.dprScale,1);
  assert.equal(c.slow,0);
  assert.equal(c.fast,0);
  c.document.hidden = false;
  c.slow = 3;
  sample(20,.5);
  assert.equal(c.dprScale,1);
  assert.equal(c.maxRawDt,0);
  assert.equal(c.slow,0);
  assert.equal(calls.resize,0);
  assert.equal(calls.blurResize.length,0);
});

test('sustained recovered frame rate restores resolution without exceeding native tier quality', () => {
  const {context:c,calls,sample} = adaptiveHarness();
  for (let i = 0; i < 100; i++) sample(30);
  const before = calls.resize;
  for (let i = 0; i < 6; i++) sample(60);
  assert.equal(c.dprScale,tiers.low.minDprScale, 'recovery waits for a stable fast streak');
  sample(60);
  assert.ok(c.dprScale > tiers.low.minDprScale);
  assert.equal(c.dofPass.blurScale,.25, 'recover sharp pixels before spending more on blur');
  for (let i = 0; i < 30; i++) sample(60);
  assert.equal(c.dprScale,1);
  assert.equal(c.dofPass.dof,true);
  assert.equal(c.dofPass.blurScale,tiers.low.blurScale);
  assert.ok(calls.resize > before);
  const recovered = {resize:calls.resize, blurResize:calls.blurResize.length};
  for (let i = 0; i < 30; i++) sample(60);
  assert.equal(calls.resize,recovered.resize, 'no repeated allocation once full resolution is restored');
  assert.equal(calls.blurResize.length,recovered.blurResize);
});

test('touch scrolling does not steer the meadow camera while mouse parallax remains available', () => {
  const start = meadow.indexOf("addEventListener('pointermove', e => {");
  const end = meadow.indexOf("addEventListener('pointerleave'", start);
  assert.ok(start >= 0 && end > start, 'pointer handler is present');
  const callbacks = {};
  const context = {ptr:{x:0,y:0},innerWidth:400,innerHeight:800,
    addEventListener(name,callback) { callbacks[name] = callback; }};
  vm.runInNewContext(meadow.slice(start,end),context);
  callbacks.pointermove({pointerType:'touch',clientX:380,clientY:100});
  assert.deepEqual(context.ptr,{x:0,y:0});
  callbacks.pointermove({pointerType:'mouse',clientX:300,clientY:200});
  assert.deepEqual(context.ptr,{x:.5,y:-.5});
});

test('a phone blade keeps the same helper axis as its tip straightens', () => {
  const expression = meadow.match(/float helperY = ([^;]+);/)?.[1];
  assert.ok(expression, 'shader exposes its helper-axis reference');
  const mix = (a,b,t) => a*(1-t)+b*t;
  const helperAt = (tipY,rootY,mobile) => vm.runInNewContext(expression, {
    up:{y:tipY}, surfaceUp:{y:rootY}, uMobileSoftness:mobile, mix,
  });
  // At the real near-rim root (x=0,z=5), straightening crosses .985.
  // The former per-vertex helper switched Y -> X inside this one ribbon.
  const rootY = Math.sqrt(6.6**2 - 5**2) / 6.6;
  const tipDirections = [rootY,.8136,.9886,.99953];
  const axis = y => Math.abs(y) < .985 ? 'Y' : 'X';
  assert.deepEqual(tipDirections.map(y => axis(helperAt(y,rootY,1))), ['Y','Y','Y','Y']);
  assert.deepEqual(tipDirections.map(y => axis(helperAt(y,rootY,0))), ['Y','Y','X','X'],
    'the approved desktop shader uses exactly its existing reference');
});

test('mobile near-root shading is gentler without changing grass tips or desktop roots', () => {
  const expression = meadow.match(/float rootShade = ([^;]+);/)?.[1];
  assert.ok(expression);
  const mix = (a,b,t) => a*(1-t)+b*t;
  const smoothstep = (a,b,x) => {
    const t = Math.max(0,Math.min(1,(x-a)/(b-a)));
    return t*t*(3-2*t);
  };
  const shade = (vV,mobileNear) => vm.runInNewContext(expression,{vV,mobileNear,mix,smoothstep});
  assert.equal(shade(0,0),.42);
  assert.ok(shade(0,1) > shade(0,0));
  assert.ok(shade(.2,1) > shade(.2,0));
  assert.equal(shade(1,1),1);
  assert.equal(shade(1,0),1);
});

test('phone turf gains near blur while desktop and landscape camera coordinates remain exact', () => {
  const start = meadow.indexOf('  if (camera.aspect < 0.92){');
  const end = meadow.indexOf('  camera.updateProjectionMatrix();',start);
  const source = meadow.slice(start,end);
  const vector = () => ({set(x,y,z){ this.x=x; this.y=y; this.z=z; }});
  for (const [aspect,mobile] of [[.56,true],[.56,false],[2.17,true],[1.75,false]]) {
    const context = {camera:{aspect},mobileMeadow:mobile,
      CAM_BASE:vector(),LOOK_BASE:vector(),centeredPhoneLogo:{matches:false},
      dofPass:{material:{uniforms:{uNearRange:{value:0},uMaxCoc:{value:0}}}},
    };
    vm.runInNewContext(source,context);
    const {camera,CAM_BASE:c,LOOK_BASE:l,dofPass}=context;
    assert.deepEqual([camera.fov,c.x,c.y,c.z,l.x,l.y,l.z], aspect < .92
      ? [52,0,1.15,8.7,0,-.35,0] : [38,0,.95,7.5,0,.8,0]);
    assert.equal(dofPass.material.uniforms.uNearRange.value, aspect < .92 && !mobile ? 16 : 9);
    assert.equal(dofPass.material.uniforms.uMaxCoc.value,mobile ? .012 : .010);
  }
});


test('mobile uses real grass without the oversized foreground billboard layer', () => {
  const start = meadow.indexOf('const fg = [];');
  const end = meadow.indexOf('/* ═',start);
  assert.ok(start >= 0 && end > start);
  const foregroundSource = meadow.slice(start,end);
  for (const mobileMeadow of [true,false]) {
    let geometries = 0;
    const added = [];
    const context = {mobileMeadow,Q:{fg:7},blurBladeTex:{},scene:{add(mesh){added.push(mesh);}},
      THREE:{DoubleSide:2,
        PlaneGeometry:class {constructor(){geometries++;} translate(){}},
        MeshBasicMaterial:class {constructor(options){Object.assign(this,options);}},
        Mesh:class {
          constructor(geometry,material){this.geometry=geometry;this.material=material;
            this.scale={set(){}};this.position={set(){}};}
        },
      },
    };
    const count = vm.runInNewContext(foregroundSource+'\nfg.length;',context);
    assert.equal(count,mobileMeadow ? 0 : 7);
    assert.equal(added.length,count);
    assert.equal(geometries,mobileMeadow ? 0 : 1);
  }
});

test('mobile removes coherent foreground shadow lanes while keeping the desktop mask', () => {
  const expression = meadow.match(/vFrontShadow = ([\s\S]*?);/)?.[1];
  assert.ok(expression);
  const smoothstep = (a,b,x) => {
    const t = Math.max(0,Math.min(1,(x-a)/(b-a)));
    return t*t*(3-2*t);
  };
  for (const canopy of [.85,.65]) for (const z of [1,2,3.25,5]) {
    const context = {uUprightNear:1,uCanopyShadow:canopy,iPos:{z},smoothstep,uMobileSoftness:1};
    assert.equal(vm.runInNewContext(expression,context),0);
    context.uMobileSoftness=0;
    assert.equal(vm.runInNewContext(expression,context),canopy*smoothstep(.70,3.25,z));
  }
});
