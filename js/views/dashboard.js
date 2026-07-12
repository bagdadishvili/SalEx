// views/dashboard.js — the 7 dashboard cards per master-prompt §5.1.

import { getState, updateState, ensureMonth } from '../state.js';
import { generateMonthTransactions } from '../monthEngine.js';
import { computeDashboard, computePlanVsActual, formatMoney, formatPercent, parseAmountInput } from '../calc.js';
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

  unsubscribe = onMonthChange(() => draw());

  function ensureCurrentMonth() {
    const key = getSelectedMonth();
    updateState(draft => {
      ensureMonth(draft, key);
      generateMonthTransactions(draft, key);
      return draft;
    });
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
    const order = settings.dashboardCardOrder.length ? settings.dashboardCardOrder : ['income', 'rate', 'essentials', 'georgia', 'savings', 'free', 'planVsActual'];

    const ctx = { month, key, dash, pva, categories, settings, rerender: draw };

    order.forEach(cardKey => {
      const renderer = CARD_RENDERERS[cardKey];
      if (renderer) cardsWrap.appendChild(renderer(ctx));
    });
  }

  draw();
}

// ---------------- Card renderers ----------------

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
    onCommit(parsed);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  return input;
}

function incomeCard({ month, key, rerender }) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'შემოსავალი' }));

  const row = el('div', { class: 'field-row' });
  row.appendChild(el('div', { class: 'field' }, [
    el('label', { text: 'გიორგი' }),
    inlineNumberField(month.income.giorgi, (v) => {
      updateState(draft => { draft.months[key].income.giorgi = v; return draft; });
      savedToast();
      rerender();
    })
  ]));
  row.appendChild(el('div', { class: 'field' }, [
    el('label', { text: 'ნინო' }),
    inlineNumberField(month.income.nino, (v) => {
      updateState(draft => { draft.months[key].income.nino = v; return draft; });
      savedToast();
      rerender();
    })
  ]));
  card.appendChild(row);
  card.appendChild(el('div', { class: 'card__sub tabular-nums', text: `ჯამი: ${formatMoney(month.income.giorgi + month.income.nino, 'EUR')}` }));
  return card;
}

function rateCard({ month, key, rerender }) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'კურსი' }));
  const row = el('div', { class: 'field-row' });
  row.appendChild(el('div', { class: 'field', style: 'max-width:90px' }, [
    el('label', { text: '1 EUR' }),
    el('div', { class: 'inline-edit tabular-nums', style: 'padding-top:10px', text: '1' })
  ]));
  row.appendChild(el('div', { class: 'field' }, [
    el('label', { text: 'GEL' }),
    inlineNumberField(month.exchangeRate, (v) => {
      if (v <= 0) return;
      updateState(draft => { draft.months[key].exchangeRate = v; return draft; });
      savedToast();
      rerender();
    })
  ]));
  card.appendChild(row);
  card.appendChild(el('div', { class: 'card__sub', text: 'ცვლილება მყისვე ანახლებს გადაუხდელ ₾ კონვერტაციებს' }));
  return card;
}

function essentialsCard({ dash }) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'აუცილებელი ხარჯები' }));
  card.appendChild(el('div', { class: 'card__big-number tabular-nums', text: formatMoney(dash.essentials.planned, 'EUR') }));
  card.appendChild(el('div', { class: 'card__sub', text: `გადახდილია: ${formatMoney(dash.essentials.actual, 'EUR')} · ${formatPercent(dash.essentials.pct)} შემოსავლიდან` }));
  const pct = dash.essentials.planned > 0 ? Math.min(100, (dash.essentials.actual / dash.essentials.planned) * 100) : 0;
  card.appendChild(progressBar(pct));
  return card;
}

function georgiaCard({ dash }) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'საქართველოში გადასარიცხი' }));
  card.appendChild(el('div', { class: 'card__big-number tabular-nums', text: `${formatMoney(dash.georgia.plannedGel, 'GEL')} ≈ ${formatMoney(dash.georgia.plannedEur, 'EUR')}` }));
  card.appendChild(el('div', { class: 'card__sub', text: `გადახდილია: ${formatMoney(dash.georgia.actualEur, 'EUR')} · ${formatPercent(dash.georgia.pct)} შემოსავლიდან` }));
  const pct = dash.georgia.plannedEur > 0 ? Math.min(100, (dash.georgia.actualEur / dash.georgia.plannedEur) * 100) : 0;
  card.appendChild(progressBar(pct));
  return card;
}

function savingsCard({ key, dash, rerender }) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'გეგმიური დანაზოგი' }));
  card.appendChild(inlineNumberField(dash.savings.planned, (v) => {
    updateState(draft => { draft.months[key].plannedSavings = v; return draft; });
    savedToast();
    rerender();
  }));
  card.appendChild(el('div', { class: 'card__sub', text: `${formatPercent(dash.savings.pct)} შემოსავლიდან` }));
  return card;
}

function freeCard({ dash }) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'თავისუფალი თანხა' }));
  card.appendChild(el('div', { class: 'card__big-number tabular-nums', text: formatMoney(dash.free.total, 'EUR') }));
  const split = el('div', { class: 'field-row', style: 'margin-top:8px' });
  split.appendChild(el('div', {}, [
    el('div', { class: 'card__sub', text: 'გიორგი' }),
    el('div', { class: 'tabular-nums', style: 'font-weight:700', text: formatMoney(dash.free.giorgi.share, 'EUR') }),
    el('div', { class: 'card__sub', text: formatPercent(dash.free.giorgi.pct) })
  ]));
  split.appendChild(el('div', {}, [
    el('div', { class: 'card__sub', text: 'ნინო' }),
    el('div', { class: 'tabular-nums', style: 'font-weight:700', text: formatMoney(dash.free.nino.share, 'EUR') }),
    el('div', { class: 'card__sub', text: formatPercent(dash.free.nino.pct) })
  ]));
  card.appendChild(split);
  return card;
}

function progressBar(pct, danger = false) {
  const bar = el('div', { class: 'progress' });
  bar.appendChild(el('div', { class: `progress__fill${danger ? ' progress__fill--danger' : ''}`, style: `width:${Math.max(0, Math.min(100, pct))}%` }));
  return bar;
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
    const bar = el('div', { class: 'progress progress--with-target' });
    bar.appendChild(el('div', {
      class: `progress__fill ${row.ok ? 'progress__fill--success' : 'progress__fill--danger'}`,
      style: `width:${Math.max(0, Math.min(100, row.actual))}%`
    }));
    bar.appendChild(el('div', { class: 'progress__target-marker', style: `left:${Math.max(0, Math.min(100, row.target))}%` }));
    r.appendChild(bar);
    rowsWrap.appendChild(r);
  });
  card.appendChild(rowsWrap);
  card.appendChild(renderDonut(pva));
  return card;
}

const DONUT_COLORS = {
  essentials: '#2563eb',
  georgia: '#d97706',
  savings: '#16a34a',
  freeGiorgi: '#7c3aed',
  freeNino: '#db2777'
};

function renderDonut(pva) {
  const wrap = el('div', { class: 'donut-wrap' });
  const total = pva.reduce((s, r) => s + Math.max(0, r.actual), 0) || 1;
  const size = 140, r = 55, cx = 70, cy = 70, circumference = 2 * Math.PI * r;
  let offset = 0;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  bg.setAttribute('cx', cx); bg.setAttribute('cy', cy); bg.setAttribute('r', r);
  bg.setAttribute('fill', 'none'); bg.setAttribute('stroke', 'var(--border)'); bg.setAttribute('stroke-width', 18);
  svg.appendChild(bg);

  pva.forEach(row => {
    const frac = Math.max(0, row.actual) / total;
    const len = frac * circumference;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r', r);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', DONUT_COLORS[row.key]);
    circle.setAttribute('stroke-width', 18);
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
      el('span', { class: 'donut-legend__swatch', style: `background:${DONUT_COLORS[row.key]}` }),
      el('span', { text: `${row.label} — ${formatPercent(row.actual)}` })
    ]));
  });
  wrap.appendChild(legend);

  return wrap;
}

const CARD_RENDERERS = {
  income: incomeCard,
  rate: rateCard,
  essentials: essentialsCard,
  georgia: georgiaCard,
  savings: savingsCard,
  free: freeCard,
  planVsActual: planVsActualCard
};
