// End-to-end checks against a running worker (local: npm run dev:local, after npm run db:init:local).
//   node test/e2e.mjs http://127.0.0.1:8799
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { entryFor, dayKey } from '../../site/js/daily.js';
import { generateDay, playableTargets } from '../../site/js/rules.js';
import { totalScore } from '../../site/js/scoring.js';

const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const schedule = JSON.parse(readFileSync(new URL('../../site/data/schedule.json', import.meta.url)));
const { targets } = JSON.parse(readFileSync(new URL('../../site/data/targets.json', import.meta.url)));
const byId = new Map(targets.map((t) => [t.id, t]));
const today = dayKey();
const entry = entryFor(today, schedule, (d) => generateDay(d, targets));

let passed = 0;
async function call(path, body, method = body ? 'POST' : 'GET') {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8080' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}
async function check(name, fn) { await fn(); passed++; console.log(`ok - ${name}`); }

const errors = [3, 12.5, 30, 47.5, 100];
const good = (s, over = {}) => ({
  ...s, day: today, mode: 'map', device: 'desktop', name: 'Tester', town: 'Leeds', targets: entry.targets,
  errors, durations: [4000, 5000, 6000, 7000, 8000], total: totalScore(errors), ...over,
});

const a = (await call('/api/session', {})).body;
const b = (await call('/api/session', {})).body;

await check('session issues id + token', () => { assert.ok(a.playerId && a.token); });
await check('CORS allows the local origin', async () => {
  const r = await call('/api/board?mode=map');
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:8080');
});
await check('bad token rejected', async () => assert.equal((await call('/api/submit', good({ ...a, token: 'x' }))).status, 401));
await check('future day rejected', async () => {
  const r = await call('/api/submit', good(a, { day: '2099-01-01' }));
  assert.equal(r.status, 400); assert.match(r.body.message, /hasn't started/);
});
await check('old day rejected', async () => assert.equal((await call('/api/submit', good(a, { day: '2026-10-01' }))).status, 400));
await check('wrong targets rejected', async () => {
  const wrong = targets.find((t) => !entry.targets.includes(t.id) && t.id !== entry.reserve).id;
  assert.equal((await call('/api/submit', good(a, { targets: [wrong, ...entry.targets.slice(1)] }))).status, 400);
});
await check('total must add up', async () => assert.equal((await call('/api/submit', good(a, { total: 499 }))).status, 400));
await check('impossibly fast rejected (under 10 s)', async () => {
  const r = await call('/api/submit', good(a, { durations: [1000, 1000, 1000, 1000, 1000] }));
  assert.equal(r.status, 400); assert.match(r.body.message, /fast/);
});
await check('profane nickname rejected', async () => assert.equal((await call('/api/submit', good(a, { name: 'sh1thead' }))).status, 400));
await check('town with coordinates rejected', async () => assert.equal((await call('/api/submit', good(a, { town: '51.507, -0.128' }))).status, 400));
await check('sensor mode must be phone', async () => assert.equal((await call('/api/submit', good(a, { mode: 'sensor' }))).status, 400));
await check('fixed mode must use the fixed spot\'s targets', async () => {
  const fixedIds = playableTargets(entry, byId.get(entry.origin), byId);
  assert.equal((await call('/api/submit', good(a, { mode: 'fixed-map', targets: fixedIds }))).status, 200);
  const swapped = [...fixedIds]; swapped[0] = entry.reserve;
  assert.equal((await call('/api/submit', good(b, { mode: 'fixed-map', targets: swapped }))).status, 400);
});
await check('reserve may replace one target (player near a target)', async () => {
  const ids = [...entry.targets]; ids[2] = entry.reserve;
  assert.equal((await call('/api/submit', good(b, { targets: ids, name: 'Bea', device: 'phone', errors: [0, 0, 0, 0, 0], total: 500 }))).status, 200);
});
await check('valid submission accepted, second one for the same mode refused', async () => {
  assert.equal((await call('/api/submit', good(a))).status, 200);
  assert.equal((await call('/api/submit', good(a))).status, 409);
});
await check('daily board ranks by total, shows device and town, marks you', async () => {
  const r = (await call(`/api/board?mode=map&period=day&day=${today}&playerId=${a.playerId}`)).body;
  assert.equal(r.players, 2);
  assert.equal(r.top[0].name, 'Bea'); assert.equal(r.top[0].device, 'phone'); assert.equal(r.top[0].total, 500);
  assert.equal(r.top[1].town, 'Leeds'); assert.ok(r.top[1].you);
  assert.ok(!JSON.stringify(r).includes('errors') && !JSON.stringify(r).includes('playerId'));
});
await check('weekly board sums days', async () => {
  const r = (await call(`/api/board?mode=map&period=week&day=${today}`)).body;
  assert.equal(r.top[0].total, 500); assert.equal(r.top[0].days, 1);
});
await check('boards are separate per mode', async () => {
  const r = (await call(`/api/board?mode=sensor&period=day&day=${today}`)).body;
  assert.equal(r.players, 0);
  const f = (await call(`/api/board?mode=fixed-map&period=day&day=${today}`)).body;
  assert.equal(f.players, 1);
});
let code;
await check('create a friend group, join it, group board filters', async () => {
  const g = await call('/api/group/create', { ...a, name: 'Office' });
  assert.equal(g.status, 200); code = g.body.code;
  assert.match(code, /^[A-Z0-9]{6}$/);
  const only = (await call(`/api/board?mode=map&day=${today}&group=${code}`)).body;
  assert.equal(only.players, 1); assert.equal(only.top[0].name, 'Tester');
  assert.equal((await call('/api/group/join', { ...b, code: code.toLowerCase() })).status, 200);
  assert.equal((await call(`/api/board?mode=map&day=${today}&group=${code}`)).body.players, 2);
  assert.equal((await call('/api/group/join', { ...b, code: 'ZZZZZZ' })).status, 404);
  assert.equal((await call('/api/group/create', { ...a, name: 'fuck off' })).status, 400);
});
await check('bad board params rejected', async () => {
  assert.equal((await call('/api/board?mode=nope')).status, 400);
  assert.equal((await call('/api/board?mode=map&day=2026-13-01')).status, 400);
  assert.equal((await call('/api/board?mode=map&group=abc')).status, 400);
});
console.log(`\n${passed} checks passed`);
