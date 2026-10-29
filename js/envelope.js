// envelope.js — dialog for "envelope" transactions (food, fuel…): a monthly amount that is
// spent gradually. Record a single purchase, OR just type what is left on the account —
// no need to enter every receipt.

import { getState, updateState, todayISO } from './state.js';
import { envelopeSpent, envelopeExtras, formatMoney, parseAmountInput } from './calc.js';
import { el, openModal, toast, formatDate } from './ui.js';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function findMonth(s, id) {
  return Object.values(s.months).find(m => m.transactions.some(x => x.id === id)) || null;
}

function findTxn(s, id) {
  for (const key of Object.keys(s.months)) {
    const t = s.months[key].transactions.find(x => x.id === id);
    if (t) return t;
  }
  return null;
}

export function openEnvelopeDialog(txnId, onDone = () => {}) {
  const txn = findTxn(getState(), txnId);
  if (!txn) return;
  const cur = txn.currency;
  const month = findMonth(getState(), txnId);
  // extras (🧺) bought with this money count as spent too
  const extras = month ? envelopeExtras(txn, month.transactions, month.exchangeRate) : 0;
  const spent = envelopeSpent(txn) + extras;
  const left = (txn.amountPlanned || 0) - spent;

  const form = el('form', { class: 'envelope-form' });
  form.appendChild(el('div', { class: 'envelope-summary tabular-nums' }, [
    el('div', {}, [el('div', { class: 'stat-card__sub', text: 'თვის ბიუჯეტი' }), el('strong', { text: formatMoney(txn.amountPlanned, cur) })]),
    el('div', {}, [el('div', { class: 'stat-card__sub', text: 'დახარჯულია' }), el('strong', { text: formatMoney(spent, cur) })]),
    el('div', {}, [el('div', { class: 'stat-card__sub', text: 'დარჩა' }), el('strong', { class: left < 0 ? 'text-danger' : 'text-success', text: formatMoney(left, cur) })])
  ]));

  let mode = 'spent';
  const modeRow = el('div', { class: 'segmented', role: 'tablist' });
  const spentBtn = el('button', { type: 'button', class: 'segmented__btn', 'aria-pressed': 'true', text: '➖ დავხარჯე' });
  const leftBtn = el('button', { type: 'button', class: 'segmented__btn', 'aria-pressed': 'false', text: '🏦 ანგარიშზე დარჩა' });
  modeRow.append(spentBtn, leftBtn);
  const label = el('label', { text: 'რამდენი დავხარჯე' });
  const hint = el('div', { class: 'card__sub', text: 'ერთი ან რამდენიმე ყიდვის ჯამი.' });
  const input = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off' });
  const note = el('input', { type: 'text', placeholder: 'შენიშვნა (არასავალდებულო)' });
  function setMode(m) {
    mode = m;
    spentBtn.setAttribute('aria-pressed', String(m === 'spent'));
    leftBtn.setAttribute('aria-pressed', String(m === 'left'));
    label.textContent = m === 'spent' ? 'რამდენი დავხარჯე' : 'რამდენი დარჩა ამ ბიუჯეტიდან ახლა';
    hint.textContent = m === 'spent'
      ? 'ერთი ან რამდენიმე ყიდვის ჯამი.'
      : 'ჩაწერე ბანკის აპში ნანახი ნაშთი (ამ ხარჯისთვის განკუთვნილი) — დახარჯული ავტომატურად დაითვლება.';
    input.focus();
  }
  spentBtn.addEventListener('click', () => setMode('spent'));
  leftBtn.addEventListener('click', () => setMode('left'));

  form.append(modeRow, el('div', { class: 'field' }, [label, input, hint]), el('div', { class: 'field' }, [note]));

  // Recent entries (with undo).
  if ((txn.spends || []).length) {
    const list = el('div', { class: 'spend-list' });
    txn.spends.slice().reverse().slice(0, 8).forEach(sp => {
      const del = el('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': 'ჩანაწერის წაშლა', text: '✕' });
      del.addEventListener('click', () => {
        updateState(d => { const t = findTxn(d, txnId); t.spends = t.spends.filter(x => x.id !== sp.id); return d; });
        toast('ჩანაწერი წაიშალა');
        close();
        onDone();
      });
      list.appendChild(el('div', { class: 'spend-list__row tabular-nums' }, [
        el('span', { text: formatDate(sp.date) }),
        el('span', { class: 'spend-list__note', text: sp.note || '' }),
        el('strong', { text: formatMoney(sp.amount, cur) }),
        del
      ]));
    });
    form.appendChild(el('details', { class: 'help-details' }, [el('summary', { text: `ბოლო ჩანაწერები (${txn.spends.length})` }), list]));
  }

  // Per-envelope switch: show "per day" on the dashboard (remembered on its template too).
  const dailyBox = el('input', { type: 'checkbox' });
  dailyBox.checked = txn.dailyHint !== false;
  dailyBox.addEventListener('change', () => {
    updateState(d => {
      const tr = findTxn(d, txnId);
      tr.dailyHint = dailyBox.checked;
      const tpl = tr.templateId && d.templates.find(x => x.id === tr.templateId);
      if (tpl) tpl.dailyHint = dailyBox.checked;
      return d;
    });
    toast(dailyBox.checked ? 'დღიური თანხა ჩაირთო' : 'დღიური თანხა გამოირთო');
    onDone();
  });
  form.appendChild(el('label', { class: 'field checkbox-field' }, [dailyBox, el('span', { text: '📆 დეშბორდზე „დღეში ≈ X" ჩვენება ამ ბიუჯეტისთვის' })]));

  const actions = el('div', { class: 'btn-row' });
  const save = el('button', { class: 'btn btn--primary', type: 'submit', text: 'შენახვა' });
  const closeBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: txn.paid ? '↩ ხელახლა გახსნა' : '✓ თვე დაიხურა' });
  closeBtn.addEventListener('click', () => {
    updateState(d => { const t = findTxn(d, txnId); t.paid = !t.paid; t.paidAt = t.paid ? todayISO() : null; return d; });
    toast(txn.paid ? 'ბიუჯეტი ხელახლა გაიხსნა' : 'ბიუჯეტი დაიხურა — დარჩენილი თანხა აღარ ითვლება გადასახდელად');
    close();
    onDone();
  });
  actions.append(save, closeBtn);
  form.appendChild(actions);

  const { close } = openModal(form, { title: `🛒 ${txn.name}` });
  setTimeout(() => input.focus(), 50);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!String(input.value).trim()) { toast('ჩაწერე თანხა', 'error'); return; }
    const value = parseAmountInput(input.value);
    if (value < 0) { toast('თანხა არ შეიძლება იყოს უარყოფითი', 'error'); return; }
    let amount = value;
    if (mode === 'left') amount = Math.round(((txn.amountPlanned || 0) - value - spent) * 100) / 100;
    if (mode === 'spent' && amount === 0) { close(); return; }
    updateState(d => {
      const t = findTxn(d, txnId);
      if (!Array.isArray(t.spends)) t.spends = [];
      t.spends.push({ id: uid('sp'), date: todayISO(), amount, note: note.value.trim() || (mode === 'left' ? 'ნაშთის მიხედვით' : '') });
      return d;
    });
    toast(mode === 'left' ? `განახლდა: დარჩა ${formatMoney(value, cur)} ✓` : `დაემატა ${formatMoney(amount, cur)} ✓`);
    close();
    onDone();
  });
}
