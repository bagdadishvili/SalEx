// sync.js — optional cross-device sync via a private GitHub Gist.
// The token + gist id live in a SEPARATE localStorage key so they never end up inside
// JSON/CSV backups (those are meant to be shareable/portable, secrets are not).
//
// How it works (v8 — built for two people editing on two phones):
//  1. MERGE, not overwrite: every sync reads the cloud copy and merges it record by record
//     with this device (newest version of each template/transaction/month wins; a record
//     disappears only if someone deleted it after its last change — see records.js).
//     The merged result is saved here AND uploaded. Nothing that exists on either side
//     is ever dropped silently.
//  2. "Shrink guard": if a sync would still make the data drastically smaller
//     (e.g. 80 records -> 5 because someone deleted a lot), automatic sync STOPS and asks.
//  3. Before local data is replaced, a restore point is saved (backup.js). Every upload is a
//     new Gist revision, and once a day a monthly backup file (backup-YYYY-MM.json) is
//     written next to the main file — so older cloud versions can always be restored.

import { getState, replaceState, onStateChange, isPristine, dataWeight, upgradeState } from './state.js';
import { summarizeState } from './backup.js';
import { mergeStates, canonical } from './records.js';

const SYNC_KEY = 'familyBudget.sync.v1';
const GIST_FILENAME = 'family-budget-data.json';
const GIST_DESCRIPTION = 'Family Budget app data (auto-synced, do not edit manually)';
const API = 'https://api.github.com';
const PUSH_DEBOUNCE_MS = 800;
// "Live" mode: while the app is on screen it asks GitHub every few seconds whether the
// cloud copy changed. These are conditional requests (ETag / If-None-Match): "nothing new"
// answers (HTTP 304) are free and don't count against GitHub's rate limit.
const LIVE_POLL_MS = 5000;
const SHRINK_MIN_WEIGHT = 5;   // guard only kicks in when the bigger side has real data
const SHRINK_RATIO = 0.5;      // ...and the other side has less than half of it

let pushTimer = null;
let etag = null;          // ETag of the cloud copy we last saw
let syncedLocalAt = null; // local updatedAt at the last successful sync (=> nothing to upload)
let intervalId = null;
let autoSyncStarted = false;
let queue = Promise.resolve();
let status = { state: 'off', message: '', blocked: null, lastResult: null };
const statusListeners = new Set();

// ---------------- config ----------------

function readRaw() {
  try {
    const text = localStorage.getItem(SYNC_KEY);
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

export function getSyncConfig() {
  const raw = readRaw();
  return { token: raw.token || '', gistId: raw.gistId || null, lastSyncedAt: raw.lastSyncedAt || null };
}

export function saveSyncConfig(partial) {
  const next = { ...readRaw(), ...partial };
  localStorage.setItem(SYNC_KEY, JSON.stringify(next));
  return next;
}

export function isConfigured(cfg = getSyncConfig()) {
  return !!(cfg.token && cfg.gistId);
}

// ---------------- status ----------------

export function getSyncStatus() { return status; }

export function onSyncStatus(fn) {
  statusListeners.add(fn);
  try { fn(status); } catch { /* ignore */ }
  return () => statusListeners.delete(fn);
}

function setStatus(patch) {
  status = { ...status, ...patch };
  statusListeners.forEach(fn => { try { fn(status); } catch (e) { console.error('[sync] status listener', e); } });
}

// ---------------- GitHub API ----------------

function httpMessage(code) {
  if (code === 401) return 'token არასწორია ან ვადაგასულია (401)';
  if (code === 403) return 'GitHub-მა უარი თქვა — შეამოწმე token-ის „gist" უფლება, ან სცადე მოგვიანებით (403)';
  if (code === 404) return 'Gist ვერ მოიძებნა — შეამოწმე Gist ID (404)';
  if (code === 422) return 'GitHub-მა მონაცემები არ მიიღო (422)';
  return `GitHub-ის შეცდომა (${code})`;
}

async function api(path, { token, method = 'GET', body } = {}) {
  const headers = { Authorization: `token ${token || getSyncConfig().token}`, Accept: 'application/vnd.github+json' };
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(API + path, { method, headers, body, cache: 'no-store' });
  } catch {
    throw new Error('ინტერნეტთან კავშირი ვერ მოხერხდა');
  }
  if (!res.ok) {
    const err = new Error(httpMessage(res.status));
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function fileContent(gistData) {
  const file = gistData && gistData.files && gistData.files[GIST_FILENAME];
  if (!file) return null;
  if (file.truncated && file.raw_url) {
    const r = await fetch(file.raw_url, { cache: 'no-store' });
    if (!r.ok) throw new Error(httpMessage(r.status));
    return r.text();
  }
  return file.content;
}

function parseRemote(text) {
  if (!text) return null;
  try {
    const obj = JSON.parse(text);
    if (!(obj && typeof obj === 'object' && obj.months && typeof obj.months === 'object')) return null;
    // A copy written by an older app version is converted to the current format first.
    return upgradeState(obj);
  } catch {
    return null;
  }
}

async function fetchRemote(token, gistId) {
  const r = await fetchRemoteIfChanged(token, gistId, null);
  return r.remote;
}

/** Conditional GET: { changed:false } when the cloud copy is unchanged (HTTP 304), else { changed:true, remote }. */
async function fetchRemoteIfChanged(token, gistId, knownEtag) {
  const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' };
  if (knownEtag) headers['If-None-Match'] = knownEtag;
  let res;
  try {
    res = await fetch(`${API}/gists/${gistId}`, { headers, cache: 'no-store' });
  } catch {
    throw new Error('ინტერნეტთან კავშირი ვერ მოხერხდა');
  }
  if (res.status === 304) return { changed: false };
  if (!res.ok) {
    const err = new Error(httpMessage(res.status));
    err.status = res.status;
    throw err;
  }
  const newEtag = res.headers && typeof res.headers.get === 'function' ? res.headers.get('ETag') : null;
  const remote = parseRemote(await fileContent(await res.json()));
  etag = newEtag || null;
  return { changed: true, remote };
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Uploads the state; once a day (or when forced) also refreshes the monthly backup file. */
async function writeRemote(token, gistId, stateObj, { backup = false } = {}) {
  const content = JSON.stringify(stateObj);
  const files = { [GIST_FILENAME]: { content } };
  const raw = readRaw();
  const doBackup = backup || raw.lastCloudBackupDay !== todayKey();
  if (doBackup) files[`backup-${todayKey().slice(0, 7)}.json`] = { content };
  await api(`/gists/${gistId}`, { token, method: 'PATCH', body: JSON.stringify({ files }) });
  if (doBackup) saveSyncConfig({ lastCloudBackupDay: todayKey() });
}

// ---------------- reconcile ----------------

const time = (iso) => (iso ? new Date(iso).getTime() || 0 : 0);
const nowIso = () => new Date().toISOString();

/** Runs sync operations strictly one after another. */
function serialize(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

function shrinks(fromState, toState) {
  const from = dataWeight(fromState);
  const to = dataWeight(toState);
  return from >= SHRINK_MIN_WEIGHT && to < from * SHRINK_RATIO;
}

function block(kind, local, remote) {
  setStatus({
    state: 'blocked',
    message: '',
    blocked: { kind, local: summarizeState(local), remote: summarizeState(remote) }
  });
}

/**
 * Brings this device and the cloud copy together.
 * prefer: null (automatic MERGE) | 'local' (upload this device as-is) | 'remote' (take the cloud as-is)
 * allowShrink: user explicitly confirmed a big data reduction.
 */
async function reconcile({ prefer = null, allowShrink = false, backup = false, prefetched } = {}) {
  const cfg = getSyncConfig();
  if (!isConfigured(cfg)) { setStatus({ state: 'off', blocked: null }); return { action: 'off' }; }
  setStatus({ state: 'syncing', message: '' });

  const remote = prefetched !== undefined ? prefetched : await fetchRemote(cfg.token, cfg.gistId);
  const local = getState();
  const done = (action) => {
    saveSyncConfig({ lastSyncedAt: nowIso() });
    syncedLocalAt = getState().updatedAt;
    if (action === 'pushed' || action === 'merged') etag = null; // our own upload changed the cloud copy
    setStatus({ state: 'ok', blocked: null, lastResult: action, at: nowIso() });
    return { action };
  };

  if (prefer === 'local' || (!remote && !isPristine(local))) {
    if (!allowShrink && remote && shrinks(remote, local)) { block('push', local, remote); return { action: 'blocked' }; }
    await writeRemote(cfg.token, cfg.gistId, local, { backup });
    return done('pushed');
  }
  if (!remote) return done('none');
  if (prefer === 'remote') {
    if (!allowShrink && shrinks(local, remote)) { block('pull', local, remote); return { action: 'blocked' }; }
    replaceState(remote, { reason: 'before-sync', source: 'sync' });
    return done('pulled');
  }

  // Automatic: record-level merge (cloud first = cloud decides the list order).
  const merged = mergeStates(remote, local);
  const before = Math.max(dataWeight(local), dataWeight(remote));
  if (!allowShrink && before >= SHRINK_MIN_WEIGHT && dataWeight(merged) < before * SHRINK_RATIO) {
    block(dataWeight(local) < dataWeight(remote) ? 'push' : 'pull', local, remote);
    return { action: 'blocked' };
  }
  const cm = canonical(merged);
  const changedLocal = cm !== canonical(local);
  const changedRemote = cm !== canonical(remote);
  if (changedLocal) replaceState(merged, { reason: 'before-sync', source: 'sync' });
  if (changedRemote || backup) await writeRemote(cfg.token, cfg.gistId, changedLocal ? getState() : local, { backup });
  return done(changedLocal && changedRemote ? 'merged' : changedLocal ? 'pulled' : changedRemote ? 'pushed' : 'none');
}

function autoRun() {
  if (!isConfigured() || status.state === 'blocked') return Promise.resolve(null);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus({ state: 'offline' });
    return Promise.resolve(null);
  }
  return serialize(async () => {
    const localDirty = getState().updatedAt !== syncedLocalAt;
    if (!localDirty && etag && status.state === 'ok') {
      // Fast path: nothing to upload — just ask "did the cloud change?" (free when it didn't).
      const cfg = getSyncConfig();
      const r = await fetchRemoteIfChanged(cfg.token, cfg.gistId, etag);
      if (!r.changed) return { action: 'none' };
      return reconcile({ prefetched: r.remote });
    }
    return reconcile();
  }).catch(e => {
    setStatus({ state: 'error', message: e.message });
    return null;
  });
}

function schedulePush() {
  if (!isConfigured() || status.state === 'blocked') return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(autoRun, PUSH_DEBOUNCE_MS);
}

// ---------------- public actions ----------------

/**
 * Links this device. If gistId is empty, looks for an existing app gist on the account
 * first (so the second device only needs the token), otherwise creates one.
 * Resolves { gistId, action: 'created'|'pushed'|'pulled'|'none'|'conflict', local?, remote? }.
 */
export async function connect(tokenInput, gistIdInput) {
  const token = String(tokenInput || '').trim();
  let gistId = String(gistIdInput || '').trim() || null;
  if (!token) throw new Error('ჯერ ჩაწერე GitHub token');

  if (!gistId) {
    const gists = await api('/gists?per_page=100', { token });
    const candidates = gists.filter(g => g.files && g.files[GIST_FILENAME]);
    if (candidates.length === 1) gistId = candidates[0].id;
    if (candidates.length > 1) {
      // Several app gists (e.g. one created by mistake) — pick the one holding the most data.
      let best = null, bestWeight = -1;
      for (const g of candidates) {
        try {
          const w = dataWeight(await fetchRemote(token, g.id) || {});
          if (w > bestWeight) { best = g; bestWeight = w; }
        } catch { /* skip unreadable */ }
      }
      if (best) gistId = best.id;
    }
  }

  if (!gistId) {
    const data = await api('/gists', {
      token, method: 'POST',
      body: JSON.stringify({ description: GIST_DESCRIPTION, public: false, files: { [GIST_FILENAME]: { content: JSON.stringify(getState()) } } })
    });
    saveSyncConfig({ token, gistId: data.id, lastSyncedAt: nowIso() });
    setStatus({ state: 'ok', blocked: null, lastResult: 'created' });
    return { gistId: data.id, action: 'created' };
  }

  const remote = await fetchRemote(token, gistId); // throws on 401/404
  saveSyncConfig({ token, gistId });
  const local = getState();

  if (!remote) {
    // Linked gist has no app file yet — upload this device.
    const r = await serialize(() => reconcile({ prefer: 'local', allowShrink: true }));
    return { gistId, action: r.action };
  }
  if (dataWeight(local) === 0 || dataWeight(remote) === 0 || local.updatedAt === remote.updatedAt) {
    // One side is empty (or both identical) — a merge is lossless and simply combines them.
    const r = await serialize(() => reconcile({ allowShrink: true }));
    return { gistId, action: r.action };
  }
  // Both sides have their own data — don't guess; offer merge (recommended) / cloud / this device.
  block('connect', local, remote);
  return { gistId, action: 'conflict', local: summarizeState(local), remote: summarizeState(remote) };
}

/**
 * User decision for a blocked/conflict situation:
 * 'merge' combines both (nothing lost), 'local' keeps this device as-is, 'remote' takes the cloud as-is.
 */
export function resolveBlocked(choice) {
  setStatus({ state: 'syncing', blocked: null });
  const prefer = choice === 'local' ? 'local' : choice === 'remote' ? 'remote' : null;
  return serialize(() => reconcile({ prefer, allowShrink: true }));
}

/** Manual buttons. Both still respect the shrink guard (a big loss asks first). */
export function pullNow() {
  if (!isConfigured()) return Promise.resolve({ action: 'off' });
  return serialize(() => reconcile({ prefer: 'remote' }));
}
export function pushNow() {
  if (!isConfigured()) return Promise.resolve({ action: 'off' });
  return serialize(() => reconcile({ prefer: 'local' }));
}
export function syncNow() {
  if (!isConfigured()) return Promise.resolve({ action: 'off' });
  return serialize(() => reconcile());
}
/** Manual "save to cloud now": merge + upload + refresh this month's backup file. */
export function backupNow() {
  if (!isConfigured()) return Promise.resolve({ action: 'off' });
  return serialize(() => reconcile({ backup: true }));
}

export function disconnect() {
  etag = null;
  syncedLocalAt = null;
  saveSyncConfig({ token: '', gistId: null, lastSyncedAt: null });
  setStatus({ state: 'off', blocked: null, message: '' });
}

// ---------------- cloud history (every upload is a Gist revision) ----------------

/** Newest first. page = 1, 2, ... (30 per page). */
export async function listCloudVersions(page = 1) {
  const cfg = getSyncConfig();
  if (!isConfigured(cfg)) throw new Error('სინქრონიზაცია არ არის დაკავშირებული');
  const commits = await api(`/gists/${cfg.gistId}/commits?per_page=30&page=${page}`);
  return commits.map(c => ({ version: c.version, committedAt: c.committed_at }));
}

export async function getCloudVersion(version) {
  const cfg = getSyncConfig();
  const data = await api(`/gists/${cfg.gistId}/${version}`);
  return parseRemote(await fileContent(data));
}

/** Restores an older cloud revision on this device AND uploads it as the newest version. */
export async function restoreCloudVersion(version) {
  const remote = await getCloudVersion(version);
  if (!remote) throw new Error('ამ ვერსიაში მონაცემები ვერ მოიძებნა');
  replaceState(remote, { reason: 'before-restore', stamp: true, source: 'restore' });
  return serialize(() => reconcile({ prefer: 'local', allowShrink: true, backup: true }));
}

// ---------------- auto sync ----------------

/** Wires auto-push (on local changes) and live auto-pull (load, focus, online, every few seconds while visible). Call once. */
export function initAutoSync() {
  if (autoSyncStarted) return;
  autoSyncStarted = true;

  onStateChange(() => schedulePush());
  if (!isConfigured()) setStatus({ state: 'off' });

  autoRun();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') autoRun();
    });
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', () => autoRun());
  }
  intervalId = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    autoRun();
  }, LIVE_POLL_MS);
}

/** For tests only. */
export function _stopAutoSync() {
  if (intervalId) clearInterval(intervalId);
  if (pushTimer) clearTimeout(pushTimer);
}
