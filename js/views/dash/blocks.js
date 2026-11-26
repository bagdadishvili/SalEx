// views/dash/blocks.js — bill cards: "⏳ still to pay", "📤 to Georgia" and one card per
// category block (spending blocks show their bills; savings blocks have "✓ გადავრიცხე").

import { updateState, todayISO } from '../../state.js';
import {
  computeRemaining, formatMoney, formatPercent, parseAmountInput, isEnvelope, isExtra, isFromSavings,
  isGeorgia, isSavingsTxn, topIdOf, txnRemainingEur, txnPlannedEur, txnPaidEur, targetEur, familyOf
} from '../../calc.js';
import { el, openModal, toast, undoToast, formatDate } from '../../ui.js';
import { tx, personTag } from '../../texts.js';
import { statCard, markDone, attachDetails } from './shared.js';

/** Fixed payments only (food/fuel budgets and savings have their own cards). */
const isBill = (categories) => (tr) => !isEnvelope(tr) && !isExtra(tr) && !isFromSavings(tr) && !isSavingsTxn(tr, categories);

export function dueCard(ctx) {
  const { month } = ctx;
  const rem = computeRemaining(month, ctx.categories, ctx.settings);
  const bill = isBill(ctx.categories);
  const card = el('div', { class: 'card stat-card stat-card--wide due-card' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.due') }));
  card.appendChild(el('div', { class: 'stat-card__value tabular-nums', text: formatMoney(rem.bills, 'EUR') }));
  if (rem.bills <= 0.004) {
    if (month.transactions.some(bill)) markDone(card, 'ყველა გადასახადი გადახდილია');
    else card.appendChild(el('div', { class: 'stat-card__sub', text: 'ამ თვეში გადასახადები ჯერ არ არის.' }));
    return attachDetails(card, 'due', ctx, bill);
  }
  card.appendChild(el('div', { class: 'stat-card__sub tabular-nums', text: `${rem.next.length} გადასახადი გადასახდელია (დანაზოგი და კვება/საწვავი აქ არ ითვლება)` }));
  const acc = el('div', { class: 'due-card__accounts tabular-nums' });
  Object.entries(rem.billsByAccount).forEach(([a, v]) => {
    if (v > 0.004) acc.appendChild(el('span', { class: `chip chip--p-${a}`, text: `${personTag(a)}: ${formatMoney(v, 'EUR', 0)}` }));
  });
  card.appendChild(acc);
  // v19: bills from a personal account — what still has to be moved there / waits for the bank
  const perPerson = (bag) => ['giorgi', 'nino'].filter(p => bag[p] > 0.004).map(p => `${personTag(p)} ${formatMoney(bag[p], 'EUR', 0)}`).join(' · ');
  const toMove = perPerson(rem.toTransfer);
  const waiting = perPerson(rem.awaitingDebit);
  if (toMove) card.appendChild(el('div', { class: 'stat-card__sub tabular-nums due-card__step', text: `⇄ პირად ანგარიშზე გადასატანი: ${toMove}` }));
  if (waiting) card.appendChild(el('div', { class: 'stat-card__sub tabular-nums due-card__step', text: `⏳ გადატანილია, ბანკი ჯერ არ ჩამოჭრა: ${waiting}` }));
  const next = rem.next.slice(0, 2).map(t => `${t.name} ${formatDate(t.dueDate).slice(0, 5)}`).join(' · ');
  if (next) card.appendChild(el('div', { class: 'stat-card__sub', text: `შემდეგი: ${next}` }));
  return attachDetails(card, 'due', ctx, (tr) => bill(tr) && txnRemainingEur(tr, month.exchangeRate) > 0.004);
}

export function georgiaCard(ctx) {
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

/** A user category block (spending or savings). */
export function categoryCard(b, ctx) {
  const { categories } = ctx;
  // Show "whose" only when the whole block (incl. sub-categories) belongs to one person.
  const owners = new Set(familyOf(categories, b).map(c => c.owner || 'shared'));
  const only = owners.size === 1 ? [...owners][0] : null;
  const owner = only && only !== 'shared' ? ` · ${personTag(only)}` : (owners.size > 1 ? ` · ${[...owners].map(o => personTag(o)).join(' + ')}` : '');
  if (b.goalType !== 'min') return billsCategoryCard(b, ctx, owner);
  const pct = b.planned > 0 ? Math.min(100, (b.actual / b.planned) * 100) : 0;
  const sub = `გადარიცხულია ${formatMoney(b.actual, 'EUR')} / ${formatMoney(b.planned, 'EUR')} · ${formatPercent(b.pct)} შემოსავლიდან${owner}`;
  const card = statCard({ label: b.name, value: formatMoney(b.planned, 'EUR'), sub, pct, color: b.color });
  if (b.planned > 0.004) {
    if (b.toTransfer > 0.5) {
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
  return attachDetails(card, `cat:${b.id}`, ctx, (tr) => topIdOf(categories, tr.categoryId) === b.id, { categoryId: b.id });
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
  const inBlockBill = (tr) => inBlock(tr) && !isEnvelope(tr) && !isExtra(tr) && !isFromSavings(tr);
  const bills = month.transactions.filter(inBlockBill);
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
  return attachDetails(card, `cat:${b.id}`, ctx, inBlockBill, { categoryId: b.id });
}

/**
 * Records the savings transfer(s) of a block, per (sub)category: unpaid savings entries that
 * already exist (e.g. from a template) are marked paid first; only the rest becomes a new entry.
 */
export function openSavingsTransferDialog(b, ctx) {
  const { month, key, categories, rerender } = ctx;
  const rate = month.exchangeRate;
  const T = (month.income?.giorgi || 0) + (month.income?.nino || 0);
  const rows = familyOf(categories, b).map(c => {
    const target = targetEur(c, T);
    const inCat = month.transactions.filter(t => t.categoryId === c.id && !isEnvelope(t) && !isExtra(t) && !isFromSavings(t));
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
  form.appendChild(el('div', { class: 'btn-row' }, [el('button', { class: 'btn btn--primary', type: 'submit', text: '✓ ჩაწერა' })]));
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
