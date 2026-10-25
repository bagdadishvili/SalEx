// state.js — load/save/migrate localStorage state for Family Budget app
// Single source of truth. All mutations go through updateState()/saveState().

import { saveSnapshot, summarizeState } from './backup.js';
import { stampChanges, restampAll, fillMissingStamps, EPOCH } from './records.js';

const STORAGE_KEY = 'familyBudget.v1';
const CURRENT_VERSION = 4;
const SAVE_DEBOUNCE_MS = 300;
const FREE_BUCKET_ID = 'free';
// A freshly seeded (never edited) state carries this timestamp, so it can never look
// "newer" than real data from another device and overwrite it during sync.
const PRISTINE_UPDATED_AT = EPOCH;

let saveTimer = null;
let state = null;
const listeners = new Set();
const replaceListeners = new Set();

/** Returns YYYY-MM for a given Date (local time). */
export function monthKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function seedState() {
  const thisMonth = monthKey();
  return {
    version: CURRENT_VERSION,
    updatedAt: PRISTINE_UPDATED_AT,
    settings: {
      theme: 'light',
      accentColor: '#2563eb',
      fontScale: 'medium',
      dashboardCardOrder: ['summary', 'due', 'envelopes', 'income', 'rate', 'georgia', 'cat_essentials', 'cat_savings', 'free', 'split', 'planVsActual', 'year'],
      // How the two salaries fund the shared costs: 'proportional' (same % of each salary) or 'equal' (50/50).
      contributionSplit: 'proportional',
      // 'actual' = transfer exactly the planned bills; 'plan' = transfer the category % of income.
      contributionBasis: 'actual',
      rateAuto: true,
      _u: EPOCH,
      planFree: {
        giorgi: { percent: 5, color: '#7c3aed' },
        nino: { percent: 5, color: '#db2777' }
      },
      lastBackupAt: null,
      backupReminderDismissedAt: null
    },
    // Unified category model (v3): a category is ALSO a dashboard block.
    // parentId: null = own dashboard card; 'free' = counts as personal free spending;
    // another category's id = its amounts are included in that category's card.
    categories: [
      { id: 'cat_essentials', name: 'აუცილებელი', percent: 65, color: '#2563eb', goalType: 'max', georgiaTransfer: false, parentId: null, _u: EPOCH },
      { id: 'cat_georgia', name: 'საქართველოში გადასარიცხი', percent: 0, color: '#d97706', goalType: 'max', georgiaTransfer: true, parentId: 'cat_essentials', _u: EPOCH },
      { id: 'cat_savings', name: 'დანაზოგი', percent: 25, color: '#16a34a', goalType: 'min', georgiaTransfer: false, parentId: null, _u: EPOCH },
      { id: 'cat_other', name: 'სხვა', percent: 0, color: '#94a3b8', goalType: 'max', georgiaTransfer: false, parentId: FREE_BUCKET_ID, _u: EPOCH }
    ],
    templates: [],
    months: {
      [thisMonth]: {
        exchangeRate: 3.00,
        income: { giorgi: 0, nino: 0 },
        plannedSavings: null,
        generatedFromTemplates: false,
        skipTemplates: [],
        _u: EPOCH,
        transactions: []
      }
    },
    deleted: {}
  };
}

function migrateV1ToV2(raw) {
  const oldPercents = (raw.settings && raw.settings.planPercents) || { essentials: 45, georgia: 20, savings: 25, freeGiorgi: 5, freeNino: 5 };
  const buckets = [
    { id: 'bucket_essentials', name: 'აუცილებელი', percent: (oldPercents.essentials || 0) + (oldPercents.georgia || 0), color: '#2563eb', goalType: 'max' },
    { id: 'bucket_savings', name: 'დანაზოგი', percent: oldPercents.savings || 0, color: '#16a34a', goalType: 'min' }
  ];
  const planFree = {
    giorgi: { percent: oldPercents.freeGiorgi || 0, color: '#7c3aed' },
    nino: { percent: oldPercents.freeNino || 0, color: '#db2777' }
  };
  const bucketMap = { essentials: 'bucket_essentials', georgia: 'bucket_essentials', savings: 'bucket_savings', free: FREE_BUCKET_ID };

  raw.categories = (raw.categories || []).map(cat => ({
    id: cat.id,
    name: cat.name,
    bucketId: bucketMap[cat.bucket] || FREE_BUCKET_ID,
    georgiaTransfer: cat.bucket === 'georgia'
  }));

  raw.settings = raw.settings || {};
  raw.settings.buckets = buckets;
  raw.settings.planFree = planFree;
  raw.settings.dashboardCardOrder = ['income', 'rate', 'georgia', 'buckets', 'free', 'planVsActual'];
  delete raw.settings.planPercents;

  raw.version = 2;
  return raw;
}

/** v3: merge the old two-level buckets+categories model into unified categories. */
function migrateV2ToV3(raw) {
  const buckets = (raw.settings && Array.isArray(raw.settings.buckets)) ? raw.settings.buckets : [];
  const oldCats = Array.isArray(raw.categories) ? raw.categories : [];
  const newCats = [];

  buckets.forEach(b => {
    const members = oldCats.filter(c => c.bucketId === b.id);
    if (!members.length) {
      // Bucket with no categories becomes a category itself (so it stays visible & assignable).
      newCats.push({ id: b.id, name: b.name, percent: b.percent || 0, color: b.color || '#2563eb', goalType: b.goalType || 'max', georgiaTransfer: false, parentId: null });
    } else {
      members.forEach((c, i) => newCats.push({
        id: c.id, name: c.name,
        percent: i === 0 ? (b.percent || 0) : 0,
        color: b.color || '#2563eb',
        goalType: b.goalType || 'max',
        georgiaTransfer: !!c.georgiaTransfer,
        parentId: i === 0 ? null : members[0].id
      }));
    }
  });
  // Free-bucket (and orphaned) categories become free-spending categories.
  oldCats.forEach(c => {
    if (newCats.some(n => n.id === c.id)) return;
    newCats.push({ id: c.id, name: c.name, percent: 0, color: '#94a3b8', goalType: 'max', georgiaTransfer: !!c.georgiaTransfer, parentId: FREE_BUCKET_ID });
  });

  raw.categories = newCats;
  if (raw.settings) {
    delete raw.settings.buckets;
    const order = Array.isArray(raw.settings.dashboardCardOrder) ? raw.settings.dashboardCardOrder : [];
    const topIds = newCats.filter(c => !c.parentId).map(c => c.id);
    const i = order.indexOf('buckets');
    if (i >= 0) order.splice(i, 1, ...topIds);
    raw.settings.dashboardCardOrder = order;
  }
  raw.version = 3;
  return raw;
}

/** v4: payment account on templates/transactions + per-record change stamps (for merge sync). */
function migrateV3ToV4(raw) {
  (raw.templates || []).forEach(t => { if (!t.account) t.account = 'shared'; });
  Object.values(raw.months || {}).forEach(m => {
    (m.transactions || []).forEach(t => { if (!t.account) t.account = 'shared'; });
  });
  fillMissingStamps(raw, raw.updatedAt || EPOCH);
  raw.version = 4;
  return raw;
}

function migrate(raw) {
  if (!raw || typeof raw !== 'object') return seedState();
  if (!raw.version) raw.version = 1;

  if (raw.version < 2) {
    raw = migrateV1ToV2(raw);
  }
  if (raw.version < 3) {
    raw = migrateV2ToV3(raw);
  }
  if (raw.version < 4) {
    raw = migrateV3ToV4(raw);
  }

  // Ensure required top-level shape even if partially corrupted.
  const seed = seedState();
  raw.settings = raw.settings || seed.settings;
  raw.settings.planFree = raw.settings.planFree || seed.settings.planFree;
  raw.settings.dashboardCardOrder = raw.settings.dashboardCardOrder || seed.settings.dashboardCardOrder;
  raw.settings.theme = raw.settings.theme || 'light';
  raw.settings.accentColor = raw.settings.accentColor || '#2563eb';
  raw.settings.fontScale = raw.settings.fontScale || 'medium';
  if (raw.settings.lastBackupAt === undefined) raw.settings.lastBackupAt = null;
  if (raw.settings.backupReminderDismissedAt === undefined) raw.settings.backupReminderDismissedAt = null;
  if (!['proportional', 'equal'].includes(raw.settings.contributionSplit)) raw.settings.contributionSplit = 'proportional';
  if (!['actual', 'plan'].includes(raw.settings.contributionBasis)) raw.settings.contributionBasis = 'actual';
  if (typeof raw.settings.rateAuto !== 'boolean') raw.settings.rateAuto = true;
  raw.categories = Array.isArray(raw.categories) && raw.categories.length ? raw.categories : seed.categories;
  raw.categories.forEach(c => {
    if (typeof c.percent !== 'number') c.percent = 0;
    if (!c.color) c.color = '#94a3b8';
    if (!c.goalType) c.goalType = 'max';
    if (c.parentId === undefined) c.parentId = null;
    c.georgiaTransfer = !!c.georgiaTransfer;
  });
  raw.templates = Array.isArray(raw.templates) ? raw.templates : [];
  raw.months = raw.months && typeof raw.months === 'object' ? raw.months : {};
  // Drop malformed month keys (an old bug could create e.g. "[object Object]").
  Object.keys(raw.months).forEach(k => {
    if (!/^\d{4}-\d{2}$/.test(k)) { delete raw.months[k]; return; }
    const m = raw.months[k];
    if (!Array.isArray(m.transactions)) m.transactions = [];
    if (!Array.isArray(m.skipTemplates)) m.skipTemplates = [];
    m.transactions.forEach(t => { if (!t.account) t.account = 'shared'; });
  });
  raw.templates.forEach(t => { if (!t.account) t.account = 'shared'; });
  fillMissingStamps(raw, raw.updatedAt || EPOCH);
  // New dashboard card: month summary (added later, keep existing user order intact).
  if (!raw.settings.dashboardCardOrder.includes('summary')) {
    raw.settings.dashboardCardOrder.unshift('summary');
  }
  if (!raw.updatedAt) raw.updatedAt = PRISTINE_UPDATED_AT;
  raw.version = CURRENT_VERSION;
  return raw;
}

function deepClone(obj) {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

export function loadState() {
  let raw = null;
  let text = null;
  try {
    text = localStorage.getItem(STORAGE_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch (e) {
    console.error('[state] failed to parse localStorage, reseeding', e);
    // Never silently destroy unreadable data — park it under a separate key first.
    try { if (text) localStorage.setItem(`${STORAGE_KEY}.corrupt-${Date.now()}`, text); } catch { /* quota */ }
    raw = null;
  }
  state = raw ? migrate(raw) : seedState();
  ensureMonth(monthKey());
  saveStateImmediate();
  return state;
}

export function getState() {
  if (!state) return loadState();
  return state;
}

/**
 * Ensures a month object exists (without template generation — that's monthEngine's job).
 * Accepts (target, key) where target is a state object/draft, or just (key) to use the live state.
 */
export function ensureMonth(target, key) {
  let obj = target;
  if (typeof target === 'string' && key === undefined) {
    obj = state;
    key = target;
  }
  if (!obj || typeof obj.months !== 'object') return null;
  if (!obj.months[key]) {
    const keys = Object.keys(obj.months).sort();
    const prevKey = keys.filter(k => k < key).pop();
    const prev = prevKey ? obj.months[prevKey] : null;
    obj.months[key] = {
      exchangeRate: prev ? prev.exchangeRate : 3.00,
      income: prev ? { ...prev.income } : { giorgi: 0, nino: 0 },
      plannedSavings: null,
      generatedFromTemplates: false,
      skipTemplates: [],
      _u: EPOCH, // derived, not a user edit — must never beat real data in a merge
      transactions: []
    };
  }
  return obj.months[key];
}

/**
 * Mutate state via a callback that receives a deep clone; result replaces state.
 * No-op mutations (nothing actually changed) are ignored entirely — no save, no
 * updatedAt bump, no sync push.
 */
export function updateState(mutator) {
  const before = JSON.stringify(state);
  const draft = deepClone(state);
  const result = mutator(draft) || draft;
  result.updatedAt = state.updatedAt;
  if (JSON.stringify(result) === before) return state;
  const now = new Date().toISOString();
  stampChanges(state, result, now);
  result.updatedAt = now;
  state = result;
  saveState();
  notify();
  return state;
}

/** True if this state was never edited on this device (fresh seed / empty). */
export function isPristine(s = state) {
  return !s || !s.updatedAt || s.updatedAt === PRISTINE_UPDATED_AT;
}

/** How much real user data a state holds (templates + transactions + months with income). */
export function dataWeight(s = state) {
  const sum = summarizeState(s);
  return sum.templates + sum.transactions + sum.months;
}

/** Fire-and-forget restore point of the CURRENT state (skipped for an untouched seed). */
export function snapshotCurrent(reason) {
  if (!state || (isPristine(state) && dataWeight(state) === 0)) return Promise.resolve(false);
  return saveSnapshot(deepClone(state), reason);
}

function notify() {
  listeners.forEach(fn => {
    try { fn(state); } catch (e) { console.error('[state] listener error', e); }
  });
}

export function onStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Called after the whole state was swapped (sync pull, restore, another tab). fn(source). */
export function onStateReplaced(fn) {
  replaceListeners.add(fn);
  return () => replaceListeners.delete(fn);
}

function notifyReplaced(source) {
  replaceListeners.forEach(fn => {
    try { fn(source); } catch (e) { console.error('[state] replace listener error', e); }
  });
}

// Another tab/window of the app saved — adopt its data instead of later overwriting it.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      state = migrate(JSON.parse(e.newValue));
      notify();
      notifyReplaced('other-tab');
    } catch (err) {
      console.warn('[state] could not adopt change from another tab', err);
    }
  });
}

export function saveState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStateImmediate, SAVE_DEBOUNCE_MS);
}

export function saveStateImmediate() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('[state] save failed', e);
    showQuotaError();
  }
}

function showQuotaError() {
  const el = document.getElementById('toast-root');
  if (!el) { alert('შენახვის შეცდომა — გთხოვთ, დაუყოვნებლივ გააკეთოთ JSON ექსპორტი, სივრცე ამოწურულია.'); return; }
  const div = document.createElement('div');
  div.className = 'toast toast--error';
  div.textContent = 'შენახვის შეცდომა! გთხოვთ დაუყოვნებლივ გააკეთოთ JSON ექსპორტი — სივრცე ამოწურულია.';
  el.appendChild(div);
  setTimeout(() => div.remove(), 6000);
}

/**
 * Replaces the whole state (import, sync pull, restore).
 * opts.reason — snapshot label for the restore point taken BEFORE replacing.
 * opts.stamp  — mark as edited now (import/restore), so it wins the next sync.
 */
export function replaceState(newState, { reason = 'before-import', stamp = false, source = 'import' } = {}) {
  snapshotCurrent(reason);
  state = migrate(deepClone(newState));
  if (stamp) {
    // Import/restore = a deliberate user choice: make its records win over old deletions.
    const now = new Date().toISOString();
    restampAll(state, now);
    state.updatedAt = now;
  }
  ensureMonth(monthKey());
  saveStateImmediate();
  notify();
  notifyReplaced(source);
  return state;
}

export function wipeState() {
  snapshotCurrent('before-wipe');
  state = seedState();
  state.updatedAt = new Date().toISOString();
  saveStateImmediate();
  notify();
  notifyReplaced('wipe');
  return state;
}

export { todayISO, STORAGE_KEY, FREE_BUCKET_ID, PRISTINE_UPDATED_AT };
