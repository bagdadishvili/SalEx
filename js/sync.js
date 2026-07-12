// sync.js — optional cross-device sync via a private GitHub Gist.
// The token + gist id live in a SEPARATE localStorage key so they never end up inside
// JSON/CSV backups (those are meant to be shareable/portable, secrets are not).

import { getState, replaceState, onStateChange } from './state.js';

const SYNC_KEY = 'familyBudget.sync.v1';
const GIST_FILENAME = 'family-budget-data.json';
const GIST_DESCRIPTION = 'Family Budget app data (auto-synced, do not edit manually)';
const PUSH_DEBOUNCE_MS = 2000;
const AUTO_PULL_INTERVAL_MS = 60000;

let pushTimer = null;
let autoSyncStarted = false;

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
  const current = readRaw();
  const next = { ...current, ...partial };
  localStorage.setItem(SYNC_KEY, JSON.stringify(next));
  return next;
}

function authHeaders(token) {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json'
  };
}

async function createGist(token, content) {
  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: { [GIST_FILENAME]: { content } }
    })
  });
  if (!res.ok) throw new Error(`Gist შექმნა ვერ მოხერხდა (${res.status})`);
  const data = await res.json();
  return data.id;
}

async function fetchGist(token, gistId) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Gist-ის წაკითხვა ვერ მოხერხდა (${res.status})`);
  const data = await res.json();
  const file = data.files && data.files[GIST_FILENAME];
  if (!file) return null;
  return file.content;
}

async function updateGist(token, gistId, content) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } })
  });
  if (!res.ok) throw new Error(`Gist-ის განახლება ვერ მოხერხდა (${res.status})`);
}

/** First-time connect: creates a gist if none is linked yet, otherwise verifies the existing one. Returns the gist id. */
export async function connect() {
  const cfg = getSyncConfig();
  if (!cfg.token) throw new Error('ჯერ ჩაწერე GitHub token');

  if (cfg.gistId) {
    // Already linked — just confirm we can read it.
    await fetchGist(cfg.token, cfg.gistId);
    return cfg.gistId;
  }

  const content = JSON.stringify(getState());
  const gistId = await createGist(cfg.token, content);
  saveSyncConfig({ gistId, lastSyncedAt: new Date().toISOString() });
  return gistId;
}

export async function pushNow() {
  const cfg = getSyncConfig();
  if (!cfg.token || !cfg.gistId) return false;
  const content = JSON.stringify(getState());
  await updateGist(cfg.token, cfg.gistId, content);
  saveSyncConfig({ lastSyncedAt: new Date().toISOString() });
  return true;
}

/** Pulls remote state; if it is newer than local (by updatedAt), applies it. Returns true if applied. */
export async function pullNow() {
  const cfg = getSyncConfig();
  if (!cfg.token || !cfg.gistId) return false;
  const content = await fetchGist(cfg.token, cfg.gistId);
  if (!content) return false;

  let remote;
  try {
    remote = JSON.parse(content);
  } catch {
    return false;
  }

  const local = getState();
  const remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
  const localTime = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;

  saveSyncConfig({ lastSyncedAt: new Date().toISOString() });

  if (remoteTime > localTime) {
    replaceState(remote);
    return true;
  }
  return false;
}

function schedulePush() {
  const cfg = getSyncConfig();
  if (!cfg.token || !cfg.gistId) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushNow().catch(err => console.warn('[sync] push failed', err));
  }, PUSH_DEBOUNCE_MS);
}

/** Wires auto-push (on every local state change) and auto-pull (on load, focus, and interval). Call once from app.js. */
export function initAutoSync() {
  if (autoSyncStarted) return;
  autoSyncStarted = true;

  onStateChange(() => schedulePush());

  const cfg = getSyncConfig();
  if (!cfg.token || !cfg.gistId) return;

  pullNow().then(pulled => { if (pulled) location.reload(); }).catch(err => console.warn('[sync] initial pull failed', err));

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        pullNow().then(pulled => { if (pulled) location.reload(); }).catch(err => console.warn('[sync] pull failed', err));
      }
    });
  }

  setInterval(() => {
    pullNow().then(pulled => { if (pulled) location.reload(); }).catch(err => console.warn('[sync] periodic pull failed', err));
  }, AUTO_PULL_INTERVAL_MS);
}
