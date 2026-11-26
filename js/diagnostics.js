// diagnostics.js — "🩺 შემოწმება" (v18): looks through the data for the kinds of mix-ups the
// family has hit (paid amount ≠ edited plan, plan copied between months, budgets left open…).
// Read-only: it never changes data, it only says what looks wrong and how to fix it.
// level: 'warn' = probably wrong data, 'info' = worth a look, 'bug' = looks like an app error.

import {
  planFor, sumAllPercents, totalIncome, isEnvelope, isExtra, isFromSavings, envelopeUsed,
  categoryPlannedEur, savingsCategories, savingsBalances, formatMoney, resolveTopCategory, FREE_BUCKET_ID
} from './calc.js';

export function runDiagnostics(state, { currentKey = null } = {}) {
  const out = [];
  const add = (level, month, title, fix) => out.push({ level, month, title, fix });
  const cats = state.categories;
  const catIds = new Set(cats.map(c => c.id));
  const savIds = new Set(savingsCategories(cats).map(c => c.id));
  const keys = Object.keys(state.months || {}).sort();
  const m0 = (v) => formatMoney(v, 'EUR', 0);

  keys.forEach(k => {
    const m = state.months[k];
    const txns = m.transactions || [];
    const T = totalIncome(m);
    const { categories: rc, settings: rs } = planFor(m, cats, state.settings);
    const isPast = currentKey && k < currentKey;
    const used = txns.length > 0;

    // 1. Paid amount differs from the plan of a savings entry — the "old amount shown, edited plan ignored" case.
    txns.forEach(t => {
      if (isEnvelope(t) || isExtra(t) || isFromSavings(t)) return;
      if (t.paid && t.amountActual !== null && t.amountActual !== undefined && Math.abs(t.amountActual - t.amountPlanned) > 0.5 && savIds.has(t.categoryId)) {
        add('warn', k, `„${t.name}": გეგმა ${formatMoney(t.amountPlanned, t.currency)}, გადახდილად კი ${formatMoney(t.amountActual, t.currency)} წერია`,
          'სიებში და ჯამებში ჩანს გადახდილი თანხა. თუ დანაზოგიდან ფული დახარჯე, დატოვე რეალური გადარიცხვა და ჩაწერე „💸 დანაზოგიდან დავხარჯე". თუ გადარიცხული თანხა იყო სხვა — ✎ → „გადახდილი თანხა".');
      }
      if (!(Number(t.amountPlanned) >= 0) || (t.amountActual !== null && t.amountActual !== undefined && !(Number(t.amountActual) >= 0))) {
        add('bug', k, `„${t.name}": არასწორი თანხა (${t.amountPlanned} / ${t.amountActual})`, 'გახსენი ✎ და ჩაწერე სწორი თანხა.');
      }
      if (!catIds.has(t.categoryId)) add('warn', k, `„${t.name}": კატეგორია აღარ არსებობს`, 'გახსენი ✎ და აირჩიე კატეგორია.');
    });

    // 2. Same template twice in one month (duplicate).
    const seen = new Map();
    txns.filter(t => t.templateId).forEach(t => seen.set(t.templateId, (seen.get(t.templateId) || 0) + 1));
    seen.forEach((n, tplId) => {
      if (n > 1) {
        const tpl = state.templates.find(x => x.id === tplId);
        add('bug', k, `შაბლონი „${tpl ? tpl.name : tplId}" თვეში ${n}-ჯერ არის`, 'ზედმეტი ჩანაწერი წაშალე „ტრანზაქციებში".');
      }
    });

    // 3. Plan does not add up to 100 % (only for months with income).
    if (T > 0 && used) {
      const sum = sumAllPercents(rs, rc, T);
      if (Math.abs(sum - 100) >= 0.5) {
        add('info', k, `გეგმის ჯამი ${sum.toString().replace('.', ',')} % (უნდა იყოს 100 %, სხვაობა ≈ ${m0(Math.abs(100 - sum) * T / 100)})`,
          '„კატეგორიები" → არჩეული თვე → 📊 გეგმა. ზედმეტი/დანაკლისი ჩვეულებრივ თავისუფალ თანხაზე აისახება.');
      }
    }

    // 4. Spending block target typed by hand, far from this month's real bills → suggest "auto".
    rc.filter(c => !c.parentId && c.goalType !== 'min').forEach(c => {
      const own = categoryPlannedEur(m, c.id);
      if (!used || own <= 0) return;
      const src = cats.find(x => x.id === c.id);
      const cfg = (m.plan && m.plan.cats && m.plan.cats[c.id]) || src;
      if (cfg.targetType === 'auto') return;
      const target = c.targetType === 'percent' ? T * (c.percent || 0) / 100 : Number(c.amount) || 0;
      if (target > 0 && Math.abs(target - own) / own > 0.1 && Math.abs(target - own) > 30) {
        add('info', k, `„${c.name}": გეგმა ${m0(target)}, ამ თვის ხარჯები კი ${m0(own)}`,
          `თუ გეგმა ყოველთვის თვის ხარჯებს უნდა უდრიდეს — „კატეგორიები" → 📊 გეგმა → „${c.name}" → ერთეული „ავტო".`);
      }
    });

    // 5. Budgets (food, fuel…): overspent, or a past month left open with money "remaining".
    txns.filter(isEnvelope).forEach(e => {
      const left = (e.amountPlanned || 0) - envelopeUsed(e, txns, m.exchangeRate);
      if (left < -0.5) add('info', k, `„${e.name}": გადაჭარბებულია ${formatMoney(-left, e.currency, 0)}-ით`, 'თუ სხვა ბიუჯეტიდან დარჩა ფული — „⇄ ნაშთის გადატანა".');
      if (isPast && left > 0.5) {
        add('warn', k, `„${e.name}" (გასული თვე): ჯერ კიდევ „დარჩა ${formatMoney(left, e.currency, 0)}"`,
          'თუ ყველაფერი დაიხარჯა — დეშბორდზე ამ თვეში ✓ („დახარჯულად"); თუ სხვა ბიუჯეტზე წავიდა — „⇄ გადატანა".');
      }
    });

    // 6. Unpaid fixed bills in a past month.
    if (isPast) {
      const open = txns.filter(t => !t.paid && !isEnvelope(t) && !isExtra(t) && !isFromSavings(t));
      if (open.length) {
        add('info', k, `${open.length} გადასახადი გადაუხდელად დარჩა: ${open.slice(0, 3).map(t => t.name).join(', ')}${open.length > 3 ? '…' : ''}`,
          'თუ გადაიხადე — მონიშნე გადახდილად; თუ აღარ მოდის — წაშალე ამ თვიდან.');
      }
    }

    // 7. Income missing in a month that has entries.
    if (used && T <= 0) add('warn', k, 'შემოსავალი ჩაწერილი არ არის', 'დეშბორდი → „შემოსავალი" — ჩაწერე ხელფასები, თორემ % გეგმა 0-ს აჩვენებს.');

    // 8. Spent-from-savings entries pointing at a non-savings category.
    txns.filter(isFromSavings).forEach(t => {
      if (!savIds.has(t.fromSavings)) add('bug', k, `„${t.name}": დანაზოგის კატეგორია ვერ მოიძებნა`, 'წაშალე და ხელახლა ჩაწერე „💸 დანაზოგიდან დავხარჯე"-თი.');
    });
  });

  // 9. Savings balance below zero (more spent from it than was ever transferred).
  if (keys.length) {
    const bal = savingsBalances(state.months, cats, keys[keys.length - 1]);
    Object.entries(bal).forEach(([id, v]) => {
      if (v < -0.5) {
        const c = cats.find(x => x.id === id);
        add('warn', null, `დანაზოგი „${c ? c.name : id}" მინუსშია (${m0(v)})`, 'შეამოწმე, რომელი დანაზოგიდან ჩაწერე ხარჯი, ან ჩაწერე ადრინდელი გადარიცხვები.');
      }
    });
  }

  // 10. Categories whose parent link is broken.
  cats.forEach(c => {
    if (c.parentId && c.parentId !== FREE_BUCKET_ID && !catIds.has(c.parentId)) {
      add('bug', null, `კატეგორია „${c.name}" მიბმულია წაშლილ კატეგორიაზე`, '„კატეგორიები" → ✎ → „სად ჩაითვალოს".');
    }
    void resolveTopCategory;
  });

  return out;
}

/** Plain text of the findings (+ the assistant's notes), to hand to whoever fixes the app. */
export function diagnosticsText(findings, notes = []) {
  const lines = ['ოჯახის ბიუჯეტი — შემოწმების შედეგი', new Date().toISOString(), ''];
  findings.forEach(f => lines.push(`[${f.level}]${f.month ? ` ${f.month}` : ''} ${f.title}\n   → ${f.fix}`));
  if (notes.length) {
    lines.push('', 'AI-ს შენიშვნები (რა უნდა გასწორდეს პროგრამულად):');
    notes.forEach(n => lines.push(`- ${n.at.slice(0, 10)} ${n.title}: ${n.detail}`));
  }
  return lines.join('\n');
}
