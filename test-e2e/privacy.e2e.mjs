// Browser end-to-end test + the privacy guarantee check.
//
//   node tools/serve.mjs 8080            (site)
//   cd worker && npm run dev:local       (leaderboard on :8799, after npm run db:init:local)
//   cd ../jacob.gg/worker && npm run dev:local   (hub on :8831, ratings)
//   node test-e2e/privacy.e2e.mjs [siteUrl] [apiUrl] [hubUrl]
//
// Plays a full map-mode game (including grabbing and dragging the 3D arrow) and a full sensor-mode game
// (synthetic orientation events on an emulated phone) with a mocked GPS position, submits both to the
// leaderboard, checks the always-visible board, practice gating and the archive card, and records EVERY
// request the page makes. Fails if any URL, header or body contains the coordinates (in any common
// rounding), or if any request goes somewhere unexpected. Map imagery tiles are the one documented
// location-related request: they must be at zoom <= 9 (about 50 km tiles) and contain no coordinates.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SITE = process.argv[2] || 'http://localhost:8080/';
const API = process.argv[3] || 'http://127.0.0.1:8799';
const HUB = process.argv[4] || 'http://127.0.0.1:8831';   // jacob.gg hub worker (ratings), run from the jacob.gg repo
const POS = { latitude: 53.80076, longitude: -1.54908 };   // Leeds, as a mock GPS fix
const N = 3;
const shotDir = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(shotDir, { recursive: true });
const shot = (page, name, fullPage = true) => page.screenshot({ path: `${shotDir}${name}.png`, fullPage });

const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);

// Every way the coordinates might be written: 53.80, 53.801, -1.549, 1.5491 ...
function coordinatePatterns({ latitude, longitude }) {
  const pats = new Set();
  for (const v of [latitude, longitude]) {
    for (const dp of [2, 3, 4, 5]) pats.add(Math.abs(v).toFixed(dp));
    pats.add(String(Math.abs(v)));
  }
  return [...pats];
}
const PATTERNS = coordinatePatterns(POS);

const requests = [];
function record(page, label) {
  page.on('request', (req) => {
    requests.push({ label, url: req.url(), method: req.method(), headers: req.headers(), body: req.postData() || '' });
  });
}

function checkPrivacy() {
  const problems = [];
  const site = new URL(SITE);
  const api = new URL(API);
  for (const r of requests) {
    const u = new URL(r.url);
    if (u.protocol === 'data:' || u.protocol === 'blob:') continue;
    const hay = `${decodeURIComponent(r.url)}\n${JSON.stringify(r.headers)}\n${r.body}`;
    for (const p of PATTERNS) if (hay.includes(p)) problems.push(`${r.label}: "${p}" in ${r.method} ${r.url} ${r.body.slice(0, 200)}`);
    if (/53\.8\D[^]*1\.5/.test(hay) || /"(lat|lon|lng|latitude|longitude)"\s*:/.test(r.body)) problems.push(`${r.label}: coordinate-like data in ${r.url} ${r.body.slice(0, 200)}`);
    if (u.host === site.host) continue;                       // the static site itself
    if (u.host === api.host) {                                // leaderboard
      if (!/^\/api\/(session|submit|board|group\/(create|join))$/.test(u.pathname)) problems.push(`unexpected API path ${u.pathname}`);
      continue;
    }
    if (u.host === new URL(HUB).host) {                       // jacob.gg hub: ratings only
      if (!/^\/api\/(rate|rating)$/.test(u.pathname)) problems.push(`unexpected hub path ${u.pathname}`);
      continue;
    }
    if (u.host === 'biccyanzac-pixel.github.io' && /^\/jacob\.gg\/kit\/jgg\.(js|css)$/.test(u.pathname)) continue;   // shared kit
    if (u.host === 'tiles.maps.eox.at') {                     // documented map imagery
      const m = u.pathname.match(/\/g\/(\d+)\/(\d+)\/(\d+)\.jpg$/);
      if (!m) problems.push(`unexpected imagery URL ${r.url}`);
      else if (Number(m[1]) > 9) problems.push(`imagery zoom ${m[1]} too detailed: ${r.url}`);
      continue;
    }
    problems.push(`request to unexpected host: ${r.url}`);
  }
  return problems;
}

// Self-test: the detector must catch leaks in the forms a bug would produce.
for (const leak of [
  { url: `${API}/api/submit`, body: JSON.stringify({ lat: 53.8008, lon: -1.5491 }) },
  { url: `${API}/api/board?mode=map&near=53.80,-1.55`, body: '' },
  { url: 'https://example.com/pixel.gif', body: '' },
  { url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/15/10000/16000.jpg', body: '' },
]) {
  requests.push({ label: 'self-test', method: 'POST', headers: {}, ...leak });
  assert.ok(checkPrivacy().length > 0, `detector missed ${leak.url} ${leak.body}`);
  requests.length = 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (page, sel) => page.waitForSelector(`${sel}:not([hidden])`);

async function boardShows(page, text) {
  await page.waitForFunction((t) => document.querySelector('#rows').textContent.includes(t), text, { timeout: 10000 });
}

async function playMap(page) {
  await page.click('#mode-map');
  await page.click('#from-gps');
  await page.waitForSelector('#start-play:not([disabled])');
  assert.match(await page.textContent('#start-play'), /Start · map · (my location|near )/, 'the Start button says what was chosen');
  await page.click('#start-play');
  for (let i = 0; i < N; i++) {
    await page.waitForSelector('#play:not([hidden]) .map-canvas');
    await page.waitForTimeout(300);
    if (i === 0) {
      // grab the arrow's tip and drag it: the direction must follow
      const before = await page.evaluate(() => { const m = window.__pointle.mapView(); return { az: m.az, el: m.el }; });
      const tip = await page.evaluate(() => window.__pointle.mapView().tipScreen());
      await page.mouse.move(tip.x, tip.y);
      await page.mouse.down();
      await page.mouse.move(tip.x + 60, tip.y + 90, { steps: 8 });
      await page.mouse.up();
      const after = await page.evaluate(() => { const m = window.__pointle.mapView(); return { az: m.az, el: m.el }; });
      assert.ok(Math.abs(after.az - before.az) > 2 || Math.abs(after.el - before.el) > 2, `dragging the arrow moved it (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);
      // the heading slider and compass follow
      const slider = Number(await page.inputValue('#heading'));
      assert.ok(Math.abs(slider - after.az) < 1, 'heading slider follows the arrow');
      await shot(page, 'map-play', false);
    } else {
      await page.locator('#heading').fill(String(40 + i * 70));
    }
    await page.locator('#tilt').fill(String(-10 - i * 15));
    await sleep(2100);   // the server rejects games faster than 6 s in total
    await page.click('#lock');
    await visible(page, '#reveal');
    await page.waitForTimeout(700);
    if (i === 0) {
      // globe zoom: starts fully out (zoom-out disabled), + zooms in, the wheel can't go past the default
      const dist = () => page.evaluate(() => window.__pointle.S.globe.dist);
      const d0 = await dist();
      assert.ok(await page.isDisabled('#reveal .globe-zoom button[aria-label="Zoom out"]'), 'cannot zoom out past the default');
      await page.click('#reveal .globe-zoom button[aria-label="Zoom in"]');
      assert.ok((await dist()) < d0, 'zoom in works');
      const g = await page.locator('#globe').boundingBox();
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      for (let k = 0; k < 10; k++) await page.mouse.wheel(0, 400);
      assert.ok(Math.abs((await dist()) - d0) < 1e-6, 'wheel zoom-out stops at the default size');
      await page.click('#reveal .globe-zoom button[aria-label="Zoom in"]');
      // click a spot on the globe: the red arrow aims there; dragging the globe only spins it
      const live = () => page.evaluate(() => JSON.stringify(window.__pointle.S.globe.lastLive?.[0] ?? null));
      const before = await live();
      await page.mouse.click(g.x + g.width * 0.6, g.y + g.height * 0.45);
      const aimed = await live();
      assert.notEqual(aimed, before, 'clicking the globe moves the red arrow');
      await page.mouse.move(g.x + g.width * 0.5, g.y + g.height * 0.5);
      await page.mouse.down(); await page.mouse.move(g.x + g.width * 0.7, g.y + g.height * 0.6, { steps: 5 }); await page.mouse.up();
      assert.equal(await live(), aimed, 'dragging the globe spins it without moving the arrow');
      await shot(page, 'map-reveal');
    }
    const rb = await page.locator('#radar').boundingBox();
    await page.mouse.click(rb.x + rb.width * 0.8, rb.y + rb.height * 0.3);   // sweep: live arrow on the globe
    await page.click('#next');
  }
  await visible(page, '#done');
  await page.fill('#nick', 'E2E map');
  assert.match(await page.textContent('#town-line'), /Leeds/, 'the nearest town (found on the device) is what the board will show');
  await page.click('#submit-btn');
  await visible(page, '#submitted-note');
  await boardShows(page, 'E2E map');
  const board = await page.textContent('#rows');
  assert.match(board, /Leeds/);
  // jacob.gg rating box: choose stars and send (keyboard: the page is still scrolling to the board)
  await page.waitForSelector('#rate .jgg-rate');
  await page.focus('#rate .jgg-stars');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await page.click('#rate .jgg-rate-send');
  await page.waitForFunction(() => document.querySelector('#rate .jgg-rate-note').textContent.startsWith('Thanks'));
  await shot(page, 'map-done');
}

async function playSensor(page) {
  // Feed a steady stream of absolute orientation readings that point the camera at a chosen direction.
  await page.evaluate(() => {
    window.__orient = { alpha: 30, beta: 70, gamma: 0 };
    setInterval(() => {
      const e = new Event('deviceorientationabsolute');
      Object.assign(e, window.__orient, { absolute: true });
      window.dispatchEvent(e);
    }, 40);
  });
  await page.click('#mode-phone');
  await page.click('#from-gps');
  await page.waitForSelector('#start-play:not([disabled])');
  await page.click('#start-play');
  await visible(page, '#setup');
  await page.click('#enable-compass');
  await page.waitForSelector('#start-sensor:not([disabled])');
  await shot(page, 'sensor-setup');
  await page.click('#start-sensor');
  for (let i = 0; i < N; i++) {
    await visible(page, '#play');
    await page.evaluate((k) => { window.__orient = { alpha: 40 * k, beta: 60 + k * 5, gamma: 0 }; }, i);
    await sleep(2100);
    assert.match(await page.textContent('#read-heading'), /\d+°|straight/);
    assert.ok(await page.isVisible('#play-instrument svg.compass'), 'compass dial on screen');
    const heading = await page.textContent('#play h2');
    const where = await page.evaluate(() => { const { S } = window.__pointle; const t = S.byId.get(S.game.ids[S.game.idx]); return t.c; });
    if (where) assert.ok(heading.includes(where), `heading "${heading}" names the country ${where}`);
    if (i === 0) await shot(page, 'sensor-play', false);
    await page.click('#lock');
    await visible(page, '#reveal');
    // move the phone: the live arrow on the globe follows
    await page.evaluate(() => { window.__orient = { alpha: 200, beta: 40, gamma: 0 }; });
    await page.waitForTimeout(500);
    if (i === 0) await shot(page, 'sensor-reveal');
    await page.click('#next');
  }
  await visible(page, '#done');
  // the name was given before (seeded below), so the score goes on the board without a click
  await visible(page, '#submitted-note');
  await boardShows(page, 'E2E phone');
  await shot(page, 'sensor-done');
  // practice is unlocked after finishing
  await page.click('#done [data-home]');
  await page.click('#go-practice');
  await visible(page, '#practice');
  const opts = await page.$$eval('#prac-pick option', (o) => o.map((x) => x.value));
  assert.ok(opts.includes('free'), 'practice unlocked after playing');
  await page.selectOption('#prac-pick', 'free');
  await page.waitForTimeout(500);
  await shot(page, 'practice-free');
}

async function practiceBeforePlaying(page) {
  await page.click('#go-practice');
  await page.click('#loc-gps');
  await visible(page, '#practice');
  const opts = await page.$$eval('#prac-pick option', (o) => o.map((x) => x.value));
  assert.deepEqual(opts, ['random'], 'before playing, practice offers random places only');
  await page.waitForSelector('#practice .map-canvas');
  assert.ok(await page.isVisible('#practice #heading'), 'practice uses the same arrow, compass and sliders as guessing');
  await page.locator('#heading').fill('123');
  assert.match(await page.textContent('#prac-read'), /^123°/);
  const today = await page.evaluate(() => { const { S } = window.__pointle; return [...S.entry.targets, S.entry.reserve].map((id) => S.byId.get(id).n); });
  for (let k = 0; k < 10; k++) {
    const name = await page.textContent('#prac-name');
    assert.ok(!today.some((t) => name.startsWith(t)), `practice place ${name} is one of today's`);
    await page.click('#prac-new');
  }
  await page.click('#prac-check');
  await shot(page, 'practice-before');
  await page.click('#practice [data-home]');
}

const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pageErrors = [];
try {
  // desktop: map mode + practice gate
  const desk = await browser.newContext({ geolocation: POS, permissions: ['geolocation'], viewport: { width: 1200, height: 900 } });
  const p1 = await desk.newPage();
  record(p1, 'desktop');
  p1.on('pageerror', (e) => pageErrors.push(`desktop: ${e.message}`));
  await p1.goto(`${SITE}?api=${encodeURIComponent(API)}&hub=${encodeURIComponent(HUB)}`);
  await visible(p1, '#home');
  await p1.waitForFunction(() => /Pointle #\d/.test(document.querySelector('#daynum').textContent));
  assert.ok(await p1.isVisible('#qr-box'), 'desktop shows the QR code');
  assert.ok(await p1.isDisabled('#mode-phone'), 'desktop cannot choose phone mode (the QR code is in its card)');
  assert.ok(await p1.isDisabled('#start-play'), 'Start waits until both choices are made');
  assert.equal(await p1.getAttribute('#mode-map', 'aria-checked'), 'true', 'map is preselected on desktop');
  assert.ok(await p1.isVisible('#board'), 'leaderboard is always visible');
  assert.ok(await p1.isVisible('#archive'), 'archive card is visible');
  assert.match(await p1.textContent('#level'), /·|Sunday special/, 'house weekday level from the jacob.gg kit');
  await p1.click('#archive-browse');
  assert.match(await p1.textContent('#archive-list'), /starts tomorrow|Pointle #/);
  await shot(p1, 'home-desktop');
  await practiceBeforePlaying(p1);
  await playMap(p1);
  console.log('ok - desktop map game (arrow drag, sliders), leaderboard, practice gate');

  // phone: sensor mode with synthetic orientation events
  const phone = await browser.newContext({ geolocation: POS, permissions: ['geolocation', 'accelerometer', 'gyroscope', 'magnetometer'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await phone.addInitScript(() => { if (!localStorage.getItem('pointle:v2')) localStorage.setItem('pointle:v2', JSON.stringify({ nick: 'E2E phone' })); });
  const p2 = await phone.newPage();
  record(p2, 'phone');
  p2.on('pageerror', (e) => pageErrors.push(`phone: ${e.message}`));
  await p2.goto(`${SITE}?api=${encodeURIComponent(API)}&hub=${encodeURIComponent(HUB)}`);
  await visible(p2, '#home');
  assert.ok(await p2.isEnabled('#mode-phone'), 'phone can choose phone mode');
  await shot(p2, 'home-phone');
  await playSensor(p2);
  console.log('ok - phone sensor game (compass dial, live globe arrow), practice unlocked');

  // a denied location request explains what to do
  const denied = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p3 = await denied.newPage();
  record(p3, 'denied');
  await p3.goto(`${SITE}?api=${encodeURIComponent(API)}&hub=${encodeURIComponent(HUB)}`);
  await visible(p3, '#home');
  await p3.click('#mode-map');
  await p3.click('#from-gps');
  await visible(p3, '#from-msg');
  assert.match(await p3.textContent('#from-msg'), /declined|blocked|location/i);
  assert.ok(await p3.isVisible('#from-town-q'), 'a denied location opens the town search');
  await p3.fill('#from-town-q', 'Leeds');
  await p3.click('#from-town-results li:first-child button');
  assert.match(await p3.textContent('#start-play'), /Start · map · from Leeds/);
  await shot(p3, 'location-denied');
  console.log('ok - denied location shows help');

  for (const p of [p1, p2]) {
    const ls = await p.evaluate(() => JSON.stringify(localStorage));
    for (const pat of PATTERNS) assert.ok(!ls.includes(pat), `localStorage contains ${pat}`);
  }
  console.log('ok - no coordinates in localStorage');
} finally {
  // closing can hang on Windows with several contexts open; don't let it block the verdict
  await Promise.race([browser.close(), sleep(5000)]);
}

assert.deepEqual(pageErrors, [], 'page errors');
const problems = checkPrivacy();
const hosts = [...new Set(requests.map((r) => new URL(r.url).host))];
console.log(`checked ${requests.length} requests to: ${hosts.join(', ')}`);
assert.deepEqual(problems, [], 'privacy problems');
assert.ok(requests.some((r) => r.url.includes('/api/submit') && r.body.includes('E2E map')), 'the test did submit');
console.log('ok - privacy: no request contained the coordinates');
process.exit(0);
