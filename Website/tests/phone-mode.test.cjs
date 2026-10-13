const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('design-a-receipt.html');

// All MediaQueryList.matches values change before browser change callbacks.
// Callback ordering is deliberately configurable to exercise dependent queries.
function profileFixture(initial, {hostname = 'kaxnvr.github.io', search = ''} = {}) {
  let viewport = {...initial};
  const queries = [];
  function matches(query) {
    return query.split(',').some(branch => [...branch.matchAll(/\(([^)]+)\)/g)].every(([,condition]) => {
      const [key,raw] = condition.split(':').map(value => value.trim());
      if (key === 'pointer') return viewport.pointer === raw;
      const limit = parseFloat(raw);
      if (key === 'max-width') return viewport.width <= limit;
      if (key === 'min-width') return viewport.width >= limit;
      if (key === 'max-height') return viewport.height <= limit;
      if (key === 'min-height') return viewport.height >= limit;
      throw new Error(`Unsupported query in profile fixture: ${condition}`);
    }));
  }
  function matchMedia(query) {
    const events = new EventTarget();
    const media = {query, get matches(){ return matches(query); },
      addEventListener:events.addEventListener.bind(events),
      removeEventListener:events.removeEventListener.bind(events),
      emit:() => events.dispatchEvent(new Event('change'))};
    queries.push(media);
    return media;
  }
  const document = {documentElement:{dataset:{}}};
  const window = {};
  vm.runInNewContext(read('assets/phone-profile.js'), {window,document,matchMedia,
    location:{hostname,search},URLSearchParams,EventTarget,Event});
  return {profile:window.KandyPhoneProfile,document,matchMedia,
    resize(next, reverseEvents = false) {
      const before = queries.map(media => media.matches);
      viewport = {...viewport,...next};
      const changed = queries.filter((media,index) => media.matches !== before[index]);
      if (reverseEvents) changed.reverse();
      changed.forEach(media => media.emit());
    }};
}

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const body = html.indexOf('{', start);
  let end=body+1, depth=1;
  while(depth && end<html.length) {
    if(html[end]==='{') depth++;
    else if(html[end]==='}') depth--;
    end++;
  }
  assert.equal(depth,0);
  return html.slice(start,end);
}

const fixtures = [
  [320,568,'coarse',true], [390,844,'coarse',true], [430,932,'coarse',true],
  [844,390,'coarse',true], [932,430,'coarse',true],
  [700,900,'coarse',true], [701,900,'coarse',false],
  [768,1024,'coarse',false], [1024,768,'coarse',false], [1025,600,'coarse',false],
  [1366,768,'coarse',false], [390,844,'fine',false], [844,390,'fine',false], [1440,900,'fine',false]
];
for(const [width,height,pointer,expected] of fixtures) test(`profile ${width}x${height}, ${pointer}: phone=${expected}`, () => {
  const f=profileFixture({width,height,pointer});
  assert.equal(f.profile.matches,expected);
  assert.equal(f.document.documentElement.dataset.kandyPhone,expected ? 'true' : undefined);
});

test('phone preview override is local only', () => {
  const view={width:1440,height:900,pointer:'fine'};
  for(const hostname of ['localhost','127.0.0.1','::1','[::1]']) {
    assert.equal(profileFixture(view,{hostname,search:'?phone-preview=1'}).profile.matches,true);
  }
  for(const hostname of ['kaxnvr.github.io','localhost.example.com']) {
    assert.equal(profileFixture(view,{hostname,search:'?phone-preview=1'}).profile.matches,false);
  }
});

test('withMedia stays stable through phone rotation, restores tablets, and supports listener removal', () => {
  const f=profileFixture({width:390,height:844,pointer:'coarse'});
  const receipt=f.profile.withMedia('(min-width:701px)',{excludePhone:true});
  const navigation=f.profile.withMedia('(max-width:600px)');
  const receipts=[],menus=[];
  const onReceipt=()=>receipts.push(receipt.matches);
  receipt.addEventListener('change',onReceipt);
  navigation.addEventListener('change',()=>menus.push(navigation.matches));
  f.resize({width:844,height:390});
  assert.equal(receipt.matches,false);assert.equal(navigation.matches,true);
  assert.deepEqual(receipts,[]);assert.deepEqual(menus,[]);
  f.resize({width:1024,height:768});
  assert.deepEqual(receipts,[true]);assert.deepEqual(menus,[false]);
  receipt.removeEventListener('change',onReceipt);
  f.resize({width:390,height:844});
  assert.equal(receipt.matches,false);assert.deepEqual(receipts,[true]);
  assert.deepEqual(menus,[false,true]);
});

test('combined media never briefly mounts desktop scenes when dependent events arrive first', () => {
  const f=profileFixture({width:500,height:900,pointer:'fine'});
  const receipt=f.profile.withMedia('(min-width:701px)',{excludePhone:true});
  const changes=[];receipt.addEventListener('change',()=>changes.push(receipt.matches));
  f.resize({width:844,height:390,pointer:'coarse'},true);
  assert.equal(receipt.matches,false);
  assert.deepEqual(changes,[], 'fine narrow -> phone landscape must remain excluded throughout');
  f.resize({width:500,height:900,pointer:'fine'},true);
  assert.deepEqual(changes,[]);
});

test('phone omits the mission chapter and its space while desktop retains all six sentences', () => {
  const mission=html.slice(html.indexOf('<section class="mission mission-story'),html.indexOf('<!-- ================= GIFT TRAY'));
  assert.equal([...mission.matchAll(/<p class="mission-line">/g)].length,6);
  const css=read('assets/phone-layout.css');
  const rule=css.match(/html\[data-kandy-phone="true"\] #missionStory \{([^}]+)\}/)?.[1];
  assert.ok(rule);
  for(const declaration of ['display:none','height:0 !important','min-height:0','margin:0','padding:0']) assert.ok(rule.includes(declaration));
  assert.ok(html.includes('if (!missionStory || !missionLines.length || window.KandyPhoneProfile?.matches) return;'));
});

test('garden entrance measures the first visible phone section and preserves the desktop mission boundary', () => {
  for(const phone of [true,false]) {
    let top=900;
    const calls=[];
    const visible={getBoundingClientRect:()=>({top})};
    const unused={getBoundingClientRect:()=>assert.fail('must not measure the other presentation')};
    const context={window:{KandyPhoneProfile:{matches:phone}},innerHeight:844,
      phoneGardenEntrance:phone?visible:unused,missionEntrance:phone?unused:visible,
      gardenPausedForHero:undefined,garden:{setPaused:value=>calls.push(value)}};
    vm.createContext(context);
    vm.runInContext(functionSource('syncGardenEntrance'),context);
    context.syncGardenEntrance();context.syncGardenEntrance();
    top=700;context.syncGardenEntrance();
    top=900;context.syncGardenEntrance();
    assert.deepEqual(calls,[true,false,true]);
  }
});

test('phone handoff does not measure a falling-letter runway or counter-scroll the wordmark', () => {
  for(const scrollY of [0,350,1200]) {
    const calls={logo:[],letters:[],colour:[]};
    const context={window:{KandyPhoneProfile:{matches:true}},reduceHandoffMotion:false,scrollY,
      meadow:{setLogoTrack:value=>calls.logo.push(value)},letterFall:{setProgress:value=>calls.letters.push(value)},
      syncGardenColourReveal:value=>calls.colour.push(value),handoffLayout:null,
      measureHandoffLayout:assert.fail};
    vm.runInNewContext(`${functionSource('syncHeroHandoff')}\nsyncHeroHandoff();`,context);
    assert.deepEqual(calls,{logo:[0],letters:[0],colour:[1]});
  }
});

test('desktop handoff retains its direct scroll-to-progress mapping', () => {
  const calls={};
  const context={window:{KandyPhoneProfile:{matches:false},__syncMissionStory:value=>calls.mission=value},
    document:{documentElement:{dataset:{}}},reduceHandoffMotion:false,scrollY:700,innerHeight:800,
    meadow:{setLogoTrack:value=>calls.logo=value},letterFall:{setRelease:value=>calls.release=value},
    syncGardenColourReveal:value=>calls.colour=value,clamp01:value=>Math.max(0,Math.min(1,value)),
    handoffLayout:{heroTop:0,meadowBottom:800,trackLimit:400,fallStart:400,fallRange:1000,launchY:400},
    measureHandoffLayout:assert.fail};
  vm.runInNewContext(`${functionSource('syncHeroHandoff')}\nsyncHeroHandoff();`,context);
  assert.equal(calls.logo,400);assert.equal(calls.release.progress,.3);
  assert.equal(calls.release.launchY,400);assert.equal(calls.release.occlusionY,100);
  assert.equal(calls.mission,.3);assert.equal(calls.colour,.3);
});

test('falling-letter model is not mounted on initial phone load and mounts once when needed', () => {
  const canvas={hidden:false};let mounts=0,ready=0,progress=[];
  const profile={matches:true};
  const context={window:{KandyPhoneProfile:profile,__kandyLoader:{lettersReady:()=>ready++}},
    document:{getElementById:()=>canvas},letterFall:undefined,lettersSource:{},handoffLayout:null,
    readyAfterFallbackPaint:fn=>fn(),syncHeroHandoff(){},staticLettersFallback(){},
    mountScene(){mounts++;return {setProgress:value=>progress.push(value)};}};
  vm.createContext(context);vm.runInContext(functionSource('syncLetterMode'),context);
  vm.runInContext('syncLetterMode()',context);
  assert.equal(mounts,0);assert.equal(canvas.hidden,true);assert.equal(ready,1);
  profile.matches=false;vm.runInContext('syncLetterMode()',context);
  assert.equal(mounts,1);assert.equal(canvas.hidden,false);
  profile.matches=true;vm.runInContext('syncLetterMode()',context);
  assert.deepEqual(progress,[0]);assert.equal(canvas.hidden,true);
  profile.matches=false;vm.runInContext('syncLetterMode()',context);assert.equal(mounts,1);
});

test('integrated receipt, navigation and store gates agree for phone portrait and landscape', async () => {
  const receiptSource=read('assets/responsive-receipt.js');
  const {mountResponsiveReceipt}=await import(`data:text/javascript;base64,${Buffer.from(receiptSource).toString('base64')}`);
  const receiptExpression=html.match(/const responsiveReceipt = mountResponsiveReceipt\(\{\s*media:([^\n]+),\n/)[1];
  const storeExpression=read('assets/stores-mist.js').match(/const small = ([^;]+);/)[1];
  const navExpression=read('assets/responsive-layout.js').match(/const narrow = ([^;]+);/)[1];
  const f=profileFixture({width:390,height:844,pointer:'coarse'});
  const context={window:{KandyPhoneProfile:f.profile},matchMedia:f.matchMedia};
  const receipt=vm.runInNewContext(receiptExpression,context);
  const stores=vm.runInNewContext(storeExpression,context),nav=vm.runInNewContext(navExpression,context);
  let loads=0,mounts=0,releases=0;
  const mounted=mountResponsiveReceipt({media:receipt,load:async()=>{loads++;return{};},
    mount:()=>{mounts++;return()=>releases++;},onError:assert.fail});
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  await flush();f.resize({width:844,height:390});await flush();
  assert.deepEqual([loads,mounts,releases],[0,0,0]);assert.equal(stores.matches,true);assert.equal(nav.matches,true);
  f.resize({width:1024,height:768});await flush();
  assert.deepEqual([loads,mounts,releases],[1,1,0]);assert.equal(stores.matches,false);assert.equal(nav.matches,false);
  f.resize({width:844,height:390});await flush();
  assert.deepEqual([loads,mounts,releases],[1,1,1]);assert.equal(stores.matches,true);assert.equal(nav.matches,true);
  mounted.dispose();
});
