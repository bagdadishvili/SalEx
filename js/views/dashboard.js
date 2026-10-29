// views/dashboard.js — compact dashboard cards, driven by the user's configured buckets.

import { getState, updateState, budgetMonthKey, daysLeftInBudget } from '../state.js';
import { generateMonthTransactions, monthNeedsGeneration, monthIsPrepared, initMonth } from '../monthEngine.js';
import { openPrepareWizard, preparationPreview } from '../prepare.js';
import { monthLabel, monthLabelFull } from '../monthNav.js';
import {
  computeDashboard, computeMonthOverview, computeRangeOverview, computeRemaining, computeSalarySplit,
  effectiveCardOrder, formatMoney, formatPercent, parseAmountInput, isEnvelope, envelopeSpent, envelopeExtras, envelopeUsed,
  isGeorgia, isSavingsTxn, topIdOf, txnRemainingEur, txnPlannedEur, txnAmountEur, txnPaidEur, FREE_BUCKET_ID, targetEur, familyOf, isExtra,
  computeSavingsOverview
} from '../calc.js';
import { openModal, undoToast } from '../ui.js';
import { todayISO } from '../state.js';
import { t, tx, personName, personTag, genitive, dative } from '../texts.js';
import { payButton, openTransactionForm } from './transactions.js';
import { el, savedToast, toast, formatDate } from '../ui.js';
import { getSelectedMonth, setSelectedMonth, onMonthChange, MONTH_NAMES_SHORT, getUiPref, setUiPref } from '../monthNav.js';
import { renderMonthNav, PAYER_LABELS } from '../components.js';
import { fetchEurGelRate, fetchFreshRateNow, getRatesToken } from '../rates.js';
import { openEnvelopeDialog } from '../envelope.js';
import { navigate } from '../app.js';
import { setTransactionsFilter } from './transactions.js';

const AUTO_RATE_EVERY_MS = 30 * 60 * 1000;

function shiftKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
let lastAutoRateTry = 0;
let rateWait = 0; // when the on-demand rate request started (0 = none running)

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
  if (!s.settings.rateAuto || !m || key < budgetMonthKey()) return;
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

    cardsWrap.innerHTML = '';
    if (settings.newMonthMode !== 'auto') {
      prepareCards(state, key, (k) => openPrepareWizard(k, () => goToMonth(k)), draw).forEach(c => cardsWrap.appendChild(c));
    }
    const hidden = new Set(settings.hiddenCards || []);
    const order = effectiveCardOrder(settings, categories).filter(k => !hidden.has(k));
    const ctx = { month, key, dash, categories, settings, state, rerender: draw, goToMonth };

    order.forEach(cardKey => {
      const renderer = CARD_RENDERERS[cardKey];
      if (renderer) {
        const out = renderer(ctx);
        (Array.isArray(out) ? out : [out]).forEach(node => cardsWrap.appendChild(node));
        return;
      }
      // Not a fixed card — it's a user category block.
      const b = dash.buckets.find(x => x.id === cardKey);
      if (b) cardsWrap.appendChild(categoryCard(b, ctx));
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

function statCard({ label, labelKey, value, sub, pct, color, accentBorder = true, wide = false }) {
  const card = el('div', {
    class: 'card stat-card' + (wide ? ' stat-card--wide' : ''),
    style: accentBorder && color ? `border-left:4px solid ${color}` : ''
  });
  card.appendChild(el('div', { class: 'stat-card__label', ...(labelKey ? tx(labelKey) : { text: label }) }));
  card.appendChild(el('div', { class: 'stat-card__value tabular-nums', text: value }));
  if (sub) card.appendChild(el('div', { class: 'stat-card__sub', text: sub }));
  if (pct !== undefined) card.appendChild(progressBar(pct, color));
  return card;
}

// ---------------- Tap a card → its transactions open right below ----------------

const expanded = new Set();

/**
 * Makes a card expandable: a tap on the card (or "▼ N ხარჯი") shows all transactions of
 * that card under it, each with the pay button and ✎ edit, plus "+ ახალი ხარჯი აქ".
 */
function attachDetails(card, id, ctx, filterFn, preset = null) {
  const { month, key, categories, rerender } = ctx;
  const txns = month.transactions.filter(filterFn)
    .sort((a, b) => (a.paid - b.paid) || (a.dueDate || '').localeCompare(b.dueDate || ''));
  const open = expanded.has(id);
  card.classList.add('card--expandable');
  const toggle = () => { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); rerender(); };
  const btn = el('button', { type: 'button', class: 'card-expand', 'aria-expanded': String(open), text: open ? '▲ დამალვა' : `▼ ${txns.length} ხარჯი — ნახვა / რედაქტირება` });
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  card.addEventListener('click', (e) => {
    if (document.body.classList.contains('text-edit-mode')) return;
    if (e.target.closest('button, input, select, a, label, .card-details')) return;
    toggle();
  });
  card.appendChild(btn);
  if (!open) return card;

  const box = el('div', { class: 'card-details' });
  if (!txns.length) box.appendChild(el('div', { class: 'card__sub', text: 'ამ თვეში ჩანაწერი არ არის.' }));
  txns.forEach(tr => {
    const cur = tr.currency;
    const shown = tr.paid ? (tr.amountActual ?? tr.amountPlanned) : tr.amountPlanned;
    const envelopeInfo = isEnvelope(tr) ? ` · დახარჯულია ${formatMoney(envelopeUsed(tr, month.transactions, month.exchangeRate), cur, 0)}` : '';
    const editBtn = el('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': `${tr.name} — რედაქტირება`, text: '✎' });
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); openTransactionForm(tr, key, rerender); });
    box.appendChild(el('div', { class: 'detail-row' + (tr.paid ? ' detail-row--paid' : '') }, [
      el('div', { class: 'detail-row__main' }, [
        el('div', { class: 'detail-row__name', text: tr.name }),
        el('div', { class: 'detail-row__meta', text: `${personTag(tr.account)}${tr.dueDate && !isEnvelope(tr) ? ` · ${formatDate(tr.dueDate).slice(0, 5)}` : ''}${envelopeInfo}` })
      ]),
      el('div', { class: 'detail-row__amount tabular-nums' }, [
        el('div', { text: formatMoney(shown, cur) }),
        cur === 'GEL' ? el('div', { class: 'detail-row__meta', text: `≈ ${formatMoney(txnAmountEur(tr, month.exchangeRate) || txnPlannedEur(tr, month.exchangeRate), 'EUR', 0)}` }) : null
      ]),
      payButton(tr, month, rerender),
      editBtn
    ]));
  });
  const actions = el('div', { class: 'btn-row card-details__actions' });
  if (preset) {
    const add = el('button', { type: 'button', class: 'btn btn--secondary btn--sm', text: '+ ახალი ხარჯი აქ' });
    add.addEventListener('click', (e) => { e.stopPropagation(); openTransactionForm(null, key, rerender, preset); });
    actions.appendChild(add);
  }
  const all = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: 'ყველა ტრანზაქცია →' });
  all.addEventListener('click', (e) => { e.stopPropagation(); navigate('transactions'); });
  actions.appendChild(all);
  box.appendChild(actions);
  card.appendChild(box);
  void categories;
  return card;
}

// ---------------- Card renderers ----------------

/**
 * Month overview: fixed payments (paid / to pay) and food-fuel budgets (spent / planned) apart,
 * then where the income goes — costs, savings, free money — in total and per person.
 */
function summaryCard({ month, categories, settings }) {
  const o = computeMonthOverview(month, categories, settings);
  const card = el('div', { class: 'card stat-card stat-card--wide summary-card' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.summary') }));

  const progressLine = (labelKey, done, planned, doneWord) => {
    const pct = planned > 0 ? Math.min(100, (done / planned) * 100) : 0;
    return el('div', { class: 'summary-line' }, [
      el('div', { class: 'summary-line__top' }, [
        el('span', { class: 'stat-card__sub', ...tx(labelKey) }),
        el('span', { class: 'summary-line__value tabular-nums', text: `${formatMoney(done, 'EUR', 0)} / ${formatMoney(planned, 'EUR', 0)}` })
      ]),
      progressBar(pct, done > planned + 0.5 ? 'var(--danger)' : undefined),
      el('div', { class: 'stat-card__sub tabular-nums', text: `${doneWord} ${formatMoney(done, 'EUR')} · დარჩა ${formatMoney(Math.max(0, planned - done), 'EUR')}` })
    ]);
  };
  card.appendChild(progressLine('summary.bills', o.bills.paid, o.bills.planned, 'გადახდილი'));
  if (o.budgets.planned > 0.004) card.appendChild(progressLine('summary.budgets', o.budgets.used, o.budgets.planned, 'დახარჯული'));

  const m0 = (v) => formatMoney(v, 'EUR', 0);
  const table = el('table', { class: 'split-table summary-table tabular-nums' });
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { text: '' }), el('th', tx('summary.total')), el('th', tx('person.giorgi')), el('th', tx('person.nino'))
  ])]));
  const row = (labelKey, k, cls = '') => el('tr', { class: cls }, [
    el('th', { scope: 'row', ...tx(labelKey) }),
    ...[o.total, o.giorgi, o.nino].map((p, i) => el('td', { class: (i === 0 ? 'summary-table__total' : '') + (p[k] < -0.5 ? ' text-danger' : ''), text: m0(p[k]) }))
  ]);
  table.appendChild(el('tbody', {}, [
    row('summary.income', 'income', 'split-table__income'),
    row('summary.costs', 'costs'),
    row('summary.savings', 'savings'),
    row('summary.free', 'free', 'summary-table__free')
  ]));
  card.appendChild(table);
  card.appendChild(el('div', { class: 'stat-card__sub', text: 'ხარჯები = გადასახადები + კვება/საწვავი (საერთო ხარჯი 50/50). დანაზოგი ხარჯში არ ითვლება.' }));
  return card;
}

function incomeCard({ month, key, rerender }) {
  const card = el('div', { class: 'card stat-card stat-card--wide' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.income') }));
  const row = el('div', { class: 'field-row', style: 'margin:2px 0' });
  row.appendChild(el('div', { class: 'field', style: 'margin-bottom:0' }, [
    el('label', { text: personName('giorgi') }),
    inlineNumberField(month.income.giorgi, (v) => {
      updateState(draft => { draft.months[key].income.giorgi = v; return draft; });
      savedToast();
      rerender();
    })
  ]));
  row.appendChild(el('div', { class: 'field', style: 'margin-bottom:0' }, [
    el('label', { text: personName('nino') }),
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
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.rate') }));
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
  const fetchBtn = el('button', { class: 'icon-btn icon-btn--sm rate-btn', type: 'button', 'aria-label': 'საქართველოს ბანკის კურსის ჩამოტვირთვა', title: 'საქართველოს ბანკის ყიდვის კურსი', text: '🏦' });
  // A request may still be running from before a redraw — show it on the new button too.
  const showWait = () => {
    if (!rateWait) return;
    fetchBtn.disabled = true;
    fetchBtn.textContent = `⏳ ${Math.round((Date.now() - rateWait) / 1000)}წ`;
  };
  showWait();
  const ticker = setInterval(() => { if (!fetchBtn.isConnected || !rateWait) { clearInterval(ticker); return; } showWait(); }, 1000);
  fetchBtn.addEventListener('click', async () => {
    if (rateWait) return;
    fetchBtn.disabled = true;
    try {
      let r = null;
      if (getRatesToken()) {
        // Ask GitHub to fetch the bank rate right now and wait for it (usually 20–60 s).
        toast('🏦 ბანკიდან ახალი კურსის მოთხოვნა… (~1 წუთი)');
        rateWait = Date.now();
        showWait();
        try { r = await fetchFreshRateNow(); } finally { rateWait = 0; }
        if (!r) toast('ახალი კურსი ჯერ არ მოვიდა — ვიყენებ ბოლოს მიღებულს', 'error');
      }
      if (!r) r = await fetchEurGelRate();
      const ageMin = r.at ? (Date.now() - new Date(r.at).getTime()) / 60000 : 0;
      if (!getRatesToken() && ageMin > 20) {
        toast(`ბანკის კურსი ${new Date(r.at).toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit', hour12: false })}-ისაა. „ახლავე" განახლება: პარამეტრები → კურსი`, 'error');
      }
      updateState(draft => {
        draft.months[key].exchangeRate = r.rate;
        draft.months[key].rateSource = rateSourceFrom(r);
        return draft;
      });
      toast(`${r.source}: ${String(r.rate).replace('.', ',')} ₾${r.stale ? ' (ძველი მონაცემი!)' : ''} ✓`, r.kind === 'bog' && !r.stale ? 'ok' : 'error');
      rerender();
    } catch (e) {
      toast(e.message, 'error');
      rerender();
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

/** Paid-in-full look: green frame + "✓ …" line, so a done card is seen at a glance. */
function markDone(card, text) {
  card.classList.add('card--done');
  card.style.borderLeft = '';
  // below the title + amount line, so the two stay on one line
  const anchor = card.querySelector(':scope > .stat-card__value') || card.querySelector(':scope > .stat-card__label');
  card.insertBefore(el('div', { class: 'done-badge', text: `✓ ${text}` }), anchor ? anchor.nextSibling : card.firstChild);
  return card;
}

function georgiaCard(ctx) {
  const { dash, categories, month } = ctx;
  const pct = dash.georgia.plannedEur > 0 ? Math.min(100, (dash.georgia.actualEur / dash.georgia.plannedEur) * 100) : 0;
  const card = statCard({
    labelKey: 'card.georgia',
    value: formatMoney(dash.georgia.plannedEur, 'EUR'),
    sub: `${formatMoney(dash.georgia.plannedGel, 'GEL')} · გადახდილია ${formatMoney(dash.georgia.actualEur, 'EUR')} · ${formatPercent(dash.georgia.pct)} შემოსავლიდან`,
    pct,
    color: '#d97706'
  });
  const items = month.transactions.filter(tr => isGeorgia(tr, categories) && !isExtra(tr));
  if (items.length && items.every(tr => tr.paid)) markDone(card, 'ყველაფერი გადარიცხულია');
  const essentials = categories.find(c => c.id === 'cat_essentials');
  return attachDetails(card, 'georgia', ctx, (tr) => isGeorgia(tr, categories), { toGeorgia: true, categoryId: essentials ? essentials.id : undefined });
}

function categoryCard(b, ctx) {
  const { month, categories } = ctx;
  // Show "whose" only when the whole block (incl. sub-categories) belongs to one person.
  const owners = new Set(familyOf(categories, b).map(c => c.owner || 'shared'));
  const only = owners.size === 1 ? [...owners][0] : null;
  const owner = only && only !== 'shared' ? ` · ${personTag(only)}` : (owners.size > 1 ? ` · ${[...owners].map(o => personTag(o)).join(' + ')}` : '');
  const isSaving = b.goalType === 'min';
  if (!isSaving) return billsCategoryCard(b, ctx, owner);
  const pct = b.planned > 0 ? Math.min(100, (b.actual / b.planned) * 100) : 0;
  const sub = `გადარიცხულია ${formatMoney(b.actual, 'EUR')} / ${formatMoney(b.planned, 'EUR')} · ${formatPercent(b.pct)} შემოსავლიდან${owner}`;
  const card = statCard({ label: b.name, value: formatMoney(b.planned, 'EUR'), sub, pct, color: b.color });
  void month;
  if (b.planned > 0.004) {
    const open = b.toTransfer > 0.5;
    if (open) {
      const status = el('div', { class: 'saving-status saving-status--open' }, [
        el('span', { text: `⏳ ჯერ არ გადარიცხულა: ${formatMoney(b.toTransfer, 'EUR', 0)}` })
      ]);
      const btn = el('button', { type: 'button', class: 'pay-btn', text: '✓ გადავრიცხე' });
      btn.addEventListener('click', (e) => { e.stopPropagation(); openSavingsTransferDialog(b, ctx); });
      status.appendChild(btn);
      card.appendChild(status);
    } else {
      markDone(card, 'გადარიცხულია');
    }
  }
  return attachDetails(card, `cat:${b.id}`, ctx, (tr) => topIdOf(ctx.categories, tr.categoryId) === b.id, { categoryId: b.id });
}

/**
 * A spending block (e.g. "აუცილებელი") shows its BILLS only: food/fuel budgets and the extras
 * bought with them are in "🛒 ხარჯები" and "🧺" (v17). The plan line still compares the whole block.
 */
function billsCategoryCard(b, ctx, owner) {
  const { month, categories } = ctx;
  const rate = month.exchangeRate;
  const T = (month.income?.giorgi || 0) + (month.income?.nino || 0);
  const inBlock = (tr) => topIdOf(categories, tr.categoryId) === b.id;
  const isBill = (tr) => inBlock(tr) && !isEnvelope(tr) && !isExtra(tr);
  const bills = month.transactions.filter(isBill);
  const planned = bills.reduce((s, tr) => s + txnPlannedEur(tr, rate), 0);
  const paid = bills.reduce((s, tr) => s + txnPaidEur(tr, rate), 0);
  const budgets = month.transactions.filter(tr => inBlock(tr) && isEnvelope(tr)).reduce((s, tr) => s + txnPlannedEur(tr, rate), 0);
  const pct = planned > 0 ? Math.min(100, (paid / planned) * 100) : 0;
  const share = T > 0 ? (planned / T) * 100 : 0;
  let sub = `გადახდილია ${formatMoney(paid, 'EUR')} · ${formatPercent(share)} შემოსავლიდან${owner}`;
  if (budgets > 0.004 || b.target > 0) {
    sub += ` · კვება/საწვავით სულ ${formatMoney(b.planned, 'EUR', 0)}${b.target > 0 ? ` (გეგმა ${formatMoney(b.target, 'EUR', 0)}, ${formatPercent(b.targetPercent)})` : ''}`;
  }
  const card = statCard({ label: b.name, value: formatMoney(planned, 'EUR'), sub, pct, color: b.color });
  if (bills.length && bills.every(tr => tr.paid)) markDone(card, 'ყველა გადასახადი გადახდილია');
  return attachDetails(card, `cat:${b.id}`, ctx, isBill, { categoryId: b.id });
}

/**
 * 💰 One card for all savings (v17): each saving (whose, short/long term) with plan and what is
 * transferred, totals for short-term, long-term and all. Tap → the separate savings cards with
 * "✓ გადავრიცხე" open below it; tap again → they fold away.
 */
function savingsCard(ctx) {
  const { dash, categories, rerender } = ctx;
  const blocks = dash.buckets.filter(b => b.goalType === 'min');
  if (!blocks.length) return [];
  const so = computeSavingsOverview(ctx.month, categories);
  const open = expanded.has('savings');
  const card = el('div', { class: 'card stat-card stat-card--wide savings-card card--expandable' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.savings') }));
  card.appendChild(el('div', { class: 'stat-card__value tabular-nums', text: formatMoney(so.total.planned, 'EUR') }));
  const m0 = (v) => formatMoney(v, 'EUR', 0);
  const TERM = { short: 'მოკლევადიანი', long: 'გრძელვადიანი' };
  const list = el('div', { class: 'savings-list' });
  so.items.forEach(r => {
    const done = r.open <= 0.5;
    list.appendChild(el('div', { class: 'savings-item' + (done ? ' savings-item--done' : '') }, [
      el('span', { class: 'savings-item__icon', text: done ? '✓' : '⏳' }),
      el('div', { class: 'savings-item__main' }, [
        el('div', { class: 'savings-item__name', text: r.name }),
        el('div', { class: 'detail-row__meta', text: [personTag(r.owner), TERM[r.term]].filter(Boolean).join(' · ') })
      ]),
      el('div', { class: 'savings-item__amount tabular-nums', text: `${m0(r.done)} / ${m0(r.planned)}` })
    ]));
  });
  card.appendChild(list);
  const totals = el('table', { class: 'split-table savings-totals tabular-nums' });
  totals.appendChild(el('thead', {}, [el('tr', {}, [el('th', { text: '' }), el('th', { text: 'გეგმა' }), el('th', { text: 'გადარიცხული' })])]));
  const row = (label, x, cls = '') => el('tr', { class: cls }, [el('th', { scope: 'row', text: label }), el('td', { text: m0(x.planned) }), el('td', { text: m0(x.done) })]);
  totals.appendChild(el('tbody', {}, [
    so.short.planned > 0.004 ? row('მოკლევადიანი', so.short) : null,
    so.long.planned > 0.004 ? row('გრძელვადიანი', so.long) : null,
    row('სულ ორივემ', so.total, 'savings-totals__all')
  ].filter(Boolean)));
  card.appendChild(totals);
  const toggle = () => { if (expanded.has('savings')) expanded.delete('savings'); else expanded.add('savings'); rerender(); };
  const btn = el('button', { type: 'button', class: 'card-expand', 'aria-expanded': String(open), text: open ? '▲ დაკეცვა' : `▼ ${blocks.length} ბარათი — გადარიცხვა / რედაქტირება` });
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  card.addEventListener('click', (e) => {
    if (document.body.classList.contains('text-edit-mode')) return;
    if (e.target.closest('button, input, select, a, label')) return;
    toggle();
  });
  card.appendChild(btn);
  if (so.items.length && so.items.every(r => r.open <= 0.5)) markDone(card, 'ყველაფერი გადარიცხულია');
  if (!open) return card;
  const subCards = blocks.map(b => { const c = categoryCard(b, ctx); c.classList.add('savings-sub'); return c; });
  return [card, ...subCards];
}

/**
 * Records the savings transfer(s) of a block, per (sub)category: unpaid savings entries that
 * already exist (e.g. from a template) are marked paid first; only the rest becomes a new entry.
 */
function openSavingsTransferDialog(b, ctx) {
  const { month, key, categories, rerender } = ctx;
  const rate = month.exchangeRate;
  const T = (month.income?.giorgi || 0) + (month.income?.nino || 0);
  const rows = familyOf(categories, b).map(c => {
    const target = targetEur(c, T);
    const inCat = month.transactions.filter(t => t.categoryId === c.id && !isEnvelope(t) && !isExtra(t));
    const done = inCat.reduce((acc, t) => acc + txnPaidEur(t, rate), 0);
    const unpaid = inCat.filter(t => !t.paid).sort((x, y) => (x.dueDate || '').localeCompare(y.dueDate || ''));
    const open = unpaid.reduce((acc, t) => acc + txnPlannedEur(t, rate), 0);
    const goal = Math.max(target, done + open);
    return { c, unpaid, missing: Math.max(0, Math.round((goal - done) * 100) / 100) };
  }).filter(r => r.missing > 0.004);
  if (!rows.length) { toast('ყველაფერი უკვე გადარიცხულია ✓'); return; }
  const form = el('form', {});
  form.appendChild(el('p', { class: 'card__sub', text: 'მონიშნე, რა გადარიცხე, და საჭიროების შემთხვევაში შეცვალე თანხა. ჩაიწერება გადახდილად.' }));
  const inputs = rows.map(r => {
    const cb = el('input', { type: 'checkbox' }); cb.checked = true;
    const amt = el('input', { type: 'text', inputmode: 'decimal', class: 'prep__amount tabular-nums', value: r.missing.toFixed(2).replace('.', ',') });
    form.appendChild(el('label', { class: 'prep__row' }, [cb, el('span', { class: 'prep__name', text: `${r.c.name}${r.c.owner && r.c.owner !== 'shared' ? ` · ${personTag(r.c.owner)}` : ''}` }), el('span', { class: 'prep__money' }, [amt, el('span', { class: 'prep__cur', text: '€' })])]));
    return { r, cb, amt };
  });
  const save = el('button', { class: 'btn btn--primary', type: 'submit', text: '✓ ჩაწერა' });
  form.appendChild(el('div', { class: 'btn-row' }, [save]));
  const { close } = openModal(form, { title: `💰 ${b.name} — გადარიცხვა` });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const made = [];
    const before = []; // copies of existing entries marked paid here (for ↩ undo)
    updateState(d => {
      const list = d.months[key].transactions;
      inputs.forEach(({ r, cb, amt }) => {
        if (!cb.checked) return;
        let v = parseAmountInput(amt.value);
        if (!(v > 0)) return;
        r.unpaid.forEach(u => {
          if (v <= 0.004) return;
          const tr = list.find(t => t.id === u.id);
          if (!tr || tr.paid) return;
          const plannedEur = txnPlannedEur(tr, rate);
          const part = Math.min(v, plannedEur);
          before.push(JSON.parse(JSON.stringify(tr)));
          tr.paid = true; tr.paidAt = todayISO(); tr.rateAtPayment = null;
          tr.amountActual = part >= plannedEur - 0.004 ? tr.amountPlanned
            : Math.round((tr.currency === 'GEL' ? part * rate : part) * 100) / 100;
          v = Math.round((v - part) * 100) / 100;
        });
        if (v <= 0.004) return;
        const id = `txn_save_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        list.push({
          id, templateId: null, name: r.c.name, categoryId: r.c.id, owner: r.c.owner || 'shared', account: r.c.owner || 'shared',
          toGeorgia: false, currency: 'EUR', amountPlanned: v, amountActual: v, paid: true, paidAt: todayISO(),
          rateAtPayment: null, dueDate: todayISO(), note: 'დანაზოგის გადარიცხვა'
        });
        made.push(id);
      });
      return d;
    });
    close();
    undoToast(`ჩაიწერა ${made.length + before.length} გადარიცხვა ✓`, () => {
      updateState(d => {
        const m = d.months[key];
        m.transactions = m.transactions.filter(t => !made.includes(t.id))
          .map(t => { const old = before.find(x => x.id === t.id); if (!old) return t; const c = { ...old }; delete c._u; return c; });
        return d;
      });
      rerender();
    });
    rerender();
  });
}

function yearCard({ state, key, goToMonth, rerender }) {
  // Period: remembered per device; default = the selected month's calendar year.
  const year = Number(key.slice(0, 4));
  const saved = getUiPref('overviewRange', null);
  const cur = budgetMonthKey();
  // "last N months" is kept relative, so it moves on with the calendar.
  const lastN = saved && saved.last > 0 ? Math.min(240, Math.round(saved.last)) : 0;
  const from = lastN ? shiftKey(cur, 1 - lastN) : (saved && saved.from ? saved.from : `${year}-01`);
  const to = lastN ? cur : (saved && saved.to ? saved.to : `${year}-12`);
  const yo = computeRangeOverview(state.months, state.categories, from, to);
  const card = el('div', { class: 'card', style: 'grid-column: 1 / -1' });
  card.appendChild(el('div', { class: 'card__title', ...tx('card.year') }));

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
  card.appendChild(el('div', { class: 'card__sub', text: 'ფაქტი: მხოლოდ გადახდილი ტრანზაქციები (თვე, სადაც ჯერ არაფერია გადახდილი, არ ჩანს). თვეზე დაჭერით გადახვალ იმ თვეში.' }));

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
  yo.rows.forEach(r => {
    const multiYear = from.slice(0, 4) !== to.slice(0, 4);
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

// ---------------- Month preparation prompts ----------------

function prepareCards(state, key, open, redraw) {
  const cards = [];
  if (!state.templates.length) return cards;
  const cur = budgetMonthKey();
  const dismissed = new Set(getUiPref('dismissedPrepare', []));
  const make = (k, title, sub, primary) => {
    const btn = el('button', { class: 'btn ' + (primary ? 'btn--primary' : 'btn--secondary'), type: 'button', text: '📅 მომზადება' });
    btn.addEventListener('click', () => open(k));
    const closeBtn = el('button', { class: 'icon-btn icon-btn--sm prepare-card__close', type: 'button', 'aria-label': 'შეხსენების დამალვა ამ თვისთვის', title: 'დამალვა (ამ თვისთვის). სულ გამორთვა — პარამეტრებში', text: '✕' });
    closeBtn.addEventListener('click', () => {
      setUiPref('dismissedPrepare', [...dismissed, k].slice(-24));
      toast('დაიმალა. „📅 შემდეგი თვის მომზადება" ისევ ხელმისაწვდომია „შაბლონების" გვერდზე; სულ გამორთვა — პარამეტრებში.');
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

function dueCard(ctx) {
  const { month } = ctx;
  // Only fixed payments (bills). Food/fuel budgets have their own card, savings their own blocks.
  const rem = computeRemaining(month, ctx.categories, ctx.settings);
  const card = el('div', { class: 'card stat-card stat-card--wide due-card' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.due') }));
  card.appendChild(el('div', { class: 'stat-card__value tabular-nums', text: formatMoney(rem.bills, 'EUR') }));
  const isBill = (tr) => !isEnvelope(tr) && !isExtra(tr) && !isSavingsTxn(tr, ctx.categories);
  if (rem.bills <= 0.004) {
    if (month.transactions.some(isBill)) markDone(card, 'ყველა გადასახადი გადახდილია');
    else card.appendChild(el('div', { class: 'stat-card__sub', text: 'ამ თვეში გადასახადები ჯერ არ არის.' }));
    return attachDetails(card, 'due', ctx, (tr) => isBill(tr));
  }
  card.appendChild(el('div', { class: 'stat-card__sub tabular-nums', text: `${rem.next.length} გადასახადი გადასახდელია (დანაზოგი და კვება/საწვავი აქ არ ითვლება)` }));
  const acc = el('div', { class: 'due-card__accounts tabular-nums' });
  Object.entries(rem.billsByAccount).forEach(([a, v]) => {
    if (v > 0.004) acc.appendChild(el('span', { class: 'chip', text: `${personTag(a)}: ${formatMoney(v, 'EUR', 0)}` }));
  });
  card.appendChild(acc);
  const next = rem.next.slice(0, 2).map(t => `${t.name} ${formatDate(t.dueDate).slice(0, 5)}`).join(' · ');
  if (next) card.appendChild(el('div', { class: 'stat-card__sub', text: `შემდეგი: ${next}` }));
  return attachDetails(card, 'due', ctx, (tr) => isBill(tr) && txnRemainingEur(tr, month.exchangeRate) > 0.004);
}

// ---------------- Envelopes (food, fuel…) ----------------

function envelopesCard({ month, key, rerender }) {
  const envs = month.transactions.filter(isEnvelope);
  if (!envs.length) return [];
  const card = el('div', { class: 'card stat-card stat-card--wide' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.envelopes') }));
  const leftAll = envs.reduce((acc, t) => acc + txnRemainingEur(t, month.exchangeRate, month.transactions), 0);
  card.appendChild(el('div', { class: 'stat-card__value tabular-nums', text: `დარჩა ${formatMoney(leftAll, 'EUR', 0)}` }));
  envs.forEach(t => {
    // Extras bought with this money (🧺 card) are part of what is spent from it.
    const extrasFromIt = envelopeExtras(t, month.transactions, month.exchangeRate);
    const spent = envelopeSpent(t) + extrasFromIt;
    const left = (t.amountPlanned || 0) - spent;
    const pct = t.amountPlanned > 0 ? Math.min(100, (spent / t.amountPlanned) * 100) : 0;
    // How much per day is left until the end of the month (current month only).
    let perDay = '';
    if (t.dailyHint !== false && key === budgetMonthKey() && !t.paid && left > 0.5) {
      const daysLeft = daysLeftInBudget(); // until the next salary
      perDay = ` · დღეში ≈ ${formatMoney(left / daysLeft, t.currency, 0)}`;
    }
    const add = el('button', { class: 'icon-btn icon-btn--sm envelope-row__add', type: 'button', 'aria-label': `${t.name}: ხარჯის ან ნაშთის ჩაწერა`, text: '＋' });
    add.addEventListener('click', () => openEnvelopeDialog(t.id, rerender));
    const row = el('div', { class: 'envelope-row' + (t.paid ? ' envelope-row--closed' : '') }, [
      el('div', { class: 'envelope-row__main' }, [
        el('div', { class: 'envelope-row__top' }, [
          el('span', { class: 'envelope-row__name', text: t.name }),
          el('span', { class: 'tabular-nums' + (left < -0.004 ? ' text-danger' : ''), text: t.paid ? 'დახურულია' : `დარჩა ${formatMoney(left, t.currency, 0)} / ${formatMoney(t.amountPlanned, t.currency, 0)}${perDay}${extrasFromIt > 0 ? ` · 🧺 ${formatMoney(extrasFromIt, t.currency, 0)}` : ''}` })
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
  const rows = [
    row('split.income', 'income', { cls: 'split-table__income' }),
    row('split.toShared', 'toShared', { strong: true, cls: 'split-table__main' }),
    view === 'keep'
      ? row('split.keep', 'keepForDebits', { hideIfZero: true })
      : row('split.back', 'backFromShared', { hideIfZero: true }),
    row('split.savings', 'savings', { hideIfZero: true }),
    row('split.free', 'free', { strong: true })
  ].filter(Boolean);
  table.appendChild(el('tbody', {}, rows));
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

// ---------------- Extras: quick list of unplanned purchases (shoes, medicine…) ----------------

function extrasCard(ctx) {
  const { month, key, categories, rerender } = ctx;
  const card = el('div', { class: 'card stat-card stat-card--wide extras-card' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.extras') }));
  const extras = month.transactions.filter(isExtra).sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || ''));
  const total = extras.reduce((acc, t) => acc + (t.amountActual ?? t.amountPlanned ?? 0), 0);
  card.appendChild(el('div', { class: 'stat-card__value tabular-nums', text: formatMoney(total, 'EUR') }));

  // quick add: name + amount + where the money came from
  const envs = month.transactions.filter(isEnvelope);
  const name = el('input', { type: 'text', class: 'extras__name', placeholder: 'რა (მაგ. ფეხსაცმელი)', maxlength: '60' });
  const amount = el('input', { type: 'text', inputmode: 'decimal', class: 'extras__amount tabular-nums', placeholder: '€' });
  const from = el('select', { class: 'extras__from', 'aria-label': 'საიდან გადავიხადეთ' }, [
    ...envs.map(e => el('option', { value: e.id, text: `🛒 ${genitive(e.name)} ფულიდან` })),
    el('option', { value: '', text: 'ცალკე (არა ბიუჯეტიდან)' })
  ]);
  const food = envs.find(e => /კვებ/.test(e.name));
  from.value = food ? food.id : (envs[0] ? envs[0].id : '');
  const add = el('button', { type: 'button', class: 'btn btn--primary btn--sm', text: '+ დამატება' });
  const submit = () => {
    const n = name.value.trim();
    const v = parseAmountInput(amount.value);
    if (!n || !(v > 0)) { toast('ჩაწერე რა იყიდე და რამდენი', 'error'); return; }
    const env = envs.find(e => e.id === from.value);
    const freeCat = categories.find(c => c.parentId === FREE_BUCKET_ID) || categories[0];
    updateState(d => {
      d.months[key].transactions.push({
        id: `txn_extra_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        templateId: null, kind: 'extra', fromEnvelope: env ? env.id : null, name: n,
        categoryId: env ? env.categoryId : (freeCat ? freeCat.id : 'cat_other'), owner: env ? env.account || 'shared' : 'shared', account: env ? env.account || 'shared' : 'shared',
        toGeorgia: false, currency: 'EUR', amountPlanned: v, amountActual: v, paid: true, paidAt: todayISO(),
        rateAtPayment: null, dueDate: todayISO(), note: ''
      });
      return d;
    });
    toast(`🧺 ${n} — ${formatMoney(v, 'EUR')} ✓${env ? ` (${dative(env.name)} დააკლდა)` : ''}`);
    rerender();
  };
  add.addEventListener('click', (e) => { e.stopPropagation(); submit(); });
  amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  card.appendChild(el('div', { class: 'extras__form' }, [name, amount, from, add]));

  if (!extras.length) {
    card.appendChild(el('div', { class: 'stat-card__sub', text: 'ბიუჯეტიდან ნაყიდი „სხვა" რამ (ფეხსაცმელი, წამალი…) აქ ჩაწერე — ის აკლდება იმ ბიუჯეტს (კვება, საწვავი), რომლის ფულიდანაც იყიდე.' }));
    return card;
  }
  // "real food cost" = what was spent from the envelope minus the extras bought with it
  envs.forEach(e => {
    const fromIt = envelopeExtras(e, extras, month.exchangeRate);
    if (fromIt > 0) {
      const own = envelopeSpent(e);
      card.appendChild(el('div', { class: 'stat-card__sub tabular-nums', text: `🛒 ${e.name}: ${formatMoney(own, e.currency, 0)} + დამატებითი ${formatMoney(fromIt, e.currency, 0)} = ${formatMoney(own + fromIt, e.currency, 0)} / ${formatMoney(e.amountPlanned, e.currency, 0)}` }));
    }
  });
  // The list folds away — it only grows during the month.
  const open = expanded.has('extras');
  const toggle = el('button', { type: 'button', class: 'card-expand', 'aria-expanded': String(open), text: open ? '▲ დამალვა' : `▼ ${extras.length} ჩანაწერი — ნახვა` });
  toggle.addEventListener('click', (e) => { e.stopPropagation(); if (open) expanded.delete('extras'); else expanded.add('extras'); rerender(); });
  card.appendChild(toggle);
  if (!open) return card;
  const list = el('div', { class: 'extras__list' });
  extras.forEach(x => {
    const env = envs.find(e => e.id === x.fromEnvelope);
    const del = el('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': `${x.name} — წაშლა`, text: '✕' });
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      const copy = JSON.parse(JSON.stringify(x));
      updateState(d => { d.months[key].transactions = d.months[key].transactions.filter(t => t.id !== x.id); return d; });
      undoToast('წაიშალა', () => { updateState(d => { delete copy._u; d.months[key].transactions.push(copy); return d; }); rerender(); });
      rerender();
    });
    list.appendChild(el('div', { class: 'detail-row' }, [
      el('div', { class: 'detail-row__main' }, [
        el('div', { class: 'detail-row__name', text: x.name }),
        el('div', { class: 'detail-row__meta', text: `${formatDate(x.paidAt || x.dueDate).slice(0, 5)}${env ? ` · ${genitive(env.name)} ფულიდან` : ' · ცალკე'}` })
      ]),
      el('div', { class: 'detail-row__amount tabular-nums', text: formatMoney(x.amountActual ?? x.amountPlanned, 'EUR') }),
      del
    ]));
  });
  card.appendChild(list);
  return card;
}

const CARD_RENDERERS = {
  summary: summaryCard,
  income: incomeCard,
  rate: rateCard,
  georgia: georgiaCard,
  savings: savingsCard,
  year: yearCard,
  due: dueCard,
  envelopes: envelopesCard,
  extras: extrasCard,
  split: splitCard
};
