// views/dash/period.js — "მიმოხილვა პერიოდით": paid facts per month for a chosen period.

import { budgetMonthKey } from '../../state.js';
import { computeRangeOverview, formatMoney } from '../../calc.js';
import { el } from '../../ui.js';
import { tx } from '../../texts.js';
import { MONTH_NAMES_SHORT, getUiPref, setUiPref } from '../../monthNav.js';
import { cardHead } from './shared.js';

function shiftKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function yearCard({ state, key, goToMonth, rerender }) {
  // Period: remembered per device; default = the selected month's calendar year.
  const year = Number(key.slice(0, 4));
  const saved = getUiPref('overviewRange', null);
  const cur = budgetMonthKey();
  // "last N months" is kept relative, so it moves on with the calendar.
  const lastN = saved && saved.last > 0 ? Math.min(240, Math.round(saved.last)) : 0;
  const from = lastN ? shiftKey(cur, 1 - lastN) : (saved && saved.from ? saved.from : `${year}-01`);
  const to = lastN ? cur : (saved && saved.to ? saved.to : `${year}-12`);
  const yo = computeRangeOverview(state.months, state.categories, from, to);
  const card = el('div', { class: 'card stat-card stat-card--wide year-card' });
  const { head, box } = cardHead(tx('card.year'), 'ნაჩვენებია მხოლოდ ფაქტობრივად გადახდილი ტრანზაქციები (ცარიელი თვეები არ ჩანს). თვეზე შეხებით გადახვალ იმ თვეში.');
  card.append(head, box);

  const fromIn = el('input', { type: 'month', value: from, class: 'period__input', 'aria-label': 'საიდან' });
  const toIn = el('input', { type: 'month', value: to, class: 'period__input', 'aria-label': 'სადამდე' });
  const apply = (f, tt) => { setUiPref('overviewRange', f && tt ? { from: f <= tt ? f : tt, to: f <= tt ? tt : f } : null); rerender(); };
  fromIn.addEventListener('change', () => apply(fromIn.value, toIn.value));
  toIn.addEventListener('change', () => apply(fromIn.value, toIn.value));

  const thisYear = !lastN && from === `${cur.slice(0, 4)}-01` && to === `${cur.slice(0, 4)}-12`;
  const yearBtn = el('button', { type: 'button', class: 'filter-btn', 'aria-pressed': String(thisYear), text: 'ეს წელი' });
  yearBtn.addEventListener('click', () => apply(`${cur.slice(0, 4)}-01`, `${cur.slice(0, 4)}-12`));
  // "ბოლო [N] თვე": pick from the list, or "სხვა…" and type any number.
  const PRESETS = [2, 3, 4, 6, 9, 12, 18, 24, 36];
  const lastSel = el('select', { class: 'period__last' + (lastN ? ' period__last--on' : ''), 'aria-label': 'ბოლო რამდენი თვე' }, [
    el('option', { value: '', text: 'ბოლო — თვე' }),
    ...PRESETS.map(n => el('option', { value: String(n), text: `ბოლო ${n} თვე` })),
    ...(lastN && !PRESETS.includes(lastN) ? [el('option', { value: String(lastN), text: `ბოლო ${lastN} თვე` })] : []),
    el('option', { value: 'other', text: 'სხვა რაოდენობა…' })
  ]);
  lastSel.value = lastN ? String(lastN) : '';
  const lastIn = el('input', { type: 'number', inputmode: 'numeric', min: '1', max: '240', class: 'period__lastnum', placeholder: 'თვე', 'aria-label': 'რამდენი თვე', hidden: 'true' });
  const setLast = (n) => { if (n > 0) { setUiPref('overviewRange', { last: Math.min(240, Math.round(n)) }); rerender(); } };
  lastSel.addEventListener('change', () => {
    if (lastSel.value === 'other') { lastIn.hidden = false; lastIn.focus(); return; }
    if (lastSel.value) setLast(Number(lastSel.value));
  });
  lastIn.addEventListener('change', () => setLast(Number(lastIn.value)));
  lastIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') setLast(Number(lastIn.value)); });
  card.appendChild(el('div', { class: 'period' }, [
    el('div', { class: 'period__inputs' }, [fromIn, el('span', { class: 'period__dash', text: '—' }), toIn]),
    el('div', { class: 'filter-row period__quick' }, [yearBtn, lastSel, lastIn])
  ]));

  if (!yo.rows.length) {
    card.appendChild(el('div', { class: 'empty-state', text: 'ამ პერიოდში მონაცემები არ არის' }));
    return card;
  }
  const m0 = (v) => formatMoney(v, 'EUR', 0);
  const table = el('table', { class: 'year-table tabular-nums' });
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { text: 'თვე' }), el('th', { text: 'შემოს.' }), el('th', { text: 'ხარჯი' }),
    el('th', { text: 'დანაზ.' }), el('th', { text: 'ნაშთი' })
  ])]));
  const tbody = el('tbody', {});
  const multiYear = from.slice(0, 4) !== to.slice(0, 4);
  yo.rows.forEach(r => {
    const label = `${MONTH_NAMES_SHORT[r.month - 1]}${multiYear ? ` ${r.key.slice(2, 4)}` : ''}`;
    const tr = el('tr', { class: 'year-table__row' + (r.key === key ? ' year-table__row--current' : ''), tabindex: '0', role: 'button', 'aria-label': `${label} — გახსნა` }, [
      el('td', { text: label }),
      el('td', { text: m0(r.income) }),
      el('td', { text: m0(r.spent) }),
      el('td', { class: 'text-success', text: m0(r.saved) }),
      el('td', { class: r.leftover < -0.5 ? 'text-danger' : '', text: m0(r.leftover) })
    ]);
    const open = () => goToMonth(r.key);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  const t = yo.totals, a = yo.average;
  // Total and average are set apart from the months (own rows with a gap and a tint).
  table.appendChild(el('tfoot', {}, [
    el('tr', { class: 'year-table__gap', 'aria-hidden': 'true' }, [el('td', { colspan: '5' })]),
    el('tr', { class: 'year-table__sum' }, [el('th', { text: 'ჯამი' }), el('th', { text: m0(t.income) }), el('th', { text: m0(t.spent) }), el('th', { text: m0(t.saved) }), el('th', { text: m0(t.leftover) })]),
    el('tr', { class: 'year-table__gap', 'aria-hidden': 'true' }, [el('td', { colspan: '5' })]),
    el('tr', { class: 'year-table__avg' }, [el('td', { text: 'საშ./თვე' }), el('td', { text: m0(a.income) }), el('td', { text: m0(a.spent) }), el('td', { text: m0(a.saved) }), el('td', { text: m0(a.leftover) })])
  ]));
  card.appendChild(el('div', { class: 'year-table-wrap' }, [table]));
  return card;
}
