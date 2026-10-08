import * as THREE from '../../vendor/three.module.js';
import {
  simulationVertex, simulationFragment, furVertex, furFragment,
  groundVertex, groundFragment
} from './shaders.js?v=soft-trail-1';

// Website adapter for the approved continuous-tone-20 material study. The
// study's controls and fixed DOM IDs deliberately stay in its preview page.
export function mountSoftGardenBackground({ canvas }) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('Soft Garden needs a canvas');
  const imageUrl = new URL('./reference-colour.jpeg', import.meta.url).href;
  const diagnostics = {
    state:'loading', frames:0, strands:0, drawCalls:0, triangles:0,
    clicks:0, dragSamples:0, held:false, errors:[]
  };
  let destroyed = false;
  let teardown = () => {};
  const instance = {
    diagnostics,
    ready: null,
    destroy() { destroyed = true; teardown(); }
  };

  function fallback(error) {
    if (destroyed) return;
    if (error) diagnostics.errors.push(String(error));
    diagnostics.state = 'fallback';
    canvas.dataset.gardenState = 'fallback';
    canvas.style.visibility = 'hidden';
    document.documentElement.classList.add('soft-garden-fallback');
  }

  instance.ready = (async () => {
    let original;
    try {
      original = await new THREE.TextureLoader().loadAsync(imageUrl);
      if (destroyed) { original.dispose(); return; }
      // The same single 3px source-atop pass as the approved preview: no
      // lower-half reconstruction and no vertical low-pass colour change.
      const clean = document.createElement('canvas');
      clean.width = original.image.naturalWidth || original.image.width;
      clean.height = original.image.naturalHeight || original.image.height;
      const context = clean.getContext('2d');
      if (!context) throw new Error('Canvas 2D is unavailable');
      context.drawImage(original.image, 0, 0);
      context.filter = 'blur(3px)';
      context.globalCompositeOperation = 'source-atop';
      context.drawImage(original.image, 0, 0);
      context.filter = 'none';
      context.globalCompositeOperation = 'source-over';
      original.dispose();
      original = null;

      const referenceTexture = new THREE.CanvasTexture(clean);
      referenceTexture.colorSpace = THREE.SRGBColorSpace;
      referenceTexture.wrapS = referenceTexture.wrapT = THREE.ClampToEdgeWrapping;
      referenceTexture.minFilter = referenceTexture.magFilter = THREE.LinearFilter;
      referenceTexture.generateMipmaps = false;

      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas, antialias:true, alpha:false, powerPreference:'high-performance'
        });
      } catch (error) {
        referenceTexture.dispose();
        throw error;
      }
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(0x20493b);
      renderer.info.autoReset = false;

      const recovery = 1.15, gustDuration = 2.8;
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-4, 4, 3.5, -3.5, 0.1, 30);
      camera.position.set(0, -0.65, 8);
      camera.lookAt(0, 0, 0);
      const size = new THREE.Vector2(8, 7);
      const gusts = Array.from({ length:5 }, () => new THREE.Vector4(0, 0, -100, 0));
      const trailGusts = Array.from({ length:32 }, () => new THREE.Vector4(0, 0, -100, 0));
      let trailIndex = 0, gustIndex = 0, heldPointerId = null, lastTrailTime = -100;
      const lastTrail = new THREE.Vector2();
      const targetOptions = {
        minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
        depthBuffer:false, stencilBuffer:false, type:THREE.UnsignedByteType
      };
      let readTarget = new THREE.WebGLRenderTarget(256, 256, targetOptions);
      let writeTarget = new THREE.WebGLRenderTarget(256, 256, targetOptions);
      const neutralTexture = new THREE.DataTexture(new Uint8Array([128,128,0,128]), 1, 1, THREE.RGBAFormat);
      neutralTexture.needsUpdate = true;
      const simUniforms = {
        uPrevious:{ value:neutralTexture }, uSize:{ value:size },
        uPointer:{ value:new THREE.Vector4(-100,-100,-100,-100) },
        uBrush:{ value:new THREE.Vector3() }, uGusts:{ value:gusts },
        uTrailGusts:{ value:trailGusts }, uTime:{ value:0 },
        uDelta:{ value:1/60 }, uRecovery:{ value:recovery },
        uGustDuration:{ value:gustDuration }
      };
      const simScene = new THREE.Scene(), simCamera = new THREE.Camera();
      const simMaterial = new THREE.ShaderMaterial({
        uniforms:simUniforms, vertexShader:simulationVertex, fragmentShader:simulationFragment,
        depthTest:false, depthWrite:false, toneMapped:false
      });
      const simPlane = new THREE.Mesh(new THREE.PlaneGeometry(2,2), simMaterial);
      simScene.add(simPlane);
      const sharedUniforms = {
        uField:{ value:neutralTexture }, uSize:{ value:size },
        uLength:{ value:1 }, uReference:{ value:referenceTexture },
        uResolution:{ value:new THREE.Vector2() }
      };
      const furMaterial = new THREE.ShaderMaterial({
        uniforms:sharedUniforms, vertexShader:furVertex, fragmentShader:furFragment,
        side:THREE.DoubleSide, toneMapped:false
      });
      const groundMaterial = new THREE.ShaderMaterial({
        uniforms:sharedUniforms, vertexShader:groundVertex, fragmentShader:groundFragment,
        toneMapped:false
      });
      let fur, ground, strandCount = 0;
      const origin = performance.now();
      const seconds = () => (performance.now() - origin) / 1000;
      let raf = 0, lastTime = 0, awakeUntil = 1, lastInput = -100;
      let dirtyPointer = false, pointerInside = false, contextLost = false, paused = false;
      const pointer = new THREE.Vector2(-100,-100), previous = new THREE.Vector2(-100,-100);
      const raycaster = new THREE.Raycaster();
      const plane = new THREE.Plane(new THREE.Vector3(0,0,1),0.04);
      const hit = new THREE.Vector3();
      const listeners = [];
      const listen = (target, type, fn, options) => {
        target.addEventListener(type, fn, options);
        listeners.push(() => target.removeEventListener(type, fn, options));
      };

      function heightAt(x,y) {
        const xx = x-0.45, yy = y+0.35;
        const radius = Math.hypot(xx*0.89, yy);
        const angle = Math.atan2(yy,xx);
        return Math.sin(radius*3.25+Math.sin(angle*2)*0.55+x*0.18)*0.115
          + Math.sin(x*1.2+y*0.7)*0.025;
      }
      function buildSurface(width,height) {
        strandCount = Math.round(Math.min(250000,Math.max(85000,width*height*0.22)));
        const geometry = new THREE.InstancedBufferGeometry();
        const positions = [], indices = [];
        const segments = 3;
        for (let i=0;i<=segments;i++) positions.push(-1,i/segments,0,1,i/segments,0);
        for (let i=0;i<segments;i++) {
          const k=i*2; indices.push(k,k+1,k+2,k+1,k+3,k+2);
        }
        geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
        geometry.setIndex(indices);
        const roots = new Float32Array(strandCount*4);
        const shapes = new Float32Array(strandCount*4);
        let randomState = 58429;
        const random = () => {
          randomState = (Math.imul(randomState,1664525)+1013904223)>>>0;
          return randomState/4294967296;
        };
        const columns = Math.ceil(Math.sqrt(strandCount*size.x/size.y));
        const rows = Math.ceil(strandCount/columns);
        for (let i=0;i<strandCount;i++) {
          const u=((i%columns)+random())/columns-0.5;
          const v=(Math.floor(i/columns)+random())/rows-0.5;
          const x=u*size.x,y=v*size.y;
          const h=heightAt(x,y), nx=(heightAt(x+0.008,y)-heightAt(x-0.008,y))/0.016;
          const ny=(heightAt(x,y+0.008)-heightAt(x,y-0.008))/0.016;
          const angle=Math.atan2(y+0.35,x-0.45)+1.3+Math.sin(x*1.7+y*2.1)*0.35+(random()-0.5)*0.85;
          roots.set([u,v,random(),random()],i*4);
          shapes.set([h,nx,ny,angle],i*4);
        }
        geometry.setAttribute('aRoot',new THREE.InstancedBufferAttribute(roots,4));
        geometry.setAttribute('aShape',new THREE.InstancedBufferAttribute(shapes,4));
        geometry.instanceCount=strandCount;
        if (fur) { scene.remove(fur); fur.geometry.dispose(); }
        fur=new THREE.Mesh(geometry,furMaterial);
        fur.frustumCulled=false;
        scene.add(fur);
        const groundGeometry=new THREE.PlaneGeometry(size.x,size.y,120,100);
        const pos=groundGeometry.attributes.position;
        for (let i=0;i<pos.count;i++) pos.setZ(i,heightAt(pos.getX(i),pos.getY(i))-0.007);
        groundGeometry.computeVertexNormals();
        if (ground) { scene.remove(ground); ground.geometry.dispose(); }
        ground=new THREE.Mesh(groundGeometry,groundMaterial);
        scene.add(ground);
        diagnostics.strands=strandCount;
      }
      function endDrag(event) {
        if (heldPointerId===null || (event?.pointerId!==undefined && event.pointerId!==heldPointerId)) return;
        heldPointerId=null;
        diagnostics.held=false;
        dirtyPointer=false;
        previous.copy(pointer);
        pointerInside=false;
      }
      function resetField() {
        endDrag();
        simUniforms.uPrevious.value=neutralTexture;
        sharedUniforms.uField.value=neutralTexture;
        simUniforms.uBrush.value.set(0,0,0);
        gusts.forEach(g=>g.set(0,0,-100,0));
        trailGusts.forEach(g=>g.set(0,0,-100,0));
        dirtyPointer=false;
      }
      function wake(duration=1) {
        awakeUntil=Math.max(awakeUntil,seconds()+duration);
        if (!raf && !document.hidden && !destroyed && !contextLost && !paused) {
          lastTime=0;
          canvas.dataset.gardenState='active';
          raf=requestAnimationFrame(render);
        }
      }
      let lastWidth=0, lastHeight=0, lastDpr=0;
      function resize(force=false) {
        if (destroyed || contextLost) return;
        const bounds=canvas.getBoundingClientRect();
        const width=Math.max(1,Math.round(bounds.width));
        const height=Math.max(1,Math.round(bounds.height));
        const dpr=Math.min(devicePixelRatio || 1,width<600?1.35:1.6);
        if (!force && width===lastWidth && height===lastHeight && dpr===lastDpr) return;
        lastWidth=width; lastHeight=height; lastDpr=dpr;
        const aspect=width/height, visibleHeight=6.4;
        camera.left=-visibleHeight*aspect/2; camera.right=visibleHeight*aspect/2;
        camera.top=visibleHeight/2; camera.bottom=-visibleHeight/2;
        camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        size.set(visibleHeight*aspect+0.65,visibleHeight+0.7);
        renderer.setPixelRatio(dpr);
        renderer.setSize(width,height,false);
        renderer.getDrawingBufferSize(sharedUniforms.uResolution.value);
        buildSurface(width,height);
        resetField(); wake(0.5);
      }
      function pointerPosition(event) {
        const bounds=canvas.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return false;
        raycaster.setFromCamera(new THREE.Vector2(
          (event.clientX-bounds.left)/bounds.width*2-1,
          1-(event.clientY-bounds.top)/bounds.height*2
        ),camera);
        if (!raycaster.ray.intersectPlane(plane,hit)) return false;
        pointer.set(hit.x,hit.y);
        return true;
      }
      function addGust(x,y) {
        gusts[gustIndex].set(x,y,seconds(),reducedMotion?0.5:1);
        gustIndex=(gustIndex+1)%gusts.length;
        diagnostics.clicks++;
        wake(gustDuration+recovery+0.25);
      }
      function addTrailGust(x,y) {
        trailGusts[trailIndex].set(x,y,seconds(),reducedMotion?0.5:1);
        trailIndex=(trailIndex+1)%trailGusts.length;
        lastTrail.set(x,y); lastTrailTime=seconds();
        diagnostics.dragSamples++;
      }
      function onPointerMove(event) {
        // Touch is reserved for native scrolling. A global swipe must not
        // wake the full-screen fur simulation behind every content section.
        if (event.pointerType==='touch') return;
        if (paused || destroyed || contextLost) return;
        if (heldPointerId!==null && event.pointerId!==heldPointerId) return;
        if (!pointerInside) {
          if (!pointerPosition(event)) return;
          previous.copy(pointer); pointerInside=true;
        }
        if (!pointerPosition(event)) return;
        if (heldPointerId!==null) {
          if (event.pointerType==='mouse' && !(event.buttons&1)) { endDrag(); return; }
          const distance=lastTrail.distanceTo(pointer);
          if (distance>=0.24) {
            const start=lastTrail.clone();
            const steps=Math.min(32,Math.ceil(distance/0.24));
            for (let i=1;i<=steps;i++) addTrailGust(
              start.x+(pointer.x-start.x)*i/steps,
              start.y+(pointer.y-start.y)*i/steps
            );
          }
          previous.copy(pointer);
          dirtyPointer=false;
          wake(gustDuration+recovery+0.25);
          return;
        }
        dirtyPointer=true; lastInput=seconds();
        wake(recovery+0.12);
      }
      function onPointerDown(event) {
        if (event.pointerType==='touch') return;
        if (paused || destroyed || contextLost) return;
        if (event.button!==0) return;
        if (heldPointerId!==null || !pointerPosition(event)) return;
        previous.copy(pointer); pointerInside=true;
        dirtyPointer=false; simUniforms.uBrush.value.set(0,0,0);
        heldPointerId=event.pointerId; diagnostics.held=true;
        lastTrail.copy(pointer); lastTrailTime=seconds();
        addGust(pointer.x,pointer.y);
      }
      function render(timestamp) {
        raf=0;
        if (destroyed || document.hidden || contextLost || paused) return;
        const now=(timestamp-origin)/1000;
        if (heldPointerId!==null) {
          if (now-lastTrailTime>=0.24) addTrailGust(pointer.x,pointer.y);
          awakeUntil=Math.max(awakeUntil,now+gustDuration+recovery+0.25);
        }
        const dt=lastTime?Math.min(now-lastTime,0.05):1/60;
        lastTime=now;
        simUniforms.uTime.value=now;
        simUniforms.uDelta.value=dt;
        if (dirtyPointer) {
          const dx=pointer.x-previous.x, dy=pointer.y-previous.y;
          const distance=Math.hypot(dx,dy);
          const scale=Math.min(1.25,distance*18)/Math.max(distance,0.0001);
          simUniforms.uPointer.value.set(previous.x,previous.y,pointer.x,pointer.y);
          simUniforms.uBrush.value.set(dx*scale,dy*scale,Math.min(1,distance*85)*(reducedMotion?0.5:1));
          previous.copy(pointer); dirtyPointer=false;
        } else simUniforms.uBrush.value.z=0;
        // An 8-bit field can retain sub-visible rounding residue. Restore a
        // neutral final frame before sleeping so a stronger trail never stains
        // the resting material or needs a perpetual cleanup animation.
        if (now>=awakeUntil && heldPointerId===null) resetField();
        renderer.info.reset();
        renderer.setRenderTarget(writeTarget);
        renderer.render(simScene,simCamera);
        [readTarget,writeTarget]=[writeTarget,readTarget];
        simUniforms.uPrevious.value=readTarget.texture;
        sharedUniforms.uField.value=readTarget.texture;
        renderer.setRenderTarget(null);
        renderer.render(scene,camera);
        diagnostics.frames++;
        diagnostics.drawCalls=renderer.info.render.calls;
        diagnostics.triangles=renderer.info.render.triangles;
        const wind=gusts.some(g=>now-g.z<gustDuration)||trailGusts.some(g=>now-g.z<gustDuration);
        diagnostics.state=wind?'wind':now-lastInput<recovery?'brushing':'rest';
        if (now<awakeUntil) raf=requestAnimationFrame(render);
        else { diagnostics.state='asleep'; canvas.dataset.gardenState='asleep'; }
      }

      let resizeTimer;
      listen(window,'pointermove',onPointerMove,{passive:true});
      listen(window,'pointerdown',onPointerDown,{passive:true});
      listen(window,'pointerup',endDrag,{passive:true});
      listen(window,'pointercancel',endDrag,{passive:true});
      listen(window,'blur',() => endDrag());
      listen(document,'visibilitychange',() => {
        if (document.hidden) {
          endDrag(); cancelAnimationFrame(raf); raf=0; diagnostics.state='hidden';
          canvas.dataset.gardenState='hidden';
        } else { lastTime=0; wake(recovery+0.1); }
      });
      listen(window,'resize',() => {
        clearTimeout(resizeTimer);
        resizeTimer=setTimeout(resize,120);
      },{passive:true});
      const observer=typeof ResizeObserver!=='undefined'
        ? new ResizeObserver(() => {
          clearTimeout(resizeTimer);
          resizeTimer=setTimeout(resize,120);
        }) : null;
      observer?.observe(canvas);
      listen(canvas,'webglcontextlost',event => {
        event.preventDefault();
        contextLost=true;
        cancelAnimationFrame(raf); raf=0;
        endDrag();
        fallback('WebGL context lost');
      });
      listen(canvas,'webglcontextrestored',() => {
        contextLost=false;
        document.documentElement.classList.remove('soft-garden-fallback');
        canvas.style.visibility='visible';
        resize(true);
      });
      teardown=() => {
        cancelAnimationFrame(raf);
        clearTimeout(resizeTimer);
        observer?.disconnect();
        listeners.forEach(remove => remove());
        fur?.geometry.dispose(); ground?.geometry.dispose();
        simPlane.geometry.dispose();
        furMaterial.dispose(); groundMaterial.dispose(); simMaterial.dispose();
        readTarget.dispose(); writeTarget.dispose();
        neutralTexture.dispose(); referenceTexture.dispose();
        renderer.dispose();
      };
      instance.setPaused = value => {
        paused=Boolean(value);
        if (paused) {
          endDrag(); cancelAnimationFrame(raf); raf=0;
          diagnostics.state='paused';
          canvas.dataset.gardenState='paused';
        } else wake(0.5);
      };
      if (destroyed) { teardown(); return; }
      resize();
    } catch (error) {
      original?.dispose();
      fallback(error);
    }
  })();
  return instance;
}
