// views/transactions.js — Transactions list, filters, paid-flow §5.2.

import { getState, updateState, ensureMonth, todayISO, FREE_BUCKET_ID } from '../state.js';
import { generateMonthTransactions, monthNeedsGeneration, monthIsPrepared, initMonth, addTemplateToMonth } from '../monthEngine.js';
import { openPrepareWizard, preparationPreview } from '../prepare.js';
import { monthLabelFull } from '../monthNav.js';
import { txnAmountEur, txnPlannedEur, txnPaidEur, topIdOf, resolveTopCategory, formatMoney, parseAmountInput, isEnvelope, envelopeSpent, ACCOUNT_LABELS } from '../calc.js';
import { openEnvelopeDialog } from '../envelope.js';
import { fetchEurGelRate } from '../rates.js';
import { el, openModal, confirmDialog, toast, undoToast, formatDate } from '../ui.js';
import { getSelectedMonth, onMonthChange } from '../monthNav.js';
import { renderMonthNav, bucketChip, freePseudoCategory, payerChip, georgiaChip, categoryChips, categoryOptions, PAYER_LABELS } from '../components.js';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

let unsubscribe = null;
let statusFilter = 'all'; // all | unpaid | paid
let ownerFilter = 'all';  // all | giorgi | nino | shared
let groupByBucket = false;

/** Lets other pages open this list pre-filtered (e.g. dashboard "still to pay" → unpaid). */
export function setTransactionsFilter(status = 'all', owner = 'all') {
  statusFilter = ['all', 'unpaid', 'paid'].includes(status) ? status : 'all';
  ownerFilter = owner;
}

export function renderTransactions(root) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }

  const container = el('div', { class: 'transactions-view' });
  root.appendChild(container);

  const monthNav = renderMonthNav(() => draw());
  container.appendChild(monthNav);

  const toolbar = el('div', { class: 'btn-row' });
  const addBtn = el('button', { class: 'btn btn--primary', text: '+ ახალი ხარჯი' });
  const regenBtn = el('button', { class: 'btn btn--secondary', text: '📅 თვის მომზადება' });
  toolbar.append(addBtn, regenBtn);
  container.appendChild(toolbar);
  const prepBanner = el('div', {});
  container.appendChild(prepBanner);

  const statusRow = el('div', { class: 'filter-row' });
  const statusBtns = {
    all: filterBtn('ყველა', () => setStatusFilter('all')),
    unpaid: filterBtn('გადაუხდელი', () => setStatusFilter('unpaid')),
    paid: filterBtn('გადახდილი', () => setStatusFilter('paid'))
  };
  statusRow.append(statusBtns.all, statusBtns.unpaid, statusBtns.paid);
  container.appendChild(statusRow);

  const ownerRow = el('div', { class: 'filter-row' });
  const ownerBtns = {
    all: filterBtn('👤 ყველა', () => setOwnerFilter('all')),
    giorgi: filterBtn('გიორგი', () => setOwnerFilter('giorgi')),
    nino: filterBtn('ნინო', () => setOwnerFilter('nino')),
    shared: filterBtn('საერთო', () => setOwnerFilter('shared'))
  };
  ownerRow.append(ownerBtns.all, ownerBtns.giorgi, ownerBtns.nino, ownerBtns.shared);
  container.appendChild(ownerRow);

  const groupRow = el('div', { class: 'filter-row' });
  const groupToggle = el('button', { class: 'filter-btn', text: 'დაჯგუფება კატეგორიით' });
  groupRow.appendChild(groupToggle);
  container.appendChild(groupRow);

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
      txns.forEach(t => list.appendChild(txnRow(t, month, categories, draw)));
    } else {
      const bucketList = [...categories.filter(c => !c.parentId), freePseudoCategory()];
      bucketList.forEach(b => {
        const group = txns.filter(t => topIdOf(categories, t.categoryId) === b.id);
        if (!group.length) return;
        list.appendChild(el('div', { class: 'card__sub', style: 'margin-top:12px;font-weight:700', text: b.name }));
        group.forEach(t => list.appendChild(txnRow(t, month, categories, draw)));
      });
    }
  }

  draw();
}

function filterBtn(label, onClick) {
  const btn = el('button', { class: 'filter-btn', text: label, 'aria-pressed': 'false' });
  btn.addEventListener('click', onClick);
  return btn;
}

function txnRow(txn, month, categories, refresh) {
  const category = categories.find(c => c.id === txn.categoryId);
  const top = category ? resolveTopCategory(categories, category.id) : null;
  const bucket = top ? (top.parentId === FREE_BUCKET_ID ? freePseudoCategory() : top) : null;
  const envelope = isEnvelope(txn);
  const overdue = !envelope && !txn.paid && txn.dueDate && txn.dueDate < todayISO();

  const row = el('div', { class: 'row' + (txn.paid ? ' row--paid' : '') + (overdue ? ' row--overdue' : '') });

  const main = el('div', { class: 'row__main' }, [
    el('div', { class: 'row__name', text: txn.name }),
    el('div', { class: 'row__meta' }, [
      ...categoryChips(categories, txn.categoryId),
      txn.toGeorgia || category?.georgiaTransfer ? georgiaChip() : null,
      payerChip(txn.account),
      envelope ? el('span', { class: 'chip', text: '🛒 ბიუჯეტი' }) : el('span', { text: formatDate(txn.dueDate) })
    ])
  ]);

  const amountEur = txnAmountEur(txn, month.exchangeRate);
  let amount;
  if (envelope) {
    const spent = envelopeSpent(txn);
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

  const payBtn = el('button', {
    class: 'icon-btn',
    'aria-label': txn.paid ? 'გადაუხდელად დაბრუნება' : 'გადახდილად მონიშვნა',
    text: txn.paid ? '↩' : '✓'
  });
  if (envelope) {
    payBtn.setAttribute('aria-label', 'ხარჯის ან ნაშთის ჩაწერა');
    payBtn.textContent = '＋';
  }
  payBtn.addEventListener('click', () => {
    if (envelope) { openEnvelopeDialog(txn.id, refresh); return; }
    if (txn.paid) {
      updateState(draft => {
        const t = findTxn(draft, txn.id);
        t.paid = false; t.paidAt = null; t.rateAtPayment = null;
        return draft;
      });
      toast('გადაუხდელად აღინიშნა');
      refresh();
      return;
    }
    if (txnIsVariable(txn) || txn.currency === 'GEL') {
      openActualAmountDialog(txn, () => refresh());
    } else {
      updateState(draft => {
        const t = findTxn(draft, txn.id);
        t.paid = true; t.paidAt = todayISO(); t.rateAtPayment = t.currency === 'GEL' ? month.exchangeRate : null;
        t.amountActual = t.amountActual ?? t.amountPlanned;
        return draft;
      });
      toast('გადახდილად აღინიშნა ✓');
      refresh();
    }
  });

  const editBtn = el('button', { class: 'icon-btn', 'aria-label': 'რედაქტირება', text: '✎' });
  editBtn.addEventListener('click', () => openTransactionForm(txn, monthKeyOf(month), refresh));

  const deleteBtn = el('button', { class: 'icon-btn', 'aria-label': 'წაშლა', text: '🗑' });
  deleteBtn.addEventListener('click', async () => {
    const ok = await confirmDialog('წავშალო ეს ტრანზაქცია?', { danger: true, confirmLabel: 'წაშლა' });
    if (!ok) return;
    const copy = JSON.parse(JSON.stringify(txn));
    const monthOfTxn = monthKeyOf(month);
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

function txnIsVariable(txn) {
  // A transaction is "variable" if it came from a variable-type template.
  const state = getState();
  if (!txn.templateId) return false;
  const tpl = state.templates.find(t => t.id === txn.templateId);
  return tpl ? tpl.type === 'variable' : false;
}
function monthKeyOf(month) {
  const state = getState();
  return Object.keys(state.months).find(k => state.months[k] === month) || getSelectedMonth();
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
  const form = el('form', {});
  form.appendChild(el('p', { class: 'card__sub', text: `გეგმა: ${formatMoney(txn.amountPlanned, txn.currency)}` }));
  const input = el('input', { type: 'text', inputmode: 'decimal', value: txn.amountPlanned.toFixed(2).replace('.', ',') });
  form.appendChild(el('div', { class: 'field' }, [el('label', { text: `გადახდილი თანხა (${isGel ? '₾' : '€'})` }), input]));

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
  const saveBtn = el('button', { class: 'btn btn--primary', type: 'submit', text: '✓ გადახდილია' });
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
    toast('გადახდილად აღინიშნა ✓');
    close();
    onDone();
  });
}

function openTransactionForm(existing, monthKeyStr, onSaved) {
  const state = getState();
  const isEdit = !!existing;
  const form = el('form', {});

  const nameInput = el('input', { type: 'text', value: existing?.name || '' });
  const categorySelect = categoryOptions(state.categories, existing?.categoryId);
  const georgiaBox = el('input', { type: 'checkbox' });
  georgiaBox.checked = !!existing?.toGeorgia;
  if (existing) categorySelect.value = existing.categoryId;

  const currencySelect = el('select', {}, [el('option', { value: 'EUR', text: 'EUR' }), el('option', { value: 'GEL', text: 'GEL' })]);
  currencySelect.value = existing?.currency || 'EUR';

  const amountInput = el('input', { type: 'text', inputmode: 'decimal', value: (existing?.amountPlanned ?? 0).toFixed(2).replace('.', ',') });

  const dueDateInput = el('input', { type: 'date', value: existing?.dueDate || `${monthKeyStr}-01` });



  const accountSelect = el('select', {}, Object.entries(PAYER_LABELS).map(([v, t]) => el('option', { value: v, text: v === 'shared' ? 'საერთო ანგარიში' : t })));
  accountSelect.value = existing?.account || 'shared';

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
  const asTemplateField = isEdit && existing.templateId ? null : el('div', {}, [
    el('label', { class: 'field checkbox-field' }, [asTemplateBox, el('span', { text: '🔁 შაბლონადაც შევინახო — მომავალ თვეებშიც ავტომატურად მოვა' })]),
    tplExtra
  ]);

  form.append(
    el('div', { class: 'field' }, [el('label', { text: 'სახელი' }), nameInput]),
    el('div', { class: 'field' }, [el('label', { text: 'კატეგორია' }), categorySelect]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', { text: 'თანხა' }), amountInput]),
      el('div', { class: 'field' }, [el('label', { text: 'ვალუტა' }), currencySelect])
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'ვადა' }), dueDateInput]),
    el('label', { class: 'field checkbox-field' }, [georgiaBox, el('span', { text: '📤 საქართველოში გადასარიცხი' })]),
    el('div', { class: 'field' }, [el('label', { text: 'ვინ იხდის (ვისი ანგარიშიდან)' }), accountSelect]),
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
    const amount = parseAmountInput(amountInput.value);
    if (amount <= 0) { toast('შეიყვანეთ სწორი თანხა', 'error'); return; }

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
          if (m && !m.preparedAt) m.addedSingly = true;
        } else {
          addTemplateToMonth(draft, tplId, monthKeyStr);
          const t = draft.months[monthKeyStr].transactions.find(x => x.templateId === tplId);
          if (t) { t.note = noteInput.value; t.dueDate = dueDateInput.value || t.dueDate; }
        }
        return draft;
      }
      if (isEdit) {
        const t = findTxn(draft, existing.id);
        Object.assign(t, {
          name, categoryId: categorySelect.value, currency: currencySelect.value,
          amountPlanned: amount, dueDate: dueDateInput.value, owner: accountSelect.value, account: accountSelect.value, toGeorgia: georgiaBox.checked, note: noteInput.value
        });
      } else {
        ensureMonth(draft, monthKeyStr);
        draft.months[monthKeyStr].transactions.push({
          id: uid('txn'), templateId: null, name, categoryId: categorySelect.value,
          owner: accountSelect.value, account: accountSelect.value, toGeorgia: georgiaBox.checked, currency: currencySelect.value, amountPlanned: amount,
          amountActual: null, paid: false, paidAt: null, rateAtPayment: null,
          dueDate: dueDateInput.value, note: noteInput.value
        });
      }
      return draft;
    });
    toast(madeTemplate ? 'შენახულია ✓ — შაბლონიც შეიქმნა, მომავალ თვეებშიც მოვა' : 'შენახულია ✓');
    close();
    onSaved();
  });
}
