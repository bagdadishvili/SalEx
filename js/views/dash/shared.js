// views/dash/shared.js — pieces every dashboard card uses: inline number field, progress bar,
// the compact stat card, the green "done" look, and "tap a card → its entries open below".

import { formatMoney, parseAmountInput, isEnvelope, envelopeUsed, txnAmountEur, txnPlannedEur, isTwoStep } from '../../calc.js';
import { el, formatDate } from '../../ui.js';
import { tx, personTag } from '../../texts.js';
import { payButton, openTransactionForm } from '../transactions.js';
import { navigate } from '../../app.js';

/** Which expandable cards are open (kept while the app runs, so a redraw keeps them open). */
export const expanded = new Set();

export function inlineNumberField(value, onCommit, decimals = 2) {
  const fmt = (v) => (v ?? 0).toFixed(decimals).replace('.', ',');
  const input = el('input', { class: 'inline-edit tabular-nums', type: 'text', inputmode: 'decimal', value: fmt(value) });
  input.addEventListener('focus', () => input.select());
  const commit = () => {
    const parsed = parseAmountInput(input.value, decimals);
    if (parsed < 0) { input.value = fmt(value); return; }
    if (Math.abs(parsed - (value ?? 0)) < 0.005) return; // unchanged — no save/toast spam
    onCommit(parsed);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  return input;
}

export function progressBar(pct, color) {
  const bar = el('div', { class: 'progress progress--compact' });
  const fill = el('div', { class: 'progress__fill', style: `width:${Math.max(0, Math.min(100, pct))}%` });
  if (color) fill.style.background = color;
  bar.appendChild(fill);
  return bar;
}

export function statCard({ label, labelKey, value, sub, pct, color, accentBorder = true, wide = false }) {
  const card = el('div', {
    class: 'card stat-card' + (wide ? ' stat-card--wide' : ''),
    style: accentBorder && color ? `border-left:4px solid ${color}` : ''
  });
  card.appendChild(el('div', { class: 'stat-card__label', ...(labelKey ? tx(labelKey) : { text: label }) }));
  card.appendChild(el('div', { class: 'stat-card__value tabular-nums', text: value }));
  if (sub) card.appendChild(el('div', { class: 'stat-card__sub', text: sub }));
  if (pct !== undefined) card.appendChild(progressBar(pct, color));
  return card;
}

/** Paid-in-full look: green frame + "✓ …" line, so a done card is seen at a glance. */
export function markDone(card, text) {
  card.classList.add('card--done');
  card.style.borderLeft = '';
  // below the title + amount line, so the two stay on one line
  const anchor = card.querySelector(':scope > .stat-card__value') || card.querySelector(':scope > .stat-card__label');
  card.insertBefore(el('div', { class: 'done-badge', text: `✓ ${text}` }), anchor ? anchor.nextSibling : card.firstChild);
  return card;
}

/**
 * One entry inside an opened card. Layout (CSS grid): the name always gets the full first line
 * next to the amount; who/date and the buttons go below — so two buttons ("⇄ გადატანა",
 * "○ ჩამოჭრა") never squeeze the name. Wide cards put everything on one line.
 */
export function detailRow(tr, ctx) {
  const { month, key, categories, rerender } = ctx;
  const cur = tr.currency;
  const env = isEnvelope(tr);
  const two = isTwoStep(tr, categories);
  const shown = tr.paid ? (tr.amountActual ?? tr.amountPlanned) : tr.amountPlanned;
  const meta = [personTag(tr.account)];
  if (tr.dueDate && !env) meta.push(formatDate(tr.dueDate).slice(0, 5));
  if (env) meta.push(`დახარჯულია ${formatMoney(envelopeUsed(tr, month.transactions, month.exchangeRate), cur, 0)}`);
  if (two && !tr.paid && tr.transferredAt) meta.push(`⇄ გადატანილია ${formatDate(tr.transferredAt).slice(0, 5)}`);
  const editBtn = el('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': `${tr.name} — რედაქტირება`, text: '✎' });
  editBtn.addEventListener('click', (e) => { e.stopPropagation(); openTransactionForm(tr, key, rerender); });
  return el('div', { class: 'detail-row' + (tr.paid ? ' detail-row--paid' : '') + (two ? ' detail-row--two' : '') }, [
    el('div', { class: 'detail-row__name', text: tr.name }),
    el('div', { class: 'detail-row__amount tabular-nums' }, [
      el('div', { text: formatMoney(shown, cur) }),
      cur === 'GEL' ? el('div', { class: 'detail-row__sub', text: `≈ ${formatMoney(txnAmountEur(tr, month.exchangeRate) || txnPlannedEur(tr, month.exchangeRate), 'EUR', 0)}` }) : null
    ]),
    el('div', { class: 'detail-row__meta', text: meta.join(' · ') }),
    el('div', { class: 'detail-row__acts' }, [payButton(tr, month, rerender), editBtn])
  ]);
}

/**
 * Makes a card expandable: a tap on the card (or "▼ N ხარჯი") shows all its entries under it,
 * each with its pay button(s) and ✎ edit, plus "+ ახალი ხარჯი აქ".
 */
export function attachDetails(card, id, ctx, filterFn, preset = null) {
  const { month, key, rerender } = ctx;
  const txns = month.transactions.filter(filterFn)
    .sort((a, b) => (a.paid - b.paid) || (a.dueDate || '').localeCompare(b.dueDate || ''));
  const open = expanded.has(id);
  card.classList.add('card--expandable');
  const toggle = () => { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); rerender(); };
  const btn = el('button', { type: 'button', class: 'card-expand', 'aria-expanded': String(open), text: open ? '▲ დამალვა' : `▼ ${txns.length} ხარჯი — ნახვა / რედაქტირება` });
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  card.addEventListener('click', (e) => {
    if (document.body.classList.contains('text-edit-mode')) return;
    if (e.target.closest('button, input, select, a, label, .card-details')) return;
    toggle();
  });
  card.appendChild(btn);
  if (!open) return card;

  const box = el('div', { class: 'card-details' });
  if (!txns.length) box.appendChild(el('div', { class: 'card__sub', text: 'ამ თვეში ჩანაწერი არ არის.' }));
  txns.forEach(tr => box.appendChild(detailRow(tr, ctx)));
  const actions = el('div', { class: 'btn-row card-details__actions' });
  if (preset) {
    const add = el('button', { type: 'button', class: 'btn btn--secondary btn--sm', text: '+ ახალი ხარჯი აქ' });
    add.addEventListener('click', (e) => { e.stopPropagation(); openTransactionForm(null, key, rerender, preset); });
    actions.appendChild(add);
  }
  const all = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: 'ყველა ტრანზაქცია →' });
  all.addEventListener('click', (e) => { e.stopPropagation(); navigate('transactions'); });
  actions.appendChild(all);
  box.appendChild(actions);
  card.appendChild(box);
  return card;
}
