// starterPack.js — add many templates at once from a template FILE.
// No personal names or amounts live in this (public) code: the family's real list is kept
// in a private JSON file outside the uploaded app folder and picked in the app once.
//
// File format:
// { "format": "family-budget-templates", "version": 1, "templates": [
//   { "name": "…", "amount": 100, "currency": "EUR"|"GEL",
//     "category": "essentials" | "savings" | "other" | "georgia" (= essentials + 📤) | <category id>,
//     "toGeorgia": true|false  (📤 money sent to Georgia — works with any category),
//     "account": "shared"|"giorgi"|"nino"  (who pays / from whose account),
//     "type": "fixed"|"variable"|"envelope", "cycleMonths": 1, "firstDueDate": "YYYY-MM-DD" } ] }

const DE = 'cat_essentials';
const CATEGORY_ALIASES = { essentials: DE, georgia: DE, savings: 'cat_savings', other: 'cat_other' };
const OK_ACC = ['shared', 'giorgi', 'nino'];
const OK_TYPE = ['fixed', 'variable', 'envelope'];

/** Validates a parsed template file; returns a clean list or throws a Georgian message. */
export function parseTemplatePack(obj) {
  const list = obj && Array.isArray(obj.templates) ? obj.templates : Array.isArray(obj) ? obj : null;
  if (!list) throw new Error('ფაილი ვერ ამოვიცანი — სჭირდება შაბლონების სია („templates").');
  const out = [];
  list.forEach(t => {
    const name = String(t.name || '').trim();
    const amount = Number(t.amount);
    if (!name || !(amount > 0)) return;
    out.push({
      name,
      amount,
      currency: t.currency === 'GEL' ? 'GEL' : 'EUR',
      category: CATEGORY_ALIASES[t.category] || t.category || DE,
      toGeorgia: !!t.toGeorgia || t.category === 'georgia',
      account: OK_ACC.includes(t.account) ? t.account : 'shared',
      type: OK_TYPE.includes(t.type) ? t.type : 'fixed',
      cycleMonths: [1, 2, 3, 6, 12].includes(Number(t.cycleMonths)) ? Number(t.cycleMonths) : 1,
      firstDueDate: /^\d{4}-\d{2}-\d{2}$/.test(t.firstDueDate || '') ? t.firstDueDate : null
    });
  });
  if (!out.length) throw new Error('ფაილში სწორი შაბლონი ვერ მოიძებნა.');
  return out;
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Makes sure the default "essentials" category exists (recreates it if it was deleted). */
function ensureCategories(draft) {
  if (!draft.categories.some(c => c.id === DE)) {
    draft.categories.unshift({ id: DE, name: 'აუცილებელი', percent: 65, color: '#2563eb', goalType: 'max', georgiaTransfer: false, parentId: null });
  }
}

/** Adds the templates from `list` that are missing (by name). Returns how many were added. */
export function addStarterTemplates(draft, startMonthKey, list) {
  ensureCategories(draft);
  const have = new Set(draft.templates.map(t => t.name));
  const catIds = new Set(draft.categories.map(c => c.id));
  let added = 0;
  (list || []).forEach(t => {
    if (have.has(t.name)) return;
    draft.templates.push({
      id: uid('tpl'),
      name: t.name,
      categoryId: catIds.has(t.category) ? t.category : DE,
      type: t.type,
      amount: t.amount,
      currency: t.currency,
      cycleMonths: t.cycleMonths || 1,
      firstDueDate: t.firstDueDate || `${startMonthKey}-01`,
      owner: t.account,
      account: t.account,
      toGeorgia: t.toGeorgia,
      active: true,
      oneTime: false
    });
    have.add(t.name);
    added += 1;
  });
  return added;
}
