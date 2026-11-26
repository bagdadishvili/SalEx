// insights.js — pure calculations for the optional features (v20): payday steps, debit
// calendar, bank-balance check, reserve for rare bills, savings goals, variable-bill forecast,
// category trends, exchange-rate impact and "what if". No DOM, no state changes.

import {
  computeSalarySplit, computeRemaining, planFor, familyOf, targetEur, totalIncome, topIdOf, txnPaidEur, txnPlannedEur,
  isEnvelope, isExtra, isFromSavings, isSavingsTxn, isTwoStep, gelToEur, isTemplateDueInMonth, FREE_BUCKET_ID
} from './calc.js';

export function shiftKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
/** Whole months from a to b (b later = positive). */
export function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by * 12 + bm) - (ay * 12 + am);
}
const isBill = (t) => !isEnvelope(t) && !isExtra(t) && !isFromSavings(t);

// ---------------- 💶 payday checklist ----------------

/**
 * What each person moves after the salary: to the shared account, to savings, and the money for
 * the bills debited from their own account (two-step bills). done = month.payday[p][step] dates.
 */
export function paydaySteps(month, categories, settings, keepDebits = true) {
  const sp = computeSalarySplit(month, categories, settings, { mode: 'equal', keepDebits });
  const done = month.payday || {};
  return ['giorgi', 'nino'].map(p => {
    const P = sp.persons[p];
    const own = month.transactions.filter(t => t.account === p && isTwoStep(t, categories));
    const ownOpen = own.filter(t => !t.paid && !t.transferredAt);
    const steps = [
      { id: 'toShared', amount: P.toShared },
      { id: 'savings', amount: P.savings },
      { id: 'debits', amount: own.reduce((s, t) => s + txnPlannedEur(t, month.exchangeRate), 0), open: ownOpen.length, auto: own.length > 0 && !ownOpen.length }
    ].filter(s => s.amount > 0.5)
      .map(s => ({ ...s, done: !!(done[p] && done[p][s.id]) || !!s.auto }));
    return { person: p, steps, allDone: steps.every(s => s.done) };
  });
}

// ---------------- 📅 debit calendar ----------------

/** Unpaid bills (and savings transfers) by due date, with warnings. */
export function calendarItems(month, categories, todayIso, horizonDays = 10) {
  const limit = new Date(todayIso); limit.setDate(limit.getDate() + horizonDays);
  const limitIso = limit.toISOString().slice(0, 10);
  return month.transactions
    .filter(t => isBill(t) && !t.paid && t.dueDate)
    .map(t => {
      const two = isTwoStep(t, categories);
      const daysTo = Math.round((new Date(t.dueDate) - new Date(todayIso)) / 86400000);
      return { t, two, daysTo, overdue: daysTo < 0, warn: two && !t.transferredAt && daysTo <= 3 };
    })
    .filter(x => x.t.dueDate <= limitIso)
    .sort((a, b) => a.t.dueDate.localeCompare(b.t.dueDate));
}

// ---------------- 🏦 bank balance check ----------------

/** Per account: the real balance typed in, what still leaves the account this month, what stays. */
export function bankCheck(month, categories) {
  const rem = computeRemaining(month, categories, null);
  const bank = month.bank || {};
  return ['shared', 'giorgi', 'nino'].map(a => {
    const entered = bank[a] && typeof bank[a].amount === 'number' ? bank[a] : null;
    const toGo = rem.byAccount[a] || 0;
    return { account: a, balance: entered ? entered.amount : null, at: entered ? entered.at : null, toGo, after: entered ? entered.amount - toGo : null };
  });
}

// ---------------- 📆 reserve for rare bills ----------------

/** Bills that come every 2+ months: monthly share, next due month, what should be set aside by now. */
export function reserveOverview(state, key) {
  const m = state.months[key];
  const rate = (m && m.exchangeRate) || 3;
  const items = state.templates
    .filter(t => t.active && !t.oneTime && (t.cycleMonths || 1) > 1 && t.type !== 'envelope')
    .map(t => {
      const cycle = t.cycleMonths;
      const amountEur = t.currency === 'GEL' ? gelToEur(t.amount, rate) : t.amount;
      let next = key, guard = 0;
      while (!isTemplateDueInMonth(t, next) && guard++ < 36) next = shiftKey(next, 1);
      const until = monthsBetween(key, next);
      const share = amountEur / cycle;
      return { tpl: t, cycle, amountEur, share, next, until, saved: Math.min(amountEur, share * (cycle - until)) };
    })
    .sort((a, b) => a.until - b.until);
  return { items, monthly: items.reduce((s, x) => s + x.share, 0), needNow: items.reduce((s, x) => s + x.saved, 0) };
}

// ---------------- 🎯 savings goals ----------------

/** Progress of a savings goal (category.goalAmount / goalBy) given its balance. */
export function goalProgress(cat, balance, key) {
  const goal = Number(cat && cat.goalAmount) || 0;
  if (!(goal > 0)) return null;
  const by = /^\d{4}-\d{2}$/.test(cat.goalBy || '') ? cat.goalBy : null;
  const left = Math.max(0, goal - (balance || 0));
  const monthsLeft = by ? Math.max(1, monthsBetween(key, by) + 1) : null;
  return { goal, by, balance: balance || 0, left, pct: Math.min(100, ((balance || 0) / goal) * 100), monthsLeft, perMonth: monthsLeft ? left / monthsLeft : null, late: !!by && by < key && left > 0.5 };
}

// ---------------- 📈 variable-bill forecast ----------------

/** Paid amounts of a template in the months before `beforeKey` (its own currency), oldest first. */
export function templateHistory(months, tplId, beforeKey, n = 6) {
  return Object.keys(months).filter(k => k < beforeKey).sort().map(k => {
    const t = months[k].transactions.find(x => x.templateId === tplId && x.paid);
    return t ? { key: k, amount: Number(t.amountActual ?? t.amountPlanned) || 0 } : null;
  }).filter(Boolean).slice(-n);
}

/** Average of the last months and the change of the last payment vs the one before. */
export function forecastTemplate(months, tpl, forKey, n = 6) {
  const h = templateHistory(months, tpl.id, forKey, n);
  if (h.length < 2) return null;
  const avg = h.reduce((s, x) => s + x.amount, 0) / h.length;
  const last = h[h.length - 1].amount, prev = h[h.length - 2].amount;
  return { avg: Math.round(avg * 100) / 100, last, prev, changePct: prev > 0 ? ((last - prev) / prev) * 100 : 0, n: h.length };
}

// ---------------- 📊 category trends ----------------

/** Paid € per month of one top category (or 'spend' = all spending) for the last n months up to toKey. */
export function categoryTrend(state, topId, toKey, n = 12) {
  const cats = state.categories;
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = shiftKey(toKey, -i);
    const m = state.months[k];
    if (!m) { out.push({ key: k, paid: 0, target: 0, empty: true }); continue; }
    const { categories: rc } = planFor(m, cats, null);
    const T = totalIncome(m);
    const inTop = (t) => {
      const top = topIdOf(cats, t.categoryId);
      if (topId === 'spend') return top !== null && !isSavingsTxn(t, cats);
      return top === topId;
    };
    const paid = m.transactions.filter(inTop).reduce((s, t) => s + txnPaidEur(t, m.exchangeRate), 0);
    let target = 0;
    if (topId === 'spend') target = rc.filter(c => !c.parentId && c.goalType !== 'min').reduce((s, c) => s + familyOf(rc, c).reduce((a, x) => a + targetEur(x, T), 0), 0);
    else if (topId !== FREE_BUCKET_ID) { const top = rc.find(c => c.id === topId); target = top ? familyOf(rc, top).reduce((a, x) => a + targetEur(x, T), 0) : 0; }
    out.push({ key: k, paid, target, empty: !m.transactions.some(t => t.paid) });
  }
  return out;
}

// ---------------- 💱 exchange-rate impact ----------------

/**
 * Lari payments: what they cost in € at the rate really used vs the month's budget rate.
 * gain > 0 = the rate helped (fewer € than planned).
 */
export function fxImpact(months, fromKey, toKey) {
  const rows = [];
  Object.keys(months).filter(k => k >= fromKey && k <= toKey).sort().forEach(k => {
    const m = months[k];
    let gel = 0, eurPaid = 0, eurPlan = 0;
    m.transactions.forEach(t => {
      if (t.currency !== 'GEL' || !t.paid || isEnvelope(t) || !(t.rateAtPayment > 0) || !(m.exchangeRate > 0)) return;
      const amt = Number(t.amountActual ?? t.amountPlanned) || 0;
      gel += amt; eurPaid += amt / t.rateAtPayment; eurPlan += amt / m.exchangeRate;
    });
    if (gel > 0) rows.push({ key: k, gel, eurPaid, eurPlan, gain: eurPlan - eurPaid, rate: gel / eurPaid, planRate: m.exchangeRate });
  });
  const sum = (f) => rows.reduce((s, r) => s + r[f], 0);
  return { rows, gel: sum('gel'), eurPaid: sum('eurPaid'), gain: sum('gain'), avgRate: sum('eurPaid') > 0 ? sum('gel') / sum('eurPaid') : 0 };
}

// ---------------- 🧮 what if ----------------

/** Salary split now vs. with changed salaries and/or one new monthly cost. */
export function whatIf(month, categories, settings, { giorgi = 0, nino = 0, cost = 0, costAccount = 'shared', costCategoryId = null } = {}, keepDebits = true) {
  const before = computeSalarySplit(month, categories, settings, { mode: 'equal', keepDebits });
  const m2 = JSON.parse(JSON.stringify(month));
  m2.income = { giorgi: (month.income.giorgi || 0) + (Number(giorgi) || 0), nino: (month.income.nino || 0) + (Number(nino) || 0) };
  if (Number(cost) > 0) {
    const cat = costCategoryId || (categories.find(c => !c.parentId && c.goalType !== 'min') || categories[0] || {}).id;
    m2.transactions.push({ id: '__whatif', categoryId: cat, account: costAccount, owner: costAccount, currency: 'EUR', amountPlanned: Number(cost), paid: false });
  }
  const after = computeSalarySplit(m2, categories, settings, { mode: 'equal', keepDebits });
  const pick = (sp) => Object.fromEntries(['giorgi', 'nino'].map(p => [p, { toShared: sp.persons[p].toShared, savings: sp.persons[p].savings, free: sp.persons[p].free }]));
  return { before: pick(before), after: pick(after) };
}


