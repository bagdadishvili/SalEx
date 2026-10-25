// prepare.js — "📅 თვის მომზადება": one clear screen that shows EXACTLY what goes into a
// month before anything is created: salaries + rate, every template due that month
// (grouped, with checkboxes and this-month amounts), what does NOT come this month and
// why, and the totals / who transfers what. One button creates it all.

import { getState, updateState } from './state.js';
import { planMonth, applyMonthPreparation, initMonth, txnFromTemplate, monthIsPrepared } from './monthEngine.js';
import { computeSalarySplit, txnPlannedEur, formatMoney, parseAmountInput, ACCOUNT_LABELS } from './calc.js';
import { el, openModal, toast } from './ui.js';
import { monthLabelFull, monthLabel, shiftMonthKey, setSelectedMonth } from './monthNav.js';
import { fetchEurGelRate } from './rates.js';
import { TEMPLATE_GROUPS, PAYER_LABELS, groupOfTemplate } from './components.js';

const CYCLE_TXT = { 2: '2 თვეში ერთხელ', 3: '3 თვეში ერთხელ', 6: '6 თვეში ერთხელ', 12: 'წელიწადში ერთხელ' };
const GROUPS = TEMPLATE_GROUPS;
const ACC_SHORT = PAYER_LABELS;
const groupOf = (state, tpl) => groupOfTemplate(state.categories, tpl);

const fmtInput = (v, d = 2) => (Number(v) || 0).toFixed(d).replace('.', ',');

/** Short description used by the dashboard banner: how many templates, roughly how much. */
export function preparationPreview(state, key) {
  const tmp = JSON.parse(JSON.stringify(state));
  const base = initMonth(tmp, key);
  const { due } = planMonth(state, key);
  const items = due.filter(d => !d.existing && !d.skipped);
  const total = items.reduce((s, d) => s + txnPlannedEur(txnFromTemplate(d.tpl, key), base.exchangeRate), 0);
  return { count: items.length, total, prepared: monthIsPrepared(state, key) };
}

export function openPrepareWizard(initialKey, onDone = () => {}) {
  let key = initialKey;
  const body = el('div', { class: 'prep' });
  const { close, modal } = openModal(body, { title: '📅 თვის მომზადება' });
  modal.classList.add('modal--wide');
  render();

  function render() {
    const state = getState();
    const tmp = JSON.parse(JSON.stringify(state));
    const base = initMonth(tmp, key); // existing month, or a new one with last month's income/rate
    const plan = planMonth(state, key);
    const prepared = monthIsPrepared(state, key);

    // ---- wizard state ----
    const income = { giorgi: base.income?.giorgi || 0, nino: base.income?.nino || 0 };
    let rate = base.exchangeRate || 3;
    let rateSource = null; // set when the user fetches or types a rate
    const rows = plan.due.map(d => ({
      tpl: d.tpl,
      existing: d.existing,
      include: d.existing ? true : !d.skipped,
      amount: d.existing ? d.existing.amountPlanned : d.tpl.amount,
      group: groupOf(state, d.tpl)
    }));

    body.innerHTML = '';

    // Month switcher
    const prev = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'წინა თვე', text: '◀' });
    const next = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'შემდეგი თვე', text: '▶' });
    prev.addEventListener('click', () => { key = shiftMonthKey(key, -1); render(); });
    next.addEventListener('click', () => { key = shiftMonthKey(key, 1); render(); });
    body.appendChild(el('div', { class: 'prep__month' }, [prev, el('strong', { text: monthLabelFull(key) }), next]));
    body.appendChild(el('p', {
      class: 'prep__intro',
      text: prepared
        ? '✓ ეს თვე უკვე მომზადებულია. აქ შეგიძლია დაამატო ის, რაც მაშინ გამოტოვე, ან შეცვალო ხელფასი/კურსი. უკვე შექმნილი ხარჯები არ შეიცვლება.'
        : 'ჯერ არაფერი შექმნილა. ქვემოთ ხედავ ზუსტად რა შევა ამ თვეში — მოხსენი ის, რაც ამ თვეში არ გინდა, ან შეცვალე თანხა (მხოლოდ ამ თვისთვის; შაბლონი უცვლელი რჩება). ბოლოს — „შექმნა".'
    }));

    // Step 1 — income & rate
    const step1 = el('section', { class: 'prep__step' }, [el('h3', { text: '1. ხელფასები და კურსი' })]);
    const gIn = el('input', { type: 'text', inputmode: 'decimal', value: fmtInput(income.giorgi) });
    const nIn = el('input', { type: 'text', inputmode: 'decimal', value: fmtInput(income.nino) });
    const rIn = el('input', { type: 'text', inputmode: 'decimal', value: fmtInput(rate, 4) });
    [gIn, nIn, rIn].forEach(i => i.addEventListener('focus', () => i.select()));
    gIn.addEventListener('input', () => { income.giorgi = parseAmountInput(gIn.value); update(); });
    nIn.addEventListener('input', () => { income.nino = parseAmountInput(nIn.value); update(); });
    rIn.addEventListener('input', () => {
      rate = parseAmountInput(rIn.value, 4);
      rateSource = { kind: 'manual', source: 'ხელით', at: new Date().toISOString() };
      update();
    });
    const bankBtn = el('button', { type: 'button', class: 'btn btn--secondary btn--sm', text: '🏦 საქ. ბანკი' });
    bankBtn.addEventListener('click', async () => {
      bankBtn.disabled = true;
      try {
        const r = await fetchEurGelRate();
        rate = r.rate;
        rIn.value = fmtInput(r.rate, 4);
        rateSource = { kind: r.kind, source: r.source, at: r.at, sell: r.sell || null };
        toast(`${r.source}: ${fmtInput(r.rate, 4)}`);
        update();
      } catch (e) { toast(e.message, 'error'); }
      bankBtn.disabled = false;
    });
    step1.appendChild(el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', { text: 'გიორგი (€)' }), gIn]),
      el('div', { class: 'field' }, [el('label', { text: 'ნინო (€)' }), nIn])
    ]));
    step1.appendChild(el('div', { class: 'field' }, [
      el('label', { text: 'კურსი 1 € = ? ₾ (ლარის ხარჯების ევროში დასათვლელად)' }),
      el('div', { class: 'prep__rate' }, [rIn, bankBtn])
    ]));
    step1.appendChild(el('div', { class: 'card__sub', text: 'შევსებულია წინა თვიდან — შეცვალე, თუ ხელფასი სხვაა.' }));
    body.appendChild(step1);

    // Step 2 — expenses
    const step2 = el('section', { class: 'prep__step' }, [el('h3', { text: '2. რა ხარჯები შედის ამ თვეში' })]);
    if (!rows.length) {
      step2.appendChild(el('div', { class: 'empty-state', text: state.templates.length ? 'ამ თვეში არცერთი შაბლონი არ მოდის.' : 'შაბლონები ჯერ არ გაქვს — „შაბლონები" გვერდზე „📋 ოჯახის შაბლონების დამატება".' }));
    }
    const groupTotals = {};
    GROUPS.forEach(([g, title]) => {
      const list = rows.filter(r => r.group === g);
      if (!list.length) return;
      const totalEl = el('span', { class: 'prep__group-total tabular-nums' });
      groupTotals[g] = totalEl;
      const toggle = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: 'ყველა' });
      const box = el('div', { class: 'prep__group' }, [
        el('div', { class: 'prep__group-head' }, [el('strong', { text: title }), totalEl, toggle])
      ]);
      const checks = [];
      list.forEach(r => {
        const cb = el('input', { type: 'checkbox', 'aria-label': r.tpl.name });
        cb.checked = r.include;
        if (r.existing) cb.disabled = true;
        checks.push([cb, r]);
        const amountIn = el('input', { type: 'text', inputmode: 'decimal', class: 'prep__amount tabular-nums', value: fmtInput(r.amount), 'aria-label': `${r.tpl.name} — თანხა ამ თვეში` });
        if (r.existing) amountIn.disabled = true;
        const eurEl = el('span', { class: 'prep__eur tabular-nums' });
        r.eurEl = eurEl;
        const meta = [
          el('span', { class: 'chip chip--account', text: `👤 ${ACC_SHORT[r.tpl.account || 'shared']}` }),
          r.tpl.toGeorgia ? el('span', { class: 'chip chip--georgia-flag', text: '📤' }) : null,
          r.tpl.cycleMonths > 1 && !r.tpl.oneTime ? el('span', { class: 'chip', text: `🔁 ${CYCLE_TXT[r.tpl.cycleMonths] || r.tpl.cycleMonths + ' თვეში ერთხელ'}` }) : null,
          r.tpl.oneTime ? el('span', { class: 'chip', text: 'ერთჯერადი' }) : null,
          r.tpl.type === 'variable' ? el('span', { class: 'chip', text: 'ცვლადი' }) : null,
          r.existing ? el('span', { class: 'chip chip--ok', text: r.existing.paid ? '✓ გადახდილია' : '✓ უკვე თვეშია' }) : null
        ];
        const row = el('label', { class: 'prep__row' + (r.include ? '' : ' prep__row--off') }, [
          cb,
          el('span', { class: 'prep__name' }, [el('span', { text: r.tpl.name }), el('span', { class: 'prep__meta' }, meta)]),
          el('span', { class: 'prep__money' }, [amountIn, el('span', { class: 'prep__cur', text: r.tpl.currency === 'GEL' ? '₾' : '€' }), eurEl])
        ]);
        cb.addEventListener('change', () => { r.include = cb.checked; row.classList.toggle('prep__row--off', !cb.checked); update(); });
        amountIn.addEventListener('input', () => { r.amount = parseAmountInput(amountIn.value); update(); });
        amountIn.addEventListener('focus', () => amountIn.select());
        box.appendChild(row);
      });
      toggle.addEventListener('click', () => {
        const editable = checks.filter(([cb]) => !cb.disabled);
        const allOn = editable.every(([cb]) => cb.checked);
        editable.forEach(([cb, r]) => { cb.checked = !allOn; r.include = !allOn; cb.closest('.prep__row').classList.toggle('prep__row--off', allOn); });
        update();
      });
      step2.appendChild(box);
    });
    body.appendChild(step2);

    // Step 3 — not this month
    if (plan.notDue.length || plan.inactive.length) {
      const items = [
        ...plan.notDue.map(({ tpl, next }) => `${tpl.name} — ${next ? `შემდეგი: ${monthLabel(next)}` : 'აღარ მოდის'}`),
        ...plan.inactive.map(({ tpl }) => `${tpl.name} — გამორთულია`)
      ];
      body.appendChild(el('details', { class: 'prep__step help-details' }, [
        el('summary', { text: `⏭ ამ თვეში არ მოდის (${items.length})` }),
        el('ul', { class: 'starter-list' }, items.map(t => el('li', { text: t })))
      ]));
    }

    // Footer — totals & who transfers what
    const footer = el('div', { class: 'prep__footer' });
    const totalsEl = el('div', { class: 'prep__totals tabular-nums' });
    const splitEl = el('div', { class: 'prep__split tabular-nums' });
    const splitDetails = el('details', { class: 'prep__split-details' }, [el('summary', { text: '💸 ვინ რამდენი გადარიცხოს' }), splitEl]);
    const createBtn = el('button', { type: 'button', class: 'btn btn--primary prep__create' });
    footer.append(totalsEl, splitDetails, createBtn);
    body.appendChild(footer);

    function previewMonth() {
      const txns = rows.filter(r => r.include).map(r => r.existing || { ...txnFromTemplate(r.tpl, key), amountPlanned: r.amount });
      const manual = (state.months[key]?.transactions || []).filter(t => !t.templateId);
      return { exchangeRate: rate > 0 ? rate : base.exchangeRate, income: { ...income }, transactions: [...txns, ...manual] };
    }

    function update() {
      const pm = previewMonth();
      rows.forEach(r => {
        r.eurEl.textContent = r.tpl.currency === 'GEL' && pm.exchangeRate > 0 ? `≈ ${formatMoney(r.amount / pm.exchangeRate, 'EUR', 0)}` : '';
      });
      GROUPS.forEach(([g]) => {
        if (!groupTotals[g]) return;
        const sum = rows.filter(r => r.group === g && r.include)
          .reduce((s, r) => s + txnPlannedEur(r.existing || { ...txnFromTemplate(r.tpl, key), amountPlanned: r.amount }, pm.exchangeRate), 0);
        groupTotals[g].textContent = formatMoney(sum, 'EUR', 0);
      });
      const byAcc = { shared: 0, giorgi: 0, nino: 0 };
      let total = 0;
      pm.transactions.forEach(t => {
        const eur = txnPlannedEur(t, pm.exchangeRate);
        total += eur;
        byAcc[ACCOUNT_LABELS[t.account] ? t.account : 'shared'] += eur;
      });
      const newCount = rows.filter(r => r.include && !r.existing).length;
      const inc = income.giorgi + income.nino;
      totalsEl.innerHTML = '';
      totalsEl.append(
        el('div', { class: 'prep__total-main' }, [el('span', { text: 'თვის ხარჯი სულ' }), el('strong', { text: formatMoney(total, 'EUR', 0) })]),
        el('div', { class: 'card__sub', text: `იხდის: საერთო ${formatMoney(byAcc.shared, 'EUR', 0)} · გიორგი ${formatMoney(byAcc.giorgi, 'EUR', 0)} · ნინო ${formatMoney(byAcc.nino, 'EUR', 0)}${inc > 0 ? ` · ${Math.round((total / inc) * 100)}% შემოსავლის` : ''}` })
      );
      splitEl.innerHTML = '';
      splitDetails.hidden = !(inc > 0);
      if (inc > 0) {
        const sp = computeSalarySplit(pm, state.categories, state.settings);
        [['giorgi', 'გიორგი'], ['nino', 'ნინო']].forEach(([p, name]) => {
          const x = sp.persons[p];
          splitEl.appendChild(el('div', { class: 'prep__person' }, [
            el('strong', { text: name }),
            el('span', { text: `➡️ საერთოზე ${formatMoney(x.toShared, 'EUR', 0)}` }),
            x.keepForDebits > 0.5 ? el('span', { text: `🏠 დატოვე ${formatMoney(x.keepForDebits, 'EUR', 0)}` }) : null,
            el('span', { text: `💰 დანაზოგზე ${formatMoney(x.savings, 'EUR', 0)}` }),
            el('span', { class: x.free < -0.5 ? 'text-danger' : '', text: `🛍 თავისუფალი ${formatMoney(x.free, 'EUR', 0)}` })
          ]));
        });
      }
      createBtn.textContent = prepared
        ? (newCount ? `✓ დამატება (${newCount}) და შენახვა` : '✓ შენახვა')
        : `✓ ${monthLabel(key)} — შექმნა (${newCount} ხარჯი)`;
      createBtn.disabled = !(rate > 0);
    }

    createBtn.addEventListener('click', () => {
      let added = 0;
      updateState(d => {
        added = applyMonthPreparation(d, key, {
          income,
          rate,
          rateSource,
          items: rows.map(r => ({ tplId: r.tpl.id, include: r.include, amount: r.amount }))
        });
        return d;
      });
      setSelectedMonth(key);
      toast(added ? `${monthLabel(key)} მზადაა ✓ — დაემატა ${added} ხარჯი` : `${monthLabel(key)} შენახულია ✓`);
      close();
      onDone(key);
    });

    update();
  }
}
