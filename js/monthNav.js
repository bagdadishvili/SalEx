// monthNav.js — shared "currently selected month" across Dashboard & Transactions views.

import { monthKey } from './state.js';

let selected = monthKey();
const listeners = new Set();

export function getSelectedMonth() {
  return selected;
}

export function setSelectedMonth(key) {
  selected = key;
  listeners.forEach(fn => fn(selected));
}

export function shiftSelectedMonth(delta) {
  const [y, m] = selected.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  setSelectedMonth(`${ny}-${String(nm).padStart(2, '0')}`);
}

export function onMonthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function monthLabel(key) {
  const names = ['იან', 'თებ', 'მარ', 'აპრ', 'მაი', 'ივნ', 'ივლ', 'აგვ', 'სექ', 'ოქტ', 'ნოე', 'დეკ'];
  const [y, m] = key.split('-').map(Number);
  return `${names[m - 1]} ${y}`;
}
