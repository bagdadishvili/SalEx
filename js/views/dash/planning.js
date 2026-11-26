// views/dash/planning.js — planning helpers (v20, switchable): 📆 reserve for rare bills and
// 🔒 month close (budgets closed, open bills sorted out, left-over moved to savings).

import { getState, updateState, budgetMonthKey, daysLeftInBudget, todayISO } from '../../state.js';
import { formatMoney, parseAmountInput, isEnvelope, isExtra, isFromSavings, envelopeUsed, savingsCategories, computeRangeOverview } from '../../calc.js';
import { reserveOverview } from '../../insights.js';
import { el, openModal, toast, undoToast } from '../../ui.js';
import { tx, personTag } from '../../texts.js';
import { MONTH_NAMES_SHORT, monthLabelFull } from '../../monthNav.js';
import { expanded } from './shared.js';

const shortMonth = (k) => `${MONTH_NAMES_SHORT[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;

/** 📆 Bills that come every few months: put a share aside every month. */
export function reserveCard(ctx) {
  const { state, key, rerender } = ctx;
  const r = reserveOverview(state, key);
  if (!r.items.length) return [];
  const card = el('div', { class: 'card stat-card stat-card--wide reserve-card' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.reserve') }));
  card.appendChild(el('div', { class: 'stat-card__value tabular-nums', text: `${formatMoney(r.monthly, 'EUR', 0)}/თვე` }));
  card.appendChild(el('div', { class: 'stat-card__sub', text: `იშვიათი გადასახადებისთვის თვეში ამდენი გადადე. ახლა გადადებული უნდა იყოს ≈ ${formatMoney(r.needNow, 'EUR', 0)}.` }));
  const open = expanded.has('reserve');
  const list = el('div', { class: 'cal-list' });
  (open ? r.items : r.items.slice(0, 3)).forEach(x => {
    list.appendChild(el('div', { class: 'cal-row' }, [
      el('div', { class: 'cal-row__date tabular-nums' }, [el('strong', { text: shortMonth(x.next) }), el('span', { text: x.until === 0 ? 'ამ თვეში' : `${x.until} თვეში` })]),
      el('div', { class: 'cal-row__main' }, [
        el('div', { class: 'cal-row__name', text: x.tpl.name }),
        el('div', { class: 'detail-row__meta', text: `${formatMoney(x.amountEur, 'EUR', 0)} · ყოველ ${x.cycle} თვეში · გადადებული ≈ ${formatMoney(x.saved, 'EUR', 0)}` })
      ]),
      el('div', { class: 'cal-row__amount tabular-nums', text: `${formatMoney(x.share, 'EUR', 0)}/თვე` })
    ]));
  });
  card.appendChild(list);
  if (r.items.length > 3) {
    const btn = el('button', { type: 'button', class: 'card-expand', 'aria-expanded': String(open), text: open ? '▲ ნაკლები' : `▼ ყველა (${r.items.length})` });
    btn.addEventListener('click', (e) => { e.stopPropagation(); if (open) expanded.delete('reserve'); else expanded.add('reserve'); rerender(); });
    card.appendChild(btn);
  }
  return card;
}

/**
 * 🔒 Month close: offered at the end of the current budget month (last 5 days) and for past
 * months that were never closed. A closed month shows a small badge with "↺ გახსნა".
 */
export function closeCard(ctx) {
  const { month, key, rerender } = ctx;
  const cur = budgetMonthKey();
  if (month.closedAt) {
    const reopen = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: '↺ ხელახლა გახსნა' });
    reopen.addEventListener('click', () => { updateState(d => { delete d.months[key].closedAt; return d; }); rerender(); });
    return el('div', { class: 'card stat-card stat-card--wide close-card close-card--done' }, [
      el('div', { class: 'stat-card__label', text: `🔒 თვე დახურულია (${month.closedAt.slice(8, 10)}.${month.closedAt.slice(5, 7)})` }), reopen
    ]);
  }
  const due = key < cur || (key === cur && daysLeftInBudget() <= 5);
  if (!due || !month.transactions.length) return [];
  const card = el('div', { class: 'card stat-card stat-card--wide close-card' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.close') }));
  card.appendChild(el('div', { class: 'stat-card__sub', text: key < cur ? 'ეს თვე უკვე დასრულდა. დახურე: ბიუჯეტები, გადაუხდელი გადასახადები და ნაშთი — ერთ ფანჯარაში.' : `თვის ბოლომდე ${daysLeftInBudget()} დღეა. როცა მზად იქნები — დახურე თვე.` }));
  const btn = el('button', { type: 'button', class: 'btn btn--primary btn--sm', text: '🔒 თვის დახურვა' });
  btn.addEventListener('click', () => openCloseDialog(ctx));
  card.appendChild(el('div', { class: 'btn-row' }, [btn]));
  return card;
}

function openCloseDialog(ctx) {
  const { month, key, categories, rerender } = ctx;
  const envs = month.transactions.filter(t => isEnvelope(t) && !t.paid);
  const bills = month.transactions.filter(t => !t.paid && !isEnvelope(t) && !isExtra(t) && !isFromSavings(t));
  const form = el('form', { class: 'close-form' });
  form.appendChild(el('p', { class: 'card__sub', text: `${monthLabelFull(key)}: მონიშნე, რა როგორ დაიხუროს. დახურვის შემდეგაც ყველაფერი იცვლება („↺ ხელახლა გახსნა").` }));

  const envInputs = envs.map(e => {
    const left = (e.amountPlanned || 0) - envelopeUsed(e, month.transactions, month.exchangeRate);
    const cb = el('input', { type: 'checkbox' }); cb.checked = true;
    form.appendChild(el('label', { class: 'prep__row' }, [cb, el('span', { class: 'prep__name', text: `🛒 ${e.name} — დაიხუროს (დარჩა ${formatMoney(left, e.currency, 0)})` })]));
    return { e, cb };
  });
  if (envs.length) form.insertBefore(el('h3', { class: 'subsection-title', text: '🛒 ბიუჯეტები' }), form.children[1]);

  const billInputs = bills.map(b => {
    const sel = el('select', { class: 'close-form__sel', 'aria-label': b.name }, [
      el('option', { value: 'keep', text: 'დარჩეს ღიად' }),
      el('option', { value: 'paid', text: '✓ გადახდილია' }),
      el('option', { value: 'drop', text: '🗑 ამ თვეში აღარ მოდის' })
    ]);
    const row = el('div', { class: 'prep__row' }, [el('span', { class: 'prep__name', text: `${b.name} · ${personTag(b.account || 'shared')} · ${formatMoney(b.amountPlanned, b.currency, 0)}` }), sel]);
    return { b, sel, row };
  });
  if (bills.length) {
    form.appendChild(el('h3', { class: 'subsection-title', text: '📄 გადაუხდელი გადასახადები' }));
    billInputs.forEach(x => form.appendChild(x.row));
  }

  // what is left of the income (paid facts) → optionally to a savings category
  const row = computeRangeOverview({ [key]: month }, getState().categories, key, key, null, key).rows[0];
  const leftover = row ? row.leftover : 0;
  const savs = savingsCategories(categories);
  let saveCb = null, saveAmt = null, saveSel = null;
  if (leftover > 0.5 && savs.length) {
    form.appendChild(el('h3', { class: 'subsection-title', text: '💰 ნაშთი' }));
    saveCb = el('input', { type: 'checkbox' });
    saveAmt = el('input', { type: 'text', inputmode: 'decimal', class: 'prep__amount tabular-nums', value: leftover.toFixed(2).replace('.', ',') });
    saveSel = el('select', { class: 'close-form__sel', 'aria-label': 'რომელ დანაზოგზე' }, savs.map(c => el('option', { value: c.id, text: `${c.name} · ${personTag(c.owner || 'shared')}` })));
    form.appendChild(el('label', { class: 'prep__row' }, [saveCb, el('span', { class: 'prep__name', text: `გადახდილის მიხედვით დარჩა ${formatMoney(leftover, 'EUR', 0)} — გადავიტანე დანაზოგზე:` })]));
    form.appendChild(el('div', { class: 'field-row' }, [el('div', { class: 'field' }, [saveAmt]), el('div', { class: 'field' }, [saveSel])]));
  }
  form.appendChild(el('div', { class: 'btn-row' }, [el('button', { class: 'btn btn--primary', type: 'submit', text: '🔒 დახურვა' })]));
  const { close } = openModal(form, { title: '🔒 თვის დახურვა' });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const before = JSON.parse(JSON.stringify(getState().months[key]));
    updateState(d => {
      const m = d.months[key];
      envInputs.forEach(({ e: env, cb }) => { if (cb.checked) { const t = m.transactions.find(x => x.id === env.id); if (t) t.paid = true; } });
      billInputs.forEach(({ b, sel }) => {
        const t = m.transactions.find(x => x.id === b.id);
        if (!t) return;
        if (sel.value === 'paid') { t.paid = true; t.paidAt = t.paidAt || todayISO(); t.amountActual = t.amountActual ?? t.amountPlanned; }
        if (sel.value === 'drop') {
          m.transactions = m.transactions.filter(x => x.id !== t.id);
          if (t.templateId && !(m.skipTemplates || []).includes(t.templateId)) m.skipTemplates = [...(m.skipTemplates || []), t.templateId];
        }
      });
      if (saveCb && saveCb.checked) {
        const v = parseAmountInput(saveAmt.value);
        const c = d.categories.find(x => x.id === saveSel.value);
        if (v > 0 && c) {
          m.transactions.push({
            id: `txn_save_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, templateId: null, name: `${c.name} (თვის ნაშთი)`,
            categoryId: c.id, owner: c.owner || 'shared', account: c.owner || 'shared', toGeorgia: false, currency: 'EUR',
            amountPlanned: v, amountActual: v, paid: true, paidAt: todayISO(), rateAtPayment: null, dueDate: todayISO(), note: 'თვის დახურვა'
          });
        }
      }
      m.closedAt = new Date().toISOString();
      return d;
    });
    close();
    undoToast('🔒 თვე დაიხურა', () => {
      updateState(d => { const back = JSON.parse(JSON.stringify(before)); delete back._u; delete back._uf; back.transactions.forEach(t => delete t._u); d.months[key] = back; return d; });
      toast('დაბრუნდა ✓');
      rerender();
    });
    rerender();
  });
}
