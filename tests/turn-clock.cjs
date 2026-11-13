const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(process.argv[2] || 'work/caro/index.html', 'utf8');
const script = html.match(/<script>const FIREBASE_CONFIG=([\s\S]*?)<\/script>/)[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
new vm.Script(script);
const gameScript = script.split('// One player for instrumental playlists')[0];
const elements = new Map();
const element = () => ({textContent:'', value:'', hidden:false, children:[], setAttribute(){}, append(x){this.children.push(x)}, replaceChildren(){this.children=[]}, animate(){}});
let now = 100000;
const context = vm.createContext({
  assert, Date: {now:()=>now}, URLSearchParams,
  document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)}, createElement:element, addEventListener(){}},
  location:{search:'',pathname:'/'}, setInterval(){},
  firebase:{database:{ServerValue:{TIMESTAMP:{'.sv':'timestamp'}}}}
});
vm.runInContext(gameScript,context);
async function run(code){return vm.runInContext('(async()=>{'+code+'})()',context)}
(async()=>{
  await run(`$('local').onclick(); assert.equal($('turnClock').textContent,'X · 15s');`);
  now += 14999;
  await run(`await tickClock();assert.equal(game.turn,'X');assert.equal($('turnClock').textContent,'X · 1s');`);
  now++;
  await run(`await tickClock();assert.equal(game.turn,'O');assert.equal($('turnClock').textContent,'O · 15s');assert.match($('notice').textContent,/15 giây/);`);
  now += 5000;
  await run(`await move(0);assert.equal(game.cells[0],'O');assert.equal(game.turn,'X');assert.equal($('turnClock').textContent,'X · 15s');`);
  now += 15000;
  await run(`await move(1);assert.equal(game.cells[1],'');assert.equal(game.turn,'O');`);
  await run(`await $('reset').onclick();assert.equal(game.round,1);assert.equal($('turnClock').textContent,'O · 15s');`);
  await run(`mode='online';symbol='O';connected=true;game.turnAt=clockNow();game.turn='O';game.count=0;game.round=1;
    globalThis.raw={round:1,count:0,turn:'O',turnAt:game.turnAt,winner:'',board:{1:'-'}};
    globalThis.writes=0;roomRef={child(){return {async transaction(fn){const next=fn(raw);if(next){writes++;raw=next;}return {committed:!!next}}}}};`);
  now += 14999;
  await run(`await tickClock();assert.equal(writes,0);`);
  now++;
  await run(`await tickClock();assert.equal(writes,1);assert.equal(raw.turn,'X');`);
  await run(`raw={round:1,count:0,turn:'O',turnAt:clockNow()-15000,winner:'',board:{1:'-'}};game.turnAt=raw.turnAt;await move(1);assert.equal(raw.board[1],'-');`);
  assert(!html.includes('min-width:675px'));
  assert(!html.includes('min-width:615px'));
  assert(html.includes('.board-wrap{width:min(100%,720px);margin:18px auto}'));
  assert(html.includes('@media(min-width:800px){.board-wrap{width:min(100%,68vh,720px)}}'));
  console.log('PASS: JavaScript syntax, local 15s boundary, move timer reset, expired move rejection, rematch timer, online timeout transaction, original responsive board sizing.');
})().catch(e=>{console.error(e);process.exitCode=1});

