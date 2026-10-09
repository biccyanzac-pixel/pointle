// Pointle UI. Screens: home -> location -> (sensor setup) -> play/reveal x5 -> done; plus leaderboard,
// practice, help, AR.
//
// PRIVACY RULE FOR THIS FILE: the player's coordinates (S.origin) live only in memory. They are never
// written to storage, put in a URL, logged, or passed to api.js. If you add a feature, keep it that way
// (test-e2e/privacy.e2e.mjs checks every outgoing request).
import { trueDirection, toAzEl, fromAzEl, compareDirections, tunnelFacts, wrap360, angleBetween } from './geo.js';
import { scoreFor, totalScore, describeMiss, shareText, encodeResult, decodeResult, emojiFor, MAX_TOTAL } from './scoring.js';
import { dayKey, puzzleNumber, weekday, msUntilNextUtcDay, entryFor, addDays } from './daily.js';
import { generateDay, playableTargets, pickPracticeTarget, kmBetween, WEEKDAY_NAMES } from './rules.js';
import { SensorPointer, sensorsLikelyAvailable, needsPermissionTap } from './sensors.js';
import { requestPosition, searchTowns, nearestTown } from './location.js';
import { checkName, checkTown } from './names.js';
import * as api from './api.js';

export const REPO_URL = 'https://github.com/biccyanzac-pixel/pointle';
const PRIVACY = `Your precise location never leaves your phone or computer — all the maths happens on your device. If you choose to show a town on the leaderboard, only that town name is saved. Check the open-source code: `;
const MODE_LABEL = { sensor: 'Phone', map: 'Map', 'fixed-sensor': 'Fixed spot · phone', 'fixed-map': 'Fixed spot · map' };
const MODES = ['sensor', 'map', 'fixed-sensor', 'fixed-map'];

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids) e.append(k);
  return e;
};
const fmtDeg = (d) => `${Math.round(d)}°`;
const fmtKm = (k) => `${Math.round(k).toLocaleString('en-GB')} km`;
const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const cardinal = (az) => CARDINALS[Math.round(wrap360(az) / 22.5) % 16];
const isPhone = () => matchMedia('(pointer: coarse)').matches;

// ---------- storage (results and preferences only; never coordinates) ----------
const STORE_KEY = 'pointle:v1';
function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* storage blocked: play still works */ }
}
const store = load();
store.days ??= {};
store.groups ??= [];
// keep two weeks of results
for (const d of Object.keys(store.days)) if (d < addDays(dayKey(), -14)) delete store.days[d];

// ---------- state ----------
const S = {
  day: dayKey(),
  schedule: null, targets: null, byId: null, entry: null,
  input: null,          // 'sensor' | 'map'
  fixed: false,
  origin: null,         // { lat, lon } in memory only
  originLabel: '',
  sensor: null,
  method: store.method || 'camera',
  game: null,           // { mode, ids, idx, results, shownAt }
  afterLocation: null,  // continuation after the location step
  practiceOrigin: null,
};
const modeKey = () => `${S.fixed ? 'fixed-' : ''}${S.input}`;
const playFor = (mode, day = S.day) => store.days[day]?.[mode];
const anyDoneToday = () => MODES.some((m) => playFor(m)?.results?.length === 5);

// ---------- data ----------
async function loadData() {
  const [sched, tg] = await Promise.all([
    fetch('data/schedule.json').then((r) => r.json()),
    fetch('data/targets.json').then((r) => r.json()),
  ]);
  S.schedule = sched;
  S.targets = tg.targets;
  S.byId = new Map(S.targets.map((t) => [t.id, t]));
  S.entry = entryFor(S.day, S.schedule, (d) => generateDay(d, S.targets));
}
const T = (id) => S.byId.get(id);
const placeName = (t) => (t.c && t.k !== 'nature' ? `${t.n}, ${t.c}` : t.n);
const fixedOrigin = () => T(S.entry.origin);

// ---------- screens ----------
let current = 'home';
const leaveHooks = [];
function show(id) {
  while (leaveHooks.length) leaveHooks.pop()();
  $$('.screen').forEach((s) => { s.hidden = s.id !== id; });
  current = id;
  window.scrollTo(0, 0);
  if (id === 'home') renderHome();
  if (id === 'board') renderBoard();
}
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) show(go.dataset.go);
});
function fillPrivacy() {
  for (const p of $$('.privacy-text')) {
    p.textContent = PRIVACY;
    p.append(el('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, REPO_URL.replace('https://', '')));
  }
}

// ---------- home ----------
function renderHome() {
  $('#puzzle-no').textContent = `Pointle #${puzzleNumber(S.day)}`;
  $('#theme').textContent = WEEKDAY_NAMES[weekday(S.day)];
  const sensorOk = sensorsLikelyAvailable();
  $('#go-sensor').hidden = !sensorOk;
  $('#qr-box').hidden = isPhone();
  if (!isPhone()) drawQr();
  const done = MODES.filter((m) => playFor(m)?.results?.length === 5);
  const box = $('#home-done');
  box.hidden = !done.length;
  box.replaceChildren(el('b', {}, 'Played today'));
  for (const m of done) {
    const p = playFor(m);
    box.append(el('div', { class: 'row' }, `${MODE_LABEL[m]}: ${totalScore(p.results.map((r) => r.error))}/${MAX_TOTAL} `,
      el('button', { class: 'link', onclick: () => showDone(m) }, 'see result')));
  }
  if (done.length) box.append(el('small', {}, 'You can still play the other modes: each has its own leaderboard.'));
}

async function drawQr() {
  if ($('#qr').childElementCount) return;
  const { default: qrcode } = await import('../vendor/qrcode/qrcode.mjs');
  const url = new URL(location.href);
  url.search = '?play=sensor';
  url.hash = '';
  const q = qrcode(0, 'M');
  q.addData(url.toString());
  q.make();
  $('#qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

function tickCountdown() {
  const ms = msUntilNextUtcDay();
  const s = Math.floor(ms / 1000);
  $('#countdown').textContent = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
  if (dayKey() !== S.day && !S.game) {   // midnight UTC: switch to the new puzzle unless mid-game
    S.day = dayKey();
    S.entry = entryFor(S.day, S.schedule, (d) => generateDay(d, S.targets));
    if (current === 'home') renderHome();
  }
}

// ---------- location ----------
function chooseOrigin(input, then, { allowFixed = true } = {}) {
  S.input = input;
  S.afterLocation = then;
  $('.fixed-name').textContent = fixedOrigin().n;
  $('#loc-fixed').hidden = !allowFixed;   // practice uses your own location or town
  $('#loc-msg').textContent = '';
  $('#town-q').value = '';
  $('#town-results').replaceChildren();
  show('loc');
}

function originChosen(origin, label, fixed) {
  S.origin = origin;
  S.originLabel = label;
  S.fixed = fixed;
  S.afterLocation?.();
}

$('#loc-gps').addEventListener('click', async () => {
  $('#loc-msg').textContent = 'Asking your browser for your location…';
  try {
    const p = await requestPosition();
    originChosen({ lat: p.lat, lon: p.lon }, 'your location', false);
  } catch (err) {
    $('#loc-msg').textContent = `${err.message} You can pick your town instead, or use today's fixed spot.`;
  }
});
$('#loc-fixed').addEventListener('click', () => {
  const f = fixedOrigin();
  originChosen({ lat: f.lat, lon: f.lon }, `${f.n} (today's fixed spot)`, true);
});
function townSearch(input, list, onPick) {
  let n = 0;
  input.addEventListener('input', async () => {
    const my = ++n;
    const found = await searchTowns(input.value);
    if (my !== n) return;
    list.replaceChildren(...found.map((t) => el('li', {}, el('button', { type: 'button', onclick: () => onPick(t) },
      t.name, el('small', {}, [t.region, t.country].filter(Boolean).join(', '))))));
  });
}
townSearch($('#town-q'), $('#town-results'), (t) => originChosen({ lat: t.lat, lon: t.lon }, `${t.name} (picked)`, false));

// ---------- sensor setup ----------
function setupSensors() {
  show('setup');
  $$('input[name=method]').forEach((r) => { r.checked = r.value === S.method; });
  $('#calib').hidden = true;
  $('#enable-compass').hidden = false;
  $('#setup-msg').textContent = '';
  $('#fixed-decl').hidden = !S.fixed;
  if (S.sensor?.ready) enableCompass();
}
$$('input[name=method]').forEach((r) => r.addEventListener('change', () => {
  S.method = r.value; store.method = S.method; save();
  if (S.sensor) S.sensor.method = S.method;
}));

async function enableCompass() {
  if (!S.sensor) {
    S.sensor = new SensorPointer({ method: S.method });
    const ok = await S.sensor.requestPermission();
    if (!ok) {
      $('#setup-msg').textContent = 'Motion access was not allowed. To fix it on iPhone: close and reopen the tab, then tap "Enable compass" and choose Allow. Or play on the map instead.';
      S.sensor = null;
      return;
    }
    S.sensor.start();
  }
  S.sensor.method = S.method;
  // In fixed-spot mode the compass is still read where the player physically is; without their location
  // the declination is unknown, so default to 0 unless they pick their town.
  if (S.fixed) S.sensor.setDeclination(0); else S.sensor.setOrigin(S.origin.lat, S.origin.lon);
  $('#enable-compass').hidden = true;
  $('#calib').hidden = false;
  const stopWatch = S.sensor.onChange(setupTick);
  leaveHooks.push(stopWatch);
  setTimeout(() => {
    if (current === 'setup' && S.sensor.kind === 'none') $('#setup-msg').textContent = 'No orientation data from this device yet. If nothing changes, your browser may not support compass access: try the map mode.';
  }, 2500);
}
$('#enable-compass').addEventListener('click', enableCompass);

function setupTick(sp) {
  $('#flat-hint').hidden = !sp.needsFlat;
  const acc = sp.accuracy;
  $('#acc-hint').textContent = sp.kind === 'relative'
    ? 'This browser gives no compass direction. Try Chrome or Safari, or play on the map.'
    : acc == null ? (sp.kind === 'absolute' ? 'Compass accuracy isn\'t reported on this device: calibrate anyway.' : '')
      : acc > 25 ? `⚠️ Compass accuracy is low (±${Math.round(acc)}°). Keep waving in a figure-8, away from metal and magnets.`
        : `Compass accuracy ±${Math.round(acc)}°.`;
  $('#acc-hint').className = acc > 25 ? 'msg warn' : 'msg';
  $('#decl-line').textContent = S.fixed ? '' : `Magnetic declination here: ${Math.abs(S.sensor.decl).toFixed(1)}° ${S.sensor.decl >= 0 ? 'E' : 'W'} (corrected automatically).`;
  const a = sp.azEl(150);
  if (a) {
    $('#setup-heading').textContent = sp.ready ? `${Math.round(a.az)}° ${cardinal(a.az)}` : '…';
    $('#setup-tilt').textContent = `${a.el >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(a.el))}°`;
  }
  $('#start-sensor').disabled = !sp.ready;
}
$('#decl-pick').addEventListener('click', () => { $('#decl-search').hidden = false; $('#decl-q').focus(); });
townSearch($('#decl-q'), $('#decl-results'), (t) => {
  S.sensor.setOrigin(t.lat, t.lon);  // declination only; the fixed spot stays the origin
  $('#decl-search').hidden = true;
  $('#fixed-decl').textContent = `Compass corrected for ${t.name}: ${Math.abs(S.sensor.decl).toFixed(1)}° ${S.sensor.decl >= 0 ? 'E' : 'W'}.`;
});
$('#start-sensor').addEventListener('click', () => startGame());

// ---------- game ----------
function startMode(input) {
  return () => (input === 'sensor' ? setupSensors() : startGame());
}

function startGame() {
  const mode = modeKey();
  const ids = playableTargets(S.entry, S.origin, S.byId);
  let saved = playFor(mode);
  if (saved?.results?.length === 5) { showDone(mode); return; }
  if (!saved || saved.ids?.join() !== ids.join()) {
    // a different origin can swap in the reserve; keep finished targets only if the list still matches
    saved = { ids, results: saved?.ids?.join() === ids.join() ? saved.results : [], device: isPhone() ? 'phone' : 'desktop' };
  }
  store.days[S.day] ??= {};
  store.days[S.day][mode] = saved;
  save();
  S.game = { mode, ids, results: saved.results, idx: saved.results.length };
  showTarget();
}

let mapView = null;
async function showTarget() {
  const g = S.game;
  const t = T(g.ids[g.idx]);
  show('play');
  $('#play-progress').textContent = `${MODE_LABEL[g.mode]} · ${g.idx + 1} of 5 · from ${S.originLabel}`;
  $('#target-name').textContent = t.n;
  $('#target-country').textContent = t.k === 'nature' ? (t.c || '') : t.c;
  g.shownAt = Date.now();
  const sensor = S.input === 'sensor';
  $('#sensor-read').hidden = !sensor;
  $('#map-wrap').hidden = sensor;
  if (sensor) {
    const off = S.sensor.onChange(() => {
      const a = S.sensor.azEl(150);
      if (!a) return;
      const vertical = Math.abs(a.el) > 80;
      $('#read-heading').textContent = vertical ? '—' : `${Math.round(a.az)}°`;
      $('#read-cardinal').textContent = vertical ? (a.el > 0 ? 'straight up' : 'straight down') : cardinal(a.az);
      $('#read-tilt').textContent = `${Math.abs(Math.round(a.el))}°`;
      $('#read-tilt-sub').textContent = Math.abs(a.el) < 0.5 ? 'level' : a.el > 0 ? 'above horizon' : 'below horizon';
      const acc = S.sensor.accuracy;
      $('#read-warn').hidden = !(acc > 25);
      $('#read-warn').textContent = `Compass accuracy is low (±${Math.round(acc)}°): try a figure-8.`;
    });
    leaveHooks.push(off);
  } else {
    if (!mapView || mapView.origin !== S.origin) {
      mapView?.dispose();
      const { MapView, IMAGERY } = await import('./mapview.js');
      $('#imagery-attrib').innerHTML = IMAGERY.attribution;
      mapView = new MapView($('#map-wrap'), S.origin, {
        onChange: (az, elv) => {
          $('#map-heading').textContent = `${Math.round(az)}° ${cardinal(az)}`;
          $('#map-tilt').textContent = `${elv >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(elv))}°`;
          $('#tilt').value = elv;
        },
      });
    }
    mapView.setDirection(Math.random() * 360, -20 + (Math.random() - 0.5) * 10); // no hint from the start pose
    requestAnimationFrame(() => mapView.resize());
  }
}
$('#tilt').addEventListener('input', (e) => mapView?.setDirection(mapView.az, Number(e.target.value)));

function currentGuess() {
  if (S.input === 'sensor') return S.sensor.lock();
  return fromAzEl(mapView.az, mapView.el);
}

$('#lock').addEventListener('click', () => {
  const g = S.game;
  const guess = currentGuess();
  if (!guess) return;
  const t = T(g.ids[g.idx]);
  const truth = trueDirection(S.origin, t);
  const c = compareDirections(guess, truth);
  const r = { id: t.id, error: Math.round(c.error * 10) / 10, h: Math.round(c.horizontal), v: Math.round(c.vertical), ms: Date.now() - g.shownAt };
  g.results.push(r);
  save();
  if (navigator.vibrate) navigator.vibrate(30);
  showReveal(g.idx, guess, truth);
  g.idx++;
});

// ---------- reveal ----------
let landCache = {};
async function land(res) {
  landCache[res] ??= fetch(`data/land-${res}.json`).then((r) => r.json()).then((d) => d.rings);
  return landCache[res];
}

async function showReveal(i, guess, truth) {
  const g = S.game;
  const r = g.results[i];
  const t = T(r.id);
  show('reveal');
  $('#rev-progress').textContent = `${MODE_LABEL[g.mode]} · ${i + 1} of 5`;
  $('#rev-name').textContent = t.n;
  $('#rev-score').textContent = `${scoreFor(r.error)}/100`;
  $('#rev-error').textContent = fmtDeg(r.error);
  $('#rev-miss').textContent = describeMiss(r.h, r.v);
  $('#next').textContent = i === 4 ? 'See today\'s score' : 'Next place';
  const tA = toAzEl(truth), gA = toAzEl(guess);
  const f = tunnelFacts(S.origin, t);
  const layer = f.deepestKm > 5150 ? 'the inner core' : f.deepestKm > 2890 ? 'the outer core' : f.deepestKm > 35 ? 'the mantle' : 'the crust';
  $('#facts').replaceChildren(
    fact(`${fmtDeg(-tA.el)} down`, `true angle below the horizon, heading ${Math.round(tA.az)}° ${cardinal(tA.az)}`),
    fact(fmtKm(f.tunnelKm), 'straight through the Earth'),
    fact(fmtKm(f.flightKm), 'flying round the surface'),
    fact(fmtKm(f.deepestKm), `deepest point of the tunnel, in ${layer}`),
  );
  const { Radar, TiltBar } = await import('./radar.js');
  const rings = await land(f.centralAngle > 60 ? '110m' : '50m');
  const radar = new Radar($('#radar'), { origin: S.origin, target: t, targetName: t.n, trueAzEl: tA, rings });
  const bar = new TiltBar($('#bar'), { trueEl: tA.el });
  radar.guess = gA; bar.guess = gA.el;
  const draw = () => { radar.draw(); bar.draw(); };
  const sensor = S.input === 'sensor';
  $('#live-legend').textContent = sensor ? 'where you\'re pointing now' : 'drag the map and bar to explore';
  $('#sweep-tip').textContent = sensor ? 'Sweep your phone around: the map turns with you. Find the green dot and the green line on the bar.' : 'Drag around the map to turn, drag the bar to tilt, and line up with the green marks.';
  if (sensor) {
    let buzzed = false;
    const off = S.sensor.onChange(() => {
      const a = S.sensor.azEl(150);
      if (!a) return;
      radar.headingUp = Math.abs(a.el) < 80 ? a.az : radar.headingUp;
      radar.pointer = a; bar.live = a.el;
      const close = angleBetween(fromAzEl(a.az, a.el), truth) <= 5;
      if (close && !buzzed && navigator.vibrate) navigator.vibrate([40, 60, 40]);
      buzzed = close;
    });
    let raf = 0;
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    loop();
    leaveHooks.push(off, () => cancelAnimationFrame(raf));
  } else {
    radar.pointer = { ...gA }; bar.live = gA.el;
    const sweepAz = (e) => { radar.pointer.az = radar.azimuthAt(e.clientX, e.clientY); draw(); };
    const sweepEl = (e) => { radar.pointer.el = bar.elAt(e.clientY); bar.live = radar.pointer.el; draw(); };
    dragOn($('#radar'), sweepAz);
    dragOn($('#bar'), sweepEl);
    leaveHooks.push(() => { dragOff($('#radar')); dragOff($('#bar')); });
    draw();
  }
  const onResize = () => { radar.resize(); bar.resize(); draw(); };
  window.addEventListener('resize', onResize);
  leaveHooks.push(() => window.removeEventListener('resize', onResize));
  // globe
  const { Globe } = await import('./globe.js');
  S.globe ??= new Globe($('#globe'), await land('110m'));
  S.globe.resize();
  S.globe.show({ origin: S.origin, target: t, guessEnu: guess });
  S.lastShare = { origin: S.origin, target: t, guess };
  $('#ar-btn').hidden = !(sensor && navigator.mediaDevices?.getUserMedia);
  $('#ar-btn').onclick = () => openAr(truth, t.n);
}
function fact(big, small) { return el('div', { class: 'fact' }, el('b', {}, big), el('span', {}, small)); }

const drags = new WeakMap();
function dragOn(node, fn) {
  const h = {
    down: (e) => { h.active = true; node.setPointerCapture(e.pointerId); fn(e); },
    move: (e) => { if (h.active) fn(e); },
    up: () => { h.active = false; },
  };
  node.addEventListener('pointerdown', h.down); node.addEventListener('pointermove', h.move);
  node.addEventListener('pointerup', h.up); node.addEventListener('pointercancel', h.up);
  drags.set(node, h);
}
function dragOff(node) {
  const h = drags.get(node);
  if (!h) return;
  node.removeEventListener('pointerdown', h.down); node.removeEventListener('pointermove', h.move);
  node.removeEventListener('pointerup', h.up); node.removeEventListener('pointercancel', h.up);
}

$('#next').addEventListener('click', () => {
  const g = S.game;
  if (g.idx >= 5) { const m = g.mode; S.game = null; showDone(m); } else showTarget();
});

// ---------- AR ----------
let arView = null;
async function openAr(truth, name) {
  const back = current;
  show('ar');
  $('#ar-label').textContent = `Follow the green beam to ${name}`;
  const { ArView } = await import('./ar.js');
  arView = new ArView($('#ar'), { sensor: S.sensor, trueDir: truth, label: name });
  try { await arView.start(); } catch {
    $('#ar-label').textContent = 'Camera not available.';
  }
  $('#ar-close').onclick = () => { arView?.stop(); arView = null; show(back); };
}

// ---------- done ----------
function siteUrl() { const u = new URL(location.href); u.search = ''; u.hash = ''; return u.toString(); }

function showDone(mode) {
  const p = playFor(mode);
  show('done');
  const errors = p.results.map((r) => r.error);
  $('#done-total').textContent = `${totalScore(errors)}/${MAX_TOTAL}`;
  $('#done-list').replaceChildren(...p.results.map((r) => el('li', {},
    el('span', {}, `${emojiFor(r.error)} ${T(r.id).n}`), el('span', {}, `${fmtDeg(r.error)} · ${scoreFor(r.error)}`))));
  const link = `${siteUrl()}?r=${encodeResult({ day: S.day, mode, errors })}`;
  const text = shareText(puzzleNumber(S.day), p.results.map((r) => ({ name: T(r.id).n, error: r.error })), link, MODE_LABEL[mode]);
  $('#share-preview').textContent = text;
  $('#share').onclick = async () => {
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); $('#share').textContent = 'Copied!'; }
    } catch { /* cancelled */ }
  };
  const canImg = !!S.lastShare && S.globe;
  $('#share-img').hidden = !canImg;
  $('#share-img-note').hidden = !canImg || mode.startsWith('fixed');
  $('#share-img').onclick = () => shareImage(mode, totalScore(errors));
  $('#nick').value = store.nick || '';
  $('#town').value = store.town ?? '';
  if (!store.town && !mode.startsWith('fixed') && S.origin) nearestTown(S.origin).then((n) => { if (n && !$('#town').value) $('#town').placeholder = `e.g. ${n} (or leave blank)`; });
  $('#submit-msg').textContent = p.submitted ? 'Submitted ✓ (submitting again updates nothing; your first entry counts).' : '';
  $('#submit-form').onsubmit = (e) => { e.preventDefault(); submitScore(mode); };
  $('#done-practice').onclick = () => openPractice();
}

async function shareImage(mode, total) {
  const { origin, target, guess } = S.lastShare;
  S.globe.show({ origin, target, guessEnu: guess });
  const src = S.globe.renderer.domElement;
  const c = document.createElement('canvas'); c.width = 800; c.height = 900;
  const g = c.getContext('2d');
  g.fillStyle = '#0d1321'; g.fillRect(0, 0, 800, 900);
  g.drawImage(src, 50, 120, 700, 700);
  g.fillStyle = '#eef2f8'; g.font = '800 46px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText(`Pointle #${puzzleNumber(S.day)}: ${total}/${MAX_TOTAL}`, 400, 70);
  g.font = '28px system-ui, sans-serif'; g.fillStyle = '#9aa8c2';
  g.fillText(`Straight through the Earth to ${target.n}`, 400, 860);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const file = new File([blob], 'pointle.png', { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: `Pointle #${puzzleNumber(S.day)}` });
    else { const a = el('a', { href: URL.createObjectURL(blob), download: 'pointle.png' }); a.click(); }
  } catch { /* cancelled */ }
}

async function submitScore(mode) {
  const p = playFor(mode);
  const msg = $('#submit-msg');
  const n = checkName($('#nick').value);
  if (n.error) { msg.textContent = n.error; msg.className = 'msg error'; return; }
  const town = checkTown($('#town').value);
  if (town.error) { msg.textContent = town.error; msg.className = 'msg error'; return; }
  store.nick = n.value; store.town = town.value ?? ''; save();
  msg.className = 'msg'; msg.textContent = 'Submitting…';
  try {
    await api.submit({
      day: S.day, mode, device: mode.endsWith('sensor') ? 'phone' : p.device, name: n.value, town: town.value,
      targets: p.results.map((r) => r.id), errors: p.results.map((r) => r.error), durations: p.results.map((r) => r.ms),
      total: totalScore(p.results.map((r) => r.error)),
    });
    p.submitted = true; save();
    msg.textContent = 'Submitted ✓';
    boardMode = mode;
    setTimeout(() => show('board'), 600);
  } catch (err) {
    msg.className = 'msg error'; msg.textContent = err.message;
  }
}

// ---------- leaderboard ----------
let boardMode = 'sensor', boardPeriod = 'day';
function renderBoard() {
  $('#board-modes').replaceChildren(...MODES.map((m) => el('button', { class: m === boardMode ? 'on' : '', onclick: () => { boardMode = m; renderBoard(); } }, MODE_LABEL[m])));
  $$('#board-period button').forEach((b) => { b.className = b.dataset.period === boardPeriod ? 'on' : ''; });
  const sel = $('#board-group');
  const keep = sel.value;
  sel.replaceChildren(el('option', { value: '' }, 'Everyone'), ...store.groups.map((gr) => el('option', { value: gr.code }, `${gr.name} (${gr.code})`)));
  sel.value = store.groups.some((x) => x.code === keep) ? keep : '';
  loadBoard();
}
$$('#board-period button').forEach((b) => b.addEventListener('click', () => { boardPeriod = b.dataset.period; renderBoard(); }));
$('#board-group').addEventListener('change', loadBoard);

async function loadBoard() {
  const list = $('#board-list'), msg = $('#board-msg');
  list.replaceChildren();
  msg.textContent = 'Loading…';
  try {
    const b = await api.board({ mode: boardMode, period: boardPeriod, day: S.day, group: $('#board-group').value });
    msg.textContent = b.top.length ? `${b.players} player${b.players === 1 ? '' : 's'}${boardPeriod === 'week' ? ` · week of ${b.from}` : ''}` : 'No scores yet. Be the first!';
    const row = (r) => el('li', { class: r.you ? 'you' : '' },
      el('span', { class: 'rk' }, `${r.rank}.`),
      el('span', { class: 'who' }, `${r.name}${boardMode.endsWith('map') ? (r.device === 'phone' ? ' 📱' : ' 💻') : ''}`, r.town ? el('small', {}, r.town) : ''),
      el('span', { class: 'pts' }, boardPeriod === 'week' ? `${r.total} (${r.days}d)` : `${r.total}`));
    list.replaceChildren(...b.top.map(row));
    if (b.you) { list.append(el('li', { class: 'gap' }, '…')); list.append(row(b.you)); }
  } catch (err) {
    msg.textContent = `Couldn't load the leaderboard: ${err.message}`;
  }
}
$('#group-create').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const g = await api.createGroup($('#group-name').value);
    store.groups.push({ code: g.code, name: g.name }); save();
    $('#group-msg').textContent = `Created! Share the code ${g.code} with friends.`;
    renderBoard(); $('#board-group').value = g.code; loadBoard();
  } catch (err) { $('#group-msg').textContent = err.message; }
});
$('#group-join').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const g = await api.joinGroup($('#group-code').value.trim().toUpperCase());
    if (!store.groups.some((x) => x.code === g.code)) store.groups.push({ code: g.code, name: g.name });
    save();
    $('#group-msg').textContent = `Joined ${g.name}. Your scores (past and future) now show on its board.`;
    renderBoard(); $('#board-group').value = g.code; loadBoard();
  } catch (err) { $('#group-msg').textContent = err.message; }
});

// ---------- practice ----------
// Before today's game is finished, practice only offers random targets that are not today's (nor within
// 1,500 km of them), and the arrow is a short stub that never shows where it would come out.
// After finishing, everything is unlocked, including today's targets and a free-explore mode.
let prac = null;
async function openPractice() {
  if (!S.origin) { chooseOrigin(S.input || (sensorsLikelyAvailable() ? 'sensor' : 'map'), openPractice, { allowFixed: false }); return; }
  show('practice');
  const unlocked = anyDoneToday();
  const pick = $('#prac-pick');
  const opts = [el('option', { value: 'random' }, 'Random place')];
  if (unlocked) {
    S.entry.targets.forEach((id, i) => opts.push(el('option', { value: id }, `Today #${i + 1}: ${T(id).n}`)));
    opts.push(el('option', { value: 'free' }, 'Free explore: see where your arrow comes out'));
  }
  pick.replaceChildren(...opts);
  $('#prac-mode').textContent = unlocked
    ? 'Everything is unlocked now that you\'ve played today.'
    : 'Practice targets are never today\'s places. Finish today\'s game to unlock everything.';
  const sensorLive = S.sensor?.ready;
  $('#prac-sliders').hidden = !!sensorLive;
  const { Globe } = await import('./globe.js');
  prac ??= { globe: new Globe($('#prac-globe'), await land('110m')) };
  prac.globe.resize();
  prac.unlocked = unlocked;
  newPracticeTarget();
  const update = () => drawPractice(false);
  if (sensorLive) {
    const off = S.sensor.onChange(update);
    leaveHooks.push(off);
  }
  leaveHooks.push(() => prac.globe.stop());
  prac.globe.start();
}
function pracDirection() {
  if (S.sensor?.ready) return S.sensor.direction(150);
  return fromAzEl(Number($('#prac-az').value), Number($('#prac-el').value));
}
function newPracticeTarget() {
  const v = $('#prac-pick').value;
  prac.free = v === 'free';
  if (v === 'random') {
    const pool = S.targets.filter((t) => t.t <= 3 && kmBetween(S.origin, t) > 300);
    prac.target = prac.unlocked ? pool[Math.floor(Math.random() * pool.length)]
      : pickPracticeTarget(S.entry, S.targets, S.byId, Math.random, S.origin);
  } else if (!prac.free) prac.target = T(v);
  $('#prac-name').textContent = prac.free ? 'anywhere you like' : placeName(prac.target);
  $('#prac-result').textContent = '';
  prac.checked = false;
  drawPractice(true);
}
function drawPractice(face) {
  const d = pracDirection();
  if (!d) return;
  const a = toAzEl(d);
  $('#prac-az-v').textContent = `${Math.round(a.az)}°`;
  $('#prac-el-v').textContent = `${Math.round(a.el)}°`;
  $('#prac-read').textContent = `Pointing ${Math.round(a.az)}° ${cardinal(a.az)}, ${Math.abs(Math.round(a.el))}° ${a.el < 0 ? 'down' : 'up'}`;
  const stub = !prac.unlocked;
  prac.globe.show({ origin: S.origin, target: prac.free ? null : prac.target, guessEnu: d, stub, hideTarget: !prac.checked && !prac.unlocked, face });
  if (prac.free) {
    import('./geo.js').then(({ exitPoint }) => {
      const out = exitPoint(S.origin, a.az, a.el);
      if (!out) { $('#prac-result').textContent = 'Pointing at the sky: the line never comes back down.'; return; }
      let best = null, bd = Infinity;
      for (const t of S.targets) { const k = kmBetween(out, t); if (k < bd) { bd = k; best = t; } }
      $('#prac-result').textContent = `Your line comes out ${fmtKm(tunnelFacts(S.origin, out).tunnelKm)} away, ${bd < 150 ? 'at' : `${fmtKm(bd)} from`} ${placeName(best)}.`;
    });
  }
}
$('#prac-new').addEventListener('click', newPracticeTarget);
$('#prac-pick').addEventListener('change', newPracticeTarget);
$('#prac-az').addEventListener('input', () => drawPractice(false));
$('#prac-el').addEventListener('input', () => drawPractice(false));
$('#prac-check').addEventListener('click', () => {
  if (prac.free) return;
  const d = pracDirection();
  const c = compareDirections(d, trueDirection(S.origin, prac.target));
  prac.checked = true;
  drawPractice(false);
  $('#prac-result').textContent = `${fmtDeg(c.error)} off (${scoreFor(c.error)}/100): ${describeMiss(c.horizontal, c.vertical)}. Press "New target" for another.`;
});
$('#go-practice').addEventListener('click', openPractice);

// ---------- start ----------
$('#go-sensor').addEventListener('click', () => chooseOrigin('sensor', startMode('sensor')));
$('#go-map').addEventListener('click', () => chooseOrigin('map', startMode('map')));

function friendBanner() {
  const code = new URLSearchParams(location.search).get('r');
  const r = code && decodeResult(code);
  if (!r) return;
  const total = totalScore(r.errors);
  const b = $('#friend-banner');
  b.hidden = false;
  b.textContent = `A friend scored ${total}/${MAX_TOTAL} on Pointle #${puzzleNumber(r.day)} (${MODE_LABEL[r.mode]}). ${r.day === S.day ? 'Can you beat it?' : 'Try today\'s puzzle!'}`;
}

async function main() {
  fillPrivacy();
  await loadData();
  friendBanner();
  show('home');
  tickCountdown();
  setInterval(tickCountdown, 1000);
  const play = new URLSearchParams(location.search).get('play');
  if (play === 'sensor' && sensorsLikelyAvailable()) chooseOrigin('sensor', startMode('sensor'));
}
main();

// exposed for the end-to-end tests
window.__pointle = { S, store };
