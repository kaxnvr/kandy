import * as THREE from './vendor/three.module.js';
import {createDandelionSeed} from './loading-dandelion.js';

const CANDY_ORBIT_AXIS=new THREE.Vector3(.24,.95,.19).normalize();

// Fibonacci points form a visibly even spherical shell. Every point then uses
// the exact same rotation axis and speed, so spacing can never wobble or bunch.
export function candySpherePosition(index,count,time,target){
  const slot=index%count;
  const latitude=Math.acos(1-2*(slot+.5)/count);
  const longitude=slot*2.3999632297+.65;
  // A small deterministic depth variation softens the mathematical shell
  // without breaking its spherical read or letting pieces drift into groups.
  const radius=1.22+Math.sin(slot*4.73)*.075+Math.sin(time*.31+slot*1.7)*.018;
  return target.setFromSphericalCoords(radius,latitude,longitude)
    .applyAxisAngle(CANDY_ORBIT_AXIS,time*.115);
}

// Approved garden composition, shared by the website worker and design previews.
export function createStudyScene(canvas,option,{reduced=false,width=940,height=660,
  pixelRatio=typeof devicePixelRatio==='number'?devicePixelRatio:1}={}){
  const metrics=canvas.dataset||{};
  let viewport={left:0,top:0,width,height};
  const measure=()=>canvas.getBoundingClientRect?.()||viewport;
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});
  renderer.setClearColor(0xffffff,0);
  renderer.setPixelRatio(Math.min(pixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.08;
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(30,1,.1,20);
  camera.position.set(0,.8,5.7);camera.lookAt(0,.13,0);
  scene.add(new THREE.HemisphereLight(0xfffdf6,0xa0a895,2));
  const key=new THREE.DirectionalLight(0xfff8e9,2.2);key.position.set(-3,4,5);scene.add(key);
  const fill=new THREE.DirectionalLight(0xe8eef5,.7);fill.position.set(3,1,-1);scene.add(fill);
  const rim=new THREE.DirectionalLight(0xd7dec8,1.05);rim.position.set(-2,2,-4);scene.add(rim);
  const floatRig=new THREE.Group(),seed=createDandelionSeed();
  scene.add(floatRig);floatRig.add(seed);
  seed.scale.setScalar(option===1?2.05:2.8);
  const spinAxis=new THREE.Vector3(.14,.985,.1).normalize();
  const spinQuaternion=new THREE.Quaternion();
  const orbitCentre=new THREE.Vector3(0,.13,0);
  const orbitPosition=new THREE.Vector3(),outward=new THREE.Vector3();
  const pointer=new THREE.Vector2(),raycaster=new THREE.Raycaster();
  raycaster.params.Line.threshold=.065;
  const hits=[];
  let pointerInside=false,hovered=false,hoverUntil=-1,pulse=0,orbitTime=0;
  let time=0,visible=true,disposed=false,blowUntil=-1,drift=0;
  const ornaments=[];
  const candyMaterials=new Map();
  const candyMaterial=color=>{
    if(!candyMaterials.has(color))candyMaterials.set(color,new THREE.MeshPhysicalMaterial({color,roughness:.20,metalness:0,clearcoat:.58,clearcoatRoughness:.16,specularIntensity:.64,specularColor:new THREE.Color(0xfff8f2)}));
    return candyMaterials.get(color);
  };
  function candy(geometry,color,x,y,z,type='candy'){
    const mesh=new THREE.Mesh(geometry,candyMaterial(color));
    mesh.position.set(x,y,z);mesh.userData.candyType=type;scene.add(mesh);return mesh;
  }
  // Same star construction as the homepage's raised candy decorations.
  function star(radius){
    const shape=new THREE.Shape();
    for(let i=0;i<10;i++){
      const a=Math.PI/2+i*Math.PI/5,r=i%2?radius*.46:radius;
      if(!i)shape.moveTo(Math.cos(a)*r,Math.sin(a)*r);else shape.lineTo(Math.cos(a)*r,Math.sin(a)*r);
    }
    shape.closePath();
    const geo=new THREE.ExtrudeGeometry(shape,{depth:.045,steps:1,bevelEnabled:true,bevelThickness:.013,bevelSize:.013,bevelSegments:3,curveSegments:8});
    geo.center();return geo;
  }
  let grass=null,grassBase=null,grassWeights=null;
  if(option===1){
    let randomState=6831;
    const rand=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
    const vertices=[],colours=[],indices=[],weights=[];
    const base=new THREE.Color(0x2c6b22).lerp(new THREE.Color(0xc4e86b),.44);
    const tip=new THREE.Color(0xc4e86b),col=new THREE.Color();
    for(let b=0;b<2400;b++){
      const angle=rand()*Math.PI*2,r=Math.sqrt(rand()),edge=1+.045*Math.sin(angle*5)+.035*Math.cos(angle*3);
      const x=Math.cos(angle)*r*.91*edge,z=Math.sin(angle)*r*.45*edge;
      const y=-.70+Math.sqrt(1-r*r)*.125+.018*Math.sin(angle*4)*r;
      const height=.12+rand()*.20,width=.006+rand()*.008,turn=rand()*Math.PI*2;
      const bendX=(rand()-.5)*.11+x*.07,bendZ=(rand()-.5)*.10;
      const tint=.87+rand()*.23,start=vertices.length/3;
      for(let s=0;s<=4;s++){
        const t=s/4,w=width*(1-.97*t*t);
        col.copy(base).lerp(tip,Math.pow(t,1.2)).multiplyScalar(tint);
        for(const side of [-1,1]){
          vertices.push(x+bendX*t*t+Math.cos(turn)*w*side,y+height*t,z+bendZ*t*t+Math.sin(turn)*w*side);
          colours.push(col.r,col.g,col.b);weights.push(t*t);
        }
        if(s<4){const i=start+s*2;indices.push(i,i+1,i+2,i+1,i+3,i+2);}
      }
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));geo.setIndex(indices);geo.computeVertexNormals();
    grass=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}));
    scene.add(grass);grassBase=new Float32Array(vertices);grassWeights=weights;
    const pebble=candy(new THREE.CapsuleGeometry(.18,.16,12,28),0xe985af,.43,-.45,.12);
    pebble.rotation.set(.18,.28,1.14);
    const sugar=new THREE.Mesh(new THREE.CapsuleGeometry(.022,.064,5,10),candyMaterial(0x90d66d));
    sugar.position.set(.02,-.04,.17);sugar.rotation.z=-.8;pebble.add(sugar);
    const dot=new THREE.Mesh(new THREE.SphereGeometry(.022,12,8),candyMaterial(0xf8d75b));dot.position.set(-.067,.085,.15);pebble.add(dot);
  }else if(option===2){
    // A loose, asymmetric candy orbit: richer than the first study while the
    // dandelion remains the visual anchor. Smaller pieces sit farther back.
    const ornamentSpecs=[
      ['pink',new THREE.CapsuleGeometry(.066,.18,10,22),0xe985af,-1.34,.58,-.10,.32,.20,-.52],
      ['pink',new THREE.CapsuleGeometry(.052,.14,10,22),0xe985af,1.38,.20,.16,-.18,.28,.72],
      ['pink',new THREE.CapsuleGeometry(.046,.12,10,22),0xe985af,-.68,-.94,-.25,.18,-.20,1.02],
      ['mint',new THREE.CapsuleGeometry(.054,.14,10,22),0x90d66d,1.12,1.19,-.30,.40,.10,.95],
      ['mint',new THREE.CapsuleGeometry(.047,.12,10,22),0x90d66d,-1.31,-.18,.20,-.24,.18,-.88],
      ['mint',new THREE.CapsuleGeometry(.043,.11,10,22),0x90d66d,.39,-1.14,-.12,.12,-.30,.48],
      ['star',star(.138),0xf8d75b,1.02,-.80,.15,-.12,.26,-.30],
      ['star',star(.104),0xf8d75b,-.72,1.29,-.15,.16,-.34,.18],
      ['star',star(.088),0xf8d75b,-1.50,1.02,.04,-.22,.18,-.12],
      ['star',star(.092),0xf8d75b,1.49,.79,-.46,.14,-.30,.28],
      // Positive Z faces the camera: this star crosses the centre just enough
      // to make the dandelion feel enclosed by a true foreground layer.
      ['star',star(.112),0xf8d75b,.12,.43,.92,-.18,.42,-.20],
      ['pink',new THREE.CapsuleGeometry(.046,.12,10,22),0xe985af,.52,-.03,.78,.20,-.24,.84],
      ['mint',new THREE.CapsuleGeometry(.041,.105,10,22),0x90d66d,-.48,.13,.70,-.18,.30,-.76]
    ];
    // Spatially mixed, not merely alternating source indices: Fibonacci slots
    // that are far apart numerically can still be neighbours in the scene.
    // Minimise same-family proximity in 3D and across 24 projected orbit angles.
    // Pink: 1,5,7,11; mint: 2,3,9,10; stars: 0,4,6,8,12.
    const sphereSlots=[5,11,1,9,2,10,6,0,12,4,8,7,3];
    ornamentSpecs.forEach(([type,geometry,color,x,y,z,rx,ry,rz],i)=>{
      const mesh=candy(geometry,color,x,y,z,type);
      mesh.rotation.set(rx,ry,rz);
      ornaments.push({mesh,index:sphereSlots[i],rotation:mesh.rotation.clone(),phase:i*1.41,push:0,velocity:0});
    });
  }
  const resize=(nextWidth,nextHeight)=>{
    if(disposed)return;
    if(typeof nextWidth==='number'&&typeof nextHeight==='number')viewport={left:0,top:0,width:nextWidth,height:nextHeight};
    const {width,height}=measure();if(!width||!height)return;
    renderer.setSize(width,height,false);camera.aspect=width/height;
    // Option 2 uses a transparent 160px bleed on every edge so pushed candy
    // can cross nearby copy without being clipped by the original art box.
    // Widen the FOV proportionally to keep the seed at its approved pixel size.
    const bleed=option===2?320:0;
    const designWidth=Math.max(1,width-bleed),designHeight=Math.max(1,height-bleed);
    camera.fov=option===2?THREE.MathUtils.radToDeg(2*Math.atan(height/designHeight*Math.tan(THREE.MathUtils.degToRad(15)))):30;
    camera.position.z=designWidth/designHeight<1.05?6.6:5.7;
    camera.updateProjectionMatrix();
  };
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>resize()):null;
  observer?.observe(canvas);resize();
  const intersection=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;}):null;
  intersection?.observe(canvas);
  function blow(){if(!reduced){blowUntil=time+2.5;pulse=1;}}
  function movePointer(e){
    const rect=measure();
    pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    pointerInside=true;
  }
  function leavePointer(){pointerInside=false;hoverUntil=-1;}
  function hitSeed(){
    if(!pointerInside)return false;
    seed.updateWorldMatrix(true,true);camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer,camera);hits.length=0;
    raycaster.intersectObject(seed,true,hits);
    return hits.length>0;
  }
  function pressPointer(e){
    if(option!==2){blow();return;}
    movePointer(e);if(hitSeed())blow();
    if(e.pointerType==='touch')leavePointer();
  }
  function keyboard(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();blow();}}
  canvas.addEventListener('pointermove',movePointer);canvas.addEventListener('pointerleave',leavePointer);
  canvas.addEventListener('pointercancel',leavePointer);canvas.addEventListener('pointerdown',pressPointer);
  canvas.addEventListener('keydown',keyboard);
  function update(dt,t){
    if(disposed||!visible)return;
    time=t;dt=Math.min(dt,.05);
    // Hit only the seed, not the canvas: no invisible rectangular air wall.
    if(option===2&&!reduced&&hitSeed())hoverUntil=t+.22;
    const touching=option===2&&!reduced&&t<hoverUntil;
    if(touching&&!hovered)pulse=1;
    hovered=touching;
    pulse*=Math.exp(-dt*1.6);
    drift+=((t<blowUntil||touching?1:0)-drift)*(1-Math.exp(-dt*1.8));
    const motion=reduced?0:t;
    // Option 2 is a floating seed, not a spinning centrepiece: yaw stays
    // within +/- five degrees of its resting orientation, without full turns.
    const seedAngle=option===2?.15+Math.sin(motion*.23)*.08:(reduced?.15:motion*.35);
    spinQuaternion.setFromAxisAngle(spinAxis,seedAngle);
    seed.quaternion.copy(spinQuaternion);
    floatRig.position.set((option===1?-.12:0)+Math.sin(motion*.6)*.045+drift*.23,
      (option===1?.31:.02)+Math.sin(motion*.83)*.05+drift*.10,0);
    floatRig.rotation.set(Math.sin(motion*.37)*.045,0,Math.sin(motion*.55)*.06-drift*.12);
    if(!reduced)orbitTime+=dt;
    // One coherent rigid sphere: every point shares the same axis and angular
    // speed, preserving even spacing across top/bottom and front/back.
    for(const ornament of ornaments){
      const {mesh,index,rotation,phase}=ornament;
      candySpherePosition(index,ornaments.length,orbitTime,orbitPosition);
      const radius=orbitPosition.length();
      outward.copy(orbitPosition).normalize();
      const target=reduced?0:(drift*.40+pulse*.25)*(1.1-Math.min(radius,2)*.20);
      // Substepped damped spring: continuous push and a soft return, even on
      // slower frames. The orbit never stops while the candy is displaced.
      const steps=Math.max(1,Math.ceil(dt*120)),step=dt/steps;
      for(let i=0;i<steps;i++){
        ornament.velocity+=((target-ornament.push)*18-ornament.velocity*7)*step;
        ornament.push+=ornament.velocity*step;
      }
      mesh.position.copy(orbitPosition).add(orbitCentre).addScaledVector(outward,ornament.push);
      mesh.rotation.y=rotation.y+Math.sin(motion*.25+phase)*.35;
      mesh.rotation.z=rotation.z+Math.sin(motion*.43+phase)*.10;
    }
    if(grass&&!reduced){
      const pos=grass.geometry.attributes.position;
      for(let i=0;i<pos.count;i++){
        const x=grassBase[i*3],z=grassBase[i*3+2];
        pos.array[i*3]=x+Math.sin(motion*1.1+x*2.5+z*2)*.012*grassWeights[i];
      }
      pos.needsUpdate=true;
    }
    renderer.render(scene,camera);
    const counts=ornaments.reduce((sum,{mesh})=>{
      const type=mesh.userData.candyType;sum[type]=(sum[type]||0)+1;return sum;
    },{});
    Object.assign(metrics,{ready:'true',engine:'Three.js r'+THREE.REVISION,spin:seedAngle.toFixed(3),orbit:orbitTime.toFixed(3),layout:'spherical-shell',unclipped:'true',hovered:String(hovered),push:(ornaments[0]?.push||0).toFixed(3),drawCalls:String(renderer.info.render.calls),ornamentCount:String(ornaments.length),pinkCount:String(counts.pink||0),mintCount:String(counts.mint||0),starCount:String(counts.star||0)});
  }
  function dispose(){
    disposed=true;observer?.disconnect();intersection?.disconnect();
    canvas.removeEventListener('pointermove',movePointer);canvas.removeEventListener('pointerleave',leavePointer);
    canvas.removeEventListener('pointercancel',leavePointer);canvas.removeEventListener('pointerdown',pressPointer);
    canvas.removeEventListener('keydown',keyboard);
    const geos=new Set(),mats=new Set();scene.traverse(o=>{if(o.geometry)geos.add(o.geometry);if(o.material)mats.add(o.material);});
    geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());renderer.dispose();renderer.forceContextLoss();
  }
  function input(type,event={}){
    if(type==='pointermove')movePointer(event);
    else if(type==='pointerdown')pressPointer(event);
    else if(type==='pointerleave'||type==='pointercancel')leavePointer();
    else if(type==='keydown')keyboard({...event,preventDefault(){}});
  }
  return{update,dispose,blow,resize,input,metrics};
}
