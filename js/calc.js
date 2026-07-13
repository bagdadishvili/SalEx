// calc.js — all money math: currency conversion, dashboard aggregates, plan-vs-actual.
// Pure functions only (no DOM, no state mutation) so they're easy to self-check and unit-test.

const FREE_BUCKET_ID = 'free';

/** GEL -> EUR at a given rate (rate = GEL per 1 EUR). */
export function gelToEur(amountGel, rate) {
  if (!rate || rate <= 0) return 0;
  return amountGel / rate;
}

/** Amount of a transaction expressed in EUR, respecting frozen rateAtPayment for paid GEL txns. */
export function txnAmountEur(txn, monthRate) {
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
    .filter(t => topIdOf(categories, t.categoryId) === topId && (!paidOnly || t.paid))
    .reduce((s, t) => s + (paidOnly ? txnAmountEur(t, month.exchangeRate) : txnPlannedEur(t, month.exchangeRate)), 0);
}

/** Sum paid EUR within free-spending categories, restricted to one owner. */
function sumFreeByOwner(month, categories, owner, usePaidActual) {
  return month.transactions
    .filter(t => topIdOf(categories, t.categoryId) === FREE_BUCKET_ID && t.owner === owner)
    .reduce((sum, t) => {
      if (usePaidActual) return t.paid ? sum + txnAmountEur(t, month.exchangeRate) : sum;
      return sum + txnPlannedEur(t, month.exchangeRate);
    }, 0);
}

/**
 * The dashboard card order actually rendered: stored order, cleaned of stale ids,
 * with any new top-level categories inserted before the free-money card.
 */
export function effectiveCardOrder(settings, categories) {
  const fixed = ['summary', 'income', 'rate', 'georgia', 'free', 'planVsActual'];
  const topIds = categories.filter(c => !c.parentId).map(c => c.id);
  const stored = Array.isArray(settings.dashboardCardOrder) ? settings.dashboardCardOrder : [];
  const order = stored.filter(k => fixed.includes(k) || topIds.includes(k));
  fixed.forEach(k => { if (!order.includes(k)) order.push(k); });
  topIds.forEach(id => {
    if (!order.includes(id)) {
      const i = order.indexOf('free');
      order.splice(i >= 0 ? i : order.length, 0, id);
    }
  });
  return order;
}

/** Sum of transactions flagged as Georgia-transfer categories (independent of where they're counted). */
function sumGeorgiaTransfer(month, categories) {
  const geoIds = new Set(categories.filter(c => c.georgiaTransfer).map(c => c.id));
  const txns = month.transactions.filter(t => geoIds.has(t.categoryId));
  const plannedGel = txns.filter(t => t.currency === 'GEL').reduce((s, t) => s + t.amountPlanned, 0);
  const plannedEur = txns.reduce((s, t) => s + txnPlannedEur(t, month.exchangeRate), 0);
  const actualEur = txns.filter(t => t.paid).reduce((s, t) => s + txnAmountEur(t, month.exchangeRate), 0);
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
    if (t.paid) {
      paid += txnAmountEur(t, month.exchangeRate);
    } else {
      unpaid += txnPlannedEur(t, month.exchangeRate);
      unpaidCount += 1;
    }
  });
  return { planned, paid, unpaid, unpaidCount, count: month.transactions.length };
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

export function formatMoney(value, currency) {
  const n = Number(value) || 0;
  const parts = Math.abs(n).toFixed(2).split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = n < 0 ? '-' : '';
  const symbol = currency === 'GEL' ? '₾' : '€';
  return `${sign}${intPart},${parts[1]} ${symbol}`;
}

export function formatPercent(value, decimals = 1) {
  const n = Number(value) || 0;
  return n.toFixed(decimals).replace('.', ',') + '%';
}

export function parseAmountInput(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const normalized = String(str).trim().replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
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
      { id: 't2', categoryId: 'cat_georgia', owner: 'giorgi', currency: 'GEL', amountPlanned: 300, amountActual: null, paid: false }
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
