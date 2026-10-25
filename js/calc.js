// calc.js — all money math: currency conversion, dashboard aggregates, plan-vs-actual.
// Pure functions only (no DOM, no state mutation) so they're easy to self-check and unit-test.

const FREE_BUCKET_ID = 'free';

/** GEL -> EUR at a given rate (rate = GEL per 1 EUR). */
export function gelToEur(amountGel, rate) {
  if (!rate || rate <= 0) return 0;
  return amountGel / rate;
}

// ---- Envelopes ("ბიუჯეტი": food, fuel…) — a planned amount that is spent gradually ----

export function isEnvelope(txn) {
  return !!txn && txn.kind === 'envelope';
}

/** Sum of the partial spends recorded in an envelope (in the envelope's currency). */
export function envelopeSpent(txn) {
  return (txn.spends || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
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

/** Money still to go out this month (EUR): unpaid bills + what is left in open envelopes. */
export function txnRemainingEur(txn, monthRate) {
  if (isEnvelope(txn)) {
    if (txn.paid) return 0; // envelope closed for the month
    return Math.max(0, toEur((txn.amountPlanned || 0) - envelopeSpent(txn), txn, monthRate));
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
export const FIXED_CARDS = ['summary', 'due', 'envelopes', 'income', 'rate', 'georgia', 'free', 'split', 'planVsActual', 'year'];

export function effectiveCardOrder(settings, categories) {
  const fixed = FIXED_CARDS;
  const topIds = categories.filter(c => !c.parentId).map(c => c.id);
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
      const i = order.indexOf('free');
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

  // One "bucket" per top-level category; child categories' amounts roll up into it.
  const buckets = categories.filter(c => !c.parentId).map(b => {
    const planned = sumByTop(month, categories, b.id, false);
    const actual = sumByTop(month, categories, b.id, true);
    return { ...b, planned, actual, pct: pct(planned) };
  });
  const bucketsPlannedTotal = buckets.reduce((s, b) => s + b.planned, 0);
  const bucketsActualTotal = buckets.reduce((s, b) => s + b.actual, 0);

  const georgia = sumGeorgiaTransfer(month, categories);

  const freeTotal = T - bucketsPlannedTotal;
  const { giorgi: freeGiorgiCfg, nino: freeNinoCfg } = settings.planFree;
  const freeShareDenom = (freeGiorgiCfg.percent + freeNinoCfg.percent) || 1;
  const freeGiorgiShare = freeTotal * (freeGiorgiCfg.percent / freeShareDenom);
  const freeNinoShare = freeTotal * (freeNinoCfg.percent / freeShareDenom);

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
    const rem = txnRemainingEur(t, month.exchangeRate);
    if (rem > 0.004) { unpaid += rem; unpaidCount += 1; }
  });
  return { planned, paid, unpaid, unpaidCount, count: month.transactions.length };
}

export const ACCOUNTS = ['shared', 'giorgi', 'nino'];
// Who pays = from whose bank account the money leaves (also whose free money it reduces).
export const ACCOUNT_LABELS = { shared: 'საერთო', giorgi: 'გიორგი', nino: 'ნინო' };

/**
 * What still has to go out this month, total and per paying account.
 * bills = unpaid regular transactions; envelopes = what is left in open envelopes.
 */
export function computeRemaining(month) {
  const out = { total: 0, bills: 0, envelopes: 0, count: 0, byAccount: { shared: 0, giorgi: 0, nino: 0 }, next: [] };
  month.transactions.forEach(t => {
    const rem = txnRemainingEur(t, month.exchangeRate);
    if (rem <= 0.004) return;
    out.total += rem;
    out.count += 1;
    if (isEnvelope(t)) out.envelopes += rem; else out.bills += rem;
    const acc = ACCOUNTS.includes(t.account) ? t.account : 'shared';
    out.byAccount[acc] += rem;
    if (!isEnvelope(t)) out.next.push(t);
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
export function computeSalarySplit(month, categories, settings) {
  const income = { giorgi: month.income?.giorgi || 0, nino: month.income?.nino || 0 };
  const T = income.giorgi + income.nino;
  const mode = settings.contributionSplit === 'equal' ? 'equal' : 'proportional';
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

  let spend = 0, spendBudget = 0, savings = 0;
  const debits = { shared: 0, giorgi: 0, nino: 0 };
  tops.forEach(c => {
    const budget = T * (Number(c.percent) || 0) / 100;
    const p = plannedBy[c.id];
    if (c.goalType === 'min') {
      savings += Math.max(budget, p.total);
    } else {
      spendBudget += budget;
      spend += basis === 'plan' ? Math.max(budget, p.total) : p.total;
      ACCOUNTS.forEach(a => { debits[a] += p[a]; });
    }
  });
  const spendPlannedTotal = debits.shared + debits.giorgi + debits.nino;

  const persons = {};
  ['giorgi', 'nino'].forEach(p => {
    const essentials = spend * share[p];
    const save = savings * share[p];
    const free = income[p] - essentials - save;
    const freeTarget = T * (Number(settings.planFree?.[p]?.percent) || 0) / 100;
    persons[p] = {
      income: income[p], share: share[p], essentials, savings: save,
      keepForDebits: debits[p], toShared: essentials - debits[p], free, freeTarget
    };
  });
  return {
    totalIncome: T, mode, basis, share,
    spend, spendPlannedTotal, spendBudget, savings, debits,
    spendPct: T > 0 ? (spendPlannedTotal / T) * 100 : 0,
    sharedNeeds: debits.shared + (basis === 'plan' ? Math.max(0, spend - spendPlannedTotal) : 0),
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
  const minTops = new Set(categories.filter(c => !c.parentId && c.goalType === 'min').map(c => c.id));
  const rows = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
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
    rows.push({ key, month: m, income, spent, saved, georgia, leftover: income - spent - saved });
  }
  const totals = rows.reduce((acc, r) => {
    ['income', 'spent', 'saved', 'georgia', 'leftover'].forEach(k => { acc[k] += r[k]; });
    return acc;
  }, { income: 0, spent: 0, saved: 0, georgia: 0, leftover: 0 });
  const n = rows.length || 1;
  const average = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v / n]));
  return { year, rows, totals, average };
}

/** Plan-vs-actual rows: one per user bucket, plus the two free-money person splits. */
export function computePlanVsActual(month, categories, settings) {
  const T = totalIncome(month);
  const pct = (x) => T > 0 ? (x / T) * 100 : 0;
  const dash = computeDashboard(month, categories, settings);

  const rows = dash.buckets.map(b => {
    const actual = pct(b.actual);
    const ok = b.goalType === 'min' ? actual >= b.percent : actual <= b.percent;
    return { key: b.id, label: b.name, color: b.color, target: b.percent, actual, delta: Math.round((actual - b.percent) * 10) / 10, ok };
  });

  const { giorgi: freeGiorgiCfg, nino: freeNinoCfg } = settings.planFree;
  const giorgiActual = pct(dash.free.giorgi.spent);
  const ninoActual = pct(dash.free.nino.spent);
  rows.push({ key: 'freeGiorgi', label: 'თავისუფალი (გიორგი)', color: freeGiorgiCfg.color, target: freeGiorgiCfg.percent, actual: giorgiActual, delta: Math.round((giorgiActual - freeGiorgiCfg.percent) * 10) / 10, ok: giorgiActual <= freeGiorgiCfg.percent });
  rows.push({ key: 'freeNino', label: 'თავისუფალი (ნინო)', color: freeNinoCfg.color, target: freeNinoCfg.percent, actual: ninoActual, delta: Math.round((ninoActual - freeNinoCfg.percent) * 10) / 10, ok: ninoActual <= freeNinoCfg.percent });

  return rows;
}

/** Sum of top-level category percents + free-money percents; must equal 100 for a valid plan. */
export function sumAllPercents(settings, categories) {
  const catSum = categories.filter(c => !c.parentId).reduce((s, c) => s + (Number(c.percent) || 0), 0);
  return catSum + (Number(settings.planFree.giorgi.percent) || 0) + (Number(settings.planFree.nino.percent) || 0);
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
  const split = computeSalarySplit(sm, categories, { ...settings, contributionSplit: 'proportional', contributionBasis: 'actual' });
  assertClose('split giorgi essentials 1200 (75% of 1600)', split.persons.giorgi.essentials, 1200);
  assertClose('split giorgi keeps 400 for own debits', split.persons.giorgi.keepForDebits, 400);
  assertClose('split giorgi to shared 800', split.persons.giorgi.toShared, 800);
  assertClose('split nino to shared 400', split.persons.nino.toShared, 400);
  assertClose('split savings giorgi 750 (25% of 4000 * 75%)', split.persons.giorgi.savings, 750);
  assertClose('shared account needs 1200', split.sharedNeeds, 1200);
  const rem = computeRemaining({ ...sm, transactions: [...sm.transactions, env] });
  assertClose('remaining total 1600 + 660', rem.total, 2260);
  assertClose('remaining giorgi account 400', rem.byAccount.giorgi, 400);
  assertEq('card order inserts due after summary', effectiveCardOrder({ dashboardCardOrder: ['summary', 'income'] }, categories).indexOf('due'), 1);
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
