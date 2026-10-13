const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'hero-meadow.js'), 'utf8');
function section(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `${start} is available`);
  return source.slice(first, last);
}
const fitSource = section('function fitLogo(){', '// Use the same continuous');
const resizeSource = section('function resize(){', "addEventListener('resize', resize);");
const cameraSource = section('function cameraUpdate(phi){', '/* ─────────────────────────── adaptive quality');
const vector = (x = 0, y = 0, z = 0) => ({x,y,z,set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}});
const target = () => ({width:1,height:1,setSize(w,h){this.width=w;this.height=h;}});

// Execute the production resize, fit, camera and repaint functions. Only the
// GPU bindings and matrix-independent world bookkeeping are test doubles.
function harness(phoneMode, phase = .37) {
  const events = [];
  const canvas = {clientWidth:390,clientHeight:702,dataset:{}};
  const camera = {aspect:1,fov:38,position:vector(0,.95,7.5),rotation:{z:0},
    updateProjectionMatrix(){},lookAt(){},setViewOffset(...args){this.view=args;},clearViewOffset(){this.view=null;}};
  const logo = {userData:{halfExtent:{x:4.2,y:1.5}},
    scale:{x:1,y:1,z:1,setScalar(value){this.x=this.y=this.z=value;}}};
  let pixelRatio = 1;
  const context = {
    phoneMode,phase,canvas,camera,logo,phoneViewport:null,lastPhoneViewOffset:NaN,scrollY:0,document:{activeElement:null},
    centeredPhoneLogo:{matches:true}, mobileMeadow:phoneMode,
    LOGO_Z:-2.6, TAU:Math.PI*2, CAM_BASE:vector(0,.95,7.5),LOOK_BASE:vector(0,.8,0),
    ptr:{x:0,y:0,sx:0,sy:0},Q:{dpr:phoneMode?2:1.75},devicePixelRatio:3,
    innerWidth:390,innerHeight:702,dprScale:1,lastW:0,lastH:0,lastDprScale:-1,painting:false,
    narrowUnderGrowth:{visible:false},fg:[],scene:{userData:{sky:{position:{z:-80},scale:vector()}}},
    renderer:{shadowMap:{needsUpdate:false},setPixelRatio(value){pixelRatio=value;},setSize(){},
      getDrawingBufferSize(out){return out.set(Math.floor(canvas.clientWidth*pixelRatio),Math.floor(canvas.clientHeight*pixelRatio));},
      getRenderTarget(){return null;},setRenderTarget(){},clear(){}},
    composer:{renderTarget1:target(),renderTarget2:target(),setPixelRatio(){},setSize(){}},
    dofPass:{rt:target(),blurRT:target(),blurScale:.25,setSize(){},material:{uniforms:{uNearRange:{value:9},uMaxCoc:{value:.012}}}},
    bloom:{prefiltered:target(),horizontal:target(),vertical:target()},
    outputPass:{uniforms:{uDitherStrength:{value:1.5}}},logoRenderTarget:Object.assign(target(),{samples:2}),
    logoCompositeMaterial:{uniforms:{uLogoTexel:{value:vector()}}},
    THREE:{Vector2:class {set(x,y){this.x=x;this.y=y;return this;}}},
    portrait:()=>camera.aspect<.92,logoRestY:()=>camera.aspect<.92?.52:.82,
    applyLogoTrack(){},UI(){return null;},build(){events.push('build');},renderComposite(){events.push('render');},
    record(event){events.push(event);},
  };
  vm.createContext(context);
  vm.runInContext(`${fitSource}\n${cameraSource}\n${resizeSource}\n
    const productionFit = fitLogo, productionCamera = cameraUpdate;
    fitLogo = () => { record('fit'); return productionFit(); };
    cameraUpdate = p => { record('camera'); return productionCamera(p); };
  `,context);
  return {context,events,resize(width,height){
    canvas.clientWidth=width;canvas.clientHeight=height;
    context.innerWidth=width;context.innerHeight=height;
    context.resize();
    return {scale:logo.scale.x,cameraZ:camera.position.z,fov:camera.fov,
      fitDistance:canvas.dataset.phoneLogoFitCameraDistance,
      resizedDistance:canvas.dataset.phoneResizeCameraDistance};
  }};
}

for (const [name,from,to] of [
  ['portrait to landscape',[320,568],[932,430]],
  ['landscape to portrait',[932,430],[320,568]],
]) test(`phone ${name} matches a cold mount at the same breathing phase`, () => {
  for (const phase of [0,.125,.37,.75]) {
    const cold=harness(true,phase),rotated=harness(true,phase);
    const expected=cold.resize(...to);
    rotated.resize(...from);
    const actual=rotated.resize(...to);
    assert.deepEqual(actual,expected);
    assert.equal(actual.fitDistance,actual.resizedDistance);
    assert.equal(rotated.context.canvas.dataset.phoneResizePhase,phase.toFixed(6));
  }
});

test('phone synchronizes its pose before fitting and preserves the equal-size early return', () => {
  const h=harness(true);
  h.resize(932,430);
  assert.deepEqual(h.events,['camera','fit','build','camera','render']);
  const before=h.events.length;
  h.resize(932,430);
  assert.equal(h.events.length,before);
});

test('desktop keeps its original fit-first and double-repaint call order', () => {
  const h=harness(false);
  h.resize(932,430);
  assert.deepEqual(h.events,['fit','build','camera','render','build','camera','render']);
  assert.equal(h.context.canvas.dataset.phoneLogoFitCameraDistance,undefined);
  assert.equal(h.context.canvas.dataset.phoneResizeCameraDistance,undefined);
});


test('phone visible-height framing updates without reallocating or refitting the stable canvas', () => {
  const h=harness(true);h.resize(390,702);h.events.length=0;
  h.context.phoneViewport={height:844,scale:1};h.resize(390,702);
  assert.equal(h.context.canvas.dataset.phoneViewOffset,'83.636');
  assert.deepEqual(h.events,['build','camera','render']);
  assert.deepEqual(h.context.camera.view,[390,702,0,-83.636,390,702]);
  h.events.length=0;h.resize(390,702);assert.deepEqual(h.events,[]);
});

test('phone framing does not chase scroll, pinch zoom or a focused input', () => {
  const h=harness(true);h.resize(390,702);
  h.context.phoneViewport={height:844,scale:1};h.context.scrollY=120;h.resize(390,702);
  assert.equal(h.context.canvas.dataset.phoneViewOffset,'12.636');
  h.context.scrollY=0;h.context.phoneViewport.scale=2;h.resize(390,702);
  assert.equal(h.context.canvas.dataset.phoneViewOffset,'12.636');
  h.context.phoneViewport.scale=1;h.context.document.activeElement={matches:()=>true};h.resize(390,702);
  assert.equal(h.context.canvas.dataset.phoneViewOffset,'12.636');
  h.context.document.activeElement=null;h.context.restorePhoneFraming();
  assert.equal(h.context.canvas.dataset.phoneViewOffset,'83.636');
});

test('rotation clears portrait framing and desktop never applies a view offset', () => {
  const phone=harness(true);phone.resize(390,702);phone.resize(844,390);
  assert.equal(phone.context.camera.view,null);
  assert.equal(phone.context.canvas.dataset.phoneViewOffset,'0.000');
  const desktop=harness(false);desktop.resize(1440,900);desktop.resize(390,702);
  assert.equal(desktop.context.camera.view,undefined);
  assert.equal(desktop.context.canvas.dataset.phoneViewOffset,undefined);
});

test('extreme phone heights bound framing to preserve the overlay region', () => {
  const h=harness(true);h.context.phoneViewport={height:1400,scale:1};h.resize(390,702);
  assert.equal(h.context.canvas.dataset.phoneViewOffset,'126.360');
});
