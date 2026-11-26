// views/dash/top.js — month overview, income and exchange-rate cards (+ automatic rate refresh).

import { getState, updateState, budgetMonthKey, salaryStart } from '../../state.js';
import { computeMonthOverview, formatMoney } from '../../calc.js';
import { el, savedToast, toast, formatDate } from '../../ui.js';
import { tx, personName } from '../../texts.js';
import { fetchEurGelRate, fetchFreshRateNow, getRatesToken } from '../../rates.js';
import { inlineNumberField, progressBar, cardHead } from './shared.js';

const AUTO_RATE_EVERY_MS = 30 * 60 * 1000;
let lastAutoRateTry = 0;
let rateWait = 0; // when the on-demand rate request started (0 = none running)

/** Rate value to write for a month (GEL per 1 €), with where it came from. */
function rateSourceFrom(r) {
  return { kind: r.kind, source: r.source, at: r.at, sell: r.sell || null };
}

/**
 * Keeps the CURRENT/FUTURE month's rate fresh from Bank of Georgia (buy rate), unless the
 * user typed a rate by hand for that month. Past months are never touched.
 */
export async function autoRefreshRate(key, rerender) {
  const s = getState();
  const m = s.months[key];
  if (!s.settings.rateAuto || !m || key < budgetMonthKey()) return;
  if (m.rateSource && m.rateSource.kind === 'manual') return;
  if (Date.now() - lastAutoRateTry < AUTO_RATE_EVERY_MS) return;
  lastAutoRateTry = Date.now();
  try {
    const r = await fetchEurGelRate();
    if (r.kind !== 'bog') return; // automatic updates only from the bank, never the official rate
    const fresh = getState().months[key];
    if (!fresh || (fresh.rateSource && fresh.rateSource.kind === 'manual')) return;
    if (Math.abs((fresh.exchangeRate || 0) - r.rate) < 0.00005 && fresh.rateSource && fresh.rateSource.at === r.at) return;
    updateState(d => { d.months[key].exchangeRate = r.rate; d.months[key].rateSource = rateSourceFrom(r); return d; });
    rerender();
  } catch { /* offline — keep the current rate */ }
}

/**
 * Month overview: fixed payments (paid / to pay) and food-fuel budgets (spent / planned) apart,
 * then where the income goes — costs, savings, free money — in total and per person.
 */
export function summaryCard({ month, categories, settings }) {
  const o = computeMonthOverview(month, categories, settings);
  const card = el('div', { class: 'card stat-card stat-card--wide summary-card' });
  const { head, box } = cardHead(tx('card.summary'), 'ხარჯები = გადასახადები + ყოველდღიური ბიუჯეტი (საერთო ხარჯი იყოფა 50/50). დანაზოგი ხარჯში არ ითვლება.');
  card.append(head, box);

  const progressLine = (labelKey, done, planned, doneWord) => {
    const pct = planned > 0 ? Math.min(100, (done / planned) * 100) : 0;
    const pctText = planned > 0 ? `${Math.round((done / planned) * 100)}%` : '0%';
    return el('div', { class: 'summary-line' }, [
      el('div', { class: 'summary-line__top' }, [
        el('span', { class: 'summary-line__label', ...tx(labelKey) }),
        el('span', { class: 'summary-line__right tabular-nums' }, [
          el('span', { class: 'summary-line__value', text: `${formatMoney(done, 'EUR', 0)} / ${formatMoney(planned, 'EUR', 0)}` }),
          el('span', { class: 'summary-line__pct', text: pctText })
        ])
      ]),
      progressBar(pct, done > planned + 0.5 ? 'var(--danger)' : undefined),
      el('div', { class: 'stat-card__sub tabular-nums', text: `${doneWord}: ${formatMoney(done, 'EUR')} · დარჩა: ${formatMoney(Math.max(0, planned - done), 'EUR')}` })
    ]);
  };
  card.appendChild(progressLine('summary.bills', o.bills.paid, o.bills.planned, 'გადახდილი'));
  if (o.budgets.planned > 0.004) card.appendChild(progressLine('summary.budgets', o.budgets.used, o.budgets.planned, 'დახარჯული'));
  if (o.fromSavings > 0.004) card.appendChild(el('div', { class: 'stat-card__sub tabular-nums', text: `💸 დანაზოგიდან დახარჯული: ${formatMoney(o.fromSavings, 'EUR')} (ხელფასის გეგმაში არ შედის)` }));

  const m0 = (v) => formatMoney(v, 'EUR', 0);
  const table = el('table', { class: 'split-table summary-table tabular-nums' });
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { text: '' }), el('th', tx('summary.total')), el('th', tx('person.giorgi')), el('th', tx('person.nino'))
  ])]));
  const row = (labelKey, k, cls = '') => el('tr', { class: cls }, [
    el('th', { scope: 'row', ...tx(labelKey) }),
    ...[o.total, o.giorgi, o.nino].map((p, i) => el('td', { class: (i === 0 ? 'summary-table__total' : '') + (p[k] < -0.5 ? ' text-danger' : ''), text: m0(p[k]) }))
  ]);
  table.appendChild(el('tbody', {}, [
    row('summary.income', 'income', 'split-table__income'),
    row('summary.costs', 'costs'),
    row('summary.savings', 'savings'),
    row('summary.free', 'free', 'summary-table__free')
  ]));
  card.appendChild(table);
  return card;
}

export function incomeCard({ month, key, rerender }) {
  const card = el('div', { class: 'card stat-card stat-card--wide' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.income') }));
  const row = el('div', { class: 'field-row', style: 'margin:2px 0' });
  ['giorgi', 'nino'].forEach(p => {
    row.appendChild(el('div', { class: 'field', style: 'margin-bottom:0' }, [
      el('label', { text: personName(p) }),
      inlineNumberField(month.income[p], (v) => {
        updateState(draft => { draft.months[key].income[p] = v; return draft; });
        savedToast();
        rerender();
      })
    ]));
  });
  card.appendChild(row);
  card.appendChild(el('div', { class: 'stat-card__sub tabular-nums', text: `ჯამი: ${formatMoney(month.income.giorgi + month.income.nino, 'EUR')}` }));
  // v20: the day THIS month's salary arrived — every month can have its own date
  const s = getState();
  if ((Number(s.settings.salaryDay) || 0) > 0 || month.salaryDate) {
    const date = el('input', { type: 'date', class: 'salary-date', value: salaryStart(key), 'aria-label': 'ამ თვის ხელფასის ჩარიცხვის დღე' });
    date.addEventListener('change', () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) return;
      updateState(d => { d.months[key].salaryDate = date.value; return d; });
      toast('შენახულია ✓ — მხოლოდ ამ თვისთვის');
      rerender();
    });
    card.appendChild(el('label', { class: 'salary-date-row' }, [
      el('span', { class: 'stat-card__sub', text: '💶 ამ თვის ხელფასი ჩაირიცხა:' }), date
    ]));
  }
  return card;
}

export function rateCard({ month, key, rerender }) {
  const card = el('div', { class: 'card stat-card' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.rate') }));
  const row = el('div', { class: 'rate-row' });
  row.appendChild(inlineNumberField(month.exchangeRate, (v) => {
    if (v <= 0) return;
    updateState(draft => {
      draft.months[key].exchangeRate = v;
      draft.months[key].rateSource = { kind: 'manual', source: 'ხელით', at: new Date().toISOString() };
      return draft;
    });
    savedToast();
    rerender();
  }, 4));
  const fetchBtn = el('button', { class: 'icon-btn icon-btn--sm rate-btn', type: 'button', 'aria-label': 'საქართველოს ბანკის კურსის ჩამოტვირთვა', title: 'საქართველოს ბანკის ყიდვის კურსი', text: '🏦' });
  // A request may still be running from before a redraw — show it on the new button too.
  const showWait = () => {
    if (!rateWait) return;
    fetchBtn.disabled = true;
    fetchBtn.textContent = `⏳ ${Math.round((Date.now() - rateWait) / 1000)}წ`;
  };
  showWait();
  const ticker = setInterval(() => { if (!fetchBtn.isConnected || !rateWait) { clearInterval(ticker); return; } showWait(); }, 1000);
  fetchBtn.addEventListener('click', async () => {
    if (rateWait) return;
    fetchBtn.disabled = true;
    try {
      let r = null;
      if (getRatesToken()) {
        // Ask GitHub to fetch the bank rate right now and wait for it (usually 20–60 s).
        toast('🏦 ბანკიდან ახალი კურსის მოთხოვნა… (~1 წუთი)');
        rateWait = Date.now();
        showWait();
        try { r = await fetchFreshRateNow(); } finally { rateWait = 0; }
        if (!r) toast('ახალი კურსი ჯერ არ მოვიდა — ვიყენებ ბოლოს მიღებულს', 'error');
      }
      if (!r) r = await fetchEurGelRate();
      const ageMin = r.at ? (Date.now() - new Date(r.at).getTime()) / 60000 : 0;
      if (!getRatesToken() && ageMin > 20) {
        toast(`ბანკის კურსი ${new Date(r.at).toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit', hour12: false })}-ისაა. „ახლავე" განახლება: პარამეტრები → კურსი`, 'error');
      }
      updateState(draft => {
        draft.months[key].exchangeRate = r.rate;
        draft.months[key].rateSource = rateSourceFrom(r);
        return draft;
      });
      toast(`${r.source}: ${String(r.rate).replace('.', ',')} ₾${r.stale ? ' (ძველი მონაცემი!)' : ''} ✓`, r.kind === 'bog' && !r.stale ? 'ok' : 'error');
      rerender();
    } catch (e) {
      toast(e.message, 'error');
      rerender();
    }
  });
  row.appendChild(fetchBtn);
  card.appendChild(row);
  const src = month.rateSource;
  let text = '🏦 = საქართველოს ბანკი, ყიდვის კურსი (ევროს ლარში გადაცვლა)';
  if (src && src.kind === 'bog') {
    const at = src.at ? new Date(src.at) : null;
    text = `საქ. ბანკი · ყიდვა${src.sell ? ` (გაყიდვა ${String(src.sell).replace('.', ',')})` : ''}${at ? ` · ${formatDate(src.at.slice(0, 10))} ${at.toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}`;
  } else if (src && src.kind === 'official') text = 'ოფიციალური (NBG) — ბანკის კურსი ვერ ჩაიტვირთა';
  else if (src && src.kind === 'manual') text = 'ხელით ჩაწერილი · 🏦 დააბრუნებს ავტომატურ კურსს';
  card.appendChild(el('div', { class: 'stat-card__sub', text }));
  return card;
}
