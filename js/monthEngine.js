// monthEngine.js — month initialization and template-driven transaction generation.

import { isTemplateDueInMonth } from './calc.js';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Ensures the month exists on `draft` (state draft), copying rate/income from previous month. */
export function initMonth(draft, key) {
  if (!draft.months[key]) {
    const keys = Object.keys(draft.months).sort();
    const prevKey = keys.filter(k => k < key).pop();
    const prev = prevKey ? draft.months[prevKey] : null;
    draft.months[key] = {
      exchangeRate: prev ? prev.exchangeRate : 3.00,
      income: prev ? { ...prev.income } : { giorgi: 0, nino: 0 },
      plannedSavings: null,
      generatedFromTemplates: false,
      transactions: []
    };
  }
  return draft.months[key];
}

/** Compute the due date within `monthKeyStr` for a template, preserving the day-of-month. */
function dueDateForMonth(tpl, monthKeyStr) {
  const day = Number(tpl.firstDueDate.slice(8, 10));
  const [y, m] = monthKeyStr.split('-').map(Number);
  // Clamp day to last day of target month (handles e.g. day 31 in a 30-day month).
  const lastDay = new Date(y, m, 0).getDate();
  const clampedDay = Math.min(day, lastDay);
  return `${monthKeyStr}-${String(clampedDay).padStart(2, '0')}`;
}

/**
 * Generates transactions in draft.months[key] from all active templates due this month.
 * Never duplicates (skips if a transaction with the same templateId already exists).
 * Mutates `draft` in place; call inside state.updateState().
 */
export function generateMonthTransactions(draft, key) {
  const month = initMonth(draft, key);
  const existingTemplateIds = new Set(
    month.transactions.filter(t => t.templateId).map(t => t.templateId)
  );

  draft.templates
    .filter(t => t.active)
    .forEach(tpl => {
      if (existingTemplateIds.has(tpl.id)) return;
      if (!isTemplateDueInMonth(tpl, key)) return;

      month.transactions.push({
        id: uid('txn'),
        templateId: tpl.id,
        name: tpl.name,
        categoryId: tpl.categoryId,
        owner: tpl.owner,
        currency: tpl.currency,
        amountPlanned: tpl.amount,
        amountActual: null,
        paid: false,
        paidAt: null,
        rateAtPayment: null,
        dueDate: dueDateForMonth(tpl, key),
        note: ''
      });
    });

  month.generatedFromTemplates = true;
  return month;
}

/** Navigates to (creates + generates) a month, returns the month key. Use on app load / month nav. */
export function ensureMonthGenerated(draft, key) {
  initMonth(draft, key);
  generateMonthTransactions(draft, key);
  return key;
}

export { uid };
