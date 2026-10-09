// Browser end-to-end test + the privacy guarantee check.
//
//   node tools/serve.mjs 8080            (site)
//   cd worker && npm run dev:local       (leaderboard on :8799, after npm run db:init:local)
//   node test-e2e/privacy.e2e.mjs [siteUrl] [apiUrl]
//
// Plays a full map-mode game and a full sensor-mode game (synthetic orientation events on an emulated
// phone) with a mocked GPS position, submits both to the leaderboard, opens practice and the boards, and
// records EVERY request the page makes. Fails if any URL, header or body contains the coordinates (in any
// common rounding), or if any request goes somewhere unexpected. Map imagery tiles are the one documented
// location-related request: they must be at zoom <= 9 (about 50 km tiles) and contain no coordinates.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const SITE = process.argv[2] || 'http://localhost:8080/';
const API = process.argv[3] || 'http://127.0.0.1:8799';
const POS = { latitude: 53.80076, longitude: -1.54908 };   // Leeds, as a mock GPS fix
const shots = new URL('./shots/', import.meta.url);
mkdirSync(shots, { recursive: true });

const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);

// Every way the coordinates might be written: 53.8, 53.80, 53.801, 5380, -1.549, -1.55, 1.549 ...
function coordinatePatterns({ latitude, longitude }) {
  const pats = new Set();
  for (const v of [latitude, longitude]) {
    for (const dp of [1, 2, 3, 4, 5]) pats.add(Math.abs(v).toFixed(dp));
    pats.add(String(Math.abs(v)));
  }
  pats.delete('1.5'); pats.delete('53.8'); // 1-dp forms are too generic to search for alone; checked as pairs below
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

async function playMap(page) {
  await page.click('#go-map');
  await page.click('#loc-gps');
  for (let i = 0; i < 5; i++) {
    await page.waitForSelector('#play:not([hidden]) .map-canvas');
    const box = await page.locator('.map-canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80 + i * 20, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.locator('#tilt').fill(String(-10 - i * 10));
    await sleep(2200);  // the server rejects games faster than 10 s in total
    if (i === 0) await page.screenshot({ path: new URL('map-play.png', shots).pathname.slice(1) });
    await page.click('#lock');
    await page.waitForSelector('#reveal:not([hidden])');
    await page.waitForTimeout(600);
    if (i === 0) await page.screenshot({ path: new URL('map-reveal.png', shots).pathname.slice(1), fullPage: true });
    // sweep the radar and bar
    const rb = await page.locator('#radar').boundingBox();
    await page.mouse.click(rb.x + rb.width * 0.8, rb.y + rb.height * 0.3);
    await page.click('#next');
  }
  await page.waitForSelector('#done:not([hidden])');
  await page.fill('#nick', 'E2E map');
  await page.fill('#town', 'Leeds');
  await page.click('#submit-form button');
  await page.waitForSelector('#board:not([hidden])', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#board-list').children.length > 0, null, { timeout: 10000 });
  await page.screenshot({ path: new URL('map-board.png', shots).pathname.slice(1), fullPage: true });
  const board = await page.textContent('#board-list');
  assert.match(board, /E2E map/);
  assert.match(board, /Leeds/);
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
  await page.click('#go-sensor');
  await page.click('#loc-gps');
  await page.waitForSelector('#setup:not([hidden])');
  await page.click('#enable-compass');
  await page.waitForSelector('#start-sensor:not([disabled])');
  await page.screenshot({ path: new URL('sensor-setup.png', shots).pathname.slice(1), fullPage: true });
  await page.click('#start-sensor');
  for (let i = 0; i < 5; i++) {
    await page.waitForSelector('#play:not([hidden])');
    await page.evaluate((k) => { window.__orient = { alpha: 40 * k, beta: 60 + k * 5, gamma: 0 }; }, i);
    await sleep(2200);
    const heading = await page.textContent('#read-heading');
    assert.match(heading, /\d+°|—/);
    if (i === 0) await page.screenshot({ path: new URL('sensor-play.png', shots).pathname.slice(1) });
    await page.click('#lock');
    await page.waitForSelector('#reveal:not([hidden])');
    await page.waitForTimeout(500);
    if (i === 0) await page.screenshot({ path: new URL('sensor-reveal.png', shots).pathname.slice(1), fullPage: true });
    await page.click('#next');
  }
  await page.waitForSelector('#done:not([hidden])');
  await page.screenshot({ path: new URL('sensor-done.png', shots).pathname.slice(1), fullPage: true });
  await page.fill('#nick', 'E2E phone');
  await page.click('#submit-form button');
  await page.waitForSelector('#board:not([hidden])', { timeout: 10000 });
  // practice is unlocked after finishing
  await page.click('[data-go="home"]');
  await page.click('#go-practice');
  await page.waitForSelector('#practice:not([hidden])');
  const opts = await page.$$eval('#prac-pick option', (o) => o.map((x) => x.value));
  assert.ok(opts.includes('free'), 'practice unlocked after playing');
  await page.selectOption('#prac-pick', 'free');
  await page.waitForTimeout(500);
  await page.screenshot({ path: new URL('practice-free.png', shots).pathname.slice(1), fullPage: true });
}

async function practiceBeforePlaying(page) {
  await page.click('#go-practice');
  await page.click('#loc-gps');
  await page.waitForSelector('#practice:not([hidden])');
  const opts = await page.$$eval('#prac-pick option', (o) => o.map((x) => x.value));
  assert.deepEqual(opts, ['random'], 'before playing, practice offers random targets only');
  const today = await page.evaluate(() => { const { S } = window.__pointle; return [...S.entry.targets, S.entry.reserve].map((id) => S.byId.get(id).n); });
  for (let k = 0; k < 10; k++) {
    const name = await page.textContent('#prac-name');
    assert.ok(!today.some((t) => name.startsWith(t)), `practice target ${name} is one of today's`);
    await page.click('#prac-new');
  }
  await page.click('#prac-check');
  await page.screenshot({ path: new URL('practice-before.png', shots).pathname.slice(1), fullPage: true });
  await page.click('[data-go="home"]');
}

const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pageErrors = [];
try {
  // desktop: map mode + practice gate
  const desk = await browser.newContext({ geolocation: POS, permissions: ['geolocation'], viewport: { width: 1200, height: 900 } });
  const p1 = await desk.newPage();
  record(p1, 'desktop');
  p1.on('pageerror', (e) => pageErrors.push(`desktop: ${e.message}`));
  await p1.goto(`${SITE}?api=${encodeURIComponent(API)}`);
  await p1.waitForSelector('#home:not([hidden])');
  assert.ok(await p1.isVisible('#qr-box'), 'desktop shows the QR code');
  assert.ok(!(await p1.isVisible('#go-sensor')), 'desktop hides sensor mode');
  await p1.screenshot({ path: new URL('home-desktop.png', shots).pathname.slice(1), fullPage: true });
  await practiceBeforePlaying(p1);
  await playMap(p1);
  console.log('ok - desktop map game, leaderboard, practice gate');

  // phone: sensor mode with synthetic orientation events
  const phone = await browser.newContext({ geolocation: POS, permissions: ['geolocation', 'accelerometer', 'gyroscope', 'magnetometer'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p2 = await phone.newPage();
  record(p2, 'phone');
  p2.on('pageerror', (e) => pageErrors.push(`phone: ${e.message}`));
  await p2.goto(`${SITE}?api=${encodeURIComponent(API)}`);
  await p2.waitForSelector('#home:not([hidden])');
  assert.ok(await p2.isVisible('#go-sensor'), 'phone shows sensor mode');
  await p2.screenshot({ path: new URL('home-phone.png', shots).pathname.slice(1), fullPage: true });
  await playSensor(p2);
  console.log('ok - phone sensor game, practice unlocked');

  // localStorage must not hold coordinates either
  for (const p of [p1, p2]) {
    const ls = await p.evaluate(() => JSON.stringify(localStorage));
    for (const pat of PATTERNS) assert.ok(!ls.includes(pat), `localStorage contains ${pat}`);
  }
  console.log('ok - no coordinates in localStorage');
} finally {
  await browser.close();
}

assert.deepEqual(pageErrors, [], 'page errors');
const problems = checkPrivacy();
const hosts = [...new Set(requests.map((r) => new URL(r.url).host))];
console.log(`checked ${requests.length} requests to: ${hosts.join(', ')}`);
assert.deepEqual(problems, [], 'privacy problems');
assert.ok(requests.some((r) => r.url.includes('/api/submit') && r.body.includes('E2E map')), 'the test did submit');
console.log('ok - privacy: no request contained the coordinates');
