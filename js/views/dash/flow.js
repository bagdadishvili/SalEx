// views/dash/flow.js — money-flow helpers on the dashboard (v20, each can be switched off):
// 💶 payday checklist, 📅 upcoming debits, 🏦 bank-balance check.

import { updateState, todayISO, budgetMonthKey } from '../../state.js';
import { formatMoney, isTwoStep } from '../../calc.js';
import { paydaySteps, calendarItems, bankCheck } from '../../insights.js';
import { el, toast, undoToast, formatDate } from '../../ui.js';
import { tx, personTag } from '../../texts.js';
import { getUiPref } from '../../monthNav.js';
import { expanded, markDone, inlineNumberField } from './shared.js';

const STEP_LABEL = {
  toShared: '➡️ საერთო ანგარიშზე',
  savings: '💰 დანაზოგზე',
  debits: '⇄ პირად ანგარიშზე'
};

/** 💶 After the salary: who moves what — tick each step; the last one marks own bills "⇄". */
export function paydayCard(ctx) {
  const { month, key, categories, settings, rerender } = ctx;
  if ((month.income?.giorgi || 0) + (month.income?.nino || 0) <= 0) return [];
  const keep = getUiPref('splitView') !== 'full' && getUiPref('splitView') !== 'half';
  const people = paydaySteps(month, categories, settings, keep).filter(p => p.steps.length);
  if (!people.length) return [];
  const card = el('div', { class: 'card stat-card stat-card--wide payday-card card--expandable' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.payday') }));
  const allDone = people.every(p => p.allDone);
  const open = !allDone || expanded.has('payday');
  if (allDone) markDone(card, 'ყველა გადარიცხვა შესრულებულია');
  if (open) {
    people.forEach(p => {
      const box = el('div', { class: 'payday-person' }, [el('div', { class: 'payday-person__name', text: personTag(p.person) })]);
      p.steps.forEach(s => {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = s.done;
        cb.disabled = !!s.auto;
        cb.addEventListener('change', () => tickStep(key, month, categories, p.person, s, cb.checked, rerender));
        const label = s.id === 'debits' && s.open ? `${STEP_LABEL.debits} · ${s.open} გადასახადი` : STEP_LABEL[s.id];
        box.appendChild(el('label', { class: 'payday-step' + (s.done ? ' payday-step--done' : '') }, [
          cb, el('span', { class: 'payday-step__name', text: label }), el('span', { class: 'payday-step__amount tabular-nums', text: formatMoney(s.amount, 'EUR', 0) })
        ]));
      });
      card.appendChild(box);
    });
    card.appendChild(el('div', { class: 'stat-card__sub', text: 'თანხები — „💸 ვინ რამდენი გადარიცხოს" ბარათიდან. ბოლო ✓ ამ ადამიანის ყველა პირადი ანგარიშის გადასახადს „⇄ გადატანილად" მონიშნავს.' }));
  }
  if (allDone) {
    const btn = el('button', { type: 'button', class: 'card-expand', 'aria-expanded': String(open), text: open ? '▲ დაკეცვა' : '▼ ნახვა' });
    btn.addEventListener('click', (e) => { e.stopPropagation(); if (expanded.has('payday')) expanded.delete('payday'); else expanded.add('payday'); rerender(); });
    card.appendChild(btn);
  }
  return card;
}

function tickStep(key, month, categories, person, step, on, rerender) {
  const today = todayISO();
  const moved = [];
  updateState(d => {
    const m = d.months[key];
    m.payday = JSON.parse(JSON.stringify(m.payday || {}));
    m.payday[person] = m.payday[person] || {};
    if (on) m.payday[person][step.id] = today; else delete m.payday[person][step.id];
    if (on && step.id === 'debits') {
      m.transactions.forEach(t => {
        if (t.account === person && !t.paid && !t.transferredAt && isTwoStep(t, d.categories)) { t.transferredAt = today; moved.push(t.id); }
      });
    }
    return d;
  });
  if (moved.length) {
    undoToast(`⇄ ${moved.length} გადასახადი მოინიშნა გადატანილად`, () => {
      updateState(d => {
        const m = d.months[key];
        m.transactions.forEach(t => { if (moved.includes(t.id)) delete t.transferredAt; });
        if (m.payday && m.payday[person]) { m.payday = JSON.parse(JSON.stringify(m.payday)); delete m.payday[person].debits; }
        return d;
      });
      rerender();
    });
  } else if (on) toast('✓ შესრულებულია');
  void month; void categories;
  rerender();
}

/** 📅 The next debits by date; warns when a personal-account bill is near but not moved yet. */
export function calendarCard(ctx) {
  const { month, key, categories, rerender } = ctx;
  const today = todayISO();
  if (key < budgetMonthKey() && !month.transactions.some(t => !t.paid)) return [];
  const items = calendarItems(month, categories, today, 10);
  const card = el('div', { class: 'card stat-card stat-card--wide calendar-card' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.calendar') }));
  const warn = items.filter(x => x.warn || x.overdue).length;
  card.appendChild(el('div', { class: 'stat-card__value tabular-nums' + (warn ? ' text-danger' : ''), text: items.length ? `${items.length}` : '✓' }));
  if (!items.length) {
    card.appendChild(el('div', { class: 'stat-card__sub', text: 'მომდევნო 10 დღეში ჩამოსაჭრელი არაფერია.' }));
    return card;
  }
  const open = expanded.has('calendar');
  const list = el('div', { class: 'cal-list' });
  const dayLabel = (d) => (d < 0 ? 'ვადაგასული' : d === 0 ? 'დღეს' : d === 1 ? 'ხვალ' : `${d} დღეში`);
  (open ? items : items.slice(0, 4)).forEach(x => {
    const status = x.t.transferredAt ? '⇄ გადატანილია' : x.warn ? '⚠️ ჯერ არ არის გადატანილი' : '';
    list.appendChild(el('div', { class: 'cal-row' + (x.overdue || x.warn ? ' cal-row--warn' : '') }, [
      el('div', { class: 'cal-row__date tabular-nums' }, [el('strong', { text: formatDate(x.t.dueDate).slice(0, 5) }), el('span', { text: dayLabel(x.daysTo) })]),
      el('div', { class: 'cal-row__main' }, [
        el('div', { class: 'cal-row__name', text: x.t.name }),
        el('div', { class: 'detail-row__meta', text: [personTag(x.t.account || 'shared'), status].filter(Boolean).join(' · ') })
      ]),
      el('div', { class: 'cal-row__amount tabular-nums', text: formatMoney(x.t.amountPlanned, x.t.currency, 0) })
    ]));
  });
  card.appendChild(list);
  if (items.length > 4) {
    const btn = el('button', { type: 'button', class: 'card-expand', 'aria-expanded': String(open), text: open ? '▲ ნაკლები' : `▼ კიდევ ${items.length - 4}` });
    btn.addEventListener('click', (e) => { e.stopPropagation(); if (open) expanded.delete('calendar'); else expanded.add('calendar'); rerender(); });
    card.appendChild(btn);
  }
  return card;
}

/** 🏦 Type the real balance of an account — see what stays after everything still to pay. */
export function bankCard(ctx) {
  const { month, key, categories, rerender } = ctx;
  const rows = bankCheck(month, categories).filter(r => r.toGo > 0.5 || r.balance !== null);
  if (!rows.length) return [];
  const card = el('div', { class: 'card stat-card stat-card--wide bank-card' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.bank') }));
  rows.forEach(r => {
    const input = inlineNumberField(r.balance ?? 0, (v) => {
      updateState(d => {
        const m = d.months[key];
        m.bank = JSON.parse(JSON.stringify(m.bank || {}));
        m.bank[r.account] = { amount: v, at: new Date().toISOString() };
        return d;
      });
      rerender();
    });
    input.classList.add('bank-row__input');
    input.setAttribute('aria-label', `${personTag(r.account)} — ანგარიშის ნაშთი ახლა`);
    if (r.balance === null) input.value = '';
    input.placeholder = 'ნაშთი';
    const result = r.after === null ? `ჯერ გადის ${formatMoney(r.toGo, 'EUR', 0)}`
      : r.after < -0.5 ? `⚠️ აკლია ${formatMoney(-r.after, 'EUR', 0)} (გადის ${formatMoney(r.toGo, 'EUR', 0)})`
      : `დარჩება ${formatMoney(r.after, 'EUR', 0)} (გადის ${formatMoney(r.toGo, 'EUR', 0)})`;
    card.appendChild(el('div', { class: 'bank-row' }, [
      el('div', { class: 'bank-row__name', text: personTag(r.account) }),
      input,
      el('div', { class: 'bank-row__result tabular-nums' + (r.after !== null && r.after < -0.5 ? ' text-danger' : ''), text: result })
    ]));
  });
  card.appendChild(el('div', { class: 'stat-card__sub', text: 'ჩაწერე ბანკის აპში ნანახი ნაშთი. „გადის" = ამ თვის ჯერ გადაუხდელი გადასახადები, ბიუჯეტების ნაშთი და გადასარიცხი დანაზოგი ამ ანგარიშიდან. თუ „დარჩება" მოულოდნელად ცოტაა — რაღაც გადახდა არ არის ჩაწერილი.' }));
  return card;
}
