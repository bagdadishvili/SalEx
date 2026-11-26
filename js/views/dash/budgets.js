// views/dash/budgets.js — 🛒 spend-as-you-go budgets (food, fuel…): ＋ spend, ✓ all spent,
// ⇄ move a left-over to another budget; and 🧺 extras bought with that money.

import { getState, updateState, budgetMonthKey, daysLeftInBudget, todayISO } from '../../state.js';
import {
  formatMoney, parseAmountInput, isEnvelope, isExtra, envelopeSpent, envelopeExtras, envelopeUsed, txnRemainingEur, FREE_BUCKET_ID
} from '../../calc.js';
import { envelopeMarkSpent, moveEnvelopeBudget } from '../../actions.js';
import { el, openModal, toast, undoToast, formatDate } from '../../ui.js';
import { tx, genitive, dative } from '../../texts.js';
import { openEnvelopeDialog } from '../../envelope.js';
import { expanded, progressBar } from './shared.js';

export function envelopesCard({ month, key, rerender }) {
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
    // How much per day is left until the next salary (current month only).
    let perDay = '';
    if (t.dailyHint !== false && key === budgetMonthKey() && !t.paid && left > 0.5) {
      perDay = ` · დღეში ≈ ${formatMoney(left / daysLeftInBudget(), t.currency, 0)}`;
    }
    const add = el('button', { class: 'icon-btn icon-btn--sm envelope-row__add', type: 'button', 'aria-label': `${t.name}: ხარჯის ან ნაშთის ჩაწერა`, text: '＋' });
    add.addEventListener('click', () => openEnvelopeDialog(t.id, rerender));
    // "it's all spent" in one tap (amount editable) — no need to type every receipt
    const doneBtn = !t.paid && left > 0.5 ? el('button', { class: 'icon-btn icon-btn--sm envelope-row__add', type: 'button', 'aria-label': `${t.name}: დარჩენილი დახარჯულად`, title: 'დარჩენილი — დახარჯულად', text: '✓' }) : null;
    if (doneBtn) doneBtn.addEventListener('click', () => openMarkSpentDialog(key, t, left, rerender));
    card.appendChild(el('div', { class: 'envelope-row' + (t.paid ? ' envelope-row--closed' : '') }, [
      el('div', { class: 'envelope-row__main' }, [
        el('div', { class: 'envelope-row__top' }, [
          el('span', { class: 'envelope-row__name', text: t.name }),
          el('span', { class: 'tabular-nums' + (left < -0.004 ? ' text-danger' : ''), text: t.paid ? 'დახურულია' : `დარჩა ${formatMoney(left, t.currency, 0)} / ${formatMoney(t.amountPlanned, t.currency, 0)}${perDay}${extrasFromIt > 0 ? ` · 🧺 ${formatMoney(extrasFromIt, t.currency, 0)}` : ''}` })
        ]),
        progressBar(pct, left < -0.004 ? 'var(--danger)' : undefined),
        (t.moves || []).length ? el('div', { class: 'stat-card__sub tabular-nums', text: (t.moves || []).map(mv => {
          const other = envs.find(x => x.id === mv.other);
          return mv.amount < 0 ? `⇄ ${formatMoney(-mv.amount, t.currency, 0)} → ${other ? other.name : '?'}` : `⇄ +${formatMoney(mv.amount, t.currency, 0)} ← ${other ? other.name : '?'}`;
        }).join(' · ') }) : null
      ]),
      el('div', { class: 'envelope-row__btns' }, [add, doneBtn])
    ]));
  });
  if (envs.length > 1) {
    const moveBtn = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: '⇄ ნაშთის გადატანა ერთიდან მეორეში' });
    moveBtn.addEventListener('click', () => openMoveBudgetDialog(key, envs, month, rerender));
    card.appendChild(el('div', { class: 'btn-row' }, [moveBtn]));
  }
  return card;
}

/** "✓ დახარჯულად": the rest of a budget (or a chosen part of it) counts as spent. */
function openMarkSpentDialog(key, env, left, rerender) {
  const form = el('form', {});
  form.appendChild(el('p', { class: 'card__sub', text: `„${env.name}"-ში დარჩენილია ${formatMoney(left, env.currency)}. რამდენი ჩაითვალოს დახარჯულად? (ცალკეული ქვითრების შეყვანა საჭირო არაა)` }));
  const input = el('input', { type: 'text', inputmode: 'decimal', value: (Math.round(left * 100) / 100).toFixed(2).replace('.', ',') });
  form.appendChild(el('div', { class: 'field' }, [el('label', { text: `დახარჯული (${env.currency === 'GEL' ? '₾' : '€'})` }), input]));
  form.appendChild(el('div', { class: 'btn-row' }, [el('button', { class: 'btn btn--primary', type: 'submit', text: '✓ დახარჯულად' })]));
  const { close } = openModal(form, { title: `🛒 ${env.name}` });
  setTimeout(() => input.select(), 50);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let msg = '', spId = null;
    try {
      updateState(d => {
        msg = envelopeMarkSpent(d, key, { envelopeId: env.id, amount: parseAmountInput(input.value) });
        const tr = d.months[key].transactions.find(x => x.id === env.id);
        spId = tr.spends[tr.spends.length - 1].id;
        return d;
      });
    } catch (err) { toast(err.message, 'error'); return; }
    close();
    undoToast(msg, () => {
      updateState(d => { const tr = d.months[key].transactions.find(x => x.id === env.id); if (tr) tr.spends = (tr.spends || []).filter(s => s.id !== spId); return d; });
      rerender();
    });
    rerender();
  });
}

/** "⇄": move a left-over amount from one budget to another (this month only). */
function openMoveBudgetDialog(key, envs, month, rerender) {
  const leftOf = (e) => Math.max(0, (e.amountPlanned || 0) - envelopeUsed(e, month.transactions, month.exchangeRate));
  const form = el('form', {});
  form.appendChild(el('p', { class: 'card__sub', text: 'მაგ.: საწვავში დარჩენილი 40 € კვებაზე დაიხარჯა (იგივე ანგარიშიდან). გეგმა იცვლება მხოლოდ ამ თვეში, ჯამი იგივე რჩება.' }));
  const opt = (e) => el('option', { value: e.id, text: `${e.name} (დარჩა ${formatMoney(leftOf(e), e.currency, 0)})` });
  const fromSel = el('select', {}, envs.map(opt));
  const toSel = el('select', {}, envs.map(opt));
  const best = envs.slice().sort((a, b) => leftOf(b) - leftOf(a))[0];
  fromSel.value = best.id;
  toSel.value = (envs.find(e => e.id !== best.id) || envs[0]).id;
  const amount = el('input', { type: 'text', inputmode: 'decimal' });
  const syncAmount = () => { const e = envs.find(x => x.id === fromSel.value); amount.value = leftOf(e).toFixed(2).replace('.', ','); };
  fromSel.addEventListener('change', syncAmount);
  syncAmount();
  form.append(
    el('div', { class: 'field' }, [el('label', { text: 'საიდან (სადაც დარჩა)' }), fromSel]),
    el('div', { class: 'field' }, [el('label', { text: 'სად (სადაც დაიხარჯა)' }), toSel]),
    el('div', { class: 'field' }, [el('label', { text: 'თანხა' }), amount]),
    el('div', { class: 'btn-row' }, [el('button', { class: 'btn btn--primary', type: 'submit', text: '⇄ გადატანა' })])
  );
  const { close } = openModal(form, { title: '⇄ ბიუჯეტის გადატანა' });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const before = JSON.parse(JSON.stringify(getState().months[key].transactions.filter(x => x.id === fromSel.value || x.id === toSel.value)));
    let msg = '';
    try {
      updateState(d => { msg = moveEnvelopeBudget(d, key, { fromId: fromSel.value, toId: toSel.value, amount: parseAmountInput(amount.value) }); return d; });
    } catch (err) { toast(err.message, 'error'); return; }
    close();
    undoToast(msg, () => {
      updateState(d => {
        d.months[key].transactions = d.months[key].transactions.map(x => { const o = before.find(b => b.id === x.id); if (!o) return x; const c = { ...o }; delete c._u; return c; });
        return d;
      });
      rerender();
    });
    rerender();
  });
}

// ---------------- Extras: quick list of unplanned purchases (shoes, medicine…) ----------------

export function extrasCard(ctx) {
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
      el('div', { class: 'detail-row__name', text: x.name }),
      el('div', { class: 'detail-row__amount tabular-nums', text: formatMoney(x.amountActual ?? x.amountPlanned, 'EUR') }),
      el('div', { class: 'detail-row__meta', text: `${formatDate(x.paidAt || x.dueDate).slice(0, 5)}${env ? ` · ${genitive(env.name)} ფულიდან` : ' · ცალკე'}` }),
      el('div', { class: 'detail-row__acts' }, [del])
    ]));
  });
  card.appendChild(list);
  return card;
}
