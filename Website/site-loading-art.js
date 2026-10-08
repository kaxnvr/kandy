/** Mount the approved artwork with an independent rendering clock if supported.
 * Text/progress remain usable if WebGL, Workers or the optional artwork fail. */
export async function mountLoadingArt(canvas,{reduced=false}={}) {
  let currentCanvas=canvas,worker=null,art=null,raf=0,last=performance.now(),time=0;
  let disposed=false,observer=null,settle,readyTimer;
  const listeners=[];
  const listen=(target,type,fn)=>{target.addEventListener(type,fn);listeners.push(()=>target.removeEventListener(type,fn));};
  const size=()=>{
    const {width,height}=currentCanvas.getBoundingClientRect();
    return {width,height,pixelRatio:Math.min(devicePixelRatio||1,2)};
  };
  const cleanupWorker=()=>{
    clearTimeout(readyTimer);observer?.disconnect();observer=null;
    listeners.splice(0).forEach(remove=>remove());
  };
  const dispose=()=>{
    if(disposed)return;
    disposed=true;cancelAnimationFrame(raf);art?.dispose();cleanupWorker();
    if(worker){
      const closingWorker=worker;
      closingWorker.postMessage({type:'dispose'});
      setTimeout(()=>closingWorker.terminate(),150);
    }
    currentCanvas.dataset.disposed='true';currentCanvas.dataset.ready='false';
    settle?.(false);
  };

  if(typeof Worker!=='undefined'&&currentCanvas.transferControlToOffscreen){
    try {
      worker=new Worker(new URL('./loading-dandelion-worker.js?v=approved-garden-1',import.meta.url),{type:'module'});
      const initialSize=size();
      const ready=new Promise(resolve=>{settle=resolve;});
      worker.onmessage=({data})=>{
        if(disposed)return;
        if(data.type==='ready'||data.type==='metrics'){
          Object.assign(currentCanvas.dataset,data.metrics,{renderThread:'worker'});
          if(data.type==='ready'){clearTimeout(readyTimer);settle(true);}
        } else if(data.type==='error')settle(false);
      };
      worker.onerror=()=>settle(false);
      const offscreen=currentCanvas.transferControlToOffscreen();
      worker.postMessage({type:'init',canvas:offscreen,reduced,...initialSize},[offscreen]);
      readyTimer=setTimeout(()=>settle(false),2500);
      const available=await ready;
      if(!available)throw new Error('Worker renderer unavailable');
      observer=new ResizeObserver(()=>worker.postMessage({type:'resize',...size()}));
      observer.observe(currentCanvas);
      for(const eventType of ['pointermove','pointerdown','pointerleave','pointerup','pointercancel','keydown']){
        listen(currentCanvas,eventType,event=>{
          if(eventType==='keydown'&&!['Enter',' '].includes(event.key))return;
          if(eventType==='keydown')event.preventDefault();
          const rect=currentCanvas.getBoundingClientRect();
          worker.postMessage({type:'input',eventType,sent:Date.now(),event:{
            clientX:event.clientX-rect.left,clientY:event.clientY-rect.top,key:event.key,pointerType:event.pointerType
          }});
        });
      }
      listen(document,'visibilitychange',()=>worker.postMessage({type:'visibility',hidden:document.hidden}));
      worker.postMessage({type:'visibility',hidden:document.hidden});
      return {dispose};
    } catch(error){
      cleanupWorker();worker?.terminate();worker=null;
      // A transferred canvas cannot acquire a main-thread context. Replace only
      // this canvas before falling back, preserving its labels and dimensions.
      const replacement=currentCanvas.cloneNode(false);
      currentCanvas.replaceWith(replacement);currentCanvas=replacement;
    }
  }

  const {createStudyScene}=await import('./loading-garden.js?v=approved-garden-1');
  art=createStudyScene(currentCanvas,2,{reduced});art.update(0,0);
  currentCanvas.dataset.renderThread='main';
  last=performance.now();
  function tick(now){
    if(disposed)return;
    const dt=Math.min(Math.max(0,now-last)/1000,.05);last=now;
    if(!document.hidden){time+=reduced?0:dt;art.update(reduced?0:dt,time);}
    raf=requestAnimationFrame(tick);
  }
  raf=requestAnimationFrame(tick);
  return {dispose};
}
