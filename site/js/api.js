// Leaderboard client. What is sent: nickname, scores, per-target errors and timings, mode, device type,
// the target ids (public), optional town NAME and group code. Never coordinates or directions.
export const DEFAULT_API = 'https://pointle-leaderboard.jacob-gg-leaderboard-worker.workers.dev';

export function apiBase() {
  const q = new URLSearchParams(location.search).get('api');
  return q || DEFAULT_API;
}

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(data?.message || `Leaderboard error (${res.status})`);
  return data;
}

const KEY = 'pointle:player';
export async function session() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved?.playerId && saved?.token) return saved;
  } catch { /* storage blocked */ }
  const s = await call('/api/session', { method: 'POST', body: {} });
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ }
  return s;
}

export async function submit(entry) {
  const s = await session();
  return call('/api/submit', { method: 'POST', body: { ...s, ...entry } });
}

export async function board({ mode, period = 'day', day, group }) {
  const s = await session().catch(() => null);
  const q = new URLSearchParams({ mode, period, day });
  if (group) q.set('group', group);
  if (s) q.set('playerId', s.playerId);
  return call(`/api/board?${q}`);
}

export async function createGroup(name) {
  const s = await session();
  return call('/api/group/create', { method: 'POST', body: { ...s, name } });
}

export async function joinGroup(code) {
  const s = await session();
  return call('/api/group/join', { method: 'POST', body: { ...s, code } });
}
