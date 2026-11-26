// views/dashboard.js — the dashboard page: month selector + the cards in the family's order.
// Each card lives in views/dash/<file>.js (see CARD_RENDERERS below); a category block that is
// not a fixed card is drawn by categoryCard. To add a card: write its renderer(ctx) in a dash
// file, register it here and add its key to FIXED_CARDS in calc.js (+ a title in texts.js).

import { getState, updateState, budgetMonthKey } from '../state.js';
import { generateMonthTransactions, monthNeedsGeneration, monthIsPrepared, initMonth } from '../monthEngine.js';
import { openPrepareWizard, preparationPreview } from '../prepare.js';
import { monthLabel, monthLabelFull, getSelectedMonth, setSelectedMonth, onMonthChange, getUiPref, setUiPref } from '../monthNav.js';
import { computeDashboard, effectiveCardOrder, formatMoney, planFor } from '../calc.js';
import { el, toast } from '../ui.js';
import { renderMonthNav } from '../components.js';
import { navigate } from '../app.js';
import { summaryCard, incomeCard, rateCard, autoRefreshRate } from './dash/top.js';
import { dueCard, georgiaCard, categoryCard } from './dash/blocks.js';
import { savingsCard } from './dash/savings.js';
import { envelopesCard, extrasCard } from './dash/budgets.js';
import { splitCard } from './dash/split.js';
import { yearCard } from './dash/period.js';

/** Fixed cards: key → renderer(ctx) returning a card (or an array of cards, or []). */
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
    // everything on the dashboard uses THIS month's plan (its own copy or the global one)
    const { categories, settings } = planFor(month, state.categories, state.settings);
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

  /** Jump to another month (from the period table) and keep the selector in sync. */
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
