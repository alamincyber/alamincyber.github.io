// ─────────────────────────────────────────────
// db-fast.js — lightweight, fast Firebase RTDB reader for PUBLIC pages
//
// Keno fast?
//  1. Firebase SDK (app + auth + database, onek KB) load kora lage na —
//     direct REST (fetch) use kora hoy. Admin pages ager moto
//     firebase-config.js use kore, oita change hoyni.
//  2. Stats er jonno pura node na niye ?shallow=true (shudhu key, tiny).
//  3. Stale-while-revalidate: ager visit-er data localStorage e thake,
//     page open hoyei cached data dekhay, background e fresh data niye
//     update kore (data change hole-i abar render hoy).
// ─────────────────────────────────────────────

const DB_URL = 'https://mywebsite-c2d4a-default-rtdb.firebaseio.com';
const PREFIX = 'alc:v1:';
const TIMEOUT_MS = 15000;

function readCache(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null; // { v: <data> }
  } catch (e) { return null; }
}

function writeCache(key, v) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify({ v })); } catch (e) { /* quota / private mode */ }
}

async function getJSON(url) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403
        ? 'Permission denied (database rules check korun)'
        : 'Network error ' + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError') lastErr = new Error('Request timeout');
    } finally { clearTimeout(t); }
  }
  throw lastErr;
}

// Same-tab e ekta node bar bar fetch na korar jonno
const inflight = new Map();
function fetchOnce(url) {
  if (!inflight.has(url)) {
    const p = getJSON(url).finally(() => setTimeout(() => inflight.delete(url), 1000));
    inflight.set(url, p);
  }
  return inflight.get(url);
}

/**
 * Ekta node load kore.
 * render(data, fromCache) — cache thakle age cache diye call hoy,
 * tarpor fresh data alada hole abar call hoy.
 * data === null mane node e kichu nai.
 * Fetch fail kore ar cache o nai hole error throw kore.
 */
export async function loadNode(path, render) {
  const cached = readCache(path);
  let shown = null;
  if (cached) {
    shown = JSON.stringify(cached.v);
    render(cached.v, true);
  }
  try {
    const fresh = await fetchOnce(`${DB_URL}/${path}.json`);
    const s = JSON.stringify(fresh);
    writeCache(path, fresh);
    if (s !== shown) render(fresh, false);
  } catch (e) {
    if (!cached) throw e;       // cache diye already dekhano hoyeche, silently ignore
    console.warn(`[db-fast] ${path}:`, e.message);
  }
}

/**
 * Ekta node e koyta child ache (shudhu count, shallow request).
 * onCount(n, fromCache)
 */
export async function loadCount(path, onCount) {
  const key = 'count:' + path;
  const cached = readCache(key);
  if (cached) onCount(cached.v, true);
  try {
    const keys = await fetchOnce(`${DB_URL}/${path}.json?shallow=true`);
    const n = keys && typeof keys === 'object' ? Object.keys(keys).length : 0;
    writeCache(key, n);
    if (!cached || cached.v !== n) onCount(n, false);
  } catch (e) {
    console.warn(`[db-fast] count ${path}:`, e.message);
    if (!cached) onCount(0, false);
  }
}

/** Firebase object -> array (key order, push-id = chronological). */
export function toList(data) {
  if (!data || typeof data !== 'object') return [];
  return Object.keys(data)
    .filter(k => data[k] && typeof data[k] === 'object')
    .map(k => ({ key: k, ...data[k] }));
}
