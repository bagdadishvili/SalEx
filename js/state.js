// state.js — load/save/migrate localStorage state for Family Budget app
// Single source of truth. All mutations go through updateState()/saveState().

const STORAGE_KEY = 'familyBudget.v1';
const CURRENT_VERSION = 1;
const SAVE_DEBOUNCE_MS = 300;

let saveTimer = null;
let state = null;
const listeners = new Set();

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
    settings: {
      theme: 'light',
      accentColor: '#2563eb',
      fontScale: 'medium',
      dashboardCardOrder: ['income', 'rate', 'essentials', 'georgia', 'savings', 'free', 'planVsActual'],
      planPercents: {
        essentials: 45,
        georgia: 20,
        savings: 25,
        freeGiorgi: 5,
        freeNino: 5
      },
      lastBackupAt: null
    },
    categories: [
      { id: 'cat_essentials', name: 'აუცილებელი ხარჯი', bucket: 'essentials', builtin: true },
      { id: 'cat_georgia', name: 'საქართველოში გადასარიცხი', bucket: 'georgia', builtin: true },
      { id: 'cat_other', name: 'სხვა', bucket: 'free', builtin: true }
    ],
    templates: [],
    months: {
      [thisMonth]: {
        exchangeRate: 3.00,
        income: { giorgi: 0, nino: 0 },
        plannedSavings: null,
        generatedFromTemplates: true,
        transactions: []
      }
    }
  };
}

function migrate(raw) {
  // Future migrations go here, keyed by raw.version.
  if (!raw || typeof raw !== 'object') return seedState();
  if (!raw.version) raw.version = CURRENT_VERSION;
  // Ensure required top-level shape even if partially corrupted.
  const seed = seedState();
  raw.settings = raw.settings || seed.settings;
  raw.settings.planPercents = raw.settings.planPercents || seed.settings.planPercents;
  raw.settings.dashboardCardOrder = raw.settings.dashboardCardOrder || seed.settings.dashboardCardOrder;
  raw.settings.theme = raw.settings.theme || 'light';
  raw.settings.accentColor = raw.settings.accentColor || '#2563eb';
  raw.settings.fontScale = raw.settings.fontScale || 'medium';
  if (raw.settings.lastBackupAt === undefined) raw.settings.lastBackupAt = null;
  raw.categories = Array.isArray(raw.categories) ? raw.categories : seed.categories;
  raw.templates = Array.isArray(raw.templates) ? raw.templates : [];
  raw.months = raw.months && typeof raw.months === 'object' ? raw.months : {};
  return raw;
}

function deepClone(obj) {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

export function loadState() {
  let raw = null;
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch (e) {
    console.error('[state] failed to parse localStorage, reseeding', e);
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

/** Ensures a month object exists (without template generation — that's monthEngine's job). */
export function ensureMonth(key) {
  if (!state.months[key]) {
    const keys = Object.keys(state.months).sort();
    const prevKey = keys.filter(k => k < key).pop();
    const prev = prevKey ? state.months[prevKey] : null;
    state.months[key] = {
      exchangeRate: prev ? prev.exchangeRate : 3.00,
      income: prev ? { ...prev.income } : { giorgi: 0, nino: 0 },
      plannedSavings: null,
      generatedFromTemplates: false,
      transactions: []
    };
  }
  return state.months[key];
}

/** Mutate state via a callback that receives a deep clone; result replaces state. */
export function updateState(mutator) {
  const draft = deepClone(state);
  const result = mutator(draft) || draft;
  state = result;
  saveState();
  notify();
  return state;
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

export function replaceState(newState) {
  state = migrate(deepClone(newState));
  ensureMonth(monthKey());
  saveStateImmediate();
  notify();
  return state;
}

export function wipeState() {
  state = seedState();
  saveStateImmediate();
  notify();
  return state;
}

export { todayISO, STORAGE_KEY };
