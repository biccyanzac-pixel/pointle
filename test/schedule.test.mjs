import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkDay, generateDay, buildSchedule, NO_REPEAT_DAYS, WEEKDAY_TIERS, playableTargets, kmBetween,
  MIN_PLAYABLE_KM, pickPracticeTarget, practiceTargetPool, PRACTICE_EXCLUSION_KM } from '../site/js/rules.js';
import { EPOCH, addDays, entryFor, weekday, mulberry32, hashString, dayKey } from '../site/js/daily.js';

const { targets } = JSON.parse(readFileSync(new URL('../site/data/targets.json', import.meta.url), 'utf8'));
const schedule = JSON.parse(readFileSync(new URL('../site/data/schedule.json', import.meta.url), 'utf8'));
const byId = new Map(targets.map((t) => [t.id, t]));
const entryAt = (i) => entryFor(addDays(schedule.start, i), schedule);

test('target list is sane', () => {
  assert.ok(targets.length > 1000);
  assert.equal(new Set(targets.map((t) => t.id)).size, targets.length, 'unique ids');
  for (const t of targets) {
    assert.ok(t.n && t.ct && t.t >= 1 && t.t <= 5, t.id);
    assert.ok(Math.abs(t.lat) <= 90 && Math.abs(t.lon) <= 180, t.id);
  }
  for (const k of [1, 2, 3, 4, 5]) assert.ok(targets.filter((t) => t.t === k).length >= 100, `tier ${k} pool`);
});

test('schedule covers at least two years from puzzle #1', () => {
  assert.equal(schedule.start, EPOCH);
  assert.ok(schedule.days.length >= 731);
});

test('every scheduled day satisfies the rules', () => {
  schedule.days.forEach((_, i) => {
    const day = addDays(schedule.start, i);
    assert.deepEqual(checkDay(day, entryAt(i), byId), [], day);
  });
});

test('no target repeats within 60 days (targets and reserves), no origin repeats within 60 days', () => {
  for (let i = 0; i < schedule.days.length; i++) {
    const ids = schedule.days[i].slice(0, 6);
    for (let j = Math.max(0, i - NO_REPEAT_DAYS + 1); j < i; j++) {
      const prev = schedule.days[j];
      for (const id of ids) assert.ok(!prev.slice(0, 6).includes(id), `${id} on day ${i} repeats day ${j}`);
      assert.notEqual(prev[6], schedule.days[i][6], `origin on day ${i} repeats day ${j}`);
    }
  }
});

test('difficulty follows the weekday: Mondays are famous capitals, Saturdays have landmarks', () => {
  for (let i = 0; i < 70; i++) {
    const day = addDays(schedule.start, i);
    const ts = entryAt(i).targets.map((id) => byId.get(id));
    assert.deepEqual(ts.map((t) => t.t).sort(), [...WEEKDAY_TIERS[weekday(day)]].sort(), day);
    if (weekday(day) === 1) assert.ok(ts.every((t) => t.k === 'city' && t.t === 1));
    if (weekday(day) === 6) assert.ok(ts.filter((t) => t.k !== 'city').length >= 2);
  }
});

test('the schedule file matches the generator (deterministic)', () => {
  const fresh = buildSchedule(EPOCH, 40, targets);
  assert.deepEqual(fresh.days, schedule.days.slice(0, 40));
});

test('days past the schedule fall back to a seeded, valid pick that is the same for everyone', () => {
  const day = addDays(schedule.start, schedule.days.length + 10);
  assert.equal(entryFor(day, schedule), null);
  const fb = (d) => generateDay(d, targets);
  const a = entryFor(day, schedule, fb), b = entryFor(day, schedule, fb);
  assert.deepEqual(a, b);
  assert.deepEqual(checkDay(day, a, byId), []);
});

test('date -> targets: the same UTC day gives the same targets in every timezone', () => {
  const ny = dayKey(new Date('2026-10-12T20:00:00-04:00'));   // 00:00 UTC on the 13th
  const tokyo = dayKey(new Date('2026-10-13T09:00:00+09:00'));
  assert.equal(ny, tokyo);
  assert.deepEqual(entryFor(ny, schedule), entryFor(tokyo, schedule));
  assert.notDeepEqual(entryFor('2026-10-12', schedule), entryFor('2026-10-13', schedule));
});

test('a target too close to the player is swapped for the reserve', () => {
  const e = entryAt(0);
  const first = byId.get(e.targets[0]);
  const ids = playableTargets(e, { lat: first.lat + 0.5, lon: first.lon }, byId);
  assert.equal(ids[0], e.reserve);
  assert.deepEqual(ids.slice(1), e.targets.slice(1));
  // far away from all of them: unchanged
  const far = playableTargets(e, { lat: -89, lon: 0 }, byId);
  if (e.targets.every((id) => kmBetween({ lat: -89, lon: 0 }, byId.get(id)) >= MIN_PLAYABLE_KM)) assert.deepEqual(far, e.targets);
});

test('before-guess practice can never select today\'s targets or anywhere near them', () => {
  for (let i = 0; i < schedule.days.length; i += 7) {
    const e = entryAt(i);
    const today = [...e.targets, e.reserve].map((id) => byId.get(id));
    const pool = practiceTargetPool(e, targets, byId);
    assert.ok(pool.length > 50, 'enough practice targets');
    for (const p of pool) for (const t of today) {
      assert.notEqual(p.id, t.id);
      assert.ok(kmBetween(p, t) >= PRACTICE_EXCLUSION_KM, `${p.n} near ${t.n}`);
    }
    const rng = mulberry32(hashString(String(i)));
    for (let k = 0; k < 50; k++) {
      const p = pickPracticeTarget(e, targets, byId, rng);
      assert.ok(!today.some((t) => t.id === p.id));
    }
  }
});
