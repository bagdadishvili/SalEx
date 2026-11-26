// views/dash/analysis.js — analysis cards (v20, switchable): 📊 category trend chart,
// 💱 exchange-rate impact on lari payments, 🧮 "what if" for salaries and a new cost.

import { formatMoney } from '../../calc.js';
import { categoryTrend, fxImpact, whatIf, shiftKey } from '../../insights.js';
import { el } from '../../ui.js';
import { tx, personTag } from '../../texts.js';
import { MONTH_NAMES_SHORT, getUiPref, setUiPref } from '../../monthNav.js';
import { expanded } from './shared.js';

const SVG = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}
const m0 = (v) => formatMoney(v, 'EUR', 0);

/** 📊 12 months of one category (or all spending): paid bars + plan marks. */
export function trendsCard(ctx) {
  const { state, key, rerender } = ctx;
  const tops = state.categories.filter(c => !c.parentId);
  const choice = getUiPref('trendCat', 'spend');
  const topId = choice === 'spend' || tops.some(c => c.id === choice) ? choice : 'spend';
  const data = categoryTrend(state, topId, key, 12);
  const card = el('div', { class: 'card stat-card stat-card--wide trends-card' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.trends') }));
  const sel = el('select', { class: 'tpl-select', 'aria-label': 'კატეგორია' }, [
    el('option', { value: 'spend', text: 'ყველა ხარჯი (დანაზოგის გარეშე)' }),
    ...tops.map(c => el('option', { value: c.id, text: c.name }))
  ]);
  sel.value = topId;
  sel.addEventListener('change', () => { setUiPref('trendCat', sel.value); rerender(); });
  card.appendChild(sel);

  const used = data.filter(d => !d.empty);
  if (!used.length) { card.appendChild(el('div', { class: 'stat-card__sub', text: 'ჯერ გადახდილი მონაცემები არ არის.' })); return card; }
  const max = Math.max(1, ...data.map(d => Math.max(d.paid, d.target)));
  const W = 360, H = 150, top = 8, bottom = 22, bw = W / data.length;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'trend-chart', role: 'img', 'aria-label': 'ხარჯი თვეების მიხედვით' });
  data.forEach((d, i) => {
    const x = i * bw;
    const h = ((H - top - bottom) * d.paid) / max;
    const over = d.target > 0 && d.paid > d.target + 0.5;
    svg.appendChild(svgEl('rect', { x: x + bw * 0.18, y: H - bottom - h, width: bw * 0.64, height: Math.max(0, h), rx: 3, class: over ? 'trend-bar trend-bar--over' : (d.key === key ? 'trend-bar trend-bar--cur' : 'trend-bar') }));
    if (d.target > 0) {
      const ty = H - bottom - ((H - top - bottom) * d.target) / max;
      svg.appendChild(svgEl('line', { x1: x + bw * 0.1, x2: x + bw * 0.9, y1: ty, y2: ty, class: 'trend-target' }));
    }
    const label = svgEl('text', { x: x + bw / 2, y: H - 6, 'text-anchor': 'middle', class: 'trend-label' });
    label.textContent = MONTH_NAMES_SHORT[Number(d.key.slice(5, 7)) - 1].slice(0, 3);
    svg.appendChild(label);
  });
  card.appendChild(svg);
  const avg = used.reduce((s, d) => s + d.paid, 0) / used.length;
  const last = data[data.length - 1];
  card.appendChild(el('div', { class: 'stat-card__sub tabular-nums', text: `საშუალოდ ${m0(avg)}/თვე · ${MONTH_NAMES_SHORT[Number(key.slice(5, 7)) - 1]}: ${m0(last.paid)}${last.target > 0 ? ` (გეგმა ${m0(last.target)})` : ''} · ხაზი = გეგმა, წითელი = გეგმაზე მეტი` }));
  return card;
}

/** 💱 Lari payments: € really paid vs € at the month's budget rate (last 12 months). */
export function fxCard(ctx) {
  const { state, key, rerender } = ctx;
  const r = fxImpact(state.months, shiftKey(key, -11), key);
  if (!r.rows.length) return [];
  const card = el('div', { class: 'card stat-card stat-card--wide fx-card' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.fx') }));
  const good = r.gain >= 0;
  card.appendChild(el('div', { class: 'stat-card__value tabular-nums ' + (good ? 'text-success' : 'text-danger'), text: `${good ? '+' : '−'}${m0(Math.abs(r.gain))}` }));
  card.appendChild(el('div', { class: 'stat-card__sub tabular-nums', text: `12 თვეში ლარით გადახდილი ${formatMoney(r.gel, 'GEL', 0)} = ${m0(r.eurPaid)}. საშუალო კურსი ${r.avgRate.toFixed(3).replace('.', ',')} — ${good ? 'კურსმა დაგიზოგათ' : 'კურსმა დაგიჯდათ'} ${m0(Math.abs(r.gain))} თვის გეგმის კურსთან შედარებით.` }));
  const open = expanded.has('fx');
  if (open) {
    r.rows.slice().reverse().forEach(row => card.appendChild(el('div', { class: 'detail-row' }, [
      el('div', { class: 'detail-row__name', text: `${MONTH_NAMES_SHORT[Number(row.key.slice(5, 7)) - 1]} ${row.key.slice(0, 4)}` }),
      el('div', { class: 'detail-row__amount tabular-nums ' + (row.gain >= 0 ? 'text-success' : 'text-danger'), text: `${row.gain >= 0 ? '+' : '−'}${m0(Math.abs(row.gain))}` }),
      el('div', { class: 'detail-row__meta', text: `${formatMoney(row.gel, 'GEL', 0)} · კურსი ${row.rate.toFixed(3).replace('.', ',')} (გეგმა ${String(row.planRate).replace('.', ',')})` })
    ])));
  }
  const btn = el('button', { type: 'button', class: 'card-expand', 'aria-expanded': String(open), text: open ? '▲ დაკეცვა' : '▼ თვეების მიხედვით' });
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (open) expanded.delete('fx'); else expanded.add('fx'); rerender(); });
  card.appendChild(btn);
  return card;
}

// "what if" inputs survive redraws while the app is open
const wi = { giorgi: '', nino: '', cost: '', acc: 'shared' };

/** 🧮 What changes if a salary changes or a new monthly cost appears. */
export function whatIfCard(ctx) {
  const { month, categories, settings } = ctx;
  if ((month.income?.giorgi || 0) + (month.income?.nino || 0) <= 0) return [];
  const card = el('div', { class: 'card stat-card stat-card--wide whatif-card' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.whatif') }));
  const num = (k, label) => {
    const i = el('input', { type: 'text', inputmode: 'decimal', value: wi[k], placeholder: '0', 'aria-label': label });
    i.addEventListener('input', () => { wi[k] = i.value; draw(); });
    return el('div', { class: 'field' }, [el('label', { text: label }), i]);
  };
  const acc = el('select', { 'aria-label': 'ვინ იხდის' }, ['shared', 'giorgi', 'nino'].map(a => el('option', { value: a, text: personTag(a) })));
  acc.value = wi.acc;
  acc.addEventListener('change', () => { wi.acc = acc.value; draw(); });
  card.appendChild(el('div', { class: 'field-row whatif-inputs' }, [
    num('giorgi', `${personTag('giorgi')}: ხელფასი ± €`), num('nino', `${personTag('nino')}: ხელფასი ± €`),
    num('cost', 'ახალი ხარჯი თვეში €'), el('div', { class: 'field' }, [el('label', { text: 'ვინ იხდის' }), acc])
  ]));
  const out = el('div', {});
  card.appendChild(out);
  const n = (s) => Number(String(s || '').replace(',', '.').replace(/\s/g, '')) || 0;
  function draw() {
    out.innerHTML = '';
    const keep = getUiPref('splitView') !== 'full' && getUiPref('splitView') !== 'half';
    const r = whatIf(month, categories, settings, { giorgi: n(wi.giorgi), nino: n(wi.nino), cost: n(wi.cost), costAccount: wi.acc }, keep);
    const table = el('table', { class: 'split-table tabular-nums' });
    table.appendChild(el('thead', {}, [el('tr', {}, [el('th', { text: '' }), el('th', tx('person.giorgi')), el('th', tx('person.nino'))])]));
    const cell = (p, f) => {
      const a = r.before[p][f], b = r.after[p][f];
      const d = b - a;
      return el('td', { class: Math.abs(d) < 0.5 ? '' : (d > 0) === (f === 'free') ? 'text-success' : 'text-danger', text: Math.abs(d) < 0.5 ? m0(b) : `${m0(b)} (${d > 0 ? '+' : '−'}${m0(Math.abs(d))})` });
    };
    table.appendChild(el('tbody', {}, [
      el('tr', {}, [el('th', { scope: 'row', ...tx('split.toShared') }), cell('giorgi', 'toShared'), cell('nino', 'toShared')]),
      el('tr', { class: 'summary-table__free' }, [el('th', { scope: 'row', ...tx('split.free') }), cell('giorgi', 'free'), cell('nino', 'free')])
    ]));
    out.appendChild(table);
  }
  draw();
  card.appendChild(el('div', { class: 'stat-card__sub', text: 'მხოლოდ გამოთვლაა — მონაცემები არ იცვლება. ფრჩხილებში — სხვაობა ახლანდელთან.' }));
  return card;
}
