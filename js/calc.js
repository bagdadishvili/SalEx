// calc.js — all money math: currency conversion, dashboard aggregates, plan-vs-actual.
// Pure functions only (no DOM, no state mutation) so they're easy to self-check and unit-test.

const FREE_BUCKET_ID = 'free';

/** GEL -> EUR at a given rate (rate = GEL per 1 EUR). */
export function gelToEur(amountGel, rate) {
  if (!rate || rate <= 0) return 0;
  return amountGel / rate;
}

// ---- Plan targets: every category (and each person's free money) has a target that is
// either a % of the month's income or a fixed € amount (v15). The other value is derived. ----

/** Target in € for a category / free-money config, given the month's total income T. */
export function targetEur(cfg, T) {
  if (!cfg) return 0;
  if (cfg.targetType === 'amount') return Number(cfg.amount) || 0;
  return (T || 0) * (Number(cfg.percent) || 0) / 100;
}

/** Target in % of income for a category / free-money config. */
export function targetPct(cfg, T) {
  if (!cfg) return 0;
  if (cfg.targetType === 'amount') return T > 0 ? ((Number(cfg.amount) || 0) / T) * 100 : 0;
  return Number(cfg.percent) || 0;
}

/** All categories that roll up into `top` (the top itself + its sub-categories, any depth). */
export function familyOf(categories, top) {
  return categories.filter(c => c.id === top.id || (resolveTopCategory(categories, c.id) || {}).id === top.id && c.parentId !== FREE_BUCKET_ID);
}

// ---- "Extra" purchases (shoes, medicine… bought outside the plan) ----
// kind 'extra'; if paid from an envelope's money (fromEnvelope = that envelope txn id) it is
// part of that envelope's spending (v16): it counts as paid money and lowers what is left
// in the envelope. Its planned amount is 0 — the envelope's plan already covers it.

export function isExtra(txn) {
  return !!txn && txn.kind === 'extra';
}

// ---- Envelopes ("ბიუჯეტი": food, fuel…) — a planned amount that is spent gradually ----

export function isEnvelope(txn) {
  return !!txn && txn.kind === 'envelope';
}

/** Sum of the partial spends recorded in an envelope (in the envelope's currency). */
export function envelopeSpent(txn) {
  return (txn.spends || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
}

/** Extras bought with this envelope's money (in the envelope's currency). */
export function envelopeExtras(env, txns, monthRate) {
  if (!Array.isArray(txns)) return 0;
  return txns.filter(x => isExtra(x) && x.fromEnvelope === env.id).reduce((s, x) => {
    const amt = Number(x.amountActual ?? x.amountPlanned) || 0;
    if (x.currency === env.currency) return s + amt;
    return s + (env.currency === 'GEL' ? amt * (monthRate || 0) : gelToEur(amt, monthRate));
  }, 0);
}

/** Everything that went out of an envelope: its own spends + extras paid from it. */
export function envelopeUsed(env, txns, monthRate) {
  return envelopeSpent(env) + envelopeExtras(env, txns, monthRate);
}

function toEur(amount, txn, monthRate) {
  if (txn.currency !== 'GEL') return amount;
  const rate = txn.paid && txn.rateAtPayment ? txn.rateAtPayment : monthRate;
  return gelToEur(amount, rate);
}

/** Money already gone (EUR): paid transactions, or what has been spent from an envelope so far. */
export function txnPaidEur(txn, monthRate) {
  if (isEnvelope(txn)) return toEur(envelopeSpent(txn), txn, monthRate);
  return txn.paid ? txnAmountEur(txn, monthRate) : 0;
}

/**
 * Money still to go out this month (EUR): unpaid bills + what is left in open envelopes.
 * Pass the month's transactions so extras bought from an envelope lower what is left in it.
 */
export function txnRemainingEur(txn, monthRate, txns = null) {
  if (isExtra(txn)) return 0;
  if (isEnvelope(txn)) {
    if (txn.paid) return 0; // envelope closed for the month
    return Math.max(0, toEur((txn.amountPlanned || 0) - envelopeUsed(txn, txns, monthRate), txn, monthRate));
  }
  return txn.paid ? 0 : txnPlannedEur(txn, monthRate);
}

/** Amount of a transaction expressed in EUR, respecting frozen rateAtPayment for paid GEL txns. */
export function txnAmountEur(txn, monthRate) {
  if (isEnvelope(txn)) return toEur(envelopeSpent(txn), txn, monthRate);
  const amount = txn.paid ? (txn.amountActual ?? txn.amountPlanned) : txn.amountPlanned;
  if (txn.currency === 'GEL') {
    const rate = txn.paid && txn.rateAtPayment ? txn.rateAtPayment : monthRate;
    return gelToEur(amount, rate);
  }
  return amount;
}

/** Planned amount of a transaction in EUR (always uses amountPlanned, current month rate for GEL). */
export function txnPlannedEur(txn, monthRate) {
  if (isExtra(txn) && txn.fromEnvelope) return 0;
  if (txn.currency === 'GEL') return gelToEur(txn.amountPlanned, monthRate);
  return txn.amountPlanned;
}

/**
 * Walks parentId links up to the top-level category (or a free-spending category).
 * Returns the resolved category object, or null if catId is unknown.
 */
export function resolveTopCategory(categories, catId) {
  let c = categories.find(x => x.id === catId);
  let guard = 0;
  while (c && c.parentId && c.parentId !== FREE_BUCKET_ID && guard++ < 10) {
    const p = categories.find(x => x.id === c.parentId);
    if (!p) break;
    c = p;
  }
  return c || null;
}

/** Top-level grouping id for a transaction's category: a category id or 'free'. */
export function topIdOf(categories, catId) {
  const c = resolveTopCategory(categories, catId);
  if (!c) return null;
  return c.parentId === FREE_BUCKET_ID ? FREE_BUCKET_ID : c.id;
}

function sumByTop(month, categories, topId, paidOnly) {
  return month.transactions
    .filter(t => topIdOf(categories, t.categoryId) === topId)
    .reduce((s, t) => s + (paidOnly ? txnPaidEur(t, month.exchangeRate) : txnPlannedEur(t, month.exchangeRate)), 0);
}

/** Sum paid EUR within free-spending categories, restricted to one owner. */
function sumFreeByOwner(month, categories, owner, usePaidActual) {
  return month.transactions
    .filter(t => topIdOf(categories, t.categoryId) === FREE_BUCKET_ID && t.owner === owner)
    .reduce((sum, t) => {
      if (usePaidActual) return sum + txnPaidEur(t, month.exchangeRate);
      return sum + txnPlannedEur(t, month.exchangeRate);
    }, 0);
}

/**
 * The dashboard card order actually rendered: stored order, cleaned of stale ids,
 * with any new top-level categories inserted before the free-money card.
 */
export const FIXED_CARDS = ['summary', 'due', 'envelopes', 'extras', 'income', 'rate', 'georgia', 'savings', 'split', 'year'];

export function effectiveCardOrder(settings, categories) {
  const fixed = FIXED_CARDS;
  // Savings blocks ("min" goal) live inside the one 💰 savings card (v17), not as cards of their own.
  const topIds = categories.filter(c => !c.parentId && c.goalType !== 'min').map(c => c.id);
  const stored = Array.isArray(settings.dashboardCardOrder) ? settings.dashboardCardOrder : [];
  const order = stored.filter(k => fixed.includes(k) || topIds.includes(k));
  // Cards added in newer versions go next to their natural neighbour, not to the very end.
  fixed.forEach((k, i) => {
    if (order.includes(k)) return;
    let at = -1;
    for (let j = i - 1; j >= 0 && at < 0; j--) at = order.indexOf(fixed[j]);
    order.splice(at + 1, 0, k);
  });
  topIds.forEach(id => {
    if (!order.includes(id)) {
      const i = order.indexOf('split');
      order.splice(i >= 0 ? i : order.length, 0, id);
    }
  });
  return order;
}

/**
 * "📤 to Georgia" is a flag on each template/transaction (v5) — independent of whether the
 * expense is essential or not. (Old category-level flags are still honoured, just in case.)
 */
export function isGeorgia(txn, categories) {
  if (txn.toGeorgia) return true;
  const c = categories && categories.find(x => x.id === txn.categoryId);
  return !!(c && c.georgiaTransfer);
}

/** Sum of Georgia transfers (shown separately; they are ALSO counted in their own category). */
function sumGeorgiaTransfer(month, categories) {
  const txns = month.transactions.filter(t => isGeorgia(t, categories));
  const plannedGel = txns.filter(t => t.currency === 'GEL').reduce((s, t) => s + t.amountPlanned, 0);
  const plannedEur = txns.reduce((s, t) => s + txnPlannedEur(t, month.exchangeRate), 0);
  const actualEur = txns.reduce((s, t) => s + txnPaidEur(t, month.exchangeRate), 0);
  return { plannedGel, plannedEur, actualEur };
}

export function totalIncome(month) {
  return (month.income?.giorgi || 0) + (month.income?.nino || 0);
}

/** Full dashboard aggregate for a month, driven entirely by the user's configured buckets. */
export function computeDashboard(month, categories, settings) {
  const T = totalIncome(month);
  const pct = (x) => T > 0 ? Math.round((x / T) * 1000) / 10 : 0;

  // One "bucket" per top-level category; sub-categories' amounts AND targets roll up into it.
  const buckets = categories.filter(c => !c.parentId).map(b => {
    const bills = sumByTop(month, categories, b.id, false);
    const actual = sumByTop(month, categories, b.id, true);
    const fam = familyOf(categories, b);
    const target = fam.reduce((acc, c) => acc + targetEur(c, T), 0);
    const targetPercent = T > 0 ? (target / T) * 100 : fam.reduce((acc, c) => acc + targetPct(c, T), 0);
    // Savings-type blocks: the target IS the plan (money to move), even before any transaction exists.
    // Counted per (sub)category, like the salary split and the "transferred" dialog.
    const catPlanned = (id) => month.transactions.filter(t => t.categoryId === id).reduce((s, t) => s + txnPlannedEur(t, month.exchangeRate), 0);
    const planned = b.goalType === 'min' ? Math.max(bills, fam.reduce((acc, c) => acc + Math.max(targetEur(c, T), catPlanned(c.id)), 0)) : bills;
    return { ...b, planned, bills, actual, target, targetPercent, toTransfer: b.goalType === 'min' ? Math.max(0, planned - actual) : 0, pct: pct(planned) };
  });
  const bucketsPlannedTotal = buckets.reduce((s, b) => s + b.planned, 0);
  const bucketsActualTotal = buckets.reduce((s, b) => s + b.actual, 0);

  const georgia = sumGeorgiaTransfer(month, categories);

  const freeTotal = T - bucketsPlannedTotal;
  const { giorgi: freeGiorgiCfg, nino: freeNinoCfg } = settings.planFree;
  const tg = targetEur(freeGiorgiCfg, T), tn = targetEur(freeNinoCfg, T);
  const freeShareDenom = (tg + tn) || 0;
  const freeGiorgiShare = freeShareDenom > 0 ? freeTotal * (tg / freeShareDenom) : freeTotal / 2;
  const freeNinoShare = freeShareDenom > 0 ? freeTotal * (tn / freeShareDenom) : freeTotal / 2;

  const freeSpentGiorgi = sumFreeByOwner(month, categories, 'giorgi', true);
  const freeSpentNino = sumFreeByOwner(month, categories, 'nino', true);
  const freeActualTotal = freeSpentGiorgi + freeSpentNino;

  const actualSavings = T - bucketsActualTotal - freeActualTotal;

  return {
    totalIncome: T,
    buckets,
    georgia: { ...georgia, pct: pct(georgia.plannedEur) },
    savings: { actual: actualSavings },
    free: {
      total: freeTotal,
      giorgi: { share: freeGiorgiShare, spent: freeSpentGiorgi, remaining: freeGiorgiShare - freeSpentGiorgi, pct: pct(freeGiorgiShare), color: freeGiorgiCfg.color },
      nino: { share: freeNinoShare, spent: freeSpentNino, remaining: freeNinoShare - freeSpentNino, pct: pct(freeNinoShare), color: freeNinoCfg.color }
    }
  };
}

/** Month-level totals across ALL transactions: planned, paid (actual), and what's left unpaid. */
export function computeMonthTotals(month) {
  let planned = 0, paid = 0, unpaid = 0, unpaidCount = 0;
  month.transactions.forEach(t => {
    planned += txnPlannedEur(t, month.exchangeRate);
    paid += txnPaidEur(t, month.exchangeRate);
    const rem = txnRemainingEur(t, month.exchangeRate, month.transactions);
    if (rem > 0.004) { unpaid += rem; unpaidCount += 1; }
  });
  return { planned, paid, unpaid, unpaidCount, count: month.transactions.length };
}

export const ACCOUNTS = ['shared', 'giorgi', 'nino'];
// Who pays = from whose bank account the money leaves (also whose free money it reduces).
export const ACCOUNT_LABELS = { shared: 'საერთო', giorgi: 'გიორგი', nino: 'ნინო' };

/** Savings term of a category: 'short' | 'long' | '' — its own setting, else read from its name. */
export function savingsTerm(c) {
  if (!c) return '';
  if (c.term === 'short' || c.term === 'long') return c.term;
  if (/გრძელ/.test(c.name || '')) return 'long';
  if (/მოკლე/.test(c.name || '')) return 'short';
  return '';
}

/**
 * The 💰 savings card (v17): every savings (sub)category with its plan for the month and what
 * is already transferred, plus totals for short-term, long-term and all savings.
 */
export function computeSavingsOverview(month, categories) {
  const T = totalIncome(month);
  const rate = month.exchangeRate;
  const items = categories.filter(c => {
    const top = resolveTopCategory(categories, c.id);
    return top && top.parentId !== FREE_BUCKET_ID && c.parentId !== FREE_BUCKET_ID && top.goalType === 'min';
  }).map(c => {
    const txns = month.transactions.filter(t => t.categoryId === c.id);
    const planned = Math.max(targetEur(c, T), txns.reduce((s, t) => s + txnPlannedEur(t, rate), 0));
    const done = txns.reduce((s, t) => s + txnPaidEur(t, rate), 0);
    return { id: c.id, name: c.name, owner: c.owner || 'shared', term: savingsTerm(c), planned, done, open: Math.max(0, planned - done) };
  }).filter(r => r.planned > 0.004 || r.done > 0.004);
  const sum = (list) => ({ planned: list.reduce((s, r) => s + r.planned, 0), done: list.reduce((s, r) => s + r.done, 0) });
  return { items, short: sum(items.filter(r => r.term === 'short')), long: sum(items.filter(r => r.term === 'long')), total: sum(items) };
}

/** Is this transaction money moved to savings (its top category has goal "min")? */
export function isSavingsTxn(txn, categories) {
  if (!categories) return false;
  const top = resolveTopCategory(categories, txn.categoryId);
  return !!top && top.parentId !== FREE_BUCKET_ID && top.goalType === 'min';
}

/**
 * What still has to go out this month, total and per paying account.
 * bills = unpaid fixed payments (no savings, no envelopes) — billsByAccount is their split;
 * envelopes = what is left in open envelopes (food, fuel…); savings = not yet transferred.
 */
export function computeRemaining(month, categories = null, settings = null) {
  const out = { total: 0, bills: 0, envelopes: 0, savings: 0, count: 0, byAccount: { shared: 0, giorgi: 0, nino: 0 }, billsByAccount: { shared: 0, giorgi: 0, nino: 0 }, next: [] };
  // Savings targets not transferred yet (per (sub)category, by whose they are).
  if (categories) {
    const T = totalIncome(month);
    categories.forEach(c => {
      const top = resolveTopCategory(categories, c.id);
      if (!top || top.parentId === FREE_BUCKET_ID || top.goalType !== 'min') return;
      const target = targetEur(c, T);
      if (target <= 0) return;
      const done = month.transactions.filter(t => t.categoryId === c.id).reduce((acc, t) => acc + Math.max(txnPaidEur(t, month.exchangeRate), 0), 0);
      const plannedOpen = month.transactions.filter(t => t.categoryId === c.id).reduce((acc, t) => acc + txnRemainingEur(t, month.exchangeRate, month.transactions), 0);
      const missing = Math.max(0, target - done - plannedOpen); // open transactions are counted below already
      if (missing <= 0.004) return;
      out.total += missing;
      out.savings += missing;
      const acc = ACCOUNTS.includes(c.owner) ? c.owner : 'shared';
      out.byAccount[acc] += missing;
    });
  }
  void settings;
  month.transactions.forEach(t => {
    const rem = txnRemainingEur(t, month.exchangeRate, month.transactions);
    if (rem <= 0.004) return;
    out.total += rem;
    out.count += 1;
    const acc = ACCOUNTS.includes(t.account) ? t.account : 'shared';
    out.byAccount[acc] += rem;
    if (isEnvelope(t)) out.envelopes += rem;
    else if (isSavingsTxn(t, categories)) out.savings += rem;
    else { out.bills += rem; out.billsByAccount[acc] += rem; out.next.push(t); }
  });
  out.next.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  return out;
}

/**
 * Salary split plan ("ხელფასის განაწილება") for the month.
 * Each person funds the shared costs by `settings.contributionSplit`:
 *  'proportional' — the same % of each salary;  'equal' — 50/50.
 * Spending categories are funded with the real planned bills ('actual') or with their
 * % of income ('plan'); savings ("min") categories always get at least their % target.
 * Bills debited directly from a person's own account stay there — so that person only
 * transfers the rest to the shared account (no money back-and-forth).
 */
export function computeSalarySplit(month, categories, settings, overrides = {}) {
  const income = { giorgi: month.income?.giorgi || 0, nino: month.income?.nino || 0 };
  const T = income.giorgi + income.nino;
  // The family splits shared costs 50/50 (v13). 'proportional' remains available to callers only.
  const mode = (overrides.mode || 'equal') === 'proportional' ? 'proportional' : 'equal';
  // keepDebits=false: EVERYTHING goes to the shared account (classic 50/50); bills that are
  // debited from a personal account then have to be sent back from the shared account.
  const keepDebits = overrides.keepDebits !== false;
  const basis = settings.contributionBasis === 'plan' ? 'plan' : 'actual';
  const share = mode === 'equal' || T <= 0
    ? { giorgi: 0.5, nino: 0.5 }
    : { giorgi: income.giorgi / T, nino: income.nino / T };

  const tops = categories.filter(c => !c.parentId);
  const plannedBy = {}; // topId -> { total, shared, giorgi, nino }
  tops.forEach(c => { plannedBy[c.id] = { total: 0, shared: 0, giorgi: 0, nino: 0 }; });
  month.transactions.forEach(t => {
    const top = topIdOf(categories, t.categoryId);
    if (!top || !plannedBy[top]) return;
    const eur = txnPlannedEur(t, month.exchangeRate);
    const acc = ACCOUNTS.includes(t.account) ? t.account : 'shared';
    plannedBy[top].total += eur;
    plannedBy[top][acc] += eur;
  });

  // A category can belong to both ("shared", split by `share`) or to one person (v14),
  // e.g. "ინვესტიცია (ნინო)" is funded 100% by Nino.
  let spend = 0, spendBudget = 0, savings = 0;
  const debits = { shared: 0, giorgi: 0, nino: 0 };
  const essBy = { giorgi: 0, nino: 0 };
  const saveBy = { giorgi: 0, nino: 0 };
  const addFor = (target, owner, amount) => {
    if (owner === 'giorgi' || owner === 'nino') target[owner] += amount;
    else { target.giorgi += amount * share.giorgi; target.nino += amount * share.nino; }
  };
  // Every category counts with its OWN owner and target (v15) — e.g. "დანაზოგი (ნინო)" shown
  // inside Giorgi's savings block on the dashboard is still Nino's money here.
  const plannedByCat = {};
  month.transactions.forEach(t => {
    const eur = txnPlannedEur(t, month.exchangeRate);
    plannedByCat[t.categoryId] = (plannedByCat[t.categoryId] || 0) + eur;
  });
  categories.forEach(c => {
    const top = resolveTopCategory(categories, c.id);
    if (!top || top.parentId === FREE_BUCKET_ID || c.parentId === FREE_BUCKET_ID) return;
    const target = targetEur(c, T);
    const planned = plannedByCat[c.id] || 0;
    const owner = c.owner && c.owner !== 'shared' ? c.owner : (top.owner || 'shared');
    if (top.goalType === 'min') {
      const amount = Math.max(target, planned);
      savings += amount;
      addFor(saveBy, owner, amount);
    } else {
      spendBudget += target;
      const amount = basis === 'plan' ? Math.max(target, planned) : planned;
      spend += amount;
      addFor(essBy, owner, amount);
    }
  });
  tops.forEach(c => {
    if (c.goalType === 'min') return;
    const p = plannedBy[c.id];
    ACCOUNTS.forEach(a => { debits[a] += p[a]; });
  });
  const spendPlannedTotal = debits.shared + debits.giorgi + debits.nino;

  const persons = {};
  ['giorgi', 'nino'].forEach(p => {
    const essentials = essBy[p];
    const save = saveBy[p];
    const free = income[p] - essentials - save;
    const freeTarget = T * (Number(settings.planFree?.[p]?.percent) || 0) / 100;
    persons[p] = {
      income: income[p], share: share[p], essentials, savings: save,
      keepForDebits: keepDebits ? debits[p] : 0,
      toShared: keepDebits ? essentials - debits[p] : essentials,
      backFromShared: keepDebits ? 0 : debits[p],
      free, freeTarget
    };
  });
  return {
    totalIncome: T, mode, basis, share, keepDebits,
    spend, spendPlannedTotal, spendBudget, savings, debits,
    spendPct: T > 0 ? (spendPlannedTotal / T) * 100 : 0,
    sharedNeeds: (keepDebits ? debits.shared : spendPlannedTotal) + (basis === 'plan' ? Math.max(0, spend - spendPlannedTotal) : 0),
    persons
  };
}

/**
 * Year overview (FACTS = paid transactions only), one row per month that has data.
 * spent  = paid in spending categories (incl. free spending)
 * saved  = paid in "min"-goal categories (e.g. დანაზოგი — money moved to savings)
 * leftover = income − spent − saved (money not used at all)
 */
export function computeYearOverview(months, categories, year) {
  return computeRangeOverview(months, categories, `${year}-01`, `${year}-12`, year);
}

/**
 * Same as the year overview, for any period fromKey..toKey (YYYY-MM, inclusive).
 * Only months with real payments are listed (plus the current one): a month that was just
 * opened copies last month's income, and without this it would show that as "left over".
 */
export function computeRangeOverview(months, categories, fromKey, toKey, year = null, currentKey = null) {
  const now = new Date();
  const nowKey = currentKey || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const minTops = new Set(categories.filter(c => !c.parentId && c.goalType === 'min').map(c => c.id));
  const rows = [];
  const keys = Object.keys(months).filter(k => k >= fromKey && k <= toKey).sort();
  for (const key of keys) {
    const m = Number(key.slice(5, 7));
    const month = months[key];
    if (!month) continue;
    let spent = 0, saved = 0, georgia = 0;
    month.transactions.forEach(t => {
      const eur = txnPaidEur(t, month.exchangeRate);
      if (eur === 0) return;
      if (minTops.has(topIdOf(categories, t.categoryId))) saved += eur; else spent += eur;
      if (isGeorgia(t, categories)) georgia += eur;
    });
    const income = totalIncome(month);
    if (income === 0 && month.transactions.length === 0) continue;
    if (spent + saved < 0.005 && key !== nowKey) continue;
    rows.push({ key, month: m, income, spent, saved, georgia, leftover: income - spent - saved });
  }
  const totals = rows.reduce((acc, r) => {
    ['income', 'spent', 'saved', 'georgia', 'leftover'].forEach(k => { acc[k] += r[k]; });
    return acc;
  }, { income: 0, spent: 0, saved: 0, georgia: 0, leftover: 0 });
  const n = rows.length || 1;
  const average = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v / n]));
  return { year, from: fromKey, to: toKey, rows, totals, average };
}

/**
 * "Month overview" card (v16): fixed payments and spend-as-you-go budgets (food, fuel…) apart,
 * savings never counted as an expense, and the income split into costs / savings / free money
 * — in total and per person, by the same 50/50 logic as the salary split card.
 */
export function computeMonthOverview(month, categories, settings) {
  const rate = month.exchangeRate;
  const bills = { planned: 0, paid: 0, count: 0, open: 0 };
  const budgets = { planned: 0, used: 0 };
  month.transactions.forEach(t => {
    if (topIdOf(categories, t.categoryId) === FREE_BUCKET_ID || isSavingsTxn(t, categories)) return;
    if (isEnvelope(t)) {
      budgets.planned += txnPlannedEur(t, rate);
      budgets.used += toEur(envelopeUsed(t, month.transactions, rate), t, rate);
      return;
    }
    if (isExtra(t) && t.fromEnvelope) return; // already inside its envelope
    bills.planned += txnPlannedEur(t, rate);
    bills.paid += txnPaidEur(t, rate);
    bills.count += 1;
    if (!t.paid) bills.open += 1;
  });
  const sp = computeSalarySplit(month, categories, settings, { mode: 'equal' });
  const person = (p) => ({ income: sp.persons[p].income, costs: sp.persons[p].essentials, savings: sp.persons[p].savings, free: sp.persons[p].free });
  const giorgi = person('giorgi'), nino = person('nino');
  const total = {};
  Object.keys(giorgi).forEach(k => { total[k] = giorgi[k] + nino[k]; });
  return { bills, budgets, total, giorgi, nino };
}

/** Plan-vs-actual rows: one per user bucket, plus the two free-money person splits. */
export function computePlanVsActual(month, categories, settings) {
  const T = totalIncome(month);
  const pct = (x) => T > 0 ? (x / T) * 100 : 0;
  const dash = computeDashboard(month, categories, settings);

  const rows = dash.buckets.map(b => {
    const actual = pct(b.actual);
    const target = b.targetPercent;
    const ok = b.goalType === 'min' ? actual >= target - 0.05 : actual <= target + 0.05;
    return { key: b.id, label: b.name, color: b.color, target, actual, delta: Math.round((actual - target) * 10) / 10, ok };
  });

  const { giorgi: freeGiorgiCfg, nino: freeNinoCfg } = settings.planFree;
  const giorgiActual = pct(dash.free.giorgi.spent);
  const ninoActual = pct(dash.free.nino.spent);
  const tgP = targetPct(freeGiorgiCfg, T), tnP = targetPct(freeNinoCfg, T);
  rows.push({ key: 'freeGiorgi', label: 'თავისუფალი (გიორგი)', color: freeGiorgiCfg.color, target: tgP, actual: giorgiActual, delta: Math.round((giorgiActual - tgP) * 10) / 10, ok: giorgiActual <= tgP + 0.05 });
  rows.push({ key: 'freeNino', label: 'თავისუფალი (ნინო)', color: freeNinoCfg.color, target: tnP, actual: ninoActual, delta: Math.round((ninoActual - tnP) * 10) / 10, ok: ninoActual <= tnP + 0.05 });

  return rows;
}

/** Sum of top-level category percents + free-money percents; must equal 100 for a valid plan. */
/**
 * Sum of all targets in % of income T (every category incl. sub-categories — € targets are
 * converted with T — plus both people's free money). Must equal 100 for a valid plan.
 */
export function sumAllPercents(settings, categories, T = 0) {
  const catSum = categories
    .filter(c => c.parentId !== FREE_BUCKET_ID)
    .reduce((acc, c) => acc + targetPct(c, T), 0);
  const v = catSum + targetPct(settings.planFree.giorgi, T) + targetPct(settings.planFree.nino, T);
  return Math.round(v * 10) / 10;
}

// ---- Number formatting (German-style: space thousands, comma decimals) ----

export function formatMoney(value, currency, decimals = 2) {
  const n = Number(value) || 0;
  const parts = Math.abs(n).toFixed(decimals).split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = n < 0 && Math.abs(n) >= 0.5 * Math.pow(10, -decimals) ? '-' : '';
  const symbol = currency === 'GEL' ? '₾' : '€';
  return parts[1] !== undefined ? `${sign}${intPart},${parts[1]} ${symbol}` : `${sign}${intPart} ${symbol}`;
}

export function formatPercent(value, decimals = 1) {
  const n = Number(value) || 0;
  return n.toFixed(decimals).replace('.', ',') + '%';
}

export function parseAmountInput(str, decimals = 2) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const normalized = String(str).trim().replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(normalized);
  const f = Math.pow(10, decimals);
  return isNaN(n) ? 0 : Math.round(n * f) / f;
}

// ---- Self-checks (run once from app.js in dev / console) ----
export function runSelfChecks() {
  const results = [];
  const assertClose = (name, actual, expected, tol = 0.01) => {
    const pass = Math.abs(actual - expected) <= tol;
    results.push({ name, pass, actual, expected });
  };
  const assertEq = (name, actual, expected) => {
    const pass = actual === expected;
    results.push({ name, pass, actual, expected });
  };

  // GEL -> EUR conversion: 500 GEL at rate 2.99 => 167.22...
  assertClose('gelToEur(500, 2.99)', gelToEur(500, 2.99), 167.2241, 0.01);

  // Cycle due-month math: monthly template (cycleMonths=1) due every month from first due.
  assertEq('cycle monthly always due', isTemplateDueInMonth({ cycleMonths: 1, firstDueDate: '2026-08-01', oneTime: false }, '2026-09'), true);

  // Quarterly: first due 2026-08, due in 2026-08 and 2026-11, not 09/10.
  const q = { cycleMonths: 3, firstDueDate: '2026-08-01', oneTime: false };
  assertEq('quarterly due 2026-08', isTemplateDueInMonth(q, '2026-08'), true);
  assertEq('quarterly not due 2026-09', isTemplateDueInMonth(q, '2026-09'), false);
  assertEq('quarterly not due 2026-10', isTemplateDueInMonth(q, '2026-10'), false);
  assertEq('quarterly due 2026-11', isTemplateDueInMonth(q, '2026-11'), true);
  assertEq('before first due', isTemplateDueInMonth(q, '2026-07'), false);

  // One-time only in its own month.
  const ot = { cycleMonths: 1, firstDueDate: '2026-08-15', oneTime: true };
  assertEq('oneTime due in its month', isTemplateDueInMonth(ot, '2026-08'), true);
  assertEq('oneTime not due next month', isTemplateDueInMonth(ot, '2026-09'), false);

  // Dashboard math with the unified category model.
  const settings = {
    planFree: { giorgi: { percent: 5, color: '#7c3aed' }, nino: { percent: 5, color: '#db2777' } }
  };
  const categories = [
    { id: 'cat_essentials', name: 'ess', percent: 65, color: '#2563eb', goalType: 'max', georgiaTransfer: false, parentId: null },
    { id: 'cat_georgia', name: 'geo', percent: 0, color: '#d97706', goalType: 'max', georgiaTransfer: true, parentId: 'cat_essentials' },
    { id: 'cat_savings', name: 'sav', percent: 25, color: '#16a34a', goalType: 'min', georgiaTransfer: false, parentId: null },
    { id: 'cat_other', name: 'oth', percent: 0, color: '#94a3b8', goalType: 'max', georgiaTransfer: false, parentId: FREE_BUCKET_ID }
  ];
  const month = {
    exchangeRate: 3, income: { giorgi: 1000, nino: 0 }, plannedSavings: null,
    transactions: [
      { id: 't1', categoryId: 'cat_essentials', owner: 'shared', currency: 'EUR', amountPlanned: 650, amountActual: 650, paid: true },
      { id: 't2', categoryId: 'cat_essentials', toGeorgia: true, owner: 'giorgi', currency: 'GEL', amountPlanned: 300, amountActual: null, paid: false }
    ]
  };
  assertEq('sumAllPercents == 100', sumAllPercents(settings, categories), 100);
  assertEq('georgia rolls up into essentials', topIdOf(categories, 'cat_georgia'), 'cat_essentials');
  assertEq('free category resolves to free', topIdOf(categories, 'cat_other'), FREE_BUCKET_ID);
  const dash = computeDashboard(month, categories, settings);
  const essentialsBucket = dash.buckets.find(b => b.id === 'cat_essentials');
  assertClose('essentials actual == 650', essentialsBucket.actual, 650, 0.01);
  assertClose('essentials planned includes georgia child (650+100)', essentialsBucket.planned, 750, 0.01);
  assertClose('georgia info plannedEur == 100 (300/3)', dash.georgia.plannedEur, 100, 0.01);
  assertEq('georgia info plannedGel == 300', dash.georgia.plannedGel, 300);
  const pva = computePlanVsActual(month, categories, settings);
  const essentialsRow = pva.find(r => r.key === 'cat_essentials');
  assertClose('plan-vs-actual essentials % == 65 (650/1000)', essentialsRow.actual, 65, 0.1);
  assertEq('plan-vs-actual essentials at target -> ok', essentialsRow.ok, true);

  // Month totals: planned = 650 + 300/3 = 750; paid = 650; unpaid = 100 (1 txn).
  const totals = computeMonthTotals(month);
  assertClose('totals planned == 750', totals.planned, 750, 0.01);
  assertClose('totals paid == 650', totals.paid, 650, 0.01);
  assertClose('totals unpaid == 100', totals.unpaid, 100, 0.01);
  assertEq('totals unpaidCount == 1', totals.unpaidCount, 1);

  // Year overview: savings-category payments count as "saved", others as "spent".
  const yo = computeYearOverview({ '2026-08': { ...month, transactions: [
    ...month.transactions,
    { id: 't3', categoryId: 'cat_savings', owner: 'shared', currency: 'EUR', amountPlanned: 200, amountActual: 200, paid: true }
  ] } }, categories, 2026);
  assertEq('year overview rows == 1', yo.rows.length, 1);
  assertClose('year overview spent == 650', yo.rows[0].spent, 650, 0.01);
  assertClose('year overview saved == 200', yo.rows[0].saved, 200, 0.01);
  assertClose('year overview leftover == 150', yo.rows[0].leftover, 150, 0.01);
  assertEq('formatMoney 0 decimals', formatMoney(1234.6, 'EUR', 0), '1 235 €');

  // Envelope: 1000 planned, 340 spent -> paid 340, remaining 660; closed -> remaining 0.
  const env = { id: 'e', categoryId: 'cat_essentials', currency: 'EUR', amountPlanned: 1000, kind: 'envelope', spends: [{ amount: 300 }, { amount: 40 }], paid: false, account: 'shared' };
  assertClose('envelope paid == 340', txnPaidEur(env, 3), 340);
  assertClose('envelope remaining == 660', txnRemainingEur(env, 3), 660);
  assertClose('closed envelope remaining == 0', txnRemainingEur({ ...env, paid: true }, 3), 0);

  // Salary split: G 3000, N 1000 (75/25). Bills: rent 1200 shared + loan 400 from Giorgi's account.
  const sm = { exchangeRate: 3, income: { giorgi: 3000, nino: 1000 }, transactions: [
    { id: 'r', categoryId: 'cat_essentials', currency: 'EUR', amountPlanned: 1200, paid: false, account: 'shared' },
    { id: 'l', categoryId: 'cat_essentials', currency: 'EUR', amountPlanned: 400, paid: false, account: 'giorgi' }
  ] };
  const split = computeSalarySplit(sm, categories, { ...settings, contributionBasis: 'actual' }, { mode: 'proportional' });
  assertClose('split giorgi essentials 1200 (75% of 1600)', split.persons.giorgi.essentials, 1200);
  assertClose('split giorgi keeps 400 for own debits', split.persons.giorgi.keepForDebits, 400);
  assertClose('split giorgi to shared 800', split.persons.giorgi.toShared, 800);
  assertClose('split nino to shared 400', split.persons.nino.toShared, 400);
  assertClose('split savings giorgi 750 (25% of 4000 * 75%)', split.persons.giorgi.savings, 750);
  assertClose('shared account needs 1200', split.sharedNeeds, 1200);
  // Classic 50/50, everything to the shared account: 1600/2 = 800 each; 400 goes back to Giorgi.
  const half = computeSalarySplit(sm, categories, { ...settings, contributionBasis: 'actual' }, { keepDebits: false });
  // 50/50 keeping own-account debits: 800 each; Giorgi keeps 400 for his loan -> 400 to shared, Nino 800.
  const keep = computeSalarySplit(sm, categories, { ...settings, contributionBasis: 'actual' });
  assertClose('50/50 keep: giorgi to shared 400', keep.persons.giorgi.toShared, 400);
  assertClose('50/50 keep: nino to shared 800', keep.persons.nino.toShared, 800);
  assertClose('50/50 keep: giorgi keeps 400', keep.persons.giorgi.keepForDebits, 400);
  // A savings category owned by one person (e.g. investment = Nino's): Nino funds all of it.
  const invest = [...categories.map(c => c.id === 'cat_savings' ? { ...c, owner: 'nino' } : c)];
  const inv = computeSalarySplit(sm, invest, { ...settings, contributionBasis: 'actual' });
  assertClose('owner=nino: nino saves all 1000', inv.persons.nino.savings, 1000);
  assertClose('owner=nino: giorgi saves 0', inv.persons.giorgi.savings, 0);
  // € target + sub-category with its own owner: savings block (giorgi) 300 € + child (nino) 200 €.
  const cats2 = [
    { id: 'e', name: 'e', percent: 0, goalType: 'max', parentId: null, owner: 'shared' },
    { id: 'sg', name: 'sg', targetType: 'amount', amount: 300, percent: 0, goalType: 'min', parentId: null, owner: 'giorgi' },
    { id: 'sn', name: 'sn', targetType: 'amount', amount: 200, percent: 0, goalType: 'min', parentId: 'sg', owner: 'nino' }
  ];
  const m2 = { exchangeRate: 3, income: { giorgi: 2000, nino: 2000 }, transactions: [] };
  const d2 = computeDashboard(m2, cats2, settings);
  assertClose('savings block planned = targets even without txns (500)', d2.buckets.find(b => b.id === 'sg').planned, 500);
  assertClose('savings block target % = 12.5', d2.buckets.find(b => b.id === 'sg').targetPercent, 12.5);
  const s2 = computeSalarySplit(m2, cats2, settings);
  assertClose('child owner counts: giorgi saves 300', s2.persons.giorgi.savings, 300);
  assertClose('child owner counts: nino saves 200', s2.persons.nino.savings, 200);
  assertClose('remaining includes savings to transfer (500)', computeRemaining(m2, cats2, settings).savings, 500);
  assertClose('sumAllPercents with € targets', sumAllPercents({ planFree: { giorgi: { percent: 5 }, nino: { targetType: 'amount', amount: 400 } } }, cats2, 4000), 27.5);
  // Extra bought from the food envelope is not counted twice.
  const env2 = { id: 'food', categoryId: 'cat_essentials', currency: 'EUR', amountPlanned: 1000, kind: 'envelope', spends: [{ amount: 600 }], paid: false };
  const ex = { id: 'x', kind: 'extra', fromEnvelope: 'food', categoryId: 'cat_essentials', currency: 'EUR', amountPlanned: 50, amountActual: 50, paid: true };
  const tot2 = computeMonthTotals({ exchangeRate: 3, income: { giorgi: 0, nino: 0 }, transactions: [env2, ex] });
  assertClose('extra from envelope counted once as paid (600 + 50)', tot2.paid, 650);
  assertClose('extra lowers what is left in the envelope (1000 - 650)', tot2.unpaid, 350);
  assertClose('envelopeUsed = spends + extras', envelopeUsed(env2, [env2, ex], 3), 650);
  // Due card: unpaid savings template is NOT a bill; envelope rest is not a bill either.
  const remB = computeRemaining({ exchangeRate: 3, income: { giorgi: 2000, nino: 2000 }, transactions: [
    { id: 'b1', categoryId: 'cat_essentials', currency: 'EUR', amountPlanned: 130, paid: false, account: 'nino' },
    { id: 's1', categoryId: 'cat_savings', currency: 'EUR', amountPlanned: 263, paid: false, account: 'giorgi' }, env2, ex
  ] }, categories, settings);
  assertClose('due bills exclude savings + envelopes (130)', remB.bills, 130);
  assertClose('due bills by account: nino 130', remB.billsByAccount.nino, 130);
  assertClose('envelope rest 350 kept apart', remB.envelopes, 350);
  // Month overview: bills vs budgets apart, savings not an expense, income = costs + savings + free.
  const mo = computeMonthOverview({ exchangeRate: 3, income: { giorgi: 2000, nino: 2000 }, transactions: [
    { id: 'b1', categoryId: 'cat_essentials', currency: 'EUR', amountPlanned: 130, amountActual: 130, paid: true, account: 'nino' },
    { id: 's1', categoryId: 'cat_savings', currency: 'EUR', amountPlanned: 263, paid: false, account: 'giorgi' }, env2, ex
  ] }, categories, settings);
  assertClose('overview bills planned 130 (no savings)', mo.bills.planned, 130);
  assertClose('overview budgets used 650 of 1000', mo.budgets.used, 650);
  assertClose('overview costs 1130 = 565 each', mo.giorgi.costs, 565);
  assertClose('overview income = costs + savings + free', mo.total.costs + mo.total.savings + mo.total.free, 4000);
  // Period overview: an opened but unused month (income copied, nothing paid) is not listed.
  const ro = computeRangeOverview({ '2026-01': { exchangeRate: 3, income: { giorgi: 1000, nino: 0 }, transactions: [] },
    '2026-02': { exchangeRate: 3, income: { giorgi: 1000, nino: 0 }, transactions: [{ id: 'p', categoryId: 'cat_essentials', currency: 'EUR', amountPlanned: 10, amountActual: 10, paid: true }] } },
  categories, '2026-01', '2026-12', null, '2026-10');
  assertEq('period overview skips unused months', ro.rows.map(r => r.key).join(), '2026-02');
  assertClose('50/50 full: giorgi to shared 800', half.persons.giorgi.toShared, 800);
  assertClose('50/50 full: nino to shared 800', half.persons.nino.toShared, 800);
  assertClose('50/50 full: 400 back to giorgi', half.persons.giorgi.backFromShared, 400);
  assertClose('50/50 full: savings 500 each', half.persons.nino.savings, 500);
  const rem = computeRemaining({ ...sm, transactions: [...sm.transactions, env] });
  assertClose('remaining total 1600 + 660', rem.total, 2260);
  assertClose('remaining giorgi account 400', rem.byAccount.giorgi, 400);
  assertEq('card order inserts due after summary', effectiveCardOrder({ dashboardCardOrder: ['summary', 'income'] }, categories).indexOf('due'), 1);
  assertEq('savings blocks are inside the savings card, not cards of their own', effectiveCardOrder({ dashboardCardOrder: ['cat_savings', 'georgia'] }, categories).includes('cat_savings'), false);
  const so = computeSavingsOverview({ exchangeRate: 3, income: { giorgi: 2000, nino: 2000 }, transactions: [] }, [
    { id: 'sg', name: 'x (მოკლევადიანი)', targetType: 'amount', amount: 300, goalType: 'min', parentId: null, owner: 'giorgi' },
    { id: 'sl', name: 'y', term: 'long', targetType: 'amount', amount: 200, goalType: 'min', parentId: 'sg', owner: 'nino' }
  ]);
  assertClose('savings card: short 300, long 200, total 500', so.short.planned * 1000 + so.long.planned + so.total.planned / 1000, 300 * 1000 + 200 + 0.5);
  assertEq('formatMoney negative', formatMoney(-12.5, 'EUR'), '-12,50 €');

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass);
  console.log(`[calc self-check] ${passed}/${results.length} passed`);
  if (failed.length) console.error('[calc self-check] FAILURES:', failed);
  return results;
}

function isTemplateDueInMonth(tpl, monthKeyStr) {
  const [ty, tm] = tpl.firstDueDate.slice(0, 7).split('-').map(Number);
  const [my, mm] = monthKeyStr.split('-').map(Number);
  const firstIdx = ty * 12 + (tm - 1);
  const curIdx = my * 12 + (mm - 1);
  if (curIdx < firstIdx) return false;
  if (tpl.oneTime) return curIdx === firstIdx;
  const cycle = tpl.cycleMonths || 1;
  return (curIdx - firstIdx) % cycle === 0;
}

export { isTemplateDueInMonth, FREE_BUCKET_ID };
