const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const input = process.argv[2] || 'work/caro/index.html';
const html = fs.readFileSync(input, 'utf8');
const start = html.indexOf('// One player for instrumental playlists');
assert(start >= 0, 'Music section marker missing');
const source = html.slice(start, html.indexOf('</script>', start));
new vm.Script(source);
assert(!/<select[^>]+id=["']musicStyle["']/.test(html), 'Retired style selector is still shown');

function setup(initialStorage = {}) {
  const elements = new Map(), listeners = new Map(), pending = [], audio = [];
  const saved = new Map(Object.entries(initialStorage));
  class Element {
    constructor() { this.value = ''; this.hidden = false; this.textContent = ''; this.attrs = new Map(); this.events = new Map(); }
    setAttribute(k, v) { this.attrs.set(k, v); }
    getAttribute(k) { return k === 'src' ? (this.src || null) : (this.attrs.get(k) ?? null); }
    addEventListener(name, fn) { this.events.set(name, fn); }
    emit(name) { return this.events.get(name)?.(); }
  }
  class Audio extends Element {
    constructor() { super(); this.paused = true; this.playCalls = 0; this.pauseCalls = 0; }
    play() {
      this.playCalls++;
      return new Promise((resolve, reject) => pending.push({
        resolve: () => { this.paused = false; resolve(); }, reject,
      }));
    }
    pause() { this.paused = true; this.pauseCalls++; }
  }
  const $ = id => {
    assert.notEqual(id, 'musicStyle', 'Playback code still depends on retired style selector');
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const document = {
    hidden: false,
    createElement(type) { assert.equal(type, 'audio'); const a = new Audio(); audio.push(a); return a; },
    body: { appendChild() {} },
    addEventListener(name, fn) { listeners.set(name, fn); },
  };
  const window = { addEventListener(name, fn) { listeners.set(name, fn); } };
  const localStorage = { getItem(k) { return saved.get(k) ?? null; }, setItem(k, v) { saved.set(k, v); } };
  const context = vm.createContext({ $, document, window, localStorage, console });
  vm.runInContext(source, context);
  const get = expr => vm.runInContext(expr, context);
  const settle = async () => { assert(pending.length, 'Expected pending audio play'); pending.shift().resolve(); await Promise.resolve(); await Promise.resolve(); };
  return { $, get, audio, pending, document, listeners, saved, settle };
}

(async () => {
  // Previously saved retired categories must migrate safely into the only remaining playlist.
  const t = setup({'caro.music.style': 'piano', 'caro.music.volume': '62'});
  const all = t.get('musicStyles');
  assert.equal(Object.keys(all).join(','), 'saxophone', 'Only saxophone playlist is allowed');
  assert.equal(t.get('music.style'), 'saxophone', 'Saved piano preference was not migrated');
  const tracks = all.saxophone.tracks;
  assert.equal(tracks.length, 20, 'Playlist must contain twenty full recordings');
  assert.equal(new Set(tracks.map(x => x.src)).size, 20, 'Duplicate recording paths');
  assert.equal(new Set(tracks.map(x => x.title.toLowerCase().trim())).size, 20, 'Duplicate recording titles');
  assert(tracks.every(x => typeof x.src === 'string' && x.src.endsWith('.mp3') && x.title.trim()), 'Missing title or playable MP3 path');
  assert.equal(t.audio.length, 1, 'Music must use one exclusive player');
  assert.equal(t.audio[0].paused, true, 'Initial visit must stay silent');
  assert.equal(t.audio[0].volume, .62, 'Initial volume preference was lost');
  assert.equal(t.$('musicVolume').value, '62');
  t.get('music.bags={}; music.last={};');
  let previous = null;
  for (let cycle = 0; cycle < 12; cycle++) {
    const batch = [];
    for (let i = 0; i < 20; i++) {
      t.get('selectTrack()');
      const chosen = t.get('music.track.src');
      assert.notEqual(chosen, previous, 'Immediate repeat at shuffle boundary');
      batch.push(chosen); previous = chosen;
    }
    assert.equal(new Set(batch).size, 20, 'Song repeated before the whole playlist played');
  }
  t.$('musicVolume').value = '37'; t.$('musicVolume').oninput();
  assert.equal(t.audio[0].volume, .37);
  assert.equal(t.saved.get('caro.music.volume'), '37');
  const before = t.get('music.track.src');
  t.$('musicNext').onclick();
  assert.notEqual(t.get('music.track.src'), before, 'Next must select another song');
  assert.equal(t.audio[0].playCalls, 0, 'Next while off must stay silent');
  const play = t.$('musicToggle').onclick(); await t.settle(); await play;
  assert.equal(t.audio[0].paused, false);
  assert.equal(t.audio[0].src, t.get('music.track.src'));
  const old = t.audio[0].src;
  const next = t.$('musicNext').onclick(); await t.settle(); await next;
  assert.notEqual(t.audio[0].src, old);
  assert.equal(t.get('music.wanted'), true);
  assert.equal(t.audio[0].volume, .37, 'Next must retain volume');
  assert.equal(t.audio[0].paused, false);

  // Simulate a slow browser play resolution arriving after the user turned sound off.
  const slow = t.$('musicNext').onclick();
  t.$('musicToggle').onclick();
  assert.equal(t.get('music.wanted'), false);
  await t.settle(); await slow;
  assert.equal(t.audio[0].paused, true, 'Stale play promise resumed after toggling off');
  const resume = t.$('musicToggle').onclick(); await t.settle(); await resume;
  t.document.hidden = true; t.listeners.get('visibilitychange')();
  assert.equal(t.audio[0].paused, true);
  t.document.hidden = false; t.listeners.get('visibilitychange')(); await t.settle();
  assert.equal(t.audio[0].paused, false, 'Visible page must resume requested music');
  const endedSource = t.audio[0].src;
  t.audio[0].emit('ended'); await t.settle();
  assert.notEqual(t.audio[0].src, endedSource, 'Ended track must advance');
  assert.equal(t.audio.length, 1, 'Playback must never create overlapping audio players');
  t.listeners.get('pagehide')();
  assert.equal(t.audio[0].paused, true);
  assert.equal(t.get('music.wanted'), false);
  console.log('PASS: 20 unique sax tracks, retired-style migration, 12 shuffle cycles, next/ended playback, volume persistence, stale play cancellation, page visibility, single audio player.');
})().catch(e => { console.error(e); process.exitCode = 1; });

