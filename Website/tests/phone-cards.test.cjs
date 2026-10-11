const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// Minimal live-node fixture. The contracts here concern identity, sibling order,
// focus and lifecycle; browser QA separately verifies layout and native details.
function fixture(initialPhone = false) {
  let writes=0;
  let document;
  class Element {
    constructor(tag,id='',cls='') { this.tagName=tag.toUpperCase();this.id=id;this.className=cls;this.childNodes=[];this.parentNode=null;this.open=false;this.hidden=false;this.scrollTop=0; }
    appendChild(node) { return this.insertBefore(node,null); }
    insertBefore(node,before) { writes++;if(node.parentNode)node.remove();const at=before===null?this.childNodes.length:this.childNodes.indexOf(before);assert.ok(at>=0);this.childNodes.splice(at,0,node);node.parentNode=this;return node; }
    remove() { writes++;if(this.parentNode)this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this),1);this.parentNode=null; }
    matches(selector) { return selector[0]==='#'?this.id===selector.slice(1):selector[0]==='.'?this.className.split(' ').includes(selector.slice(1)):this.tagName===selector.toUpperCase(); }
    querySelector(selector) {
      const parts=selector.split(' '),all=[];
      function walk(node){for(const child of node.childNodes){all.push(child);walk(child);}}walk(this);
      return all.find(node=>{if(!node.matches(parts.at(-1)))return false;let parent=node.parentNode;
        for(let i=parts.length-2;i>=0;i--){while(parent&&!parent.matches(parts[i]))parent=parent.parentNode;if(!parent)return false;parent=parent.parentNode;}return true;})||null;
    }
    contains(node) { return node===this||this.childNodes.some(child=>child.contains(node)); }
    closest(selector) { for(let node=this;node;node=node.parentNode)if(node.matches(selector))return node;return null; }
    focus() { document.activeElement=this; }
  }
  const root=new Element('html');
  const add=(parent,tag,id,cls)=>parent.appendChild(new Element(tag,id,cls));
  const tray=add(root,'div','trayPlane'),copy=add(tray,'div','','tray-feature-copy');
  add(copy,'span','','eyebrow');add(copy,'h2');add(copy,'p','','tray-feature-lead');
  const trayFacts=add(copy,'ul','','tray-feature-facts'),trayNote=add(copy,'p','','tray-feature-note');
  const actions=add(copy,'div','','tray-feature-actions'),cta=add(actions,'a','','btn'),small=add(actions,'p','','small');
  const pdp=add(root,'div','pdp');pdp.hidden=true;
  const panel=add(pdp,'div','','pdp-panel'),close=add(panel,'button','pdpClose'),body=add(panel,'div','','pdp-body');
  add(body,'span','pdpFlavor');add(body,'h3','pdpName');add(body,'p','pdpDesc');
  const facts=add(body,'ul','pdpFacts','pdp-facts'),buy=add(body,'div','','pdp-buy'),note=add(body,'p','','pdp-note');
  add(body,'p','','pdp-demo-actions');
  document={activeElement:null,querySelector:s=>root.querySelector(s),getElementById:id=>root.querySelector('#'+id),
    createElement:tag=>{writes++;return new Element(tag);},createComment:()=>{writes++;return new Element('#comment');}};
  const callbacks=[],profile={matches:initialPhone,addEventListener:(_,fn)=>callbacks.push(fn)},observers=[];
  class MutationObserver {constructor(fn){this.fn=fn;this.connected=false;observers.push(this);}observe(){this.connected=true;}disconnect(){this.connected=false;}}
  const original={copy:[...copy.childNodes],actions:[...actions.childNodes],body:[...body.childNodes]};
  writes=0;
  vm.runInNewContext(read('assets/phone-cards.js'),{window:{KandyPhoneProfile:profile},document,MutationObserver});
  return {root,document,copy,trayFacts,trayNote,actions,cta,small,pdp,panel,close,body,facts,buy,note,original,observers,add,
    get writes(){return writes;},change(value){profile.matches=value;callbacks.forEach(fn=>fn());},
    open(){pdp.hidden=false;observers.filter(observer=>observer.connected).forEach(observer=>observer.fn());}};
}

test('desktop creates no disclosure, marker or node movement',()=>{
  const f=fixture();assert.equal(f.writes,0);f.change(false);assert.equal(f.writes,0);
});

test('phone disclosure retains full content while primary actions and demo notice stay outside',()=>{
  const f=fixture(true),trayDetails=f.copy.querySelector('details'),pdpDetails=f.body.querySelector('details');
  assert.equal(f.trayFacts.parentNode,trayDetails);assert.equal(f.trayNote.parentNode,trayDetails);assert.equal(f.small.parentNode,trayDetails);
  assert.equal(f.facts.parentNode,pdpDetails);assert.equal(f.cta.parentNode,f.actions);assert.equal(f.buy.parentNode,f.body);assert.equal(f.note.parentNode,f.body);
  assert.ok(f.body.childNodes.indexOf(f.buy)<f.body.childNodes.indexOf(pdpDetails));
  assert.equal(trayDetails.querySelector('summary').textContent,'Collection details');
  assert.equal(pdpDetails.querySelector('summary').textContent,'Product details');
});

test('three phone/desktop transitions restore exact original nodes and order without duplicate wrappers',()=>{
  const f=fixture();
  for(let round=0;round<3;round++){
    f.change(true);const count=f.writes;f.change(true);assert.equal(f.writes,count);
    f.change(false);assert.deepEqual(f.copy.childNodes,f.original.copy);assert.deepEqual(f.actions.childNodes,f.original.actions);assert.deepEqual(f.body.childNodes,f.original.body);
    assert.equal(f.root.querySelector('details'),null);assert.ok(f.observers.every(observer=>!observer.connected));
  }
});

test('existing product updates keep their live facts node and each opening starts at the top',()=>{
  const f=fixture(true),details=f.body.querySelector('details');
  const fresh=f.add(f.facts,'li','new-product-fact');details.open=true;f.panel.scrollTop=300;
  f.open();assert.equal(details.open,false);assert.equal(f.panel.scrollTop,0);
  f.change(false);assert.equal(f.facts.querySelector('#new-product-fact'),fresh);
  assert.equal(f.document.getElementById('pdpFacts'),f.facts);
});

test('removing a focused mobile summary returns focus to an existing control in its component',()=>{
  for(const component of ['tray','pdp']){
    const f=fixture(true);f.document.activeElement=(component==='tray'?f.copy:f.body).querySelector('summary');
    f.change(false);assert.equal(f.document.activeElement,component==='tray'?f.cta:f.close);
  }
});

test('all added card and flow CSS remains explicitly gated by the phone root attribute',()=>{
  for(const file of ['assets/phone-cards.css','assets/phone-layout.css']){
    const css=read(file).replace(/\/\*[\s\S]*?\*\//g,'');
    for(const match of css.matchAll(/([^{}]+)\{/g)){
      const selector=match[1].trim();if(selector.startsWith('@media'))continue;
      assert.match(selector,/^html\[data-kandy-phone=['"]true['"]\]/,`${file}: ${selector}`);
    }
  }
});
