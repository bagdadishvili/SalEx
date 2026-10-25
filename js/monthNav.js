// monthNav.js — shared "currently selected month" across Dashboard & Transactions views.
// The choice is remembered per device (separate key, never synced or exported), so the
// app reopens on the month you looked at last.

import { monthKey } from './state.js';

const UI_KEY = 'familyBudget.ui.v1';
const VALID_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function readUi() {
  try {
    const text = typeof localStorage !== 'undefined' ? localStorage.getItem(UI_KEY) : null;
    return text ? JSON.parse(text) || {} : {};
  } catch {
    return {};
  }
}

function writeUi(partial) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ ...readUi(), ...partial }));
  } catch { /* storage unavailable — selection just won't be remembered */ }
}

function initialMonth() {
  const saved = readUi().selectedMonth;
  return saved && VALID_MONTH.test(saved) ? saved : monthKey();
}

/** Small per-device preferences (not synced): e.g. dismissed month-preparation cards. */
export function getUiPref(key, fallback = null) {
  const v = readUi()[key];
  return v === undefined ? fallback : v;
}
export function setUiPref(key, value) {
  writeUi({ [key]: value });
}

let selected = initialMonth();
const listeners = new Set();

export const MONTH_NAMES_SHORT = ['იან', 'თებ', 'მარ', 'აპრ', 'მაი', 'ივნ', 'ივლ', 'აგვ', 'სექ', 'ოქტ', 'ნოე', 'დეკ'];
export const MONTH_NAMES_FULL = [
  'იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი',
  'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'
];

export function getSelectedMonth() {
  return selected;
}

export function setSelectedMonth(key) {
  if (!VALID_MONTH.test(String(key))) return;
  selected = key;
  writeUi({ selectedMonth: key });
  listeners.forEach(fn => fn(selected));
}

export function shiftMonthKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function shiftSelectedMonth(delta) {
  setSelectedMonth(shiftMonthKey(selected, delta));
}

export function onMonthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES_SHORT[m - 1]} ${y}`;
}

export function monthLabelFull(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES_FULL[m - 1]} ${y}`;
}
