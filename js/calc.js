// calc.js — all money math: currency conversion, dashboard aggregates, plan-vs-actual.
// Pure functions only (no DOM, no state mutation) so they're easy to self-check and unit-test.

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

function categoryBucketMap(categories) {
  const map = {};
  categories.forEach(c => { map[c.id] = c.bucket; });
  return map;
}

/** Sum of planned amounts (EUR) for transactions whose category is in `bucket`. */
export function sumPlannedByBucket(month, categories, bucket) {
  const bucketMap = categoryBucketMap(categories);
  return month.transactions
    .filter(t => bucketMap[t.categoryId] === bucket)
    .reduce((sum, t) => sum + txnPlannedEur(t, month.exchangeRate), 0);
}

/** Sum of actual amounts (EUR) for PAID transactions whose category is in `bucket`. */
export function sumActualByBucket(month, categories, bucket) {
  const bucketMap = categoryBucketMap(categories);
  return month.transactions
    .filter(t => bucketMap[t.categoryId] === bucket && t.paid)
    .reduce((sum, t) => sum + txnAmountEur(t, month.exchangeRate), 0);
}

/** Sum planned/actual EUR for a bucket, restricted to a given owner. */
export function sumByBucketAndOwner(month, categories, bucket, owner, usePaidActual = true) {
  const bucketMap = categoryBucketMap(categories);
  return month.transactions
    .filter(t => bucketMap[t.categoryId] === bucket && t.owner === owner)
    .reduce((sum, t) => {
      if (usePaidActual && t.paid) return sum + txnAmountEur(t, month.exchangeRate);
      if (!usePaidActual) return sum + txnPlannedEur(t, month.exchangeRate);
      return sum;
    }, 0);
}

export function totalIncome(month) {
  return (month.income?.giorgi || 0) + (month.income?.nino || 0);
}

/** Full dashboard aggregate for a month, per spec §4.3. */
export function computeDashboard(month, categories, settings) {
  const T = totalIncome(month);
  const essentialsPlanned = sumPlannedByBucket(month, categories, 'essentials');
  const essentialsActual = sumActualByBucket(month, categories, 'essentials');
  const georgiaPlannedEur = sumPlannedByBucket(month, categories, 'georgia');
  const georgiaActualEur = sumActualByBucket(month, categories, 'georgia');
  const georgiaPlannedGel = month.transactions
    .filter(t => categoryBucketMap(categories)[t.categoryId] === 'georgia' && t.currency === 'GEL')
    .reduce((s, t) => s + t.amountPlanned, 0);

  const plannedSavings = month.plannedSavings != null
    ? month.plannedSavings
    : T * (settings.planPercents.savings / 100);

  const freeTotal = T - essentialsPlanned - georgiaPlannedEur - plannedSavings;

  const { freeGiorgi, freeNino } = settings.planPercents;
  const freeShareDenom = (freeGiorgi + freeNino) || 1;
  const freeGiorgiShare = freeTotal * (freeGiorgi / freeShareDenom);
  const freeNinoShare = freeTotal * (freeNino / freeShareDenom);

  const freeSpentGiorgi = sumByBucketAndOwner(month, categories, 'free', 'giorgi', true);
  const freeSpentNino = sumByBucketAndOwner(month, categories, 'free', 'nino', true);

  const allPaidActuals = ['essentials', 'georgia', 'free']
    .reduce((sum, bucket) => sum + sumActualByBucket(month, categories, bucket), 0);
  const actualSavings = T - allPaidActuals;

  const pct = (x) => T > 0 ? Math.round((x / T) * 1000) / 10 : 0;

  return {
    totalIncome: T,
    essentials: { planned: essentialsPlanned, actual: essentialsActual, pct: pct(essentialsPlanned) },
    georgia: {
      plannedEur: georgiaPlannedEur,
      actualEur: georgiaActualEur,
      plannedGel: georgiaPlannedGel,
      pct: pct(georgiaPlannedEur)
    },
    savings: { planned: plannedSavings, actual: actualSavings, pct: pct(plannedSavings) },
    free: {
      total: freeTotal,
      giorgi: { share: freeGiorgiShare, spent: freeSpentGiorgi, remaining: freeGiorgiShare - freeSpentGiorgi, pct: pct(freeGiorgiShare) },
      nino: { share: freeNinoShare, spent: freeSpentNino, remaining: freeNinoShare - freeSpentNino, pct: pct(freeNinoShare) }
    }
  };
}

/** Plan-vs-actual rows for the 5 buckets, per spec §4.4. */
export function computePlanVsActual(month, categories, settings) {
  const T = totalIncome(month);
  const d = computeDashboard(month, categories, settings);
  const pct = (x) => T > 0 ? (x / T) * 100 : 0;

  const rows = [
    { key: 'essentials', label: 'აუცილებელი', target: settings.planPercents.essentials, actual: pct(d.essentials.actual), isExpense: true },
    { key: 'georgia', label: 'საქართველო', target: settings.planPercents.georgia, actual: pct(d.georgia.actualEur), isExpense: true },
    { key: 'savings', label: 'დანაზოგი', target: settings.planPercents.savings, actual: pct(d.savings.actual), isExpense: false },
    { key: 'freeGiorgi', label: 'თავისუფალი (გიორგი)', target: settings.planPercents.freeGiorgi, actual: pct(d.free.giorgi.spent), isExpense: true },
    { key: 'freeNino', label: 'თავისუფალი (ნინო)', target: settings.planPercents.freeNino, actual: pct(d.free.nino.spent), isExpense: true }
  ];

  return rows.map(r => {
    const delta = r.actual - r.target;
    const ok = r.isExpense ? r.actual <= r.target : r.actual >= r.target;
    return { ...r, delta: Math.round(delta * 10) / 10, ok };
  });
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

  // Before first due month => never due.
  assertEq('before first due', isTemplateDueInMonth(q, '2026-07'), false);

  // One-time only in its own month.
  const ot = { cycleMonths: 1, firstDueDate: '2026-08-15', oneTime: true };
  assertEq('oneTime due in its month', isTemplateDueInMonth(ot, '2026-08'), true);
  assertEq('oneTime not due next month', isTemplateDueInMonth(ot, '2026-09'), false);

  // Plan-vs-actual percentage math sanity: 100 income, 45 essentials actual => 45%.
  const month = {
    exchangeRate: 3, income: { giorgi: 100, nino: 0 }, plannedSavings: null,
    transactions: [{ id: 't1', categoryId: 'cat_essentials', owner: 'shared', currency: 'EUR', amountPlanned: 45, amountActual: 45, paid: true }]
  };
  const categories = [
    { id: 'cat_essentials', bucket: 'essentials' },
    { id: 'cat_georgia', bucket: 'georgia' },
    { id: 'cat_other', bucket: 'free' }
  ];
  const settings = { planPercents: { essentials: 45, georgia: 20, savings: 25, freeGiorgi: 5, freeNino: 5 } };
  const pva = computePlanVsActual(month, categories, settings);
  const essentialsRow = pva.find(r => r.key === 'essentials');
  assertClose('plan-vs-actual essentials %', essentialsRow.actual, 45, 0.1);
  assertEq('plan-vs-actual essentials ok (at target)', essentialsRow.ok, true);

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass);
  console.log(`[calc self-check] ${passed}/${results.length} passed`);
  if (failed.length) console.error('[calc self-check] FAILURES:', failed);
  return results;
}

// Imported lazily to avoid circular import issues at module init time in some bundlers;
// re-exported here so runSelfChecks can use it without importing monthEngine.js (kept pure/local copy).
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

export { isTemplateDueInMonth };
