// views/dash/savings.js — the one 💰 savings card (v17) and "💸 დანაზოგიდან დავხარჯე" (v18).

import { updateState } from '../../state.js';
import { computeSavingsOverview, formatMoney, parseAmountInput, savingsCategories, FREE_BUCKET_ID } from '../../calc.js';
import { spendFromSavings } from '../../actions.js';
import { el, openModal, toast, undoToast } from '../../ui.js';
import { tx, personTag } from '../../texts.js';
import { expanded, markDone } from './shared.js';
import { categoryCard } from './blocks.js';

/**
 * 💰 One card for all savings: each saving (whose, short/long term) with plan and what is
 * transferred, totals for short-term, long-term and all. Tap → the separate savings cards with
 * "✓ გადავრიცხე" open below it; tap again → they fold away.
 */
export function savingsCard(ctx) {
  const { dash, categories, rerender } = ctx;
  const blocks = dash.buckets.filter(b => b.goalType === 'min');
  if (!blocks.length) return [];
  const so = computeSavingsOverview(ctx.month, categories, ctx.state.months, ctx.key);
  const open = expanded.has('savings');
  const card = el('div', { class: 'card stat-card stat-card--wide savings-card card--expandable' });
  card.appendChild(el('div', { class: 'stat-card__label', ...tx('card.savings') }));
  card.appendChild(el('div', { class: 'stat-card__value tabular-nums', text: formatMoney(so.total.planned, 'EUR') }));
  const m0 = (v) => formatMoney(v, 'EUR', 0);
  const TERM = { short: 'მოკლევადიანი', long: 'გრძელვადიანი' };
  const list = el('div', { class: 'savings-list' });
  so.items.forEach(r => {
    const done = r.open <= 0.5;
    list.appendChild(el('div', { class: 'savings-item' + (done ? ' savings-item--done' : '') }, [
      el('span', { class: 'savings-item__icon', text: done ? '✓' : '⏳' }),
      el('div', { class: 'savings-item__main' }, [
        el('div', { class: 'savings-item__name', text: r.name }),
        el('div', { class: 'detail-row__meta', text: [personTag(r.owner), TERM[r.term],
          r.withdrawn > 0.004 ? `💸 დაიხარჯა ${m0(r.withdrawn)}` : '',
          r.balance !== null ? `ნაშთი სულ ${m0(r.balance)}` : ''].filter(Boolean).join(' · ') })
      ]),
      el('div', { class: 'savings-item__amount tabular-nums', text: `${m0(r.done)} / ${m0(r.planned)}` })
    ]));
  });
  card.appendChild(list);
  // money taken OUT of savings for an expense — one step, no editing of the transfer
  const spendBtn = el('button', { type: 'button', class: 'btn btn--secondary btn--sm', text: '💸 დანაზოგიდან დავხარჯე' });
  spendBtn.addEventListener('click', (e) => { e.stopPropagation(); openSpendFromSavingsDialog(ctx); });
  card.appendChild(el('div', { class: 'btn-row savings-card__actions' }, [spendBtn]));
  const totals = el('table', { class: 'split-table savings-totals tabular-nums' });
  const anyOut = so.total.withdrawn > 0.004;
  totals.appendChild(el('thead', {}, [el('tr', {}, [el('th', { text: '' }), el('th', { text: 'გეგმა' }), el('th', { text: 'გადარიცხული' }), anyOut ? el('th', { text: 'დაიხარჯა' }) : null].filter(Boolean))]));
  const row = (label, x, cls = '') => el('tr', { class: cls }, [el('th', { scope: 'row', text: label }), el('td', { text: m0(x.planned) }), el('td', { text: m0(x.done) }), anyOut ? el('td', { text: x.withdrawn > 0.004 ? `−${m0(x.withdrawn)}` : '—' }) : null].filter(Boolean));
  totals.appendChild(el('tbody', {}, [
    so.short.planned > 0.004 ? row('მოკლევადიანი', so.short) : null,
    so.long.planned > 0.004 ? row('გრძელვადიანი', so.long) : null,
    row('სულ ორივემ', so.total, 'savings-totals__all')
  ].filter(Boolean)));
  card.appendChild(totals);
  const toggle = () => { if (expanded.has('savings')) expanded.delete('savings'); else expanded.add('savings'); rerender(); };
  const btn = el('button', { type: 'button', class: 'card-expand', 'aria-expanded': String(open), text: open ? '▲ დაკეცვა' : `▼ ${blocks.length} ბარათი — გადარიცხვა / რედაქტირება` });
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  card.addEventListener('click', (e) => {
    if (document.body.classList.contains('text-edit-mode')) return;
    if (e.target.closest('button, input, select, a, label')) return;
    toggle();
  });
  card.appendChild(btn);
  if (so.items.length && so.items.every(r => r.open <= 0.5)) markDone(card, 'ყველაფერი გადარიცხულია');
  if (!open) return card;
  const subCards = blocks.map(b => { const c = categoryCard(b, ctx); c.classList.add('savings-sub'); return c; });
  return [card, ...subCards];
}

/**
 * "💸 დანაზოგიდან დავხარჯე": an expense paid with saved money. Recorded as a paid expense in the
 * chosen category and subtracted from that saving's balance — the month's transfer stays as it was.
 */
export function openSpendFromSavingsDialog(ctx) {
  const { key, categories, rerender, state } = ctx;
  const savs = savingsCategories(categories);
  if (!savs.length) { toast('დანაზოგის კატეგორია არ არის', 'error'); return; }
  const balances = computeSavingsOverview(ctx.month, categories, state.months, key).items;
  const form = el('form', {});
  form.appendChild(el('p', { class: 'card__sub', text: 'ხარჯი ჩაიწერება გადახდილად და დააკლდება არჩეული დანაზოგის ნაშთს. ამ თვის გადარიცხვა უცვლელი რჩება.' }));
  const from = el('select', {}, savs.map(c => {
    const b = balances.find(x => x.id === c.id);
    return el('option', { value: c.id, text: `${c.name} · ${personTag(c.owner || 'shared')}${b && b.balance !== null ? ` (ნაშთი ${formatMoney(b.balance, 'EUR', 0)})` : ''}` });
  }));
  const name = el('input', { type: 'text', placeholder: 'რაში (მაგ. მანქანის შეკეთება)', maxlength: '80' });
  const amount = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00' });
  const spendCats = categories.filter(c => !savs.some(s => s.id === c.id));
  const cat = el('select', {}, spendCats.map(c => el('option', { value: c.id, text: `${c.parentId && c.parentId !== FREE_BUCKET_ID ? '↳ ' : ''}${c.name}` })));
  const ess = spendCats.find(c => c.id === 'cat_essentials') || spendCats[0];
  if (ess) cat.value = ess.id;
  form.append(
    el('div', { class: 'field' }, [el('label', { text: 'რომელი დანაზოგიდან' }), from]),
    el('div', { class: 'field' }, [el('label', { text: 'რაში დაიხარჯა' }), name]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', { text: 'თანხა (€)' }), amount]),
      el('div', { class: 'field' }, [el('label', { text: 'ხარჯის კატეგორია' }), cat])
    ])
  );
  form.appendChild(el('div', { class: 'btn-row' }, [el('button', { class: 'btn btn--primary', type: 'submit', text: '✓ ჩაწერა' })]));
  const { close } = openModal(form, { title: '💸 დანაზოგიდან ხარჯი' });
  setTimeout(() => name.focus(), 50);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let msg = '';
    let newId = null;
    try {
      updateState(d => {
        msg = spendFromSavings(d, key, { savingsCategoryId: from.value, amount: parseAmountInput(amount.value), name: name.value.trim() || 'დანაზოგიდან ხარჯი', categoryId: cat.value });
        newId = d.months[key].transactions[d.months[key].transactions.length - 1].id;
        return d;
      });
    } catch (err) { toast(err.message, 'error'); return; }
    close();
    undoToast(msg, () => {
      updateState(d => { d.months[key].transactions = d.months[key].transactions.filter(t => t.id !== newId); return d; });
      rerender();
    });
    rerender();
  });
}
