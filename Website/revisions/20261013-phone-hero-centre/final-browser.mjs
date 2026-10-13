import {chromium} from '/Users/junhao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const b=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),r={states:[],errors:[],modality:'Isolated local Chrome mobile viewport/touch profile; not physical Safari'};
const c=await b.newContext({viewport:{width:390,height:700},hasTouch:true,isMobile:true}),p=await c.newPage();p.on('pageerror',e=>r.errors.push(String(e)));
const inspect=()=>{const hero=window.__hero,canvas=document.getElementById('heroGL'),rect=canvas.getBoundingClientRect(),v=new hero.THREE.Vector3(0,.52,-2.6).project(hero.camera);return {size:[innerWidth,innerHeight],vv:[visualViewport.width,visualViewport.height,visualViewport.scale],canvas:rect.toJSON(),data:{...canvas.dataset},view:hero.camera.view,projection:[...hero.camera.projectionMatrix.elements],origin:[(v.x+1)*rect.width/2,(1-v.y)*rect.height/2],nav:document.querySelector('#nav').getBoundingClientRect().toJSON(),lead:document.querySelector('.hero-tagline').getBoundingClientRect().toJSON(),cta:document.querySelector('.hero-cta').getBoundingClientRect().toJSON(),scrollY,width:document.documentElement.scrollWidth};};
try{
 await p.goto('http://127.0.0.1:4173/Website/design-a-receipt.html');await p.waitForFunction(()=>document.getElementById('heroGL')?.dataset.ready==='true');await p.waitForTimeout(3000);
 for(const [w,h] of [[390,700],[390,844],[375,667],[430,932],[320,568],[844,390],[390,844]]){
  await p.setViewportSize({width:w,height:h});await p.waitForTimeout(300);await p.evaluate(()=>{window.__hero.setPaused(true);window.__hero.render(0);});
  const after=await p.evaluate(inspect);r.states.push({name:w+'x'+h,...after});assert.equal(after.width,w);assert.ok(after.cta.bottom<=h);await p.screenshot({path:`/tmp/kandy-final-${w}x${h}.png`});
  const before=await p.evaluate(()=>{const hero=window.__hero,cam=hero.camera,view=cam.view?{...cam.view}:null;window.__framingView=view;cam.clearViewOffset();hero.render(0);return [...cam.projectionMatrix.elements];});
  await p.screenshot({path:`/tmp/kandy-paired-before-${w}x${h}.png`});
  const restored=await p.evaluate(()=>{const v=window.__framingView,h=window.__hero;if(v?.enabled)h.camera.setViewOffset(v.fullWidth,v.fullHeight,v.offsetX,v.offsetY,v.width,v.height);h.render(0);return [...h.camera.projectionMatrix.elements];});
  for(let i=0;i<16;i++)if(i!==9)assert.equal(before[i],restored[i]);
  if(w>h)assert.equal(after.view.enabled,false);
 }
 const top=await p.evaluate(inspect);await p.evaluate(()=>scrollTo(0,120));await p.waitForTimeout(200);await p.setViewportSize({width:390,height:900});await p.waitForTimeout(250);
 const scrolled=await p.evaluate(inspect);assert.equal(scrolled.data.phoneViewOffset,top.data.phoneViewOffset);r.states.push({name:'scrolled-height-change-held',...scrolled});
 await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(250);const returned=await p.evaluate(inspect);assert.equal(returned.data.phoneViewOffset,'111.636');r.states.push({name:'top-height-change-resumed',...returned});
 await c.close();
 const dc=await b.newContext({viewport:{width:1440,height:900}}),d=await dc.newPage();d.on('pageerror',e=>r.errors.push(String(e)));await d.goto('http://127.0.0.1:4173/Website/design-a-receipt.html');await d.waitForFunction(()=>window.__hero);await d.waitForTimeout(1600);await d.evaluate(()=>{window.__hero.setPaused(true);window.__hero.render(0);});const desktop=await d.evaluate(inspect);assert.equal(desktop.view,null);assert.equal(desktop.data.phoneViewOffset,undefined);r.states.push({name:'desktop',...desktop});await d.screenshot({path:'/tmp/kandy-final-desktop.png'});await dc.close();assert.deepEqual(r.errors,[]);
}catch(e){r.failure=String(e.stack);console.log(r.failure);process.exitCode=1;}finally{await b.close();await fs.writeFile('/tmp/kandy-final.json',JSON.stringify(r,null,2));console.log(JSON.stringify({states:r.states.map(s=>({name:s.name,offset:s.data.phoneViewOffset,origin:s.origin})),errors:r.errors,failure:r.failure}));}
