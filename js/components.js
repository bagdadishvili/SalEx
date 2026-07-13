// components.js — small shared UI building blocks reused across views.

import { el } from './ui.js';
import { getSelectedMonth, setSelectedMonth, shiftSelectedMonth, MONTH_NAMES_SHORT } from './monthNav.js';

const YEAR_RANGE_BACK = 3;
const YEAR_RANGE_FWD = 4;

/** Month selector: "◀ [year ▾] [month ▾] ▶" — calls onChange(newKey) after updating shared selection. */
export function renderMonthNav(onChange) {
  const wrap = el('div', { class: 'month-nav' });
  const prev = el('button', { class: 'icon-btn', 'aria-label': 'წინა თვე', text: '◀' });
  const next = el('button', { class: 'icon-btn', 'aria-label': 'შემდეგი თვე', text: '▶' });

  const [curY, curM] = getSelectedMonth().split('-').map(Number);
  const thisYear = new Date().getFullYear();
  const yearSelect = el('select', { class: 'month-nav__select', 'aria-label': 'წელი' });
  for (let y = thisYear - YEAR_RANGE_BACK; y <= thisYear + YEAR_RANGE_FWD; y++) {
    yearSelect.appendChild(el('option', { value: String(y), text: String(y) }));
  }
  // If the selected month's year fell outside the default range, add it so the select stays accurate.
  if (![...yearSelect.options].some(o => o.value === String(curY))) {
    const opt = el('option', { value: String(curY), text: String(curY) });
    curY < thisYear - YEAR_RANGE_BACK ? yearSelect.prepend(opt) : yearSelect.appendChild(opt);
  }
  yearSelect.value = String(curY);

  const monthSelect = el('select', { class: 'month-nav__select', 'aria-label': 'თვე' });
  MONTH_NAMES_SHORT.forEach((name, idx) => {
    monthSelect.appendChild(el('option', { value: String(idx + 1), text: name }));
  });
  monthSelect.value = String(curM);

  function syncFromSelected() {
    const [y, m] = getSelectedMonth().split('-').map(Number);
    yearSelect.value = String(y);
    monthSelect.value = String(m);
  }

  prev.addEventListener('click', () => {
    shiftSelectedMonth(-1);
    syncFromSelected();
    onChange(getSelectedMonth());
  });
  next.addEventListener('click', () => {
    shiftSelectedMonth(1);
    syncFromSelected();
    onChange(getSelectedMonth());
  });
  function commitFromSelects() {
    const y = yearSelect.value;
    const m = String(monthSelect.value).padStart(2, '0');
    setSelectedMonth(`${y}-${m}`);
    onChange(getSelectedMonth());
  }
  yearSelect.addEventListener('change', commitFromSelects);
  monthSelect.addEventListener('change', commitFromSelects);

  wrap.append(prev, yearSelect, monthSelect, next);
  return wrap;
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#94a3b8');
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 148, g: 163, b: 184 };
}

/** Colored chip for a bucket (or the special free-spending pseudo-bucket). */
export function bucketChip(bucket) {
  if (!bucket) return el('span', { class: 'chip', text: '—' });
  const { r, g, b } = hexToRgb(bucket.color);
  return el('span', {
    class: 'chip',
    style: `background: rgba(${r},${g},${b},0.15); color: ${bucket.color}; border-color: transparent;`,
    text: bucket.name
  });
}

export function ownerChip(owner) {
  const labels = { giorgi: 'გიორგი', nino: 'ნინო', shared: 'საერთო' };
  return el('span', { class: 'chip', text: labels[owner] || owner });
}

export function georgiaBadge() {
  return el('span', { class: 'chip chip--georgia-flag', text: '🇬🇪 საქართველო' });
}

export { hexToRgb };
