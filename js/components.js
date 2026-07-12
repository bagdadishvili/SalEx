// components.js — small shared UI building blocks reused across views.

import { el } from './ui.js';
import { getSelectedMonth, setSelectedMonth, shiftSelectedMonth, monthLabel } from './monthNav.js';

/** Month selector "◀ AGV 2026 ▶" — calls onChange(newKey) after updating shared selection. */
export function renderMonthNav(onChange) {
  const wrap = el('div', { class: 'month-nav' });
  const prev = el('button', { class: 'icon-btn', 'aria-label': 'წინა თვე', text: '◀' });
  const label = el('span', { class: 'month-nav__label', text: monthLabel(getSelectedMonth()) });
  const next = el('button', { class: 'icon-btn', 'aria-label': 'შემდეგი თვე', text: '▶' });

  prev.addEventListener('click', () => {
    shiftSelectedMonth(-1);
    label.textContent = monthLabel(getSelectedMonth());
    onChange(getSelectedMonth());
  });
  next.addEventListener('click', () => {
    shiftSelectedMonth(1);
    label.textContent = monthLabel(getSelectedMonth());
    onChange(getSelectedMonth());
  });

  wrap.append(prev, label, next);
  return wrap;
}

const BUCKET_LABELS = {
  essentials: 'აუცილებელი',
  georgia: 'საქართველო',
  savings: 'დანაზოგი',
  free: 'თავისუფალი'
};

export function bucketChip(bucket) {
  return el('span', { class: `chip chip--${bucket}`, text: BUCKET_LABELS[bucket] || bucket });
}

export function ownerChip(owner) {
  const labels = { giorgi: 'გიორგი', nino: 'ნინო', shared: 'საერთო' };
  return el('span', { class: 'chip', text: labels[owner] || owner });
}

export { BUCKET_LABELS };
