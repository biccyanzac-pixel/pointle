// Pointle UI, laid out like ridd-le: a game card (home -> location -> setup -> play/reveal x3 -> done,
// plus practice), then today's leaderboard (always visible), yesterday's places and the archive.
//
// PRIVACY RULE FOR THIS FILE: the player's coordinates (S.origin) live only in memory. They are never
// written to storage, put in a URL, logged, or passed to api.js. If you add a feature, keep it that way
// (test-e2e/privacy.e2e.mjs checks every outgoing request).
import { trueDirection, toAzEl, fromAzEl, compareDirections, tunnelFacts, angleBetween, exitPoint } from './geo.js';
import { scoreFor, totalScore, describeMiss, shareText, encodeResult, decodeResult, emojiFor, MAX_TOTAL, TARGETS_PER_DAY as N } from './scoring.js';
import { dayKey, puzzleNumber, weekday, msUntilNextUtcDay, entryFor, addDays, EPOCH } from './daily.js';
import { generateDay, playableTargets, pickPracticeTarget, kmBetween, WEEKDAY_NAMES } from './rules.js';
import { SensorPointer, sensorsLikelyAvailable } from './sensors.js';
import { requestPosition, searchTowns, nearestTown } from './location.js';
import { checkName, checkTown } from './names.js';
import { Compass, TiltGauge, cardinal } from './compass.js';
import * as api from './api.js';

export const REPO_URL = 'https://github.com/biccyanzac-pixel/pointle';
const PRIVACY = 'Your precise location never leaves your phone or computer — all the maths happens on your device. If you choose to show a town on the leaderboard, only that town name is saved. Check the open-source code: ';
const MODE_LABEL = { sensor: 'Phone', map: 'Map', 'fixed-sensor': 'Fixed spot · phone', 'fixed-map': 'Fixed spot · map' };
const MODES = ['sensor', 'map', 'fixed-sensor', 'fixed-map'];

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null && k !== '') e.append(k);
  return e;
};
const fmtDeg = (d) => `${Math.round(d)}°`;
const fmtKm = (k) => `${Math.round(k).toLocaleString('en-GB')} km`;
const fmtDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' });
const isPhone = () => matchMedia('(pointer: coarse)').matches;
const scoreClass = (s, max) => (s >= max * 0.7 ? 'good' : s < max * 0.3 ? 'bad' : '');

// ---------- storage (results and preferences only; never coordinates) ----------
const STORE_KEY = 'pointle:v2';   // v2: three places a day
function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* storage blocked: play still works */ }
}
const store = load();
store.days ??= {};
store.groups ??= [];
for (const d of Object.keys(store.days)) if (d < addDays(dayKey(), -60)) delete store.days[d];

// ---------- state ----------
const S = {
  today: dayKey(),
  day: dayKey(),         // the day being played (today, or a past day from the archive)
  archive: false,
  schedule: null, targets: null, byId: null, entry: null,
  input: null,           // 'sensor' | 'map'
  fixed: false,
  origin: null,          // { lat, lon } in memory only
  originLabel: '',
  sensor: null,
  method: store.method || 'camera',
  game: null,            // { mode, ids, idx, results, shownAt }
  afterLocation: null,
};
const modeKey = () => `${S.fixed ? 'fixed-' : ''}${S.input}`;
const slot = (mode) => (S.archive ? `late:${mode}` : mode);
const playFor = (mode, day = S.day) => store.days[day]?.[slot(mode)];
const finished = (p) => p?.results?.length === N;
const anyDoneToday = () => MODES.some((m) => finished(store.days[S.today]?.[m]));

// ---------- data ----------
async function loadData() {
  const [sched, tg] = await Promise.all([
    fetch('data/schedule.json').then((r) => r.json()),
    fetch('data/targets.json').then((r) => r.json()),
  ]);
  S.schedule = sched;
  S.targets = tg.targets;
  S.byId = new Map(S.targets.map((t) => [t.id, t]));
  S.entry = entryForDay(S.day);
}
const entryForDay = (d) => entryFor(d, S.schedule, (x) => generateDay(x, S.targets));
const T = (id) => S.byId.get(id);
const placeName = (t) => (t.c && t.k !== 'nature' ? `${t.n}, ${t.c}` : t.n);
const fixedOrigin = () => T(S.entry.origin);

// ---------- screens (inside the game card) ----------
let current = 'home';
const leaveHooks = [];
function show(id, { scroll = true } = {}) {
  while (leaveHooks.length) leaveHooks.pop()();
  $$('#game .screen').forEach((s) => { s.hidden = s.id !== id; });
  current = id;
  if (id === 'home') renderHome();
  if (scroll) $('#game').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-home]')) show('home'); });
function fillPrivacy() {
  for (const p of $$('.privacy-text')) {
    p.textContent = PRIVACY;
    p.append(el('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, REPO_URL.replace('https://', '')));
  }
}
function showError(node, message, help) {
  node.hidden = !message;
  node.replaceChildren(message ?? '');
  if (help) node.append(el('span', { class: 'help' }, help));
}

// ---------- home ----------
function renderHome() {
  $('#daynum').textContent = `Pointle #${puzzleNumber(S.day)}`;
  $('#theme').textContent = WEEKDAY_NAMES[weekday(S.day)];
  $('#archive-banner').hidden = !S.archive;
  $('#archive-banner-day').textContent = `Pointle #${puzzleNumber(S.day)}, ${fmtDay(S.day)}`;
  $('#go-sensor').hidden = !sensorsLikelyAvailable();
  $('#qr-box').hidden = isPhone() || S.archive;
  if (!isPhone()) drawQr();
  const done = MODES.filter((m) => finished(playFor(m)));
  const box = $('#home-done');
  box.hidden = !done.length;
  box.replaceChildren(el('p', { class: 'eyebrow' }, S.archive ? 'Played (late)' : 'Played today'));
  for (const m of done) {
    const p = playFor(m);
    box.append(el('div', { class: 'played-row' }, el('span', {}, MODE_LABEL[m]),
      el('span', {}, `${totalScore(p.results.map((r) => r.error))}/${MAX_TOTAL} `, el('button', { type: 'button', class: 'link', onclick: () => showDone(m) }, 'result'))));
  }
  if (done.length) box.append(el('p', { class: 'hint' }, 'You can still play the other modes: each has its own leaderboard.'));
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
  $('#countdown').textContent = `Next in ${[Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':')}`;
  if (dayKey() !== S.today && !S.game) {   // midnight UTC: switch to the new puzzle unless mid-game
    S.today = dayKey();
    if (!S.archive) { S.day = S.today; S.entry = entryForDay(S.day); }
    if (current === 'home') renderHome();
    renderBoard(); renderYesterday(); renderArchiveList();
  }
}

// ---------- location ----------
function chooseOrigin(input, then, { allowFixed = true } = {}) {
  S.input = input;
  S.afterLocation = then;
  $('.fixed-name').textContent = fixedOrigin().n;
  $('#loc-fixed').hidden = !allowFixed;
  showError($('#loc-msg'), null);
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
  const btn = $('#loc-gps');
  btn.disabled = true;
  btn.querySelector('small').textContent = 'Asking your phone or browser…';
  showError($('#loc-msg'), null);
  try {
    const p = await requestPosition();
    originChosen({ lat: p.lat, lon: p.lon }, 'your location', false);
  } catch (err) {
    showError($('#loc-msg'), `${err.message} You can pick your town below instead.`, err.help);
  } finally {
    btn.disabled = false;
    btn.querySelector('small').textContent = 'City-level accuracy is plenty';
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

// ---------- compass instruments ----------
function instrument(container) {
  container.replaceChildren();
  return { compass: new Compass(container, { size: 'big' }), tilt: new TiltGauge(container) };
}
const readTilt = (elv) => (Math.abs(elv) < 0.5 ? 'level' : `${Math.abs(Math.round(elv))}° ${elv > 0 ? 'up' : 'down'}`);

// ---------- sensor setup ----------
function setupSensors() {
  show('setup');
  $$('input[name=method]').forEach((r) => { r.checked = r.value === S.method; });
  $('#calib').hidden = true;
  $('#enable-compass').hidden = false;
  showError($('#setup-msg'), null);
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
      showError($('#setup-msg'), 'Motion access was not allowed.', 'On iPhone: close and reopen the tab, tap "Enable compass" again and choose Allow. Or play on the map instead.');
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
  const inst = instrument($('#setup-instrument'));
  const stop = S.sensor.onChange((sp) => setupTick(sp, inst));
  leaveHooks.push(stop);
  setTimeout(() => {
    if (current === 'setup' && S.sensor?.kind === 'none') showError($('#setup-msg'), 'No orientation data from this device yet.', 'If nothing changes, this browser may not give compass access: try Chrome or Safari, or play on the map.');
  }, 2500);
}
$('#enable-compass').addEventListener('click', enableCompass);

function setupTick(sp, inst) {
  $('#flat-hint').hidden = !sp.needsFlat;
  const acc = sp.accuracy;
  $('#acc-hint').textContent = sp.kind === 'relative'
    ? 'This browser gives no compass direction. Try Chrome or Safari, or play on the map.'
    : acc == null ? (sp.kind === 'absolute' ? 'Compass accuracy isn’t reported on this device: calibrate anyway.' : '')
      : acc > 25 ? `⚠️ Compass accuracy is low (±${Math.round(acc)}°). Keep waving in a figure-8, away from metal and magnets.`
        : `Compass accuracy ±${Math.round(acc)}°.`;
  $('#acc-hint').className = acc > 25 ? 'hint warn' : 'hint';
  $('#decl-line').textContent = S.fixed ? '' : `Magnetic declination here: ${Math.abs(S.sensor.decl).toFixed(1)}° ${S.sensor.decl >= 0 ? 'E' : 'W'} (corrected automatically).`;
  const a = sp.azEl(150);
  if (a) {
    inst.compass.set(sp.ready && Math.abs(a.el) < 85 ? a.az : null);
    inst.tilt.set(a.el);
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
  if (finished(saved)) { showDone(mode); return; }
  if (!saved || saved.ids?.join() !== ids.join()) {
    // a different origin can swap in the reserve; keep finished targets only if the list still matches
    saved = { ids, results: [], device: isPhone() ? 'phone' : 'desktop' };
  }
  store.days[S.day] ??= {};
  store.days[S.day][slot(mode)] = saved;
  save();
  S.game = { mode, ids, results: saved.results, idx: saved.results.length };
  showTarget();
}

let mapView = null, mapCompass = null;
async function showTarget() {
  const g = S.game;
  const t = T(g.ids[g.idx]);
  show('play');
  $('#play-progress').textContent = `${MODE_LABEL[g.mode]} · place ${g.idx + 1} of ${N} · from ${S.originLabel}`;
  $('#target-name').textContent = t.n;
  $('#target-country').textContent = t.c || '';
  g.shownAt = Date.now();
  const sensor = S.input === 'sensor';
  $('#sensor-read').hidden = !sensor;
  $('#map-wrap').hidden = sensor;
  $('#heading-ctl').hidden = sensor;
  if (sensor) {
    const inst = instrument($('#play-instrument'));
    const off = S.sensor.onChange(() => {
      const a = S.sensor.azEl(150);
      if (!a) return;
      const vertical = Math.abs(a.el) > 85;
      inst.compass.set(vertical ? null : a.az);
      inst.tilt.set(a.el);
      $('#read-heading').textContent = vertical ? (a.el > 0 ? 'straight up' : 'straight down') : `${Math.round(a.az)}° ${cardinal(a.az)}`;
      $('#read-tilt').textContent = readTilt(a.el);
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
      $('#map-compass').replaceChildren();
      mapCompass = new Compass($('#map-compass'), { size: 'small' });
      mapView = new MapView($('#map-wrap'), S.origin, {
        onChange: (az, elv) => {
          mapCompass.set(az);
          $('#map-readout').textContent = `${Math.round(az)}° ${cardinal(az)} · ${readTilt(elv)}`;
          $('#tilt').value = elv;
          $('#heading').value = az;
        },
      });
    }
    mapView.setDirection(Math.random() * 360, -20 + (Math.random() - 0.5) * 10); // no hint from the start pose
    requestAnimationFrame(() => mapView.resize());
  }
}
$('#tilt').addEventListener('input', (e) => mapView?.setDirection(mapView.az, Number(e.target.value)));
$('#heading').addEventListener('input', (e) => mapView?.setDirection(Number(e.target.value), mapView.el));

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
const landCache = {};
function land(res) {
  landCache[res] ??= fetch(`data/land-${res}.json`).then((r) => r.json()).then((d) => d.rings);
  return landCache[res];
}

async function showReveal(i, guess, truth) {
  const g = S.game;
  const r = g.results[i];
  const t = T(r.id);
  show('reveal');
  $('#rev-progress').textContent = `${MODE_LABEL[g.mode]} · place ${i + 1} of ${N}`;
  $('#rev-name').textContent = placeName(t);
  const pts = scoreFor(r.error);
  $('#rev-score').textContent = `${pts}`;
  $('#rev-score').className = `score ${scoreClass(pts, 100)}`;
  $('#rev-error').textContent = fmtDeg(r.error);
  $('#rev-miss').textContent = describeMiss(r.h, r.v);
  $('#next').textContent = i === N - 1 ? 'See your score' : 'Next place';
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
  // globe: true line (green) and your guess (white) stay put; the red arrow follows you live
  const { Globe } = await import('./globe.js');
  S.globe ??= new Globe($('#globe'), await land('110m'));
  S.globe.resize();
  S.globe.show({ origin: S.origin, target: t, guessEnu: guess, guessColour: '--ink' });
  S.lastShare = { origin: S.origin, target: t, guess };
  let globeDirty = false, lastLive = null;
  const setLive = (dir) => { lastLive = dir; globeDirty = true; };
  const draw = () => {
    radar.draw(); bar.draw();
    if (globeDirty) { S.globe.setLive(lastLive); globeDirty = false; }
  };
  const sensor = S.input === 'sensor';
  $('#live-legend').textContent = sensor ? 'where you’re pointing now' : 'drag the map and bar to explore';
  $('#sweep-tip').textContent = sensor
    ? 'Sweep your phone around: the map turns with you and the red arrow on the globe follows. Find the green dot and the green line on the bar.'
    : 'Drag around the map to turn, drag the bar to tilt: the red arrow on the globe follows. Line up with the green marks.';
  if (sensor) {
    let buzzed = false;
    const off = S.sensor.onChange(() => {
      const a = S.sensor.azEl(150);
      if (!a) return;
      radar.headingUp = Math.abs(a.el) < 80 ? a.az : radar.headingUp;
      radar.pointer = a; bar.live = a.el;
      setLive(fromAzEl(a.az, a.el));
      const close = angleBetween(fromAzEl(a.az, a.el), truth) <= 5;
      if (close && !buzzed && navigator.vibrate) navigator.vibrate([40, 60, 40]);
      buzzed = close;
    });
    let raf = 0, lastDraw = 0;
    const loop = (now) => { if (now - lastDraw > 33) { draw(); lastDraw = now; } raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    leaveHooks.push(off, () => cancelAnimationFrame(raf));
  } else {
    radar.pointer = { ...gA }; bar.live = gA.el;
    setLive(guess);
    const sweepAz = (e) => { radar.pointer.az = radar.azimuthAt(e.clientX, e.clientY); setLive(fromAzEl(radar.pointer.az, radar.pointer.el)); draw(); };
    const sweepEl = (e) => { radar.pointer.el = bar.elAt(e.clientY); bar.live = radar.pointer.el; setLive(fromAzEl(radar.pointer.az, radar.pointer.el)); draw(); };
    dragOn($('#radar'), sweepAz);
    dragOn($('#bar'), sweepEl);
    leaveHooks.push(() => { dragOff($('#radar')); dragOff($('#bar')); });
    draw();
  }
  const onResize = () => { radar.resize(); bar.resize(); S.globe.resize(); globeDirty = true; draw(); };
  window.addEventListener('resize', onResize);
  leaveHooks.push(() => window.removeEventListener('resize', onResize));
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
  if (g.idx >= N) { const m = g.mode; S.game = null; showDone(m); } else showTarget();
});

// ---------- AR ----------
let arView = null;
async function openAr(truth, name) {
  $('#ar').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#ar-label').textContent = `Follow the yellow arrow and the green beam to ${name}`;
  $('#ar-hint').textContent = '';
  const { ArView } = await import('./ar.js');
  arView = new ArView($('#ar'), { sensor: S.sensor, trueDir: truth, label: name, onHint: (h) => { $('#ar-hint').textContent = h; } });
  try { await arView.start(); } catch {
    $('#ar-label').textContent = 'Camera not available.';
  }
}
$('#ar-close').addEventListener('click', () => {
  arView?.stop(); arView = null;
  $('#ar').hidden = true;
  document.body.style.overflow = '';
});

// ---------- done ----------
function siteUrl() { const u = new URL(location.href); u.search = ''; u.hash = ''; return u.toString(); }

function showDone(mode) {
  const p = playFor(mode);
  show('done');
  const errors = p.results.map((r) => r.error);
  const total = totalScore(errors);
  $('#done-caption').textContent = `${S.archive ? `Pointle #${puzzleNumber(S.day)} (late)` : 'Today’s score'} · ${MODE_LABEL[mode]}`;
  $('#done-total').textContent = `${total}`;
  $('#done-total').className = `score ${scoreClass(total, MAX_TOTAL)}`;
  $('#done-list').replaceChildren(...p.results.map((r) => el('li', { class: 'attempt-row' },
    el('span', {}, `${emojiFor(r.error)} ${T(r.id).n}`),
    el('span', { class: `attempt-score ${scoreClass(scoreFor(r.error), 100)}` }, `${fmtDeg(r.error)} · ${scoreFor(r.error)}`))));
  const link = `${siteUrl()}?r=${encodeResult({ day: S.day, mode, errors })}`;
  const text = shareText(puzzleNumber(S.day), p.results.map((r) => ({ name: T(r.id).n, error: r.error })), link, MODE_LABEL[mode]);
  $('#share-preview').textContent = text;
  $('#share').onclick = async () => {
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); $('#share').textContent = 'Copied!'; }
    } catch { /* cancelled */ }
  };
  const canImg = !!S.lastShare && !!S.globe;
  $('#share-img').hidden = !canImg;
  $('#share-img-note').hidden = !canImg || mode.startsWith('fixed');
  $('#share-img').onclick = () => shareImage(total);
  $('#nick').value = store.nick || '';
  $('#town').value = store.town ?? '';
  if (!store.town && !mode.startsWith('fixed') && S.origin) nearestTown(S.origin).then((n) => { if (n && !$('#town').value) $('#town').placeholder = `e.g. ${n} (or leave blank)`; });
  $('#submit-form').hidden = !!p.submitted;
  $('#submitted-note').hidden = !p.submitted;
  $('#submitted-note').textContent = 'Submitted to the leaderboard ✓';
  showError($('#submit-msg'), null);
  $('#submit-form').onsubmit = (e) => { e.preventDefault(); submitScore(mode); };
  $('#done-practice').onclick = () => openPractice();
  boardMode = mode;
  renderBoard();
}

async function shareImage(total) {
  const { origin, target, guess } = S.lastShare;
  S.globe.show({ origin, target, guessEnu: guess, guessColour: '--ink' });
  S.globe.setLive(null);
  const src = S.globe.renderer.domElement;
  const c = document.createElement('canvas'); c.width = 800; c.height = 900;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0c10'; g.fillRect(0, 0, 800, 900);
  g.drawImage(src, 50, 120, 700, 700);
  g.fillStyle = '#edeef2'; g.font = '800 46px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText(`Pointle #${puzzleNumber(S.day)}: ${total}/${MAX_TOTAL}`, 400, 70);
  g.font = '28px system-ui, sans-serif'; g.fillStyle = '#9aa0ae';
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
  if (n.error) { showError(msg, n.error); return; }
  const town = checkTown($('#town').value);
  if (town.error) { showError(msg, town.error); return; }
  store.nick = n.value; store.town = town.value ?? ''; save();
  showError(msg, null);
  $('#submit-btn').disabled = true;
  try {
    await api.submit({
      day: S.day, archive: S.archive, mode, device: mode.endsWith('sensor') ? 'phone' : p.device, name: n.value, town: town.value,
      targets: p.results.map((r) => r.id), errors: p.results.map((r) => r.error), durations: p.results.map((r) => r.ms),
      total: totalScore(p.results.map((r) => r.error)),
    });
    p.submitted = true; save();
    $('#submit-form').hidden = true;
    $('#submitted-note').hidden = false;
    boardMode = mode;
    boardLate = S.archive && S.day !== S.today;
    await renderBoard();
    $('#board').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError(msg, err.message);
  } finally {
    $('#submit-btn').disabled = false;
  }
}

// ---------- leaderboard (always visible) ----------
let boardMode = 'sensor', boardPeriod = 'day', boardLate = false;
function rowNode(r, mode, period) {
  return el('li', { class: `row${r.you ? ' me' : ''}` },
    el('span', { class: 'row-rank' }, String(r.rank)),
    el('span', { class: 'row-main' },
      el('span', { class: 'row-name' }, `${r.name}${mode.endsWith('map') ? (r.device === 'phone' ? ' 📱' : ' 💻') : ''}`),
      r.town || period === 'week' ? el('span', { class: 'row-sub' }, [r.town, period === 'week' ? `${r.days} day${r.days === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')) : ''),
    el('span', { class: 'row-score' }, String(r.total)));
}
async function renderBoard() {
  const past = S.day !== S.today;
  $('#board-title').textContent = past ? `Pointle #${puzzleNumber(S.day)} leaderboard` : 'Today’s leaderboard';
  $('#board-modes').replaceChildren(...MODES.map((m) => el('button', { type: 'button', role: 'tab', class: m === boardMode ? 'on' : '', onclick: () => { boardMode = m; renderBoard(); } }, MODE_LABEL[m])));
  const periods = past ? [['day', false, 'That day'], ['day', true, 'Late (archive)']] : [['day', false, 'Today'], ['week', false, 'This week']];
  if (past && boardPeriod === 'week') boardPeriod = 'day';
  if (!past) boardLate = false;
  $('#board-period').replaceChildren(...periods.map(([p, late, label]) => el('button', {
    type: 'button', role: 'tab', class: p === boardPeriod && late === boardLate ? 'on' : '',
    onclick: () => { boardPeriod = p; boardLate = late; renderBoard(); },
  }, label)));
  const sel = $('#board-group');
  const keep = sel.value;
  sel.replaceChildren(el('option', { value: '' }, 'Everyone'), ...store.groups.map((gr) => el('option', { value: gr.code }, `${gr.name} (${gr.code})`)));
  sel.value = store.groups.some((x) => x.code === keep) ? keep : '';
  const list = $('#rows');
  try {
    const b = await api.board({ mode: boardMode, period: boardPeriod, day: S.day, group: sel.value, late: boardLate });
    $('#players').textContent = b.players ? `${b.players} player${b.players === 1 ? '' : 's'}` : '';
    list.replaceChildren(...b.top.map((r) => rowNode(r, boardMode, boardPeriod)));
    if (b.you) list.append(el('li', { class: 'row-gap' }, '···'), rowNode(b.you, boardMode, boardPeriod));
    $('#board-empty').hidden = b.top.length > 0;
    $('#board-empty').textContent = boardLate ? 'Nobody has replayed this day yet.' : `Nobody has played ${MODE_LABEL[boardMode].toLowerCase()} mode ${past ? 'that day' : boardPeriod === 'week' ? 'this week' : 'yet today'}. Be the first.`;
  } catch (err) {
    list.replaceChildren();
    $('#board-empty').hidden = false;
    $('#board-empty').textContent = `Couldn't load the leaderboard: ${err.message}`;
  }
}
$('#board-group').addEventListener('change', renderBoard);
$('#group-create').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const g = await api.createGroup($('#group-name').value);
    store.groups.push({ code: g.code, name: g.name }); save();
    $('#group-msg').textContent = `Created! Share the code ${g.code} with friends.`;
    $('#board-group').append(el('option', { value: g.code }, `${g.name} (${g.code})`));
    $('#board-group').value = g.code; renderBoard();
  } catch (err) { $('#group-msg').textContent = err.message; }
});
$('#group-join').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const g = await api.joinGroup($('#group-code').value.trim().toUpperCase());
    if (!store.groups.some((x) => x.code === g.code)) store.groups.push({ code: g.code, name: g.name });
    save();
    $('#group-msg').textContent = `Joined ${g.name}. Your scores (past and future) now show on its board.`;
    $('#board-group').append(el('option', { value: g.code }, `${g.name} (${g.code})`));
    $('#board-group').value = g.code; renderBoard();
  } catch (err) { $('#group-msg').textContent = err.message; }
});

// ---------- yesterday ----------
async function renderYesterday() {
  const y = addDays(S.today, -1);
  const card = $('#yesterday');
  if (y < EPOCH) { card.hidden = true; return; }
  card.hidden = false;
  const e = entryForDay(y);
  $('#yesterday-places').textContent = `Pointle #${puzzleNumber(y)}: ${e.targets.map((id) => T(id).n).join(' · ')} (fixed spot: ${T(e.origin).n})`;
  const rows = $('#yesterday-rows');
  rows.replaceChildren();
  const boards = await Promise.all(MODES.map((m) => api.board({ mode: m, period: 'day', day: y }).catch(() => null)));
  boards.forEach((b, i) => {
    if (!b?.top?.length) return;
    rows.append(el('li', { class: 'yesterday-row' }, el('span', { class: 'yesterday-score' }, String(b.top[0].total)),
      el('span', {}, `🏆 ${b.top[0].name}`), el('span', { class: 'yesterday-mode' }, `${MODE_LABEL[MODES[i]]} · ${b.players} played`)));
  });
  if (!rows.childElementCount) rows.append(el('li', { class: 'yesterday-row' }, el('span', {}, 'Nobody played yesterday.')));
}

// ---------- archive ----------
function renderArchiveList() {
  const list = $('#archive-list');
  list.replaceChildren();
  const days = [];
  for (let d = addDays(S.today, -1); d >= EPOCH; d = addDays(d, -1)) days.push(d);
  if (!days.length) { list.append(el('li', { class: 'archive-list-empty' }, 'No past days yet: the archive starts tomorrow.')); return; }
  for (const d of days) {
    const e = entryForDay(d);
    list.append(el('li', {}, el('button', { type: 'button', class: 'archive-list-item', onclick: () => openArchiveDay(d) },
      el('span', { class: 'archive-list-day' }, `Pointle #${puzzleNumber(d)} — ${fmtDay(d)}`),
      el('span', { class: 'archive-list-prompt' }, `${WEEKDAY_NAMES[weekday(d)]} · ${e.targets.length} places`))));
  }
}
$('#archive-browse').addEventListener('click', () => {
  const list = $('#archive-list');
  list.hidden = !list.hidden;
  if (!list.hidden) renderArchiveList();
});
function openArchiveDay(d) {
  S.archive = true; S.day = d; S.entry = entryForDay(d); S.game = null;
  $('#archive-list').hidden = true;
  boardLate = false; boardPeriod = 'day';
  show('home');
  renderBoard();
}
$('#archive-exit').addEventListener('click', () => {
  S.archive = false; S.day = S.today; S.entry = entryForDay(S.day); S.game = null;
  boardLate = false;
  show('home');
  renderBoard();
});

// ---------- practice ----------
// Before today's game is finished, practice only offers random places that are not today's (nor within
// 1,500 km of them), and the arrow is a short stub that never shows where it would come out.
// After finishing, everything is unlocked, including today's places and a free-explore mode.
let prac = null;
async function openPractice() {
  if (!S.origin) { chooseOrigin(S.input || (sensorsLikelyAvailable() ? 'sensor' : 'map'), openPractice, { allowFixed: false }); return; }
  show('practice');
  const unlocked = anyDoneToday();
  const today = entryForDay(S.today);
  const pick = $('#prac-pick');
  const opts = [el('option', { value: 'random' }, 'Random place')];
  if (unlocked) {
    today.targets.forEach((id, i) => opts.push(el('option', { value: id }, `Today #${i + 1}: ${T(id).n}`)));
    opts.push(el('option', { value: 'free' }, 'Free explore: see where your arrow comes out'));
  }
  pick.replaceChildren(...opts);
  $('#prac-mode').textContent = unlocked
    ? 'Everything is unlocked now that you’ve played today.'
    : 'Practice places are never today’s. Finish today’s game to unlock everything.';
  const sensorLive = S.sensor?.ready;
  $('#prac-sliders').hidden = !!sensorLive;
  if (!prac) {
    const [{ Globe }, rings] = await Promise.all([import('./globe.js'), land('110m')]);
    prac = { globe: new Globe($('#prac-globe'), rings) };
  }
  prac.globe.resize();
  prac.unlocked = unlocked;
  prac.entry = today;
  newPracticeTarget();
  if (sensorLive) leaveHooks.push(S.sensor.onChange(() => drawPractice(false)));
}
function pracDirection() {
  if (S.sensor?.ready) return S.sensor.direction(150);
  return fromAzEl(Number($('#prac-az').value), Number($('#prac-el').value));
}
function newPracticeTarget() {
  if (!prac) return;
  const v = $('#prac-pick').value;
  prac.free = v === 'free';
  if (v === 'random') {
    const pool = S.targets.filter((t) => t.t <= 3 && kmBetween(S.origin, t) > 300);
    prac.target = prac.unlocked ? pool[Math.floor(Math.random() * pool.length)]
      : pickPracticeTarget(prac.entry, S.targets, S.byId, Math.random, S.origin);
  } else if (!prac.free) prac.target = T(v);
  $('#prac-name').textContent = prac.free ? 'anywhere you like' : placeName(prac.target);
  $('#prac-result').hidden = true;
  prac.checked = false;
  drawPractice(true);
}
function drawPractice(face) {
  if (!prac) return;
  const d = pracDirection();
  if (!d) return;
  const a = toAzEl(d);
  $('#prac-az-v').textContent = `${Math.round(a.az)}°`;
  $('#prac-el-v').textContent = `${Math.round(a.el)}°`;
  $('#prac-read').textContent = `Pointing ${Math.round(a.az)}° ${cardinal(a.az)}, ${readTilt(a.el)}`;
  prac.globe.show({ origin: S.origin, target: prac.free ? null : prac.target, guessEnu: d, stub: !prac.unlocked, hideTarget: !prac.checked && !prac.unlocked, face });
  if (prac.free) {
    const out = exitPoint(S.origin, a.az, a.el);
    const res = $('#prac-result');
    res.hidden = false;
    if (!out) { res.textContent = 'Pointing at the sky: the line never comes back down.'; return; }
    let best = null, bd = Infinity;
    for (const t of S.targets) { const k = kmBetween(out, t); if (k < bd) { bd = k; best = t; } }
    res.textContent = `Your line comes out ${fmtKm(tunnelFacts(S.origin, out).tunnelKm)} away, ${bd < 150 ? 'at' : `${fmtKm(bd)} from`} ${placeName(best)}.`;
  }
}
$('#prac-new').addEventListener('click', newPracticeTarget);
$('#prac-pick').addEventListener('change', newPracticeTarget);
$('#prac-az').addEventListener('input', () => drawPractice(false));
$('#prac-el').addEventListener('input', () => drawPractice(false));
$('#prac-check').addEventListener('click', () => {
  if (!prac?.target || prac.free) return;
  const d = pracDirection();
  const c = compareDirections(d, trueDirection(S.origin, prac.target));
  prac.checked = true;
  drawPractice(false);
  $('#prac-result').hidden = false;
  $('#prac-result').textContent = `${fmtDeg(c.error)} off (${scoreFor(c.error)}/100): ${describeMiss(c.horizontal, c.vertical)}. Press "New place" for another.`;
});
$('#go-practice').addEventListener('click', openPractice);

// ---------- start ----------
$('#go-sensor').addEventListener('click', () => chooseOrigin('sensor', startMode('sensor')));
$('#go-map').addEventListener('click', () => chooseOrigin('map', startMode('map')));

function friendBanner() {
  const code = new URLSearchParams(location.search).get('r');
  const r = code && decodeResult(code);
  if (!r) return;
  const b = $('#friend-banner');
  b.hidden = false;
  b.textContent = `A friend scored ${totalScore(r.errors)}/${MAX_TOTAL} on Pointle #${puzzleNumber(r.day)} (${MODE_LABEL[r.mode]}). ${r.day === S.today ? 'Can you beat it?' : 'Try today’s places!'}`;
}

async function main() {
  fillPrivacy();
  await loadData();
  friendBanner();
  show('home', { scroll: false });
  tickCountdown();
  setInterval(tickCountdown, 1000);
  renderBoard();
  renderYesterday();
  const play = new URLSearchParams(location.search).get('play');
  if (play === 'sensor' && sensorsLikelyAvailable()) chooseOrigin('sensor', startMode('sensor'));
}
main();

// exposed for the end-to-end tests
window.__pointle = { S, store, mapView: () => mapView };
