// views/transactions.js — Transactions list, filters, paid-flow §5.2.

import { getState, updateState, ensureMonth, todayISO, FREE_BUCKET_ID } from '../state.js';
import { generateMonthTransactions, monthNeedsGeneration } from '../monthEngine.js';
import { txnAmountEur, txnPlannedEur, formatMoney, parseAmountInput } from '../calc.js';
import { el, openModal, confirmDialog, toast, formatDate } from '../ui.js';
import { getSelectedMonth, onMonthChange } from '../monthNav.js';
import { renderMonthNav, bucketChip, ownerChip } from '../components.js';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

let unsubscribe = null;
let statusFilter = 'all'; // all | unpaid | paid
let ownerFilter = 'all';  // all | giorgi | nino | shared
let groupByBucket = false;

export function renderTransactions(root) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }

  const container = el('div', { class: 'transactions-view' });
  root.appendChild(container);

  const monthNav = renderMonthNav(() => draw());
  container.appendChild(monthNav);

  const toolbar = el('div', { class: 'btn-row' });
  const addBtn = el('button', { class: 'btn btn--primary', text: '+ ერთჯერადი ტრანზაქცია' });
  const regenBtn = el('button', { class: 'btn btn--secondary', text: '↻ შაბლონების განახლება' });
  toolbar.append(addBtn, regenBtn);
  container.appendChild(toolbar);

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
    all: filterBtn('ყველა', () => setOwnerFilter('all')),
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

  regenBtn.addEventListener('click', () => {
    const key = getSelectedMonth();
    updateState(draft => { generateMonthTransactions(draft, key); return draft; });
    toast('შაბლონები განახლდა ✓');
    draw();
  });

  unsubscribe = onMonthChange(() => {
    if (!container.isConnected) {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      return;
    }
    draw();
  });

  function draw() {
    const key = getSelectedMonth();
    if (monthNeedsGeneration(getState(), key)) {
      updateState(draft => { generateMonthTransactions(draft, key); return draft; });
    }
    drawFilterState();

    const state = getState();
    const month = state.months[key];
    const categories = state.categories;
    const bucketIdOf = (catId) => categories.find(c => c.id === catId)?.bucketId;

    let txns = month.transactions.slice();
    if (statusFilter === 'unpaid') txns = txns.filter(t => !t.paid);
    if (statusFilter === 'paid') txns = txns.filter(t => t.paid);
    if (ownerFilter !== 'all') txns = txns.filter(t => t.owner === ownerFilter);
    txns.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

    // Totals for the currently visible (filtered) set.
    const planned = txns.reduce((s, t) => s + txnPlannedEur(t, month.exchangeRate), 0);
    const paid = txns.filter(t => t.paid).reduce((s, t) => s + txnAmountEur(t, month.exchangeRate), 0);
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
      const bucketList = [...state.settings.buckets, { id: FREE_BUCKET_ID, name: 'თავისუფალი ხარჯვა' }];
      bucketList.forEach(b => {
        const group = txns.filter(t => bucketIdOf(t.categoryId) === b.id);
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
  const state = getState();
  const category = categories.find(c => c.id === txn.categoryId);
  const bucket = category
    ? (category.bucketId === FREE_BUCKET_ID
        ? { id: FREE_BUCKET_ID, name: 'თავისუფალი ხარჯვა', color: '#94a3b8' }
        : state.settings.buckets.find(b => b.id === category.bucketId))
    : null;
  const overdue = !txn.paid && txn.dueDate && txn.dueDate < todayISO();

  const row = el('div', { class: 'row' + (txn.paid ? ' row--paid' : '') + (overdue ? ' row--overdue' : '') });

  const main = el('div', { class: 'row__main' }, [
    el('div', { class: 'row__name', text: txn.name }),
    el('div', { class: 'row__meta' }, [
      bucketChip(bucket),
      category?.georgiaTransfer ? el('span', { class: 'chip chip--georgia', text: '🇬🇪' }) : null,
      ownerChip(txn.owner),
      el('span', { text: formatDate(txn.dueDate) })
    ])
  ]);

  const amountEur = txnAmountEur(txn, month.exchangeRate);
  const amount = el('div', { class: 'row__amount tabular-nums' }, [
    el('div', { text: formatMoney(txn.paid ? (txn.amountActual ?? txn.amountPlanned) : txn.amountPlanned, txn.currency) }),
    txn.currency === 'GEL' ? el('div', { class: 'row__amount-sub', text: `≈ ${formatMoney(amountEur, 'EUR')}` }) : null
  ]);

  const actions = el('div', { class: 'row__actions' });

  const payBtn = el('button', {
    class: 'icon-btn',
    'aria-label': txn.paid ? 'გადაუხდელად დაბრუნება' : 'გადახდილად მონიშვნა',
    text: txn.paid ? '↩' : '✓'
  });
  payBtn.addEventListener('click', () => {
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
    if (txnIsVariable(txn)) {
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
    updateState(draft => {
      const m = findMonthByTxnId(draft, txn.id);
      if (m) m.transactions = m.transactions.filter(t => t.id !== txn.id);
      return draft;
    });
    toast('წაიშალა');
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
  const form = el('form', {});
  form.appendChild(el('p', { class: 'card__sub', text: `გეგმა: ${formatMoney(txn.amountPlanned, txn.currency)}` }));
  const input = el('input', { type: 'text', inputmode: 'decimal', value: txn.amountPlanned.toFixed(2).replace('.', ',') });
  form.appendChild(el('div', { class: 'field' }, [el('label', { text: 'რეალური თანხა' }), input]));
  const actions = el('div', { class: 'btn-row' });
  const saveBtn = el('button', { class: 'btn btn--primary', type: 'submit', text: 'დადასტურება' });
  actions.appendChild(saveBtn);
  form.appendChild(actions);

  const { close } = openModal(form, { title: 'გადახდილი თანხა' });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const actual = parseAmountInput(input.value);
    if (actual < 0) return;
    updateState(draft => {
      const t = findTxn(draft, txn.id);
      t.paid = true;
      t.paidAt = todayISO();
      t.amountActual = actual;
      t.rateAtPayment = t.currency === 'GEL' ? month.exchangeRate : null;
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
  const categorySelect = el('select', {}, state.categories.map(c => el('option', { value: c.id, text: c.name })));
  if (existing) categorySelect.value = existing.categoryId;

  const currencySelect = el('select', {}, [el('option', { value: 'EUR', text: 'EUR' }), el('option', { value: 'GEL', text: 'GEL' })]);
  currencySelect.value = existing?.currency || 'EUR';

  const amountInput = el('input', { type: 'text', inputmode: 'decimal', value: (existing?.amountPlanned ?? 0).toFixed(2).replace('.', ',') });

  const dueDateInput = el('input', { type: 'date', value: existing?.dueDate || `${monthKeyStr}-01` });

  const ownerSelect = el('select', {}, [
    el('option', { value: 'shared', text: 'საერთო' }),
    el('option', { value: 'giorgi', text: 'გიორგი' }),
    el('option', { value: 'nino', text: 'ნინო' })
  ]);
  ownerSelect.value = existing?.owner || 'shared';

  const noteInput = el('input', { type: 'text', value: existing?.note || '' });

  form.append(
    el('div', { class: 'field' }, [el('label', { text: 'სახელი' }), nameInput]),
    el('div', { class: 'field' }, [el('label', { text: 'კატეგორია' }), categorySelect]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', { text: 'თანხა' }), amountInput]),
      el('div', { class: 'field' }, [el('label', { text: 'ვალუტა' }), currencySelect])
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'ვადა' }), dueDateInput]),
    el('div', { class: 'field' }, [el('label', { text: 'ვისი ხარჯია' }), ownerSelect]),
    el('div', { class: 'field' }, [el('label', { text: 'შენიშვნა' }), noteInput])
  );

  const actions = el('div', { class: 'btn-row' });
  actions.appendChild(el('button', { class: 'btn btn--primary', type: 'submit', text: isEdit ? 'შენახვა' : 'დამატება' }));
  form.appendChild(actions);

  const { close } = openModal(form, { title: isEdit ? 'ტრანზაქციის რედაქტირება' : 'ერთჯერადი ტრანზაქცია' });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) { toast('შეავსეთ სახელი', 'error'); return; }
    const amount = parseAmountInput(amountInput.value);
    if (amount <= 0) { toast('შეიყვანეთ სწორი თანხა', 'error'); return; }

    updateState(draft => {
      if (isEdit) {
        const t = findTxn(draft, existing.id);
        Object.assign(t, {
          name, categoryId: categorySelect.value, currency: currencySelect.value,
          amountPlanned: amount, dueDate: dueDateInput.value, owner: ownerSelect.value, note: noteInput.value
        });
      } else {
        ensureMonth(draft, monthKeyStr);
        draft.months[monthKeyStr].transactions.push({
          id: uid('txn'), templateId: null, name, categoryId: categorySelect.value,
          owner: ownerSelect.value, currency: currencySelect.value, amountPlanned: amount,
          amountActual: null, paid: false, paidAt: null, rateAtPayment: null,
          dueDate: dueDateInput.value, note: noteInput.value
        });
      }
      return draft;
    });
    toast('შენახულია ✓');
    close();
    onSaved();
  });
}
