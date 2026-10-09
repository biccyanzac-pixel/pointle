import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreFor, totalScore, describeMiss, shareText, encodeResult, decodeResult, MAX_TOTAL } from '../site/js/scoring.js';
import { dayKey, puzzleNumber, weekday, weekStart, msUntilNextUtcDay, isValidDay, addDays, mulberry32, hashString, isLate } from '../site/js/daily.js';

test('score: 100 within 5 deg, linear to 0 at 90 deg', () => {
  assert.equal(scoreFor(0), 100);
  assert.equal(scoreFor(5), 100);
  assert.equal(scoreFor(5.01), 100);  // rounds
  assert.equal(scoreFor(47.5), 50);
  assert.equal(scoreFor(90), 0);
  assert.equal(scoreFor(170), 0);
  assert.equal(scoreFor(NaN), 0);
  assert.equal(scoreFor(-1), 0);
  assert.equal(scoreFor(22), 80);
  for (let e = 5; e < 90; e += 0.5) assert.ok(scoreFor(e) >= scoreFor(e + 0.5), 'monotonic');
  assert.equal(totalScore([0, 5, 47.5, 90, 22]), 330);
  assert.equal(MAX_TOTAL, 300);
});

test('miss description', () => {
  assert.equal(describeMiss(-12.2, 7.6), '12° too far left, 8° too high');
  assert.equal(describeMiss(3, -1), '3° too far right, 1° too low');
  assert.equal(describeMiss(0.2, -0.4), 'Spot on!');
});

test('share text has the scores and no coordinates', () => {
  const txt = shareText(12, [
    { name: 'Tokyo', error: 12.2 }, { name: 'Lima', error: 31 }, { name: 'Cairo', error: 4 },
  ], 'https://example.org/pointle/');
  assert.match(txt, /^Pointle #12 /);
  assert.match(txt, /🎯 Tokyo 12° · Lima 31° · Cairo 4° — \d+\/300/);
  assert.ok(!/\d+\.\d{2,}/.test(txt), 'no decimal coordinates');
});

test('share link encoding round-trips and rejects junk', () => {
  const r = { day: '2026-10-09', mode: 'fixed-map', errors: [0, 4.2, 179.9] };
  const code = encodeResult(r);
  assert.match(code, /^20261009\.3\./);
  const back = decodeResult(code);
  assert.equal(back.day, r.day);
  assert.equal(back.mode, r.mode);
  assert.deepEqual(back.errors, [0, 4.2, 179.9]);
  for (const bad of ['', 'x', '2026-10-09.0.1', '20261009.9.1', '20261009.0.zzz', '20261009.0']) assert.equal(decodeResult(bad), null, bad);
});

test('days are UTC dates: timezone edge cases', () => {
  // 23:30 in New York on 9 Oct is already 10 Oct UTC
  assert.equal(dayKey(new Date('2026-10-09T23:30:00-04:00')), '2026-10-10');
  // 00:30 in Tokyo on 10 Oct is still 9 Oct UTC
  assert.equal(dayKey(new Date('2026-10-10T00:30:00+09:00')), '2026-10-09');
  // UK summer time: 00:30 BST is 23:30 UTC the previous day
  assert.equal(dayKey(new Date('2027-07-01T00:30:00+01:00')), '2027-06-30');
  assert.equal(dayKey(new Date('2026-10-09T00:00:00Z')), '2026-10-09');
  assert.equal(dayKey(new Date('2026-10-09T23:59:59.999Z')), '2026-10-09');
  assert.equal(puzzleNumber('2026-10-09'), 1);
  assert.equal(puzzleNumber('2027-10-09'), 366);
  assert.equal(weekday('2026-10-12'), 1); // Monday
  assert.equal(weekStart('2026-10-18'), '2026-10-12'); // Sunday belongs to the week starting Monday
  assert.equal(weekStart('2026-10-12'), '2026-10-12');
  assert.equal(msUntilNextUtcDay(new Date('2026-10-09T23:59:00Z')), 60000);
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.ok(isValidDay('2028-02-29') && !isValidDay('2027-02-29') && !isValidDay('2026-1-01'));
  assert.ok(!isValidDay('2026-13-01') && !isValidDay('2026-02-30') && !isValidDay(null));
});

test('late (archive) board: today never; yesterday only after the 2 h grace or when replayed; older always', () => {
  const at = (iso) => new Date(iso);
  assert.equal(isLate('2026-10-12', false, at('2026-10-12T15:00:00Z')), false);
  assert.equal(isLate('2026-10-12', true, at('2026-10-12T15:00:00Z')), false);
  assert.equal(isLate('2026-10-11', false, at('2026-10-12T01:30:00Z')), false);  // finished just after midnight
  assert.equal(isLate('2026-10-11', true, at('2026-10-12T01:30:00Z')), true);    // chosen from the archive
  assert.equal(isLate('2026-10-11', false, at('2026-10-12T02:30:00Z')), true);
  assert.equal(isLate('2026-10-01', false, at('2026-10-12T00:10:00Z')), true);
});

test('seeded RNG is deterministic', () => {
  const a = mulberry32(hashString('2026-10-09')), b = mulberry32(hashString('2026-10-09'));
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  assert.notEqual(mulberry32(hashString('x'))(), mulberry32(hashString('y'))());
});
