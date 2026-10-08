const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../design-a-receipt.html'), 'utf8');
const cardHandlers = html.slice(html.indexOf('  function bindTilt(el)'), html.indexOf('  // Testimonials are an editorial reading break'));
const pdpStart = html.indexOf('  if (!reduced) {\n    pdpCard.parentNode.addEventListener');
const pdpHandlers = html.slice(pdpStart, html.indexOf('  /* ---- nav:', pdpStart));

function element() {
  const listeners = new Map();
  const writes = new Map();
  let measurements = 0;
  return {
    classList:{contains(){return false;}},
    getAttribute(){return '2';},
    getBoundingClientRect(){measurements++; return {left:0, top:0, width:200, height:100};},
    style:{setProperty(name, value){writes.set(name, value);}},
    addEventListener(type, handler){listeners.set(type, handler);},
    dispatch(type, pointerType){listeners.get(type)?.({pointerType, clientX:150, clientY:25});},
    writes,
    get measurements(){return measurements;}
  };
}

function fixture() {
  const tile = element(), glass = element(), scene = element(), pdp = element(), parent = element(), page = element();
  pdp.parentNode = parent;
  Object.assign(page, {innerWidth:200, innerHeight:100});
  let kicks = 0;
  const context = {
    reduced:false, parseFloat,
    document:{querySelectorAll(selector){
      if (selector.startsWith('[data-tilt]')) return [tile];
      if (selector === '.lg[data-tilt-off]') return [glass];
      if (selector === '.tilt-scene') return [scene];
      return [];
    }},
    window:page, pdpCard:pdp,
    tTarget:{x:0, y:0, mx:50, my:50}, tCur:{x:0, y:0, mx:50, my:50},
    TILT_X:14, TILT_Y:18,
    tiltKick(){kicks++;}
  };
  vm.createContext(context);
  vm.runInContext(cardHandlers + pdpHandlers, context);
  return {tile, glass, scene, pdp, parent, page, context, get kicks(){return kicks;}};
}

test('touch scrolling leaves card highlights, scene tilt and product detail stationary', () => {
  const f = fixture();
  for (let sample=0; sample<30; sample++) {
    f.tile.dispatch('pointermove', 'touch');
    f.glass.dispatch('pointermove', 'touch');
    f.page.dispatch('pointermove', 'touch');
    f.pdp.dispatch('pointerenter', 'touch');
    f.parent.dispatch('pointermove', 'touch');
  }
  f.tile.dispatch('pointerleave', 'touch');
  f.parent.dispatch('pointerleave', 'touch');
  for (const node of [f.tile, f.glass, f.scene, f.pdp]) {
    assert.equal(node.measurements, 0);
    assert.equal(node.writes.size, 0);
  }
  assert.equal(f.kicks, 0);
  assert.deepEqual(f.context.tTarget, {x:0, y:0, mx:50, my:50});
});

for (const pointerType of ['mouse', 'pen']) {
  test(`${pointerType} keeps tilt, highlights and product detail easing`, () => {
    const f = fixture();
    f.tile.dispatch('pointermove', pointerType);
    f.glass.dispatch('pointermove', pointerType);
    f.page.dispatch('pointermove', pointerType);
    f.pdp.dispatch('pointerenter', pointerType);
    f.parent.dispatch('pointermove', pointerType);
    assert.equal(f.tile.writes.get('--ry'), '0.50deg');
    assert.equal(f.glass.writes.get('--mx'), '75%');
    assert.equal(f.scene.writes.get('--sx'), '2.25deg');
    assert.equal(f.pdp.writes.get('--mx'), '75.00%');
    assert.equal(f.context.tTarget.y, 4.5);
    assert.equal(f.kicks, 1);
    f.tile.dispatch('pointerleave', pointerType);
    f.parent.dispatch('pointerleave', pointerType);
    assert.equal(f.tile.writes.get('--ry'), '0deg');
    assert.equal(f.context.tTarget.y, 0);
    assert.equal(f.kicks, 2);
  });
}
