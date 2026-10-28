// views/dashboard.js — compact dashboard cards, driven by the user's configured buckets.

import { getState, updateState, monthKey } from '../state.js';
import { generateMonthTransactions, monthNeedsGeneration, monthIsPrepared, initMonth } from '../monthEngine.js';
import { openPrepareWizard, preparationPreview } from '../prepare.js';
import { monthLabel, monthLabelFull } from '../monthNav.js';
import {
  computeDashboard, computePlanVsActual, computeMonthTotals, computeYearOverview, computeRemaining, computeSalarySplit,
  effectiveCardOrder, totalIncome, formatMoney, formatPercent, parseAmountInput, isEnvelope, envelopeSpent, ACCOUNT_LABELS
} from '../calc.js';
import { el, savedToast, toast, formatDate } from '../ui.js';
import { getSelectedMonth, setSelectedMonth, onMonthChange, MONTH_NAMES_SHORT, getUiPref, setUiPref } from '../monthNav.js';
import { renderMonthNav } from '../components.js';
import { fetchEurGelRate } from '../rates.js';
import { openEnvelopeDialog } from '../envelope.js';
import { navigate } from '../app.js';
import { setTransactionsFilter } from './transactions.js';

const AUTO_RATE_EVERY_MS = 30 * 60 * 1000;
let lastAutoRateTry = 0;

/** Rate value to write for a month (GEL per 1 €), with where it came from. */
function rateSourceFrom(r) {
  return { kind: r.kind, source: r.source, at: r.at, sell: r.sell || null };
}

/**
 * Keeps the CURRENT/FUTURE month's rate fresh from Bank of Georgia (buy rate), unless the
 * user typed a rate by hand for that month. Past months are never touched.
 */
async function autoRefreshRate(key, rerender) {
  const s = getState();
  const m = s.months[key];
  if (!s.settings.rateAuto || !m || key < monthKey()) return;
  if (m.rateSource && m.rateSource.kind === 'manual') return;
  if (Date.now() - lastAutoRateTry < AUTO_RATE_EVERY_MS) return;
  lastAutoRateTry = Date.now();
  try {
    const r = await fetchEurGelRate();
    if (r.kind !== 'bog') return; // automatic updates only from the bank, never the official rate
    const fresh = getState().months[key];
    if (!fresh || (fresh.rateSource && fresh.rateSource.kind === 'manual')) return;
    if (Math.abs((fresh.exchangeRate || 0) - r.rate) < 0.00005 && fresh.rateSource && fresh.rateSource.at === r.at) return;
    updateState(d => { d.months[key].exchangeRate = r.rate; d.months[key].rateSource = rateSourceFrom(r); return d; });
    rerender();
  } catch { /* offline — keep the current rate */ }
}

let unsubscribe = null;

export function renderDashboard(root) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }

  const container = el('div', { class: 'dashboard-view' });
  root.appendChild(container);

  let monthNav = renderMonthNav(() => draw());
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
    if (!getState().months[key]) updateState(draft => { initMonth(draft, key); return draft; });
    // Only a PREPARED month is topped up automatically (e.g. a template added later).
    // An unprepared month shows the preparation card instead — nothing appears silently.
    // (Setting "new month: automatically" restores the old silent behaviour.)
    const auto = getState().settings.newMonthMode === 'auto';
    if ((auto || monthIsPrepared(getState(), key)) && monthNeedsGeneration(getState(), key)) {
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
    if (settings.newMonthMode !== 'auto') {
      prepareCards(state, key, (k) => openPrepareWizard(k, () => goToMonth(k)), draw).forEach(c => cardsWrap.appendChild(c));
    }
    const hidden = new Set(settings.hiddenCards || []);
    const order = effectiveCardOrder(settings, categories).filter(k => !hidden.has(k));
    const ctx = { month, key, dash, pva, categories, settings, state, rerender: draw, goToMonth };

    order.forEach(cardKey => {
      const renderer = CARD_RENDERERS[cardKey];
      if (renderer) {
        const out = renderer(ctx);
        (Array.isArray(out) ? out : [out]).forEach(node => cardsWrap.appendChild(node));
        return;
      }
      // Not a fixed card — it's a user category block.
      const b = dash.buckets.find(x => x.id === cardKey);
      if (b) cardsWrap.appendChild(categoryCard(b));
    });
  }

  const customize = el('div', { class: 'dash-customize' }, [
    el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '⚙️ ბლოკების დამალვა / გადაადგილება' })
  ]);
  customize.firstChild.addEventListener('click', () => { navigate('settings'); setTimeout(() => document.getElementById('dashboard-layout')?.scrollIntoView({ behavior: 'smooth' }), 50); });
  container.appendChild(customize);

  /** Jump to another month (from the year table) and keep the selector in sync. */
  function goToMonth(k) {
    setSelectedMonth(k);
    const fresh = renderMonthNav(() => draw());
    monthNav.replaceWith(fresh);
    monthNav = fresh;
    draw();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  draw();
  autoRefreshRate(getSelectedMonth(), () => { if (container.isConnected) draw(); });
}

// ---------------- Small shared bits ----------------

function inlineNumberField(value, onCommit, decimals = 2) {
  const fmt = (v) => (v ?? 0).toFixed(decimals).replace('.', ',');
  const input = el('input', {
    class: 'inline-edit tabular-nums',
    type: 'text',
    inputmode: 'decimal',
    value: fmt(value)
  });
  input.addEventListener('focus', () => input.select());
  const commit = () => {
    const parsed = parseAmountInput(input.value, decimals);
    if (parsed < 0) { input.value = fmt(value); return; }
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

function summaryCard({ month }) {
  const totals = computeMonthTotals(month);
  const pct = totals.planned > 0 ? Math.min(100, (totals.paid / totals.planned) * 100) : 0;
  const card = el('div', { class: 'card stat-card stat-card--wide' });
  card.appendChild(el('div', { class: 'stat-card__label', text: 'თვის მიმოხილვა' }));

  const grid = el('div', { class: 'summary-grid' });
  grid.appendChild(summaryCell('დაგეგმილი', formatMoney(totals.planned, 'EUR')));
  grid.appendChild(summaryCell('გადახდილი', formatMoney(totals.paid, 'EUR')));
  grid.appendChild(summaryCell('შემოსავალი', formatMoney(totalIncome(month), 'EUR')));
  grid.appendChild(summaryCell('ნაშთი', formatMoney(totalIncome(month) - totals.paid, 'EUR')));
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
  const row = el('div', { class: 'rate-row' });
  row.appendChild(inlineNumberField(month.exchangeRate, (v) => {
    if (v <= 0) return;
    updateState(draft => {
      draft.months[key].exchangeRate = v;
      draft.months[key].rateSource = { kind: 'manual', source: 'ხელით', at: new Date().toISOString() };
      return draft;
    });
    savedToast();
    rerender();
  }, 4));
  const fetchBtn = el('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'საქართველოს ბანკის კურსის ჩამოტვირთვა', title: 'საქართველოს ბანკის ყიდვის კურსი', text: '🏦' });
  fetchBtn.addEventListener('click', async () => {
    fetchBtn.disabled = true;
    try {
      const r = await fetchEurGelRate();
      updateState(draft => {
        draft.months[key].exchangeRate = r.rate;
        draft.months[key].rateSource = rateSourceFrom(r);
        return draft;
      });
      toast(`${r.source}: ${String(r.rate).replace('.', ',')} ₾${r.stale ? ' (ძველი მონაცემი!)' : ''} ✓`, r.kind === 'bog' && !r.stale ? 'ok' : 'error');
      rerender();
    } catch (e) {
      toast(e.message, 'error');
      fetchBtn.disabled = false;
    }
  });
  row.appendChild(fetchBtn);
  card.appendChild(row);
  const src = month.rateSource;
  let text = '🏦 = საქართველოს ბანკი, ყიდვის კურსი (ევროს ლარში გადაცვლა)';
  if (src && src.kind === 'bog') {
    const at = src.at ? new Date(src.at) : null;
    text = `საქ. ბანკი · ყიდვა${src.sell ? ` (გაყიდვა ${String(src.sell).replace('.', ',')})` : ''}${at ? ` · ${formatDate(src.at.slice(0, 10))} ${at.toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}`;
  } else if (src && src.kind === 'official') text = 'ოფიციალური (NBG) — ბანკის კურსი ვერ ჩაიტვირთა';
  else if (src && src.kind === 'manual') text = 'ხელით ჩაწერილი · 🏦 დააბრუნებს ავტომატურ კურსს';
  card.appendChild(el('div', { class: 'stat-card__sub', text }));
  return card;
}

function georgiaCard({ dash }) {
  const pct = dash.georgia.plannedEur > 0 ? Math.min(100, (dash.georgia.actualEur / dash.georgia.plannedEur) * 100) : 0;
  return statCard({
    label: 'საქართველოში გადასარიცხი',
    value: formatMoney(dash.georgia.plannedEur, 'EUR'),
    sub: `${formatMoney(dash.georgia.plannedGel, 'GEL')} · გადახდილია ${formatMoney(dash.georgia.actualEur, 'EUR')} · ${formatPercent(dash.georgia.pct)} შემოსავლიდან`,
    pct,
    color: '#d97706'
  });
}

function categoryCard(b) {
  const pct = b.planned > 0 ? Math.min(100, (b.actual / b.planned) * 100) : 0;
  return statCard({
    label: b.name,
    value: formatMoney(b.planned, 'EUR'),
    sub: `გადახდილია: ${formatMoney(b.actual, 'EUR')} · ${formatPercent(b.pct)} შემოსავლიდან`,
    pct,
    color: b.color
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
  card.appendChild(el('div', { class: 'card__title', text: 'დაგეგმილი vs რეალური' }));

  const rowsWrap = el('div', {});
  pva.forEach(row => {
    const r = el('div', { class: 'pva-row' });
    r.appendChild(el('div', { class: 'pva-row__label' }, [
      el('span', { text: row.label }),
      el('span', {
        class: `pva-row__delta ${row.ok ? 'pva-row__delta--ok' : 'pva-row__delta--bad'}`,
        text: `${formatPercent(row.actual, 0)} · გეგმა ${formatPercent(row.target, 0)}`
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

function yearCard({ state, key, goToMonth }) {
  const year = Number(key.slice(0, 4));
  const yo = computeYearOverview(state.months, state.categories, year);
  const card = el('div', { class: 'card', style: 'grid-column: 1 / -1' });
  card.appendChild(el('div', { class: 'card__title', text: `წლიური მიმოხილვა — ${year}` }));
  card.appendChild(el('div', { class: 'card__sub', text: 'ფაქტი: მხოლოდ გადახდილი ტრანზაქციები. თვეზე დაჭერით გადახვალ იმ თვეში.' }));

  if (!yo.rows.length) {
    card.appendChild(el('div', { class: 'empty-state', text: 'ამ წელს ჯერ მონაცემები არ არის' }));
    return card;
  }
  const m0 = (v) => formatMoney(v, 'EUR', 0);
  const table = el('table', { class: 'year-table tabular-nums' });
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { text: 'თვე' }), el('th', { text: 'შემოს.' }), el('th', { text: 'ხარჯი' }),
    el('th', { text: 'დანაზ.' }), el('th', { text: 'ნაშთი' })
  ])]));
  const tbody = el('tbody', {});
  yo.rows.forEach(r => {
    const tr = el('tr', { class: 'year-table__row' + (r.key === key ? ' year-table__row--current' : ''), tabindex: '0', role: 'button', 'aria-label': `${MONTH_NAMES_SHORT[r.month - 1]} — გახსნა` }, [
      el('td', { text: MONTH_NAMES_SHORT[r.month - 1] }),
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
  table.appendChild(el('tfoot', {}, [
    el('tr', {}, [el('th', { text: 'ჯამი' }), el('th', { text: m0(t.income) }), el('th', { text: m0(t.spent) }), el('th', { text: m0(t.saved) }), el('th', { text: m0(t.leftover) })]),
    el('tr', { class: 'year-table__avg' }, [el('td', { text: 'საშ./თვე' }), el('td', { text: m0(a.income) }), el('td', { text: m0(a.spent) }), el('td', { text: m0(a.saved) }), el('td', { text: m0(a.leftover) })])
  ]));
  card.appendChild(el('div', { class: 'year-table-wrap' }, [table]));
  if (t.georgia > 0) {
    card.appendChild(el('div', { class: 'stat-card__sub', style: 'margin-top:6px', text: `📤 საქართველოში გადარიცხულია ${year}-ში: ${formatMoney(t.georgia, 'EUR')} (ხარჯის ნაწილია)` }));
  }
  return card;
}

// ---------------- Month preparation prompts ----------------

function prepareCards(state, key, open, redraw) {
  const cards = [];
  if (!state.templates.length) return cards;
  const cur = monthKey();
  const dismissed = new Set(getUiPref('dismissedPrepare', []));
  const make = (k, title, sub, primary) => {
    const btn = el('button', { class: 'btn ' + (primary ? 'btn--primary' : 'btn--secondary'), type: 'button', text: '📅 მომზადება' });
    btn.addEventListener('click', () => open(k));
    const closeBtn = el('button', { class: 'icon-btn icon-btn--sm prepare-card__close', type: 'button', 'aria-label': 'შეხსენების დამალვა ამ თვისთვის', title: 'დამალვა (ამ თვისთვის). სულ გამორთვა — პარამეტრებში', text: '✕' });
    closeBtn.addEventListener('click', () => {
      setUiPref('dismissedPrepare', [...dismissed, k].slice(-24));
      toast('დაიმალა. „📅 თვის მომზადება" ისევ ხელმისაწვდომია „ტრანზაქციების" გვერდზე; სულ გამორთვა — პარამეტრებში.');
      redraw();
    });
    return el('div', { class: 'card stat-card stat-card--wide prepare-card' + (primary ? ' prepare-card--main' : '') }, [
      el('div', { class: 'prepare-card__text' }, [el('div', { class: 'prepare-card__title', text: title }), el('div', { class: 'stat-card__sub', text: sub })]),
      btn,
      closeBtn
    ]);
  };
  const p = preparationPreview(state, key);
  if (!p.prepared && !dismissed.has(key)) {
    cards.push(make(key, `📅 ${monthLabelFull(key)} ჯერ არ არის მომზადებული`,
      p.count ? `${p.count} ხარჯი შაბლონებიდან ≈ ${formatMoney(p.total, 'EUR', 0)}. ნახე სია, შეცვალე რაც საჭიროა და შექმენი ერთი დაჭერით.` : 'ამ თვეში შაბლონები არ მოდის — მაინც შეგიძლია ჩაწერო ხელფასი და კურსი.',
      true));
  } else if (key !== cur && !monthIsPrepared(state, cur) && !dismissed.has(cur)) {
    const pc = preparationPreview(state, cur);
    cards.push(make(cur, `🗓 ${monthLabel(cur)} დაიწყო`, `${pc.count} ხარჯი ≈ ${formatMoney(pc.total, 'EUR', 0)} ელოდება მომზადებას.`, false));
  }
  return cards;
}

// ---------------- Still to pay ----------------

function dueCard({ month }) {
  const rem = computeRemaining(month);
  const card = el('div', { class: 'card stat-card stat-card--wide due-card', role: 'button', tabindex: '0', 'aria-label': 'გადაუხდელი ტრანზაქციების ნახვა' });
  const open = () => { setTransactionsFilter('unpaid'); navigate('transactions'); };
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  card.appendChild(el('div', { class: 'stat-card__label', text: '⏳ ამ თვეში ჯერ გადასახდელი' }));
  card.appendChild(el('div', { class: 'stat-card__value tabular-nums', text: formatMoney(rem.total, 'EUR') }));
  if (rem.total <= 0.004) {
    card.appendChild(el('div', { class: 'stat-card__sub text-success', text: 'ყველაფერი გადახდილია ✓' }));
    return card;
  }
  const parts = [];
  if (rem.bills > 0.004) parts.push(`გადასახადები ${formatMoney(rem.bills, 'EUR')}`);
  if (rem.envelopes > 0.004) parts.push(`ყოველდღიურ ბიუჯეტებში დარჩა ${formatMoney(rem.envelopes, 'EUR')}`);
  card.appendChild(el('div', { class: 'stat-card__sub tabular-nums', text: parts.join(' · ') }));
  const acc = el('div', { class: 'due-card__accounts tabular-nums' });
  Object.entries(rem.byAccount).forEach(([a, v]) => {
    if (v > 0.004) acc.appendChild(el('span', { class: 'chip', text: `👤 ${ACCOUNT_LABELS[a]}: ${formatMoney(v, 'EUR', 0)}` }));
  });
  card.appendChild(acc);
  const next = rem.next.slice(0, 2).map(t => `${t.name} ${formatDate(t.dueDate).slice(0, 5)}`).join(' · ');
  if (next) card.appendChild(el('div', { class: 'stat-card__sub', text: `შემდეგი: ${next}` }));
  return card;
}

// ---------------- Envelopes (food, fuel…) ----------------

function envelopesCard({ month, key, rerender }) {
  const envs = month.transactions.filter(isEnvelope);
  if (!envs.length) return [];
  const card = el('div', { class: 'card stat-card stat-card--wide' });
  card.appendChild(el('div', { class: 'stat-card__label', text: '🛒 ყოველდღიური ბიუჯეტები' }));
  envs.forEach(t => {
    const spent = envelopeSpent(t);
    const left = (t.amountPlanned || 0) - spent;
    const pct = t.amountPlanned > 0 ? Math.min(100, (spent / t.amountPlanned) * 100) : 0;
    // How much per day is left until the end of the month (current month only).
    let perDay = '';
    if (key === monthKey() && !t.paid && left > 0.5) {
      const now = new Date();
      const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
      perDay = ` · დღეში ≈ ${formatMoney(left / daysLeft, t.currency, 0)}`;
    }
    const add = el('button', { class: 'icon-btn icon-btn--sm envelope-row__add', type: 'button', 'aria-label': `${t.name}: ხარჯის ან ნაშთის ჩაწერა`, text: '＋' });
    add.addEventListener('click', () => openEnvelopeDialog(t.id, rerender));
    const row = el('div', { class: 'envelope-row' + (t.paid ? ' envelope-row--closed' : '') }, [
      el('div', { class: 'envelope-row__main' }, [
        el('div', { class: 'envelope-row__top' }, [
          el('span', { class: 'envelope-row__name', text: t.name }),
          el('span', { class: 'tabular-nums' + (left < -0.004 ? ' text-danger' : ''), text: t.paid ? 'დახურულია' : `დარჩა ${formatMoney(left, t.currency, 0)} / ${formatMoney(t.amountPlanned, t.currency, 0)}${perDay}` })
        ]),
        progressBar(pct, left < -0.004 ? 'var(--danger)' : undefined)
      ]),
      add
    ]);
    card.appendChild(row);
  });
  return card;
}

// ---------------- Salary split / transfer plan ----------------

function splitCard({ month, categories, settings, rerender }) {
  const card = el('div', { class: 'card stat-card stat-card--wide split-card' });
  card.appendChild(el('div', { class: 'stat-card__label', text: '💸 ვინ რამდენი გადარიცხოს (50/50)' }));
  if ((month.income?.giorgi || 0) + (month.income?.nino || 0) <= 0) {
    card.appendChild(el('div', { class: 'stat-card__sub', text: 'ჩაწერე ამ თვის ხელფასები („შემოსავალი") — აქ გამოჩნდება, ვინ სად რამდენი უნდა გადარიცხოს.' }));
    return card;
  }
  // Both variants split the month's shared costs 50/50; they differ only in the route of the money.
  const view = getUiPref('splitView') === 'half' || getUiPref('splitView') === 'full' ? 'full' : 'keep';
  const sp = computeSalarySplit(month, categories, settings, { mode: 'equal', keepDebits: view === 'keep' });
  const m0 = (v) => formatMoney(v, 'EUR', 0);

  const tabs = el('div', { class: 'segmented split-tabs', role: 'tablist' });
  [['keep', 'ა) ჩამოსაჭრელს ანგარიშზე ვიტოვებთ'], ['full', 'ბ) სრულად საერთოზე, მერე უკან']].forEach(([k, label]) => {
    const b = el('button', { type: 'button', class: 'segmented__btn', 'aria-pressed': String(view === k), text: label });
    b.addEventListener('click', () => { setUiPref('splitView', k); rerender(); });
    tabs.appendChild(b);
  });
  card.appendChild(tabs);

  const P = sp.persons;
  const table = el('table', { class: 'split-table tabular-nums' });
  table.appendChild(el('thead', {}, [el('tr', {}, [el('th', { text: '' }), el('th', { text: 'გიორგი' }), el('th', { text: 'ნინო' })])]));
  const row = (label, key, opts = {}) => {
    const g = P.giorgi[key], n = P.nino[key];
    if (opts.hideIfZero && Math.abs(g) < 0.5 && Math.abs(n) < 0.5) return null;
    const cell = (v) => el('td', { class: (opts.strong ? 'split-table__strong' : '') + (v < -0.5 ? ' text-danger' : ''), text: m0(v) });
    return el('tr', { class: opts.cls || '' }, [el('th', { scope: 'row', text: label }), cell(g), cell(n)]);
  };
  const rows = [
    row('💶 ხელფასი', 'income', { cls: 'split-table__income' }),
    row('➡️ საერთოზე', 'toShared', { strong: true, cls: 'split-table__main' }),
    view === 'keep'
      ? row('🏠 ანგარიშზე დატოვე', 'keepForDebits', { hideIfZero: true })
      : row('↩️ საერთოდან უკან', 'backFromShared', { hideIfZero: true }),
    row('💰 დანაზოგზე', 'savings', { hideIfZero: true }),
    row('🛍 რჩება', 'free', { strong: true })
  ].filter(Boolean);
  table.appendChild(el('tbody', {}, rows));
  card.appendChild(table);

  const notes = [];
  const short = [['giorgi', 'გიორგი'], ['nino', 'ნინო']].filter(([p]) => P[p].free < -0.5).map(([p, n]) => `${n}: აკლია ${m0(-P[p].free)}`);
  if (short.length) notes.push(`⚠️ ხელფასი არ ჰყოფნის (${short.join(', ')}).`);
  notes.push(view === 'keep'
    ? 'ა) თითოეულის ანგარიშიდან ჩამოსაჭრელი გადასახადები იქვე რჩება, დანარჩენი ნახევარი — საერთოზე. წინ და უკან გადარიცხვა არ სჭირდება.'
    : 'ბ) ორივე მთელ ნახევარს რიცხავს საერთოზე; შემდეგ საერთოდან უკან გადადის ის თანხა, რაც პირადი ანგარიშიდან იჭრება.');
  notes.push(`თვის საერთო ხარჯი ${m0(sp.spendPlannedTotal)} (${formatPercent(sp.spendPct, 0)} შემოსავლის) · საერთოდან გადის ${m0(sp.sharedNeeds)}.`);
  card.appendChild(el('div', { class: 'stat-card__sub split-notes', text: notes.join(' ') }));
  return card;
}

const CARD_RENDERERS = {
  summary: summaryCard,
  income: incomeCard,
  rate: rateCard,
  georgia: georgiaCard,
  free: freeCard,
  planVsActual: planVsActualCard,
  year: yearCard,
  due: dueCard,
  envelopes: envelopesCard,
  split: splitCard
};
