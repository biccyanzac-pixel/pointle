// Pre-generate the daily schedule: node tools/make_schedule.mjs [days]
// Writes site/data/schedule.json. Each day: [t1, t2, t3, reserve, fixedOrigin] (target ids).
//
// Once the game is live, never regenerate days up to and including today: that would change past and
// current puzzles (and the leaderboard worker validates against this file). To extend, use
// `--keep-until YYYY-MM-DD`, which keeps those days from the committed file and regenerates after them.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildSchedule, generateDay, NO_REPEAT_DAYS } from '../site/js/rules.js';
import { EPOCH, addDays, daysBetween } from '../site/js/daily.js';

const args = process.argv.slice(2);
const keepIdx = args.indexOf('--keep-until');
const keepUntil = keepIdx >= 0 ? args.splice(keepIdx, 2)[1] : null;
const count = Number(args[0] ?? 820); // a little over two years
const { targets } = JSON.parse(readFileSync('site/data/targets.json', 'utf8'));

let schedule;
if (keepUntil && existsSync('site/data/schedule.json')) {
  const old = JSON.parse(readFileSync('site/data/schedule.json', 'utf8'));
  const keep = old.days.slice(0, daysBetween(old.start, keepUntil) + 1);
  const days = [...keep];
  for (let i = keep.length; i < count; i++) {
    const recent = new Set(), recentOrigins = new Set();
    for (const d of days.slice(Math.max(0, i - (NO_REPEAT_DAYS - 1)))) { d.slice(0, -1).forEach((id) => recent.add(id)); recentOrigins.add(d.at(-1)); }
    const e = generateDay(addDays(old.start, i), targets, recent, recentOrigins);
    days.push([...e.targets, e.reserve, e.origin]);
  }
  schedule = { start: old.start, days };
} else {
  schedule = buildSchedule(EPOCH, count, targets);
}
writeFileSync('site/data/schedule.json', JSON.stringify(schedule).replace(/\],\[/g, '],\n['));
console.log(`schedule: ${schedule.days.length} days from ${schedule.start} to ${addDays(schedule.start, schedule.days.length - 1)}`);
