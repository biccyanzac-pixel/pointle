/**
 * Pointle leaderboards: Cloudflare Worker + D1. Modelled on Yogle's worker.
 *
 * The browser does all the pointing maths; the player's location never comes here. This worker stores the
 * numbers the browser computed and closes the cheap holes:
 *   - player ids/tokens are issued here (/api/session); submissions must present the token.
 *   - the day must be today (UTC), or yesterday within a short grace period for late finishers;
 *     never a day that hasn't started. Older days (from puzzle #1) are archive replays and go on a
 *     separate "late" board that never changes the day's original results.
 *   - the targets must belong to that day (this server's own copy of the schedule, bundled at deploy);
 *     fixed-spot modes must play exactly the fixed spot's targets.
 *   - the total must equal the sum of per-target scores computed from the errors (same scoring code).
 *   - impossible timings are rejected (all three in under 6 s, or any in under 0.5 s).
 *   - nicknames, towns and group names pass a profanity filter; per-IP rate limits.
 *   - one entry per player, day and mode (the first counts); rows are insert-only.
 * Not defended (by design): a modified browser reporting invented errors. Boards say they are honour-based.
 */
import { entryFor, isValidDay, weekStart, dayKey, EPOCH, isLate } from '../../site/js/daily.js';
import { generateDay, playableTargets } from '../../site/js/rules.js';
import { totalScore, TARGETS_PER_DAY as N, MAX_TOTAL } from '../../site/js/scoring.js';
import { checkName, checkTown, cleanText, isProfane } from '../../site/js/names.js';
import schedule from '../../site/data/schedule.json';
import targetData from '../../site/data/targets.json';

const MODES = ['sensor', 'map', 'fixed-sensor', 'fixed-map'];
const BOARD_SIZE = 25;
const MIN_TOTAL_MS = 6_000;
const MIN_TARGET_MS = 500;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const byId = new Map(targetData.targets.map((t) => [t.id, t]));
export function entryForDay(day) {
  return entryFor(day, schedule, (d) => generateDay(d, targetData.targets));
}

/** Range and consistency checks. Returns an error message or null. */
export function checkSubmission(b, now = new Date()) {
  if (!isValidDay(b.day)) return 'Invalid day.';
  const today = dayKey(now);
  if (b.day > today) return "That day hasn't started yet.";
  if (b.day < EPOCH) return 'There was no Pointle that day.';
  if (!MODES.includes(b.mode)) return 'Unknown mode.';
  if (!['phone', 'desktop'].includes(b.device)) return 'Unknown device.';
  if (b.mode.endsWith('sensor') && b.device !== 'phone') return 'Sensor mode is phone-only.';
  const { targets, errors, durations } = b;
  if (!Array.isArray(targets) || targets.length !== N || new Set(targets).size !== N) return `Need ${N} different targets.`;
  const entry = entryForDay(b.day);
  const allowed = new Set([...entry.targets, entry.reserve]);
  if (!targets.every((id) => allowed.has(id))) return "Those aren't that day's targets. Refresh the page.";
  if (b.mode.startsWith('fixed')) {
    const fixed = byId.get(entry.origin);
    if (playableTargets(entry, fixed, byId).join() !== targets.join()) return "Those aren't the fixed spot's targets.";
  }
  if (!Array.isArray(errors) || errors.length !== N || !errors.every((e) => typeof e === 'number' && e >= 0 && e <= 180)) return 'Bad errors.';
  if (b.total !== totalScore(errors) || b.total > MAX_TOTAL) return "Score doesn't add up.";
  if (!Array.isArray(durations) || durations.length !== N || !durations.every((d) => Number.isInteger(d) && d >= 0 && d < 86400000)) return 'Bad timings.';
  if (durations.some((d) => d < MIN_TARGET_MS) || durations.reduce((s, d) => s + d, 0) < MIN_TOTAL_MS) return 'That was impossibly fast.';
  return null;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- HTTP plumbing ---
function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) return '*';
  return allowed.includes(origin) ? origin : allowed[0];
}
function cors(request, env) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(request, env),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
const json = (request, env, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(request, env) } });
const fail = (request, env, code, message, status) => json(request, env, { error: code, message }, status);

// in-memory, per isolate: enough to blunt a burst
const hits = new Map();
function rateLimited(ip, bucket, limit) {
  const now = Date.now(), key = `${bucket}:${ip}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3600_000);
  const over = recent.length >= limit;
  if (!over) recent.push(now);
  hits.set(key, recent);
  return over;
}

async function verifyPlayer(env, playerId, token) {
  if (typeof playerId !== 'string' || typeof token !== 'string' || !playerId || !token) return false;
  const row = await env.DB.prepare('SELECT token_hash FROM players WHERE id = ?').bind(playerId).first();
  return !!row && row.token_hash === (await sha256Hex(token));
}

// --- routes ---
async function handleSession(request, env, ip) {
  if (rateLimited(ip, 'session', 30)) return fail(request, env, 'rate_limited', 'Too many new sessions from here.', 429);
  const playerId = crypto.randomUUID(), token = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO players (id, token_hash, created_at) VALUES (?, ?, ?)')
    .bind(playerId, await sha256Hex(token), new Date().toISOString()).run();
  return json(request, env, { playerId, token });
}

async function handleSubmit(request, env, ip) {
  if (rateLimited(ip, 'submit', 40)) return fail(request, env, 'rate_limited', 'Too many submissions from here. Try again later.', 429);
  let b;
  try { b = await request.json(); } catch { return fail(request, env, 'bad_request', 'Invalid JSON.', 400); }
  if (!(await verifyPlayer(env, b?.playerId, b?.token))) return fail(request, env, 'bad_session', 'Invalid session. Reload the page.', 401);
  const name = checkName(b.name);
  if (name.error) return fail(request, env, 'bad_name', name.error, 400);
  const town = checkTown(b.town);
  if (town.error) return fail(request, env, 'bad_town', town.error, 400);
  const problem = checkSubmission(b);
  if (problem) return fail(request, env, 'bad_result', problem, 400);
  const late = isLate(b.day, b.archive === true) ? 1 : 0;
  try {
    await env.DB.prepare(
      `INSERT INTO results (id, player_id, day_key, week_key, mode, device, name, town, targets, errors, durations, total, submitted_at, is_late)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), b.playerId, b.day, weekStart(b.day), b.mode, b.device, name.value, town.value,
      JSON.stringify(b.targets), JSON.stringify(b.errors), JSON.stringify(b.durations), b.total, new Date().toISOString(), late).run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) return fail(request, env, 'already', "You've already submitted for this mode and day. Your first score counts.", 409);
    throw e;
  }
  return json(request, env, { ok: true, late: !!late });
}

export async function fetchBoard(env, { mode, period, day, group, playerId, late = false }) {
  const groupClause = group ? 'AND r.player_id IN (SELECT player_id FROM group_members WHERE code = ?)' : '';
  let rows;
  if (period === 'week') {
    const wk = weekStart(day);
    const q = `SELECT r.player_id, SUM(r.total) AS total, COUNT(*) AS days, MIN(r.submitted_at) AS first,
        (SELECT r2.name FROM results r2 WHERE r2.player_id = r.player_id AND r2.week_key = ?1 AND r2.mode = ?2 AND r2.is_late = 0 ORDER BY r2.submitted_at DESC LIMIT 1) AS name,
        (SELECT r2.town FROM results r2 WHERE r2.player_id = r.player_id AND r2.week_key = ?1 AND r2.mode = ?2 AND r2.is_late = 0 ORDER BY r2.submitted_at DESC LIMIT 1) AS town,
        (SELECT r2.device FROM results r2 WHERE r2.player_id = r.player_id AND r2.week_key = ?1 AND r2.mode = ?2 AND r2.is_late = 0 ORDER BY r2.submitted_at DESC LIMIT 1) AS device
      FROM results r WHERE r.week_key = ?1 AND r.mode = ?2 AND r.is_late = 0 ${group ? 'AND r.player_id IN (SELECT player_id FROM group_members WHERE code = ?3)' : ''}
      GROUP BY r.player_id ORDER BY total DESC, first ASC`;
    const stmt = env.DB.prepare(q);
    rows = (await (group ? stmt.bind(wk, mode, group) : stmt.bind(wk, mode)).all()).results ?? [];
  } else {
    const q = `SELECT r.player_id, r.name, r.town, r.device, r.total, 1 AS days FROM results r
      WHERE r.day_key = ? AND r.mode = ? AND r.is_late = ? ${groupClause} ORDER BY r.total DESC, r.submitted_at ASC`;
    const stmt = env.DB.prepare(q);
    const lateFlag = late ? 1 : 0;
    rows = (await (group ? stmt.bind(day, mode, lateFlag, group) : stmt.bind(day, mode, lateFlag)).all()).results ?? [];
  }
  const view = (r, i) => ({ rank: i + 1, name: r.name, town: r.town, device: r.device, total: r.total, days: r.days, you: r.player_id === playerId });
  const yi = playerId ? rows.findIndex((r) => r.player_id === playerId) : -1;
  return {
    mode, period, day, late: !!late, from: period === 'week' ? weekStart(day) : day, players: rows.length,
    top: rows.slice(0, BOARD_SIZE).map(view), you: yi >= BOARD_SIZE ? view(rows[yi], yi) : null,
  };
}

async function handleBoard(request, env) {
  const u = new URL(request.url);
  const mode = u.searchParams.get('mode') || 'sensor';
  const period = u.searchParams.get('period') === 'week' ? 'week' : 'day';
  const day = u.searchParams.get('day') || dayKey();
  const group = u.searchParams.get('group') || null;
  if (!MODES.includes(mode)) return fail(request, env, 'bad_mode', 'Unknown mode.', 400);
  if (!isValidDay(day)) return fail(request, env, 'bad_day', 'Invalid day.', 400);
  if (group && !/^[A-Z0-9]{6}$/.test(group)) return fail(request, env, 'bad_group', 'Invalid group code.', 400);
  const late = u.searchParams.get('late') === '1';
  return json(request, env, await fetchBoard(env, { mode, period, day, group, late, playerId: u.searchParams.get('playerId') }));
}

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

async function handleGroupCreate(request, env, ip) {
  if (rateLimited(ip, 'group', 20)) return fail(request, env, 'rate_limited', 'Too many groups from here.', 429);
  let b;
  try { b = await request.json(); } catch { return fail(request, env, 'bad_request', 'Invalid JSON.', 400); }
  if (!(await verifyPlayer(env, b?.playerId, b?.token))) return fail(request, env, 'bad_session', 'Invalid session. Reload the page.', 401);
  const name = cleanText(b.name, 30);
  if (!name || isProfane(name)) return fail(request, env, 'bad_name', 'Group name must be 1-30 characters (and polite).', 400);
  const now = new Date().toISOString();
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO groups (code, name, created_by, created_at) VALUES (?, ?, ?, ?)').bind(code, name, b.playerId, now),
        env.DB.prepare('INSERT INTO group_members (code, player_id, joined_at) VALUES (?, ?, ?)').bind(code, b.playerId, now),
      ]);
      return json(request, env, { code, name });
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e;
    }
  }
  return fail(request, env, 'server_error', 'Could not create a group. Try again.', 500);
}

async function handleGroupJoin(request, env, ip) {
  if (rateLimited(ip, 'join', 60)) return fail(request, env, 'rate_limited', 'Too many attempts from here.', 429);
  let b;
  try { b = await request.json(); } catch { return fail(request, env, 'bad_request', 'Invalid JSON.', 400); }
  if (!(await verifyPlayer(env, b?.playerId, b?.token))) return fail(request, env, 'bad_session', 'Invalid session. Reload the page.', 401);
  const code = typeof b.code === 'string' ? b.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{6}$/.test(code)) return fail(request, env, 'bad_code', 'Group codes are 6 letters and numbers.', 400);
  const g = await env.DB.prepare('SELECT code, name FROM groups WHERE code = ?').bind(code).first();
  if (!g) return fail(request, env, 'no_group', 'No group with that code.', 404);
  await env.DB.prepare('INSERT OR IGNORE INTO group_members (code, player_id, joined_at) VALUES (?, ?, ?)')
    .bind(code, b.playerId, new Date().toISOString()).run();
  return json(request, env, { code: g.code, name: g.name });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(request, env) });
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    try {
      const route = `${request.method} ${url.pathname}`;
      if (route === 'POST /api/session') return await handleSession(request, env, ip);
      if (route === 'POST /api/submit') return await handleSubmit(request, env, ip);
      if (route === 'GET /api/board') return await handleBoard(request, env);
      if (route === 'POST /api/group/create') return await handleGroupCreate(request, env, ip);
      if (route === 'POST /api/group/join') return await handleGroupJoin(request, env, ip);
      return fail(request, env, 'not_found', 'No such endpoint.', 404);
    } catch (err) {
      console.error(err);
      return fail(request, env, 'server_error', 'Something broke. Try again.', 500);
    }
  },
};

