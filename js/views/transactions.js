// views/transactions.js — Transactions list, filters, paid-flow §5.2.

import { getState, updateState, ensureMonth, todayISO, FREE_BUCKET_ID } from '../state.js';
import { generateMonthTransactions, monthNeedsGeneration, monthIsPrepared, initMonth, addTemplateToMonth } from '../monthEngine.js';
import { openPrepareWizard, preparationPreview } from '../prepare.js';
import { monthLabelFull } from '../monthNav.js';
import { txnAmountEur, txnPlannedEur, txnPaidEur, resolveTopCategory, formatMoney, parseAmountInput, isEnvelope, isExtra, envelopeSpent, envelopeUsed, isTwoStep, isTransferred } from '../calc.js';
import { openEnvelopeDialog } from '../envelope.js';
import { t, tx, personName, genitive } from '../texts.js';
import { fetchEurGelRate } from '../rates.js';
import { el, openModal, confirmDialog, toast, undoToast, formatDate } from '../ui.js';
import { getSelectedMonth, onMonthChange } from '../monthNav.js';
import { isOn } from '../features.js';
import { renderMonthNav, bucketChip, freePseudoCategory, payerChip, georgiaChip, categoryChips, categoryOptions, PAYER_LABELS } from '../components.js';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

let unsubscribe = null;
let statusFilter = 'all'; // all | unpaid | moved (transferred, not yet debited) | paid
let ownerFilter = 'all';  // all | giorgi | nino | shared
let groupByBucket = false;

/** Lets other pages open this list pre-filtered (e.g. dashboard "still to pay" → unpaid). */
export function setTransactionsFilter(status = 'all', owner = 'all') {
  statusFilter = ['all', 'unpaid', 'moved', 'paid'].includes(status) ? status : 'all';
  ownerFilter = owner;
}

export function renderTransactions(root) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }

  const container = el('div', { class: 'transactions-view' });
  root.appendChild(container);

  const monthNav = renderMonthNav(() => draw());
  container.appendChild(monthNav);

  const toolbar = el('div', { class: 'btn-row' });
  const addBtn = el('button', { class: 'btn btn--primary', ...tx('btn.newExpense') });
  const regenBtn = el('button', { class: 'btn btn--secondary', ...tx('btn.prepare') });
  toolbar.append(addBtn, regenBtn);
  container.appendChild(toolbar);
  const prepBanner = el('div', {});
  container.appendChild(prepBanner);

  // v20: all filters in ONE row that scrolls sideways — three rows took half a phone screen
  const statusRow = el('div', { class: 'filter-row filter-row--scroll' });
  const statusBtns = {
    all: filterBtn(t('filter.all'), () => setStatusFilter('all'), 'filter.all'),
    unpaid: filterBtn(t('filter.unpaid'), () => setStatusFilter('unpaid'), 'filter.unpaid'),
    moved: filterBtn(t('filter.moved'), () => setStatusFilter('moved'), 'filter.moved'),
    paid: filterBtn(t('filter.paid'), () => setStatusFilter('paid'), 'filter.paid')
  };
  statusRow.append(statusBtns.all, statusBtns.unpaid, statusBtns.moved, statusBtns.paid);
  container.appendChild(statusRow);
  const ownerRow = statusRow;

  ownerRow.appendChild(el('span', { class: 'filter-sep', 'aria-hidden': 'true' }));
  const ownerBtns = {
    all: filterBtn(`👤 ${t('filter.all')}`, () => setOwnerFilter('all')),
    giorgi: filterBtn(personName('giorgi'), () => setOwnerFilter('giorgi'), 'person.giorgi'),
    nino: filterBtn(personName('nino'), () => setOwnerFilter('nino'), 'person.nino'),
    shared: filterBtn(personName('shared'), () => setOwnerFilter('shared'), 'person.shared')
  };
  ownerRow.append(ownerBtns.all, ownerBtns.giorgi, ownerBtns.nino, ownerBtns.shared);
  ownerRow.appendChild(el('span', { class: 'filter-sep', 'aria-hidden': 'true' }));
  const groupToggle = el('button', { class: 'filter-btn', ...tx('btn.groupByCategory') });
  ownerRow.appendChild(groupToggle);

  const totalsBar = el('div', { class: 'totals-bar tabular-nums' });
  container.appendChild(totalsBar);

  const list = el('div', { class: 'list' });
  container.appendChild(list);

  function setStatusFilter(v) { statusFilter = v; drawFilterState(); draw(); }
  function setOwnerFilter(v) { ownerFilter = v; drawFilterState(); draw(); }
  function drawFilterState() {
    Object.entries(statusBtns).forEach(([k, btn]) => btn.setAttribute('aria-pressed', String(k === statusFilter)));
    Object.entries(ownerBtns).forEach(([k, btn]) => btn.setAttribute('aria-pressed', String(k === ownerFilter)));
    groupToggle.setAttribute('aria-pressed', String(groupByBucket));
  }

  groupToggle.addEventListener('click', () => { groupByBucket = !groupByBucket; drawFilterState(); draw(); });

  addBtn.addEventListener('click', () => openTransactionForm(null, getSelectedMonth(), draw));

  // Opens the visual preparation screen: shows what comes from templates, lets you add back skipped ones.
  regenBtn.addEventListener('click', () => openPrepareWizard(getSelectedMonth(), () => draw()));

  unsubscribe = onMonthChange(() => {
    if (!container.isConnected) {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      return;
    }
    draw();
  });

  function draw() {
    const key = getSelectedMonth();
    if (!getState().months[key]) updateState(draft => { initMonth(draft, key); return draft; });
    const auto = getState().settings.newMonthMode === 'auto';
    if ((auto || monthIsPrepared(getState(), key)) && monthNeedsGeneration(getState(), key)) {
      updateState(draft => { generateMonthTransactions(draft, key); return draft; });
    }
    prepBanner.innerHTML = '';
    if (!auto && !monthIsPrepared(getState(), key) && getState().templates.length) {
      const p = preparationPreview(getState(), key);
      const btn = el('button', { class: 'btn btn--primary', type: 'button', text: '📅 მომზადება' });
      btn.addEventListener('click', () => openPrepareWizard(key, () => draw()));
      prepBanner.appendChild(el('div', { class: 'card prepare-card prepare-card--main' }, [
        el('div', { class: 'prepare-card__text' }, [
          el('div', { class: 'prepare-card__title', text: `${monthLabelFull(key)} ჯერ არ არის მომზადებული` }),
          el('div', { class: 'stat-card__sub', text: `${p.count} ხარჯი შაბლონებიდან ≈ ${formatMoney(p.total, 'EUR', 0)} — ნახე და შექმენი.` })
        ]),
        btn
      ]));
    }
    drawFilterState();

    const state = getState();
    const month = state.months[key];
    const categories = state.categories;

    let txns = month.transactions.slice();
    const isOpen = (t) => !t.paid; // envelopes count as open until closed for the month
    if (statusFilter === 'unpaid') txns = txns.filter(isOpen);
    if (statusFilter === 'moved') txns = txns.filter(t => !t.paid && t.transferredAt);
    // "⇄ transferred" only matters when the month has bills paid from a personal account
    statusBtns.moved.hidden = !month.transactions.some(t => isTwoStep(t, categories)) && statusFilter !== 'moved';
    if (statusFilter === 'paid') txns = txns.filter(t => t.paid || (isEnvelope(t) && envelopeSpent(t) > 0));
    if (ownerFilter !== 'all') txns = txns.filter(t => (t.account || 'shared') === ownerFilter);
    txns.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

    // Totals for the currently visible (filtered) set.
    const planned = txns.reduce((s, t) => s + txnPlannedEur(t, month.exchangeRate), 0);
    const paid = txns.reduce((s, t) => s + txnPaidEur(t, month.exchangeRate), 0);
    totalsBar.textContent = txns.length
      ? `${txns.length} ჩანაწერი · გეგმა: ${formatMoney(planned, 'EUR')} · გადახდილია: ${formatMoney(paid, 'EUR')}`
      : '';

    list.innerHTML = '';
    if (txns.length === 0) {
      list.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-state__icon', text: '💳' }),
        el('div', { text: 'ტრანზაქციები არ მოიძებნა' })
      ]));
      return;
    }

    if (!groupByBucket) {
      txns.forEach(tr => list.appendChild(txnRow(tr, month, key, categories, draw)));
    } else {
      // One group per category (as in the "კატეგორიები" page), with count and sum.
      const order = [];
      categories.filter(c => !c.parentId).forEach(top => {
        order.push(top);
        categories.filter(c => c.parentId === top.id).forEach(ch => order.push(ch));
      });
      categories.filter(c => c.parentId === FREE_BUCKET_ID).forEach(c => order.push(c));
      categories.forEach(c => { if (!order.includes(c)) order.push(c); });
      const unknown = { id: '__none', name: 'კატეგორიის გარეშე' };
      [...order, unknown].forEach(cat => {
        const group = txns.filter(tr => (cat === unknown ? !categories.some(c => c.id === tr.categoryId) : tr.categoryId === cat.id));
        if (!group.length) return;
        const sum = group.reduce((acc, tr) => acc + txnPlannedEur(tr, month.exchangeRate), 0);
        list.appendChild(el('div', { class: 'txn-group-title' }, [
          el('span', {}, [cat.color ? el('span', { class: 'color-dot', style: `background:${cat.color}` }) : null, ` ${cat.name}`]),
          el('span', { class: 'tabular-nums', text: `${group.length} · ${formatMoney(sum, 'EUR', 0)}` })
        ]));
        group.forEach(tr => list.appendChild(txnRow(tr, month, key, categories, draw)));
      });
    }
  }

  draw();
}

function filterBtn(label, onClick, tkey) {
  const btn = el('button', { class: 'filter-btn', text: label, 'aria-pressed': 'false', ...(tkey ? { 'data-tkey': tkey } : {}) });
  btn.addEventListener('click', onClick);
  return btn;
}

function txnRow(txn, month, key, categories, refresh) {
  const category = categories.find(c => c.id === txn.categoryId);
  const top = category ? resolveTopCategory(categories, category.id) : null;
  const bucket = top ? (top.parentId === FREE_BUCKET_ID ? freePseudoCategory() : top) : null;
  const envelope = isEnvelope(txn);
  const overdue = !envelope && !txn.paid && txn.dueDate && txn.dueDate < todayISO();

  const row = el('div', { class: 'row' + (txn.paid ? ' row--paid' : '') + (overdue ? ' row--overdue' : '') + (!txn.paid && txn.transferredAt ? ' row--moved' : '') });

  const main = el('div', { class: 'row__main' }, [
    el('div', { class: 'row__name', text: txn.name }),
    el('div', { class: 'row__meta' }, [
      // food/fuel and the extras bought with that money are "expenses", not bills of their category
      ...(envelope ? [el('span', { class: 'chip', text: '🛒 ხარჯი' })]
        : isExtra(txn) ? [el('span', { class: 'chip', text: '🧺 დამატებითი ხარჯი' })]
        : txn.kind === 'fromSavings' ? [...categoryChips(categories, txn.categoryId), el('span', { class: 'chip', text: `💸 ${categories.find(c => c.id === txn.fromSavings)?.name || 'დანაზოგი'}-დან` })]
        : categoryChips(categories, txn.categoryId)),
      txn.toGeorgia || category?.georgiaTransfer ? georgiaChip() : null,
      payerChip(txn.account),
      envelope ? null : el('span', { text: formatDate(txn.dueDate) })
    ])
  ]);

  const amountEur = txnAmountEur(txn, month.exchangeRate);
  let amount;
  if (envelope) {
    const spent = envelopeUsed(txn, month.transactions, month.exchangeRate); // incl. extras bought with it
    const left = (txn.amountPlanned || 0) - spent;
    amount = el('div', { class: 'row__amount tabular-nums' }, [
      el('div', { text: `${formatMoney(spent, txn.currency, 0)} / ${formatMoney(txn.amountPlanned, txn.currency, 0)}` }),
      el('div', { class: 'row__amount-sub' + (left < -0.004 ? ' text-danger' : ''), text: txn.paid ? 'დახურულია' : `დარჩა ${formatMoney(left, txn.currency)}` })
    ]);
  } else {
    amount = el('div', { class: 'row__amount tabular-nums' }, [
      el('div', { text: formatMoney(txn.paid ? (txn.amountActual ?? txn.amountPlanned) : txn.amountPlanned, txn.currency) }),
      txn.currency === 'GEL' ? el('div', { class: 'row__amount-sub', text: `≈ ${formatMoney(amountEur, 'EUR')}${txn.paid && txn.rateAtPayment ? ` (კურსი ${String(txn.rateAtPayment).replace('.', ',')})` : ''}` }) : null
    ]);
  }

  const actions = el('div', { class: 'row__actions' });

  const payBtn = payButton(txn, month, refresh);

  const editBtn = el('button', { class: 'icon-btn', 'aria-label': 'რედაქტირება', text: '✎' });
  editBtn.addEventListener('click', () => openTransactionForm(txn, key, refresh));

  const deleteBtn = el('button', { class: 'icon-btn', 'aria-label': 'წაშლა', text: '🗑' });
  deleteBtn.addEventListener('click', async () => {
    const ok = await confirmDialog('წავშალო ეს ტრანზაქცია?', { danger: true, confirmLabel: 'წაშლა' });
    if (!ok) return;
    const copy = JSON.parse(JSON.stringify(txn));
    const monthOfTxn = key;
    updateState(draft => {
      const m = findMonthByTxnId(draft, txn.id);
      if (m) {
        m.transactions = m.transactions.filter(t => t.id !== txn.id);
        // A deleted template transaction must not silently come back on the next render.
        if (txn.templateId) {
          if (!Array.isArray(m.skipTemplates)) m.skipTemplates = [];
          if (!m.skipTemplates.includes(txn.templateId)) m.skipTemplates.push(txn.templateId);
        }
      }
      return draft;
    });
    undoToast('წაიშალა', () => {
      updateState(draft => {
        const m = draft.months[monthOfTxn];
        if (!m || m.transactions.some(t => t.id === copy.id)) return draft;
        delete copy._u;
        m.transactions.push(copy);
        if (copy.templateId) m.skipTemplates = (m.skipTemplates || []).filter(id => id !== copy.templateId);
        return draft;
      });
      toast('დაბრუნდა ✓');
      refresh();
    });
    refresh();
  });

  actions.append(payBtn, editBtn, deleteBtn);
  row.append(main, amount, actions);
  return row;
}

/**
 * Pay controls of one entry (always ONE element, so rows lay out the same everywhere):
 *  - one step (shared account): "○ გადახდა" → "✓ გადახდილია" (tap again = unpaid, with undo);
 *  - two steps (v19, a bill debited from a personal account): "⇄ გადატანა" = the money is moved
 *    to that account, and "○ ჩამოჭრა" = the bank took it. Debited implies transferred;
 *  - food/fuel budget: "＋ ხარჯი"; extras and spent-from-savings: a chip (already paid).
 * Used here and in the dashboard cards.
 */
export function payButton(txn, month, refresh) {
  if (txn.kind === 'extra') return el('span', { class: 'chip', title: 'დამატებითი ხარჯი (უკვე გადახდილი)', text: '🧺 დამატებითი' });
  if (txn.kind === 'fromSavings') return el('span', { class: 'chip', title: 'დანაზოგიდან გადახდილი ხარჯი', text: '💸 დანაზოგიდან' });
  if (isEnvelope(txn)) {
    const b = el('button', { type: 'button', class: 'pay-btn pay-btn--envelope', 'aria-label': 'ხარჯის ან ნაშთის ჩაწერა', text: '＋ ხარჯი' });
    b.addEventListener('click', (e) => { e.stopPropagation(); openEnvelopeDialog(txn.id, refresh); });
    return b;
  }
  const two = isTwoStep(txn, getState().categories);
  const payBtn = el('button', {
    type: 'button',
    class: 'pay-btn' + (txn.paid ? ' pay-btn--done' : ''),
    'aria-label': txn.paid ? `${two ? 'ჩამოჭრილია' : 'გადახდილია'} — დააჭირე გასაუქმებლად` : (two ? 'ჩამოჭრილად მონიშვნა' : 'გადახდილად მონიშვნა'),
    text: two ? (txn.paid ? t('btn.debited') : `○ ${t('btn.debit')}`) : (txn.paid ? t('btn.paid') : `○ ${t('btn.pay')}`)
  });
  payBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePaid(txn, refresh, two); });
  if (!two) return payBtn;

  const moved = isTransferred(txn);
  const moveBtn = el('button', {
    type: 'button',
    class: 'pay-btn pay-btn--move' + (moved ? ' pay-btn--done' : ''),
    'aria-label': txn.paid ? 'ჩამოჭრილია — ესე იგი გადატანილიცაა' : moved ? 'გადატანილია — დააჭირე გასაუქმებლად' : `${genitive(personName(txn.account))} ანგარიშზე გადატანილად მონიშვნა`,
    text: moved ? t('btn.transferred') : `⇄ ${t('btn.transfer')}`
  });
  if (txn.paid) moveBtn.disabled = true;
  moveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const was = txn.transferredAt || null;
    updateState(draft => {
      const tr = findTxn(draft, txn.id);
      if (was) delete tr.transferredAt; else tr.transferredAt = todayISO();
      return draft;
    });
    if (was) {
      undoToast('გადატანა გაუქმდა', () => { updateState(draft => { findTxn(draft, txn.id).transferredAt = was; return draft; }); refresh(); });
    } else {
      toast(`⇄ გადატანილია — ${genitive(personName(txn.account))} ანგარიშზეა, ელოდება ჩამოჭრას ✓`);
    }
    refresh();
  });
  return el('span', { class: 'pay-group' }, [moveBtn, payBtn]);
}

/** Paid ↔ unpaid (with undo). Variable or ₾ bills ask for the real amount first. */
function togglePaid(txn, refresh, two) {
  if (txn.paid) {
    const before = { paid: txn.paid, paidAt: txn.paidAt, rateAtPayment: txn.rateAtPayment, amountActual: txn.amountActual };
    updateState(draft => {
      const tr = findTxn(draft, txn.id);
      tr.paid = false; tr.paidAt = null; tr.rateAtPayment = null;
      return draft;
    });
    undoToast(two ? 'ჩამოჭრა გაუქმდა' : 'გადაუხდელად აღინიშნა', () => {
      updateState(draft => { Object.assign(findTxn(draft, txn.id), before); return draft; });
      refresh();
    });
    refresh();
    return;
  }
  if (txnIsVariable(txn) || txn.currency === 'GEL') {
    openActualAmountDialog(txn, () => refresh());
    return;
  }
  updateState(draft => {
    const tr = findTxn(draft, txn.id);
    tr.paid = true; tr.paidAt = todayISO(); tr.rateAtPayment = null;
    tr.amountActual = tr.amountActual ?? tr.amountPlanned;
    return draft;
  });
  toast(two ? 'ჩამოჭრილად აღინიშნა ✓' : 'გადახდილად აღინიშნა ✓');
  refresh();
}

function txnIsVariable(txn) {
  // A transaction is "variable" if it came from a variable-type template.
  const state = getState();
  if (!txn.templateId) return false;
  const tpl = state.templates.find(t => t.id === txn.templateId);
  return tpl ? tpl.type === 'variable' : false;
}

function findTxn(draft, id) {
  for (const key of Object.keys(draft.months)) {
    const t = draft.months[key].transactions.find(x => x.id === id);
    if (t) return t;
  }
  return null;
}
function findMonthByTxnId(draft, id) {
  for (const key of Object.keys(draft.months)) {
    if (draft.months[key].transactions.some(x => x.id === id)) return draft.months[key];
  }
  return null;
}

function openActualAmountDialog(txn, onDone) {
  const state = getState();
  const month = findMonthByTxnId(state, txn.id) || state.months[getSelectedMonth()];
  const isGel = txn.currency === 'GEL';
  const two = isTwoStep(txn, state.categories);
  const form = el('form', {});
  form.appendChild(el('p', { class: 'card__sub', text: `გეგმა: ${formatMoney(txn.amountPlanned, txn.currency)}` }));
  const input = el('input', { type: 'text', inputmode: 'decimal', value: txn.amountPlanned.toFixed(2).replace('.', ',') });
  form.appendChild(el('div', { class: 'field' }, [el('label', { text: `${two ? 'ჩამოჭრილი' : 'გადახდილი'} თანხა (${isGel ? '₾' : '€'})` }), input]));

  let rateInput = null;
  const eurPreview = el('div', { class: 'card__sub tabular-nums' });
  if (isGel) {
    rateInput = el('input', { type: 'text', inputmode: 'decimal', value: String(month.exchangeRate).replace('.', ',') });
    const bankBtn = el('button', { type: 'button', class: 'btn btn--secondary btn--sm', text: '🏦 საქ. ბანკის კურსი' });
    bankBtn.addEventListener('click', async () => {
      try {
        const r = await fetchEurGelRate();
        rateInput.value = String(r.rate).replace('.', ',');
        updatePreview();
        toast(`${r.source}: ${String(r.rate).replace('.', ',')}`);
      } catch (e) { toast(e.message, 'error'); }
    });
    form.appendChild(el('div', { class: 'field' }, [
      el('label', { text: 'კურსი, რომლითაც გადაცვალე (1 € = ? ₾) — გადახდის შემდეგ აღარ შეიცვლება' }),
      el('div', { style: 'display:flex;gap:8px;align-items:center' }, [rateInput, bankBtn])
    ]));
    form.appendChild(eurPreview);
  }
  function updatePreview() {
    if (!isGel) return;
    const amt = parseAmountInput(input.value), rate = parseAmountInput(rateInput.value, 4);
    eurPreview.textContent = rate > 0 ? `≈ ${formatMoney(amt / rate, 'EUR')}` : '';
  }
  input.addEventListener('input', updatePreview);
  if (rateInput) rateInput.addEventListener('input', updatePreview);
  updatePreview();

  const actions = el('div', { class: 'btn-row' });
  const saveBtn = el('button', { class: 'btn btn--primary', type: 'submit', text: two ? t('btn.debited') : t('btn.paid') });
  actions.appendChild(saveBtn);
  form.appendChild(actions);

  const { close } = openModal(form, { title: txn.name });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const actual = parseAmountInput(input.value);
    if (actual < 0) return;
    const rate = isGel ? parseAmountInput(rateInput.value, 4) : null;
    if (isGel && !(rate > 0)) { toast('ჩაწერე სწორი კურსი', 'error'); return; }
    updateState(draft => {
      const t = findTxn(draft, txn.id);
      t.paid = true;
      t.paidAt = todayISO();
      t.amountActual = actual;
      t.rateAtPayment = isGel ? rate : null;
      return draft;
    });
    toast(two ? 'ჩამოჭრილად აღინიშნა ✓' : 'გადახდილად აღინიშნა ✓');
    close();
    onDone();
    offerTemplateAmount(txn, actual, onDone);
  });
}

// ---------------- v20: keep the template in step with what really happens ----------------

/**
 * A FIXED bill was paid with a different amount than its template says (e.g. the insurance went
 * up): ask once whether the template — and the unpaid entries already made for later months —
 * should use the new amount too. Variable bills (electricity…) change anyway, so no question.
 */
function offerTemplateAmount(txn, actual, onDone) {
  if (!isOn('templateSync') || !txn.templateId) return;
  const tpl = getState().templates.find(x => x.id === txn.templateId);
  if (!tpl || tpl.type !== 'fixed' || tpl.currency !== txn.currency || Math.abs((tpl.amount || 0) - actual) < 0.005) return;
  setTimeout(async () => {
    const ok = await confirmDialog(`„${tpl.name}": გადახდილია ${formatMoney(actual, tpl.currency)}, შაბლონში კი ${formatMoney(tpl.amount, tpl.currency)} წერია. შაბლონშიც ჩავწერო ${formatMoney(actual, tpl.currency)}, რომ შემდეგ თვეებში ასე მოვიდეს?`,
      { confirmLabel: 'კი, შაბლონშიც', cancelLabel: 'არა, მხოლოდ ამჯერად' });
    if (!ok) return;
    const fromKey = monthOfTxn(getState(), txn.id);
    let n = 0;
    updateState(d => {
      const tp = d.templates.find(x => x.id === tpl.id);
      if (tp) tp.amount = actual;
      Object.keys(d.months).filter(k => fromKey && k > fromKey).forEach(k => d.months[k].transactions.forEach(t => {
        if (t.templateId === tpl.id && !t.paid && Math.abs(t.amountPlanned - tpl.amount) < 0.005) { t.amountPlanned = actual; n += 1; }
      }));
      return d;
    });
    toast(`შაბლონი განახლდა ✓${n ? ` (+ ${n} ჩანაწერი შემდეგ თვეებში)` : ''}`);
    onDone();
  }, 350);
}

function monthOfTxn(state, id) {
  return Object.keys(state.months).find(k => state.months[k].transactions.some(t => t.id === id)) || null;
}

/** Fields of an entry that differ from its template (what the user changed in the entry). */
function templateDiff(tpl, tr, before) {
  const out = [];
  const add = (field, label, now, was, tplVal, show) => {
    if (now !== was && now !== tplVal) out.push({ field, label, value: now, show: show || String(now) });
  };
  add('name', 'სახელი', tr.name, before.name, tpl.name);
  add('amount', 'თანხა', tr.amountPlanned, before.amountPlanned, tpl.amount, formatMoney(tr.amountPlanned, tr.currency));
  add('categoryId', 'კატეგორია', tr.categoryId, before.categoryId, tpl.categoryId, (getState().categories.find(c => c.id === tr.categoryId) || {}).name);
  add('account', 'ვინ იხდის', tr.account, before.account, tpl.account || 'shared', personName(tr.account));
  add('currency', 'ვალუტა', tr.currency, before.currency, tpl.currency);
  add('toGeorgia', 'საქართველოში', !!tr.toGeorgia, !!before.toGeorgia, !!tpl.toGeorgia, tr.toGeorgia ? 'კი' : 'არა');
  const day = (iso) => (iso || '').slice(8, 10);
  if (day(tr.dueDate) && day(tr.dueDate) !== day(before.dueDate) && day(tr.dueDate) !== day(tpl.firstDueDate)) out.push({ field: 'day', label: 'გადახდის დღე', value: day(tr.dueDate), show: day(tr.dueDate) });
  return out;
}

/** After editing an entry made from a template: "should the template change too?" */
function offerTemplateUpdate(before, onDone) {
  if (!isOn('templateSync') || !before.templateId) return;
  const s = getState();
  const tpl = s.templates.find(x => x.id === before.templateId);
  const key = monthOfTxn(s, before.id);
  const tr = key && s.months[key].transactions.find(t => t.id === before.id);
  if (!tpl || !tr) return;
  const diff = templateDiff(tpl, tr, before);
  if (!diff.length) return;
  setTimeout(async () => {
    const ok = await confirmDialog(`შაბლონიც შევცვალო, რომ შემდეგ თვეებშიც ასე მოვიდეს? (${diff.map(d => `${d.label}: ${d.show}`).join('; ')})`,
      { confirmLabel: 'კი, შაბლონიც', cancelLabel: 'არა, მხოლოდ ეს ჩანაწერი' });
    if (!ok) return;
    updateState(d => {
      const tp = d.templates.find(x => x.id === tpl.id);
      if (!tp) return d;
      diff.forEach(x => {
        if (x.field === 'day') tp.firstDueDate = `${tp.firstDueDate.slice(0, 8)}${x.value}`;
        else if (x.field === 'account') { tp.account = x.value; tp.owner = x.value; } else tp[x.field] = x.value;
      });
      return d;
    });
    toast('შაბლონი განახლდა ✓');
    onDone();
  }, 350);
}

export function openTransactionForm(existing, monthKeyStr, onSaved, presets = {}) {
  const state = getState();
  const isEdit = !!existing;
  const form = el('form', {});

  const nameInput = el('input', { type: 'text', value: existing?.name || '' });
  const categorySelect = categoryOptions(state.categories, existing?.categoryId || presets.categoryId);
  const georgiaBox = el('input', { type: 'checkbox' });
  georgiaBox.checked = !!(existing ? existing.toGeorgia : presets.toGeorgia);
  if (existing) categorySelect.value = existing.categoryId;

  const currencySelect = el('select', {}, [el('option', { value: 'EUR', text: 'EUR' }), el('option', { value: 'GEL', text: 'GEL' })]);
  currencySelect.value = existing?.currency || 'EUR';

  const amountInput = el('input', { type: 'text', inputmode: 'decimal', value: (existing?.amountPlanned ?? 0).toFixed(2).replace('.', ',') });
  // v18: a PAID entry shows (and saves) the amount that was really paid — before, the form only
  // changed the plan, so the list (which shows the paid amount) kept the old number.
  const fromSav = !!existing && existing.kind === 'fromSavings';
  const showPaid = !!existing && existing.paid && !isEnvelope(existing);
  const paidInput = showPaid ? el('input', { type: 'text', inputmode: 'decimal', value: Number(existing.amountActual ?? existing.amountPlanned ?? 0).toFixed(2).replace('.', ',') }) : null;
  if (fromSav && paidInput) amountInput.value = paidInput.value;

  const dueDateInput = el('input', { type: 'date', value: existing?.dueDate || `${monthKeyStr}-01` });

  const accountSelect = el('select', {}, Object.entries(PAYER_LABELS).map(([v, t]) => el('option', { value: v, text: v === 'shared' ? 'საერთო ანგარიში' : t })));
  accountSelect.value = existing?.account || 'shared';

  // v19: a bill from a personal account — is the money already moved to that account?
  const movedBox = el('input', { type: 'checkbox' });
  movedBox.checked = !!(existing && existing.transferredAt);
  const movedField = el('label', { class: 'field checkbox-field' }, [movedBox, el('span', { text: '⇄ გადატანილია — ფული უკვე ამ ანგარიშზეა, ბანკი ჯერ არ ჩამოჭრა' })]);
  const syncMoved = () => {
    const probe = { ...(existing || {}), kind: existing?.kind, account: accountSelect.value, categoryId: categorySelect.value };
    movedField.hidden = !isTwoStep(probe, state.categories) || !!existing?.paid;
  };
  accountSelect.addEventListener('change', syncMoved);
  categorySelect.addEventListener('change', syncMoved);
  syncMoved();
  /** Writes the transfer status onto the saved entry (inside updateState). */
  const applyMoved = (tr, cats) => {
    if (!tr) return;
    if (!isTwoStep(tr, cats)) { delete tr.transferredAt; return; }
    if (tr.paid) return; // debited = transferred anyway
    if (movedBox.checked) tr.transferredAt = tr.transferredAt || todayISO(); else delete tr.transferredAt;
  };

  const noteInput = el('input', { type: 'text', value: existing?.note || '' });

  // New expense that will repeat: save it as a template too (and keep it in this month).
  const asTemplateBox = el('input', { type: 'checkbox' });
  const cycleSelect = el('select', {}, [
    el('option', { value: '1', text: 'ყოველ თვე' }),
    el('option', { value: '2', text: '2 თვეში ერთხელ' }),
    el('option', { value: '3', text: '3 თვეში ერთხელ' }),
    el('option', { value: '6', text: '6 თვეში ერთხელ' }),
    el('option', { value: '12', text: 'წელიწადში ერთხელ' })
  ]);
  const typeSelect = el('select', {}, [
    el('option', { value: 'fixed', text: 'ფიქსირებული' }),
    el('option', { value: 'variable', text: 'ცვლადი' }),
    el('option', { value: 'envelope', text: '🛒 ბიუჯეტი (ნელ-ნელა იხარჯება)' })
  ]);
  const tplExtra = el('div', { class: 'field-row', hidden: 'true' }, [
    el('div', { class: 'field' }, [el('label', { text: 'რამდენად ხშირად' }), cycleSelect]),
    el('div', { class: 'field' }, [el('label', { text: 'ტიპი' }), typeSelect])
  ]);
  asTemplateBox.addEventListener('change', () => { tplExtra.hidden = !asTemplateBox.checked; });
  const asTemplateField = isEdit && (existing.templateId || fromSav || existing.kind === 'extra') ? null : el('div', {}, [
    el('label', { class: 'field checkbox-field' }, [asTemplateBox, el('span', { text: '🔁 შაბლონადაც შევინახო — მომავალ თვეებშიც ავტომატურად მოვა' })]),
    tplExtra
  ]);

  form.append(
    el('div', { class: 'field' }, [el('label', { text: 'სახელი' }), nameInput]),
    el('div', { class: 'field' }, [el('label', { text: 'კატეგორია' }), categorySelect]),
    el('div', { class: 'field-row' }, [
      fromSav ? null : el('div', { class: 'field' }, [el('label', { text: showPaid ? 'გეგმა (დაგეგმილი თანხა)' : 'თანხა' }), amountInput]),
      showPaid ? el('div', { class: 'field' }, [el('label', { text: '✓ გადახდილი თანხა' }), paidInput]) : null,
      el('div', { class: 'field' }, [el('label', { text: 'ვალუტა' }), currencySelect])
    ]),
    showPaid && !fromSav ? el('p', { class: 'card__sub', text: 'გადახდილ ჩანაწერს ორი თანხა აქვს: გეგმა და რეალურად გადახდილი. სიაში და ჯამებში ჩანს გადახდილი.' }) : null,
    fromSav ? el('p', { class: 'card__sub', text: '💸 ეს ხარჯი დანაზოგიდან გადაიხადეთ — თანხა აკლდება დანაზოგის ნაშთს.' }) : null,
    el('div', { class: 'field' }, [el('label', { text: 'გადახდის თარიღი' }), dueDateInput]),
    el('label', { class: 'field checkbox-field' }, [georgiaBox, el('span', { text: '📤 საქართველოში გადასარიცხი' })]),
    el('div', { class: 'field' }, [el('label', { text: 'ვინ იხდის (ვისი ანგარიშიდან)' }), accountSelect]),
    movedField,
    el('div', { class: 'field' }, [el('label', { text: 'შენიშვნა' }), noteInput]),
    asTemplateField
  );

  const actions = el('div', { class: 'btn-row' });
  actions.appendChild(el('button', { class: 'btn btn--primary', type: 'submit', text: isEdit ? 'შენახვა' : 'დამატება' }));
  form.appendChild(actions);

  const { close } = openModal(form, { title: isEdit ? 'ტრანზაქციის რედაქტირება' : 'ახალი ხარჯი ამ თვეში' });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) { toast('შეავსეთ სახელი', 'error'); return; }
    const paidAmount = paidInput ? parseAmountInput(paidInput.value) : null;
    if (paidInput && !(paidAmount > 0)) { toast('შეიყვანეთ სწორი გადახდილი თანხა', 'error'); return; }
    // a "from savings" entry has no plan of its own (planned 0) — only the paid amount
    const amount = fromSav ? 0 : parseAmountInput(amountInput.value);
    if (!fromSav && amount <= 0) { toast('შეიყვანეთ სწორი თანხა', 'error'); return; }

    let madeTemplate = false;
    updateState(draft => {
      if (asTemplateBox.checked) {
        // Template first; the month's transaction is then created FROM it (linked, no duplicates).
        const tplId = uid('tpl');
        draft.templates.push({
          id: tplId, name, categoryId: categorySelect.value, type: typeSelect.value,
          amount, currency: currencySelect.value, cycleMonths: Number(cycleSelect.value) || 1,
          firstDueDate: dueDateInput.value || `${monthKeyStr}-01`, owner: accountSelect.value, account: accountSelect.value,
          toGeorgia: georgiaBox.checked, active: true, oneTime: false
        });
        madeTemplate = true;
        if (isEdit) {
          const m = findMonthByTxnId(draft, existing.id);
          const t = findTxn(draft, existing.id);
          Object.assign(t, { templateId: tplId, name, categoryId: categorySelect.value, currency: currencySelect.value, amountPlanned: amount, dueDate: dueDateInput.value, owner: accountSelect.value, account: accountSelect.value, toGeorgia: georgiaBox.checked, note: noteInput.value });
          if (paidInput && t.paid) t.amountActual = paidAmount;
          applyMoved(t, draft.categories);
          if (m && !m.preparedAt) m.addedSingly = true;
        } else {
          addTemplateToMonth(draft, tplId, monthKeyStr);
          const t = draft.months[monthKeyStr].transactions.find(x => x.templateId === tplId);
          if (t) { t.note = noteInput.value; t.dueDate = dueDateInput.value || t.dueDate; applyMoved(t, draft.categories); }
        }
        return draft;
      }
      if (isEdit) {
        const t = findTxn(draft, existing.id);
        Object.assign(t, {
          name, categoryId: categorySelect.value, currency: currencySelect.value,
          amountPlanned: amount, dueDate: dueDateInput.value, owner: accountSelect.value, account: accountSelect.value, toGeorgia: georgiaBox.checked, note: noteInput.value
        });
        if (paidInput && t.paid) t.amountActual = paidAmount;
        applyMoved(t, draft.categories);
      } else {
        ensureMonth(draft, monthKeyStr);
        const list = draft.months[monthKeyStr].transactions;
        list.push({
          id: uid('txn'), templateId: null, name, categoryId: categorySelect.value,
          owner: accountSelect.value, account: accountSelect.value, toGeorgia: georgiaBox.checked, currency: currencySelect.value, amountPlanned: amount,
          amountActual: null, paid: false, paidAt: null, rateAtPayment: null,
          dueDate: dueDateInput.value, note: noteInput.value
        });
        applyMoved(list[list.length - 1], draft.categories);
      }
      return draft;
    });
    toast(madeTemplate ? 'შენახულია ✓ — შაბლონიც შეიქმნა, მომავალ თვეებშიც მოვა' : 'შენახულია ✓');
    close();
    onSaved();
    if (isEdit && !madeTemplate) offerTemplateUpdate(existing, onSaved);
  });
}
