const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const input = process.argv[2] || 'work/caro/index.html';
const html = fs.readFileSync(input, 'utf8');
const start = html.indexOf('// One player for instrumental playlists');
assert(start >= 0, 'Music section marker missing');
const source = html.slice(start, html.indexOf('</script>', start));
new vm.Script(source);

function setup() {
  const elements = new Map();
  const listeners = new Map();
  const pending = [];
  const audio = [];
  const saved = new Map();
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
  const t = setup();
  const all = t.get('musicStyles');
  for (const key of ['edm', 'vinahouse', 'violin', 'piano', 'saxophone']) {
    assert(all[key], `Missing new category ${key}`);
    const expected = key === 'saxophone' ? 4 : 5;
    assert.equal(all[key].tracks.length, expected, `${key} must contain ${expected} full songs`);
    assert.equal(new Set(all[key].tracks.map(x => x.src)).size, expected, `${key} contains duplicate files`);
  }
  assert.equal(t.audio.length, 1, 'One shared music player prevents overlapping playlists/water');
  for (const [key, style] of Object.entries(all)) {
    if (style.tracks.length < 2) continue;
    t.get(`music.style=${JSON.stringify(key)}; music.bags={}; music.last={};`);
    let previous = null;
    for (let cycle = 0; cycle < 12; cycle++) {
      const batch = [];
      for (let i = 0; i < style.tracks.length; i++) {
        t.get('selectTrack()');
        const chosen = t.get('music.track.src');
        assert.notEqual(chosen, previous, `${key}: immediate repetition at a shuffle boundary`);
        batch.push(chosen); previous = chosen;
      }
      assert.equal(new Set(batch).size, style.tracks.length, `${key}: repeats before all songs play`);
    }
  }
  t.$('musicVolume').value = '37'; t.$('musicVolume').oninput();
  assert.equal(t.audio[0].volume, .37);
  assert.equal(t.saved.get('caro.music.volume'), '37');
  const play = t.$('musicToggle').onclick();
  await t.settle(); await play;
  assert.equal(t.audio[0].paused, false);
  t.$('musicStyle').value = 'piano';
  const switchPlay = t.$('musicStyle').onchange();
  assert.equal(t.get('music.style'), 'piano');
  assert.equal(t.get('music.wanted'), true, 'Changing style keeps playback enabled');
  assert.equal(t.audio[0].volume, .37, 'Changing style retains volume');
  await t.settle(); await switchPlay;
  assert(all.piano.tracks.some(x => x.src === t.audio[0].src));
  assert.equal(t.audio[0].paused, false);

  // Slow play from a previous selection must not resume audio after the user turns it off.
  const pendingChange = t.$('musicNext').onclick();
  t.$('musicToggle').onclick();
  assert.equal(t.get('music.wanted'), false);
  await t.settle(); await pendingChange;
  assert.equal(t.audio[0].paused, true, 'Stale play promise resumed after toggling off');

  t.$('musicStyle').value = 'water'; t.$('musicStyle').onchange();
  assert.equal(all.water.tracks.length, 1);
  assert.equal(t.audio[0].loop, true);
  assert.equal(t.$('musicNext').hidden, true);
  assert.equal(t.audio[0].paused, true, 'Switching style while off must remain silent');
  const waterPlay = t.$('musicToggle').onclick(); await t.settle(); await waterPlay;
  assert.equal(t.audio[0].src, all.water.tracks[0].src);
  assert.equal(t.audio.length, 1, 'Water must use the same exclusive player');
  t.document.hidden = true; t.listeners.get('visibilitychange')();
  assert.equal(t.audio[0].paused, true);
  t.document.hidden = false; t.listeners.get('visibilitychange')();
  await t.settle();
  assert.equal(t.audio[0].paused, false, 'Visible page resumes requested music');
  t.listeners.get('pagehide')();
  assert.equal(t.audio[0].paused, true);
  assert.equal(t.get('music.wanted'), false);
  console.log('PASS: 24 new selections (4–5 per group), shuffle cycles, no immediate repeats, playing style changes, volume persistence, stale play cancellation, exclusive looping water, page visibility playback.');
})().catch(e => { console.error(e); process.exitCode = 1; });

