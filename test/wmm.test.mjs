import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { magneticField, declination, decimalYear } from '../site/js/wmm.js';

const rows = readFileSync(new URL('./fixtures/WMM2025_TestValues.txt', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim().split(/\s+/).map(Number));

test('WMM2025 matches every official NOAA test value', () => {
  assert.ok(rows.length >= 10);
  for (const [year, alt, lat, lon, D, I, H, X, Y, Z] of rows) {
    const f = magneticField(lat, lon, alt, year);
    const where = `${year} ${alt}km ${lat},${lon}`;
    assert.ok(Math.abs(f.D - D) < 0.01, `D at ${where}: ${f.D} vs ${D}`);
    assert.ok(Math.abs(f.I - I) < 0.01, `I at ${where}: ${f.I} vs ${I}`);
    assert.ok(Math.abs(f.X - X) < 0.5, `X at ${where}: ${f.X} vs ${X}`);
    assert.ok(Math.abs(f.Y - Y) < 0.5, `Y at ${where}: ${f.Y} vs ${Y}`);
    assert.ok(Math.abs(f.Z - Z) < 0.5, `Z at ${where}: ${f.Z} vs ${Z}`);
    assert.ok(Math.abs(f.H - H) < 0.5, `H at ${where}`);
  }
});

test('declination() uses the date and is east-positive', () => {
  // London is close to zero (slightly east) in the mid 2020s; western US is strongly east; NE Canada west.
  const london = declination(51.5, -0.13, new Date('2026-10-09T00:00:00Z'));
  assert.ok(london > -1 && london < 3, `London ${london}`);
  assert.ok(declination(37.8, -122.4, new Date('2026-10-09T00:00:00Z')) > 10);
  assert.ok(declination(47.6, -52.7, new Date('2026-10-09T00:00:00Z')) < -10);
});

test('decimalYear', () => {
  assert.equal(decimalYear(new Date('2025-01-01T00:00:00Z')), 2025);
  assert.ok(Math.abs(decimalYear(new Date('2026-07-02T12:00:00Z')) - 2026.5) < 0.002);
});
