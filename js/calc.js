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

function categoryMap(categories) {
  const map = {};
  categories.forEach(c => { map[c.id] = c; });
  return map;
}

function sumPlannedByBucket(month, categories, bucketId) {
  const catMap = categoryMap(categories);
  return month.transactions
    .filter(t => catMap[t.categoryId]?.bucketId === bucketId)
    .reduce((sum, t) => sum + txnPlannedEur(t, month.exchangeRate), 0);
}

function sumActualByBucket(month, categories, bucketId) {
  const catMap = categoryMap(categories);
  return month.transactions
    .filter(t => catMap[t.categoryId]?.bucketId === bucketId && t.paid)
    .reduce((sum, t) => sum + txnAmountEur(t, month.exchangeRate), 0);
}

/** Sum planned/actual EUR within the free bucket, restricted to one owner. */
function sumFreeByOwner(month, categories, owner, usePaidActual) {
  const catMap = categoryMap(categories);
  return month.transactions
    .filter(t => catMap[t.categoryId]?.bucketId === FREE_BUCKET_ID && t.owner === owner)
    .reduce((sum, t) => {
      if (usePaidActual) return t.paid ? sum + txnAmountEur(t, month.exchangeRate) : sum;
      return sum + txnPlannedEur(t, month.exchangeRate);
    }, 0);
}

/** Sum of transactions flagged as Georgia-transfer categories (independent of their budget bucket). */
function sumGeorgiaTransfer(month, categories) {
  const catMap = categoryMap(categories);
  const txns = month.transactions.filter(t => catMap[t.categoryId]?.georgiaTransfer);
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

  const buckets = settings.buckets.map(b => {
    const planned = sumPlannedByBucket(month, categories, b.id);
    const actual = sumActualByBucket(month, categories, b.id);
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

/** Sum of all bucket percents + free-money percents; must equal 100 for a valid plan. */
export function sumAllPercents(settings) {
  const bucketSum = settings.buckets.reduce((s, b) => s + (Number(b.percent) || 0), 0);
  return bucketSum + (Number(settings.planFree.giorgi.percent) || 0) + (Number(settings.planFree.nino.percent) || 0);
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

  // Dashboard math with the generic buckets model.
  const settings = {
    buckets: [
      { id: 'bucket_essentials', name: 'აუცილებელი', percent: 65, color: '#2563eb', goalType: 'max' },
      { id: 'bucket_savings', name: 'დანაზოგი', percent: 25, color: '#16a34a', goalType: 'min' }
    ],
    planFree: { giorgi: { percent: 5, color: '#7c3aed' }, nino: { percent: 5, color: '#db2777' } }
  };
  const categories = [
    { id: 'cat_essentials', bucketId: 'bucket_essentials', georgiaTransfer: false },
    { id: 'cat_georgia', bucketId: 'bucket_essentials', georgiaTransfer: true },
    { id: 'cat_other', bucketId: FREE_BUCKET_ID, georgiaTransfer: false }
  ];
  const month = {
    exchangeRate: 3, income: { giorgi: 1000, nino: 0 }, plannedSavings: null,
    transactions: [
      { id: 't1', categoryId: 'cat_essentials', owner: 'shared', currency: 'EUR', amountPlanned: 650, amountActual: 650, paid: true },
      { id: 't2', categoryId: 'cat_georgia', owner: 'giorgi', currency: 'GEL', amountPlanned: 300, amountActual: null, paid: false }
    ]
  };
  assertEq('sumAllPercents == 100', sumAllPercents(settings), 100);
  const dash = computeDashboard(month, categories, settings);
  const essentialsBucket = dash.buckets.find(b => b.id === 'bucket_essentials');
  assertClose('essentials bucket actual == 650', essentialsBucket.actual, 650, 0.01);
  assertClose('georgia info plannedEur == 100 (300/3)', dash.georgia.plannedEur, 100, 0.01);
  assertEq('georgia info plannedGel == 300', dash.georgia.plannedGel, 300);
  const pva = computePlanVsActual(month, categories, settings);
  const essentialsRow = pva.find(r => r.key === 'bucket_essentials');
  assertClose('plan-vs-actual essentials % == 65 (650/1000)', essentialsRow.actual, 65, 0.1);
  assertEq('plan-vs-actual essentials at target -> ok', essentialsRow.ok, true);

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
