import * as THREE from './vendor/three.module.js';

/** The single floating seed from hero-meadow.js, not a whole flower head.
 * Preserve its proportions and true 3D fibres; adapt contrast for white.
 */
export function createDandelionSeed() {
  const root=new THREE.Group();root.name='dandelion-seed';
  const HUB_Y=.13,HAIRS=92,GOLDEN=2.39996323;
  const positions=[];let segmentCount=0;
  function segment(a,b){
    positions.push(...a,...b);segmentCount++;
  }
  for(let j=0;j<HAIRS;j++){
    const t=(j+.5)/HAIRS,ny=-.04+t*.88;
    const radial=Math.sqrt(Math.max(0,1-ny*ny)),a=j*GOLDEN;
    // Slight deterministic irregularity keeps the rotation legible; a
    // perfectly radial umbrella has the same silhouette at every y angle.
    const length=.255+Math.sin(j*2.17)*.014+Math.sin(a*3+.7)*.018;
    const x=Math.cos(a)*radial*length,y=HUB_Y+ny*length,z=Math.sin(a)*radial*length;
    segment([0,HUB_Y,0],[x,y,z]);
    if(j%3===0){
      const branch=[x*.74,HUB_Y+(y-HUB_Y)*.74,z*.74];
      const tx=-Math.sin(a)*.020,tz=Math.cos(a)*.020;
      segment(branch,[x+tx,y+.006,z+tz]);
      segment(branch,[x-tx,y-.005,z-tz]);
    }
  }
  const fibres=new THREE.BufferGeometry();
  fibres.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const pappus=new THREE.LineSegments(fibres,new THREE.LineBasicMaterial({
    color:0x9da58f,transparent:true,opacity:.7,depthWrite:false,toneMapped:false
  }));
  pappus.name='pappus';root.add(pappus);
  const beakMaterial=new THREE.MeshStandardMaterial({color:0xb7baa0,roughness:.96,metalness:0});
  const hub=new THREE.Mesh(new THREE.SphereGeometry(.015,12,8),beakMaterial);
  hub.name='hub';hub.position.y=HUB_Y;root.add(hub);
  const path=new THREE.CatmullRomCurve3([
    new THREE.Vector3(0,HUB_Y-.005,0),new THREE.Vector3(.010,.025,-.004),
    new THREE.Vector3(-.006,-.105,.006),new THREE.Vector3(0,-.215,0)
  ]);
  const beak=new THREE.Mesh(new THREE.TubeGeometry(path,16,.0055,7,false),beakMaterial);
  beak.name='beak';root.add(beak);
  const achene=new THREE.Mesh(new THREE.SphereGeometry(.031,16,12),
    new THREE.MeshStandardMaterial({color:0x8f967b,roughness:1,metalness:0}));
  achene.name='achene';achene.position.y=-.258;achene.scale.set(.72,1.75,.72);root.add(achene);
  root.userData.source='hero-meadow.js / seedTemplate';root.userData.fibreCount=HAIRS;
  root.userData.segmentCount=segmentCount;
  return root;
}

/** Uses the host's clock so the preview and production loader share motion. */
export function createDandelion(canvas,{reduced=false,view='front',width=620,height=340,
  pixelRatio=typeof devicePixelRatio==='number'?devicePixelRatio:1}={}) {
  const metrics=canvas.dataset||{};
  let viewport={left:0,top:0,width,height};
  const measure=()=>canvas.getBoundingClientRect?.()||viewport;
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});
  renderer.setClearColor(0xffffff,1);
  renderer.setPixelRatio(Math.min(pixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(28,1,.1,20);
  // Review views preserve the same model, lighting, scale and viewport.
  const views={front:0,right:Math.PI/2,rear:Math.PI,left:-Math.PI/2};
  const azimuth=views[view]??0;
  camera.position.set(Math.sin(azimuth)*6.3,.18,Math.cos(azimuth)*6.3);camera.lookAt(0,.18,0);
  scene.add(new THREE.HemisphereLight(0xfffdf6,0xa0a895,2));
  const key=new THREE.DirectionalLight(0xfff8e9,2.2);key.position.set(-3,4,5);scene.add(key);
  const fill=new THREE.DirectionalLight(0xe8eef5,.7);fill.position.set(3,1,-1);scene.add(fill);
  const rim=new THREE.DirectionalLight(0xd7dec8,1.05);rim.position.set(-2,2,-4);scene.add(rim);
  const floatRig=new THREE.Group();scene.add(floatRig);
  const seed=createDandelionSeed();seed.scale.setScalar(3.15);floatRig.add(seed);
  const spinAxis=new THREE.Vector3(.14,.985,.1).normalize();
  const spinQuaternion=new THREE.Quaternion();
  const pointer=new THREE.Vector2(100,100),raycaster=new THREE.Raycaster();
  const plane=new THREE.Plane(new THREE.Vector3(0,0,1),0),hit=new THREE.Vector3();
  const pendingMotion=new THREE.Vector2(),airVelocity=new THREE.Vector2(),airOffset=new THREE.Vector2();
  let touching=false,hasPointerSample=false,lastPointerX=0,lastPointerY=0;
  let time=0,until=-10,drift=0,lean=0,pointerInfluence=0;
  let disposed=false,visible=true,lost=false,first=true;
  function locate(event){
    const rect=measure();
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    if(hasPointerSample){
      pendingMotion.x+=THREE.MathUtils.clamp((event.clientX-lastPointerX)/rect.width*14,-.8,.8);
      pendingMotion.y+=THREE.MathUtils.clamp((lastPointerY-event.clientY)/rect.height*14,-.8,.8);
    }
    lastPointerX=event.clientX;lastPointerY=event.clientY;hasPointerSample=true;
    touching=true;
  }
  function leave(){
    touching=false;hasPointerSample=false;pointer.set(100,100);pendingMotion.set(0,0);
  }
  function blow(){if(!reduced)until=time+2.5;}
  function tap(event){locate(event);blow();}
  function keyboard(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();blow();}}
  function contextLost(event){event.preventDefault();lost=true;metrics.ready='false';}
  function contextRestored(){lost=false;first=true;}
  canvas.addEventListener('pointermove',locate);canvas.addEventListener('pointerdown',tap);
  canvas.addEventListener('pointerleave',leave);canvas.addEventListener('pointerup',leave);
  canvas.addEventListener('pointercancel',leave);canvas.addEventListener('keydown',keyboard);
  canvas.addEventListener('webglcontextlost',contextLost);canvas.addEventListener('webglcontextrestored',contextRestored);
  function resize(nextWidth,nextHeight){
    if(disposed)return;
    if(typeof nextWidth==='number'&&typeof nextHeight==='number')viewport={left:0,top:0,width:nextWidth,height:nextHeight};
    const {width,height}=measure();if(!width||!height)return;
    const aspect=width/height;
    camera.aspect=aspect;
    camera.updateProjectionMatrix();renderer.setSize(width,height,false);first=true;
  }
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>resize()):null;
  observer?.observe(canvas);resize();
  const visibility=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)first=true;}):null;
  visibility?.observe(canvas);
  metrics.engine='Three.js r'+THREE.REVISION;metrics.seedCount='1';
  metrics.fibreCount=String(seed.userData.fibreCount);
  function reset(){
    time=0;until=-10;drift=0;lean=0;pointerInfluence=0;
    airVelocity.set(0,0);airOffset.set(0,0);leave();first=true;
  }
  function update(dt,t){
    if(disposed||lost||(!visible&&!first))return;
    time=t;dt=Math.min(dt,.05);
    raycaster.setFromCamera(pointer,camera);
    const hasHit=touching&&raycaster.ray.intersectPlane(plane,hit);
    const distance=hasHit?Math.hypot(hit.x-floatRig.position.x,hit.y-.4):Infinity;
    const rawInfluence=hasHit?1-THREE.MathUtils.smoothstep(distance,.18,1.55):0;
    pointerInfluence+=(rawInfluence-pointerInfluence)*(1-Math.exp(-dt*5));
    if(!reduced&&pointerInfluence>.001){
      pendingMotion.clampLength(0,.42);
      airVelocity.addScaledVector(pendingMotion,pointerInfluence*.55);
      airVelocity.clampLength(0,.7);
    }
    pendingMotion.set(0,0);
    airVelocity.multiplyScalar(Math.exp(-dt*3.4));
    airOffset.addScaledVector(airVelocity,dt);
    airOffset.multiplyScalar(Math.exp(-dt*1.65));
    const target=!reduced&&t<until?1:0;
    drift+=(target-drift)*(1-Math.exp(-dt*(target?1.5:.8)));
    const leanTarget=!reduced?THREE.MathUtils.clamp(-airVelocity.x*.1,-.1,.1):0;
    lean+=(leanTarget-lean)*(1-Math.exp(-dt*2));
    floatRig.position.set(reduced?0:Math.sin(t*.6)*.055+drift*.57+airOffset.x,
      reduced?.02:.02+Math.sin(t*.83)*.07+drift*.22+airOffset.y,0);
    floatRig.rotation.set(reduced?0:Math.sin(t*.37)*.055,
      0,reduced?0:Math.sin(t*.55)*.065-drift*.24+lean);
    // A slightly tilted local axis produces visible parallax and gentle
    // precession. A pure y-axis spin of a radial umbrella reads as 2D.
    const spinAngle=reduced?.15:t*.35;
    spinQuaternion.setFromAxisAngle(spinAxis,spinAngle);
    seed.quaternion.copy(spinQuaternion);
    renderer.render(scene,camera);first=false;
    metrics.ready='true';metrics.activeSeeds=drift>.08?'1':'0';
    metrics.drift=drift.toFixed(3);metrics.time=t.toFixed(3);
    metrics.pointerInfluence=pointerInfluence.toFixed(3);
    metrics.airSpeed=airVelocity.length().toFixed(3);
    metrics.spinAngle=spinAngle.toFixed(3);
    metrics.projection='perspective';
    metrics.drawCalls=String(renderer.info.render.calls);
  }
  function dispose(){
    disposed=true;observer?.disconnect();visibility?.disconnect();
    canvas.removeEventListener('pointermove',locate);canvas.removeEventListener('pointerdown',tap);
    canvas.removeEventListener('pointerleave',leave);canvas.removeEventListener('pointerup',leave);
    canvas.removeEventListener('pointercancel',leave);canvas.removeEventListener('keydown',keyboard);
    canvas.removeEventListener('webglcontextlost',contextLost);canvas.removeEventListener('webglcontextrestored',contextRestored);
    const geometries=new Set(),materials=new Set();
    seed.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)materials.add(object.material);});
    geometries.forEach(geo=>geo.dispose());materials.forEach(mat=>mat.dispose());renderer.dispose();
    renderer.forceContextLoss();metrics.ready='false';metrics.disposed='true';
  }
  function input(type,event){
    if(type==='pointermove')locate(event);
    else if(type==='pointerdown')tap(event);
    else if(type==='keydown')keyboard({...event,preventDefault(){}});
    else leave();
  }
  return {update,reset,blow,dispose,resize,input,metrics};
}
