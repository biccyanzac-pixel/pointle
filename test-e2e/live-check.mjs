// Read-only check of the deployed site: loads it, plays one map-mode target and the reveal, opens the
// leaderboard, and checks requests for coordinates. Never submits a score.
//   node test-e2e/live-check.mjs [https://biccyanzac-pixel.github.io/pointle/]
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const SITE = process.argv[2] || 'https://biccyanzac-pixel.github.io/pointle/';
const POS = { latitude: 53.80076, longitude: -1.54908 };
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ geolocation: POS, permissions: ['geolocation'], viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
const reqs = [], errors = [];
page.on('request', (r) => reqs.push(`${r.url()} ${r.postData() || ''}`));
page.on('pageerror', (e) => errors.push(e.message));
page.on('requestfailed', (r) => errors.push(`failed: ${r.url()}`));
try {
  await page.goto(SITE);
  await page.waitForSelector('#home:not([hidden])');
  await page.waitForFunction(() => /Pointle #\d/.test(document.querySelector('#daynum').textContent));
  console.log('home:', await page.textContent('#daynum'), '·', await page.textContent('#theme'));
  await page.click('#archive-browse');
  console.log('archive:', (await page.textContent('#archive-list')).slice(0, 80));
  await page.click('#go-map');
  await page.click('#loc-gps');
  await page.waitForSelector('#play:not([hidden]) .map-canvas');
  console.log('first target:', await page.textContent('#target-name'));
  await page.waitForTimeout(2500);
  await page.click('#lock');
  await page.waitForSelector('#reveal:not([hidden])');
  await page.waitForTimeout(800);
  console.log('reveal:', (await page.textContent('#rev-score')), (await page.textContent('#rev-miss')));
  console.log('board visible:', await page.isVisible('#board'), '·', (await page.textContent('#board-empty')).trim() || (await page.textContent('#rows')).slice(0, 80));
} finally {
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
}
const leaks = reqs.filter((r) => /53\.80|1\.549|1\.55\b|53\.8\d/.test(decodeURIComponent(r)));
assert.deepEqual(errors, [], 'page errors');
assert.deepEqual(leaks, [], 'coordinates in requests');
console.log(`ok - ${reqs.length} requests, hosts: ${[...new Set(reqs.map((r) => new URL(r.split(' ')[0]).host))].join(', ')}`);
process.exit(0);
