const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(process.argv[2]||'work/current-index.html','utf8');
const script=html.match(/<script>const FIREBASE_CONFIG=([\s\S]*?)<\/script>/)[0].replace(/^<script>/,'').replace(/<\/script>$/,'').split('// One player for instrumental playlists')[0];
function harness(identity='host-user'){
  let now=100000, persistence, signIns=0;
  const elements=new Map(),events=new Map(),writes=[];
  const element=()=>({textContent:'',value:'',hidden:false,children:[],setAttribute(){},append(x){this.children.push(x)},replaceChildren(){this.children=[]},animate(){}});
  const store={rooms:{ABC123:{host:'host-user',guest:'guest-user',created:now,closed:false,presence:{'host-user':true,'guest-user':true},game:{round:0,count:0,board:Object.fromEntries(Array.from({length:225},(_,i)=>[i,'-'])),turn:'X',last:'-1',winner:'',turnAt:now}}}};
  function get(path){if(path==='.info/connected')return true;if(path==='.info/serverTimeOffset')return 0;return path.split('/').reduce((v,k)=>v?.[k],store)??null;}
  function snap(path){return{val:()=>get(path),forEach(fn){for(const [key,value]of Object.entries(get(path)||{}))fn({key,val:()=>value});}};}
  function resolve(v){if(v&&typeof v==='object'){if(v['.sv']==='timestamp')return now;return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolve(x)]));}return v;}
  function emit(changed){for(const [p,fns]of events)if(p===changed||p.startsWith(changed+'/')||changed.startsWith(p+'/'))for(const fn of [...fns])fn(snap(p));}
  function put(path,value){let target=store,parts=path.split('/');for(const p of parts.slice(0,-1))target=target[p]??={};target[parts.at(-1)]=resolve(value);writes.push({path,value});emit(path);}
  function ref(path){return{child:p=>ref(path+'/'+p),once:async()=>snap(path),on(event,fn){if(!events.has(path))events.set(path,new Set());events.get(path).add(fn);fn(snap(path));},off(event,fn){events.get(path)?.delete(fn)},limitToLast(){return this},onDisconnect(){return{cancel(){return Promise.resolve()},set(){return Promise.resolve()}}},async set(v){put(path,v)},async transaction(fn){const value=fn(get(path));if(value===undefined)return{committed:false};put(path,value);return{committed:true,snapshot:snap(path)}}};}
  const database=()=>({ref});database.ServerValue={TIMESTAMP:{'.sv':'timestamp'}};
  const auth=()=>({currentUser:{uid:identity},async setPersistence(value){persistence=value},async signInAnonymously(){signIns++;return{user:{uid:identity}}}});auth.Auth={Persistence:{LOCAL:'local',SESSION:'session'}};
  const context=vm.createContext({Date:{now:()=>now},URLSearchParams,document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement:element,addEventListener(){}},location:{search:'',pathname:'/'},history:{replaceState(){}},setInterval(){},firebase:{apps:[{}],auth,database},assert});
  vm.runInContext(script,context);
  return{store,writes,context,setNow:v=>{now=v},get persistence(){return persistence},get signIns(){return signIns},run:code=>vm.runInContext('(async()=>{'+code+'})()',context),async settle(){for(let n=0;n<8;n++)await Promise.resolve()}};
}
const results=[];
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS '+name)}catch(error){results.push({name,pass:false});console.log('FAIL '+name+': '+error.message)}}
(async()=>{
  await test('Leave preserves room and opponent; only own presence becomes false',async()=>{
    const h=harness();await h.run(`await start(false,'ABC123');`);await h.settle();assert.equal(vm.runInContext('ready',h.context),true);
    h.writes.length=0;await h.run(`await $('leave').onclick();`);await h.settle();
    assert.equal(h.store.rooms.ABC123.closed,false,'leaving must not close room');
    assert.equal(h.store.rooms.ABC123.presence['host-user'],false);
    assert.equal(h.store.rooms.ABC123.presence['guest-user'],true);
    assert(!h.writes.some(w=>w.path.endsWith('/closed')),'leave must never write closed');
    assert.equal(vm.runInContext('mode',h.context),'');
  });
  for(const identity of ['host-user','guest-user'])await test('Same '+identity+' can leave and rejoin original seat',async()=>{
    const h=harness(identity);await h.run(`await start(false,'ABC123');`);await h.settle();
    const originalSymbol=vm.runInContext('symbol',h.context);
    await h.run(`await $('leave').onclick();`);await h.settle();
    await h.run(`await start(false,'ABC123');`);await h.settle();
    assert.equal(vm.runInContext('ready',h.context),true,'rejoining both-present room should be ready');
    assert.equal(vm.runInContext('symbol',h.context),originalSymbol);
    assert.equal(h.store.rooms.ABC123.presence[identity],true);
    assert.equal(h.store.rooms.ABC123.closed,false);
    assert.equal(h.signIns,0,'rejoin should reuse existing anonymous user');
  });
  await test('Auth requests LOCAL persistence for reload and tabs',async()=>{const h=harness();await h.run('await init();');assert.equal(h.persistence,'local')});
  for(const identity of ['host-user','guest-user'])await test('Original '+identity+' can reopen legacy closed room',async()=>{
    const h=harness(identity);h.store.rooms.ABC123.closed=true;await h.run(`await start(false,'ABC123');`);await h.settle();
    assert.equal(h.store.rooms.ABC123.closed,false);assert.equal(vm.runInContext('ready',h.context),true);
  });
  await test('Outsider cannot reopen legacy closed room',async()=>{
    const h=harness('outsider');h.store.rooms.ABC123.closed=true;await h.run(`await start(false,'ABC123');`);await h.settle();
    assert.equal(h.store.rooms.ABC123.closed,true);assert.equal(vm.runInContext('mode',h.context),'');
  });
  for(const age of [10100,14500,15000])await test('Online client move at '+age+'ms '+(age<15000?'commits':'is rejected'),async()=>{
    const h=harness();await h.run(`await start(false,'ABC123');`);await h.settle();h.setNow(100000+age);
    await h.run('await move(0);');await h.settle();assert.equal(h.store.rooms.ABC123.game.board[0],age<15000?'X':'-');
  });
  console.log(JSON.stringify({passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length}));
  if(results.some(x=>!x.pass))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});

