import { createStudyScene } from './loading-garden.js?v=approved-garden-1';

// Keep the seed moving while the main thread builds the meadow geometry.
let art, raf=0, last=0, elapsed=0, hidden=false, reduced=false, lastReport=0, frames=0;
function tick(now) {
  const dt=Math.min(Math.max(0,now-last)/1000,.05);
  last=now;
  if(!hidden){
    elapsed+=reduced?0:dt;
    art.update(reduced?0:dt,elapsed);
    frames++;
    if(now-lastReport>200){
      lastReport=now;
      postMessage({type:'metrics',metrics:{...art.metrics,frames:String(frames)}});
    }
  }
  raf=requestAnimationFrame(tick);
}
self.onmessage=({data})=>{
  try {
    if(data.type==='init'){
      reduced=data.reduced;
      art=createStudyScene(data.canvas,2,data);
      art.update(0,0);
      last=performance.now();
      postMessage({type:'ready',metrics:art.metrics});
      raf=requestAnimationFrame(tick);
    } else if(data.type==='resize')art?.resize(data.width,data.height);
    else if(data.type==='input'){
      // Don't replay a backlog of old pointer moves after a long main-thread task.
      if(Date.now()-data.sent<250)art?.input(data.eventType,data.event);
    } else if(data.type==='visibility')hidden=data.hidden;
    else if(data.type==='dispose'){
      cancelAnimationFrame(raf);art?.dispose();self.close();
    }
  } catch(error){
    cancelAnimationFrame(raf);art?.dispose();
    postMessage({type:'error',message:String(error)});
  }
};
