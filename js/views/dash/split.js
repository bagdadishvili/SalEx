// views/dash/split.js — "💸 ვინ რამდენი გადარიცხოს (50/50)": who transfers what, two variants.

import { computeSalarySplit, formatMoney, formatPercent } from '../../calc.js';
import { el } from '../../ui.js';
import { tx, personName } from '../../texts.js';
import { getUiPref, setUiPref } from '../../monthNav.js';

export function splitCard({ month, categories, settings, rerender }) {
  const card = el('div', { class: 'card stat-card stat-card--wide split-card' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.split') }));
  if ((month.income?.giorgi || 0) + (month.income?.nino || 0) <= 0) {
    card.appendChild(el('div', { class: 'stat-card__sub', text: 'ჩაწერე ამ თვის ხელფასები („შემოსავალი") — აქ გამოჩნდება, ვინ სად რამდენი უნდა გადარიცხოს.' }));
    return card;
  }
  // Both variants split the month's shared costs 50/50; they differ only in the route of the money.
  const view = getUiPref('splitView') === 'half' || getUiPref('splitView') === 'full' ? 'full' : 'keep';
  const sp = computeSalarySplit(month, categories, settings, { mode: 'equal', keepDebits: view === 'keep' });
  const m0 = (v) => formatMoney(v, 'EUR', 0);

  const tabs = el('div', { class: 'segmented split-tabs', role: 'tablist' });
  [['keep', 'split.tabKeep'], ['full', 'split.tabFull']].forEach(([k, tkey]) => {
    const b = el('button', { type: 'button', class: 'segmented__btn', 'aria-pressed': String(view === k), ...tx(tkey) });
    b.addEventListener('click', () => { setUiPref('splitView', k); rerender(); });
    tabs.appendChild(b);
  });
  card.appendChild(tabs);

  const P = sp.persons;
  const table = el('table', { class: 'split-table tabular-nums' });
  table.appendChild(el('thead', {}, [el('tr', {}, [el('th', { text: '' }), el('th', tx('person.giorgi')), el('th', tx('person.nino'))])]));
  const row = (labelKey, key, opts = {}) => {
    const g = P.giorgi[key], n = P.nino[key];
    if (opts.hideIfZero && Math.abs(g) < 0.5 && Math.abs(n) < 0.5) return null;
    const cell = (v) => el('td', { class: (opts.strong ? 'split-table__strong' : '') + (v < -0.5 ? ' text-danger' : ''), text: m0(v) });
    return el('tr', { class: opts.cls || '' }, [el('th', { scope: 'row', ...tx(labelKey) }), cell(g), cell(n)]);
  };
  table.appendChild(el('tbody', {}, [
    row('split.income', 'income', { cls: 'split-table__income' }),
    row('split.toShared', 'toShared', { strong: true, cls: 'split-table__main' }),
    view === 'keep'
      ? row('split.keep', 'keepForDebits', { hideIfZero: true })
      : row('split.back', 'backFromShared', { hideIfZero: true }),
    row('split.savings', 'savings', { hideIfZero: true }),
    row('split.free', 'free', { strong: true })
  ].filter(Boolean)));
  card.appendChild(table);

  const notes = [];
  const short = ['giorgi', 'nino'].filter(p => P[p].free < -0.5).map(p => `${personName(p)}: აკლია ${m0(-P[p].free)}`);
  if (short.length) notes.push(`⚠️ ხელფასი არ ჰყოფნის (${short.join(', ')}).`);
  notes.push(view === 'keep'
    ? 'თითოეულის ანგარიშიდან ჩამოსაჭრელი გადასახადები იქვე რჩება, დანარჩენი ნახევარი — საერთოზე. წინ და უკან გადარიცხვა არ სჭირდება.'
    : 'ორივე მთელ ნახევარს რიცხავს საერთოზე; შემდეგ საერთოდან უკან გადადის ის თანხა, რაც პირადი ანგარიშიდან იჭრება.');
  notes.push(`თვის საერთო ხარჯი ${m0(sp.spendPlannedTotal)} (${formatPercent(sp.spendPct, 0)} შემოსავლის) · საერთოდან გადის ${m0(sp.sharedNeeds)}.`);
  card.appendChild(el('div', { class: 'stat-card__sub split-notes', text: notes.join(' ') }));
  return card;
}
