// views/dashboard.js — compact dashboard cards, driven by the user's configured buckets.

import { getState, updateState } from '../state.js';
import { generateMonthTransactions, monthNeedsGeneration } from '../monthEngine.js';
import { computeDashboard, computePlanVsActual, computeMonthTotals, formatMoney, formatPercent, parseAmountInput } from '../calc.js';
import { el, savedToast } from '../ui.js';
import { getSelectedMonth, onMonthChange } from '../monthNav.js';
import { renderMonthNav } from '../components.js';

let unsubscribe = null;

export function renderDashboard(root) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }

  const container = el('div', { class: 'dashboard-view' });
  root.appendChild(container);

  const monthNav = renderMonthNav(() => draw());
  container.appendChild(monthNav);

  const cardsWrap = el('div', { class: 'card-grid' });
  container.appendChild(cardsWrap);

  unsubscribe = onMonthChange(() => {
    // View was replaced by another route — stop listening instead of drawing into detached DOM.
    if (!container.isConnected) {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      return;
    }
    draw();
  });

  function ensureCurrentMonth() {
    const key = getSelectedMonth();
    // Only touch state when something would actually change — avoids bumping
    // updatedAt (and triggering sync pushes) on every render.
    if (monthNeedsGeneration(getState(), key)) {
      updateState(draft => { generateMonthTransactions(draft, key); return draft; });
    }
    return key;
  }

  function draw() {
    const key = ensureCurrentMonth();
    const state = getState();
    const month = state.months[key];
    const { categories, settings } = state;
    const dash = computeDashboard(month, categories, settings);
    const pva = computePlanVsActual(month, categories, settings);

    cardsWrap.innerHTML = '';
    const order = settings.dashboardCardOrder.length ? settings.dashboardCardOrder : ['summary', 'income', 'rate', 'georgia', 'buckets', 'free', 'planVsActual'];
    const ctx = { month, key, dash, pva, categories, settings, rerender: draw };

    order.forEach(cardKey => {
      const renderer = CARD_RENDERERS[cardKey];
      if (!renderer) return;
      const out = renderer(ctx);
      (Array.isArray(out) ? out : [out]).forEach(node => cardsWrap.appendChild(node));
    });
  }

  draw();
}

// ---------------- Small shared bits ----------------

function inlineNumberField(value, onCommit) {
  const input = el('input', {
    class: 'inline-edit tabular-nums',
    type: 'text',
    inputmode: 'decimal',
    value: (value ?? 0).toFixed(2).replace('.', ',')
  });
  const commit = () => {
    const parsed = parseAmountInput(input.value);
    if (parsed < 0) { input.value = (value ?? 0).toFixed(2).replace('.', ','); return; }
    if (Math.abs(parsed - (value ?? 0)) < 0.005) return; // unchanged — no save/toast spam
    onCommit(parsed);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  return input;
}

function progressBar(pct, color) {
  const bar = el('div', { class: 'progress progress--compact' });
  const fill = el('div', { class: 'progress__fill', style: `width:${Math.max(0, Math.min(100, pct))}%` });
  if (color) fill.style.background = color;
  bar.appendChild(fill);
  return bar;
}

function statCard({ label, value, sub, pct, color, accentBorder = true, wide = false }) {
  const card = el('div', {
    class: 'card stat-card' + (wide ? ' stat-card--wide' : ''),
    style: accentBorder && color ? `border-left:4px solid ${color}` : ''
  });
  card.appendChild(el('div', { class: 'stat-card__label', text: label, title: label }));
  card.appendChild(el('div', { class: 'stat-card__value tabular-nums', text: value }));
  if (sub) card.appendChild(el('div', { class: 'stat-card__sub', text: sub }));
  if (pct !== undefined) card.appendChild(progressBar(pct, color));
  return card;
}

// ---------------- Card renderers ----------------

function summaryCard({ month, dash }) {
  const totals = computeMonthTotals(month);
  const pct = totals.planned > 0 ? Math.min(100, (totals.paid / totals.planned) * 100) : 0;
  const card = el('div', { class: 'card stat-card stat-card--wide' });
  card.appendChild(el('div', { class: 'stat-card__label', text: 'თვის მიმოხილვა' }));

  const grid = el('div', { class: 'summary-grid' });
  grid.appendChild(summaryCell('დაგეგმილი', formatMoney(totals.planned, 'EUR')));
  grid.appendChild(summaryCell('გადახდილი', formatMoney(totals.paid, 'EUR')));
  grid.appendChild(summaryCell(
    totals.unpaidCount > 0 ? `დარჩა (${totals.unpaidCount})` : 'დარჩა',
    formatMoney(totals.unpaid, 'EUR')
  ));
  grid.appendChild(summaryCell('ფაქტ. დანაზოგი', formatMoney(dash.savings.actual, 'EUR')));
  card.appendChild(grid);
  card.appendChild(progressBar(pct));
  return card;
}

function summaryCell(label, value) {
  return el('div', { class: 'summary-grid__cell' }, [
    el('div', { class: 'stat-card__sub', text: label }),
    el('div', { class: 'summary-grid__value tabular-nums', text: value })
  ]);
}

function incomeCard({ month, key, rerender }) {
  const card = el('div', { class: 'card stat-card stat-card--wide' });
  card.appendChild(el('div', { class: 'stat-card__label', text: 'შემოსავალი' }));
  const row = el('div', { class: 'field-row', style: 'margin:2px 0' });
  row.appendChild(el('div', { class: 'field', style: 'margin-bottom:0' }, [
    el('label', { text: 'გიორგი' }),
    inlineNumberField(month.income.giorgi, (v) => {
      updateState(draft => { draft.months[key].income.giorgi = v; return draft; });
      savedToast();
      rerender();
    })
  ]));
  row.appendChild(el('div', { class: 'field', style: 'margin-bottom:0' }, [
    el('label', { text: 'ნინო' }),
    inlineNumberField(month.income.nino, (v) => {
      updateState(draft => { draft.months[key].income.nino = v; return draft; });
      savedToast();
      rerender();
    })
  ]));
  card.appendChild(row);
  card.appendChild(el('div', { class: 'stat-card__sub tabular-nums', text: `ჯამი: ${formatMoney(month.income.giorgi + month.income.nino, 'EUR')}` }));
  return card;
}

function rateCard({ month, key, rerender }) {
  const card = el('div', { class: 'card stat-card' });
  card.appendChild(el('div', { class: 'stat-card__label', text: 'კურსი (1 € = ? ₾)' }));
  card.appendChild(inlineNumberField(month.exchangeRate, (v) => {
    if (v <= 0) return;
    updateState(draft => { draft.months[key].exchangeRate = v; return draft; });
    savedToast();
    rerender();
  }));
  card.appendChild(el('div', { class: 'stat-card__sub', text: 'ცვლილება მყისვე ანახლებს გადაუხდელ ₾ კონვერტაციებს' }));
  return card;
}

function georgiaCard({ dash }) {
  const pct = dash.georgia.plannedEur > 0 ? Math.min(100, (dash.georgia.actualEur / dash.georgia.plannedEur) * 100) : 0;
  return statCard({
    label: 'საქართველოში გადასარიცხი',
    value: `${formatMoney(dash.georgia.plannedGel, 'GEL')} ≈ ${formatMoney(dash.georgia.plannedEur, 'EUR')}`,
    sub: `გადახდილია: ${formatMoney(dash.georgia.actualEur, 'EUR')} · ${formatPercent(dash.georgia.pct)} შემოსავლიდან`,
    pct,
    color: '#d97706'
  });
}

function bucketsBlock({ dash }) {
  return dash.buckets.map(b => {
    const pct = b.planned > 0 ? Math.min(100, (b.actual / b.planned) * 100) : 0;
    return statCard({
      label: b.name,
      value: formatMoney(b.planned, 'EUR'),
      sub: `გადახდილია: ${formatMoney(b.actual, 'EUR')} · ${formatPercent(b.pct)}`,
      pct,
      color: b.color
    });
  });
}

function freeCard({ dash }) {
  const card = el('div', { class: 'card stat-card stat-card--wide' });
  card.appendChild(el('div', { class: 'stat-card__label', text: 'თავისუფალი თანხა' }));
  card.appendChild(el('div', { class: 'stat-card__value tabular-nums', text: formatMoney(dash.free.total, 'EUR') }));
  const split = el('div', { class: 'free-split' });
  split.appendChild(freePersonBlock('გიორგი', dash.free.giorgi));
  split.appendChild(freePersonBlock('ნინო', dash.free.nino));
  card.appendChild(split);
  return card;
}

function freePersonBlock(label, person) {
  const spentPct = person.share > 0 ? Math.min(100, (person.spent / person.share) * 100) : (person.spent > 0 ? 100 : 0);
  const over = person.remaining < -0.005;
  const block = el('div', { class: 'free-split__person', style: `border-left:3px solid ${person.color}` }, [
    el('div', { class: 'stat-card__sub', text: `${label} · ${formatPercent(person.pct)}` }),
    el('div', { class: 'free-split__share tabular-nums', text: formatMoney(person.share, 'EUR') }),
    el('div', {
      class: 'stat-card__sub tabular-nums' + (over ? ' text-danger' : ''),
      text: `დახარჯულია ${formatMoney(person.spent, 'EUR')} · დარჩა ${formatMoney(person.remaining, 'EUR')}`
    })
  ]);
  block.appendChild(progressBar(spentPct, over ? 'var(--danger)' : person.color));
  return block;
}

function planVsActualCard({ pva }) {
  const card = el('div', { class: 'card', style: 'grid-column: 1 / -1' });
  card.appendChild(el('div', { class: 'card__title', text: 'გეგმა vs ფაქტი' }));

  const rowsWrap = el('div', {});
  pva.forEach(row => {
    const r = el('div', { class: 'pva-row' });
    r.appendChild(el('div', { class: 'pva-row__label' }, [
      el('span', { text: row.label }),
      el('span', {
        class: `pva-row__delta ${row.ok ? 'pva-row__delta--ok' : 'pva-row__delta--bad'}`,
        text: `${formatPercent(row.actual)} (გეგმა ${formatPercent(row.target)}, ${row.delta >= 0 ? '+' : ''}${formatPercent(row.delta)})`
      })
    ]));
    const bar = el('div', { class: 'progress progress--with-target progress--compact' });
    bar.appendChild(el('div', {
      class: 'progress__fill',
      style: `width:${Math.max(0, Math.min(100, row.actual))}%;background:${row.color}`
    }));
    bar.appendChild(el('div', { class: 'progress__target-marker', style: `left:${Math.max(0, Math.min(100, row.target))}%` }));
    r.appendChild(bar);
    rowsWrap.appendChild(r);
  });
  card.appendChild(rowsWrap);
  card.appendChild(renderDonut(pva));
  return card;
}

function renderDonut(pva) {
  const wrap = el('div', { class: 'donut-wrap' });
  const total = pva.reduce((s, r) => s + Math.max(0, r.actual), 0) || 1;
  const size = 110, r = 42, cx = 55, cy = 55, circumference = 2 * Math.PI * r;
  let offset = 0;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  bg.setAttribute('cx', cx); bg.setAttribute('cy', cy); bg.setAttribute('r', r);
  bg.setAttribute('fill', 'none'); bg.setAttribute('stroke', 'var(--border)'); bg.setAttribute('stroke-width', 14);
  svg.appendChild(bg);

  pva.forEach(row => {
    const frac = Math.max(0, row.actual) / total;
    const len = frac * circumference;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r', r);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', row.color);
    circle.setAttribute('stroke-width', 14);
    circle.setAttribute('stroke-dasharray', `${len} ${circumference - len}`);
    circle.setAttribute('stroke-dashoffset', String(-offset));
    circle.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
    svg.appendChild(circle);
    offset += len;
  });

  wrap.appendChild(svg);

  const legend = el('div', { class: 'donut-legend' });
  pva.forEach(row => {
    legend.appendChild(el('div', { class: 'donut-legend__item' }, [
      el('span', { class: 'donut-legend__swatch', style: `background:${row.color}` }),
      el('span', { text: `${row.label} — ${formatPercent(row.actual)}` })
    ]));
  });
  wrap.appendChild(legend);

  return wrap;
}

const CARD_RENDERERS = {
  summary: summaryCard,
  income: incomeCard,
  rate: rateCard,
  georgia: georgiaCard,
  buckets: bucketsBlock,
  free: freeCard,
  planVsActual: planVsActualCard
};
