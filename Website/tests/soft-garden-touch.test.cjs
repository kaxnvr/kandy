const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/soft-garden/background.js'), 'utf8');
const handlers = source.slice(source.indexOf('      function onPointerMove(event)'), source.indexOf('      function render(timestamp)'));

function fixture() {
  const calls = { measure:0, wake:0, gust:0, trail:0 };
  const vector = () => ({ x:0, y:0, copy(){}, distanceTo(){return 0;}, clone(){return vector();} });
  const context = {
    paused:false, destroyed:false, contextLost:false,
    heldPointerId:null, pointerInside:false, dirtyPointer:false,
    lastTrailTime:0, lastInput:0, gustDuration:2.8, recovery:1.15,
    diagnostics:{held:false}, previous:vector(), pointer:vector(), lastTrail:vector(),
    simUniforms:{uBrush:{value:{set(){}}}},
    pointerPosition(){calls.measure++; return true;},
    addGust(){calls.gust++;}, addTrailGust(){calls.trail++;},
    wake(){calls.wake++;}, seconds(){return 1;}, endDrag(){context.heldPointerId=null;},
    Math
  };
  vm.createContext(context);
  vm.runInContext(handlers, context);
  return {calls, context};
}

test('touch taps and swipe samples leave the decorative garden asleep', () => {
  const {calls, context} = fixture();
  const touch = {pointerType:'touch', pointerId:1, button:0, buttons:1};
  context.onPointerDown(touch);
  for (let i=0; i<30; i++) context.onPointerMove(touch);
  assert.deepEqual(calls, {measure:0, wake:0, gust:0, trail:0});
  assert.equal(context.heldPointerId, null);
  assert.equal(context.diagnostics.held, false);
});

for (const pointerType of ['mouse', 'pen']) {
  test(`${pointerType} keeps its existing hover and drag interaction`, () => {
    const {calls, context} = fixture();
    const event = {pointerType, pointerId:2, button:0, buttons:1};
    context.onPointerMove(event);
    assert.equal(calls.wake, 1);
    context.onPointerDown(event);
    assert.equal(calls.gust, 1);
    assert.equal(context.heldPointerId, 2);
    assert.equal(context.diagnostics.held, true);
    context.onPointerMove(event);
    assert.equal(calls.wake, 2);
  });
}
