// views/categories.js — unified category management (v3 model).
// A category IS a dashboard block: it has a percent target, color and goal type.
// It can also be counted inside another category, or as personal free spending.

import { getState, updateState, FREE_BUCKET_ID } from '../state.js';
import { formatPercent, formatMoney, parseAmountInput, targetEur, targetPct, sumAllPercents, totalIncome } from '../calc.js';
import { getSelectedMonth, monthLabel } from '../monthNav.js';
import { el, openModal, confirmDialog, toast } from '../ui.js';
import { personTag } from '../texts.js';
import { pickColor, COLOR_PRESETS, freePseudoCategory, PAYER_LABELS } from '../components.js';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function usageCount(state, categoryId) {
  let count = state.templates.filter(t => t.categoryId === categoryId).length;
  Object.values(state.months).forEach(m => {
    count += m.transactions.filter(t => t.categoryId === categoryId).length;
  });
  return count;
}

function parentLabel(state, cat) {
  if (!cat.parentId) return null;
  if (cat.parentId === FREE_BUCKET_ID) return '→ თავისუფალი';
  const p = state.categories.find(c => c.id === cat.parentId);
  return p ? `→ ${p.name}` : null;
}

export function renderCategories(root) {
  const container = el('div', { class: 'categories-view' });
  root.appendChild(container);

  const addBtn = el('button', { class: 'btn btn--primary', text: '+ ახალი კატეგორია' });
  container.appendChild(el('div', { class: 'btn-row' }, [addBtn]));

  container.appendChild(el('p', {
    class: 'card__sub',
    text: 'ახალი კატეგორია ავტომატურად ჩნდება დეშბორდზე. „მინ. (დანაზოგი)" კატეგორიები ერთ ბარათშია — „💰 დანაზოგები".'
  }));

  const planWrap = el('div', {});
  container.appendChild(planWrap);
  const list = el('div', { class: 'list' });
  container.appendChild(list);

  function draw() {
    renderPlan(planWrap, draw);
    const state = getState();
    list.innerHTML = '';

    if (state.categories.length === 0) {
      list.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-state__icon', text: '🏷️' }),
        el('div', { text: 'დაამატე პირველი კატეგორია' })
      ]));
      return;
    }

    // Top-level first, then their children, then free-spending ones.
    const tops = state.categories.filter(c => !c.parentId);
    const ordered = [];
    tops.forEach(t => {
      ordered.push(t);
      state.categories.filter(c => c.parentId === t.id).forEach(ch => ordered.push(ch));
    });
    state.categories.filter(c => c.parentId === FREE_BUCKET_ID).forEach(c => ordered.push(c));
    // Anything with a broken parent link — show too.
    state.categories.forEach(c => { if (!ordered.includes(c)) ordered.push(c); });

    ordered.forEach(cat => {
      const count = usageCount(state, cat.id);
      const isTop = !cat.parentId;
      const pLabel = parentLabel(state, cat);

      const row = el('div', { class: 'row' });
      const main = el('div', { class: 'row__main' }, [
        el('div', { class: 'row__name', style: 'display:flex;align-items:center;gap:8px' }, [
          el('span', { class: 'color-dot', style: `background:${cat.color}` }),
          el('span', { text: cat.name })
        ]),
        el('div', { class: 'row__meta' }, [
          cat.parentId !== FREE_BUCKET_ID ? el('span', { class: 'chip', text: `${cat.targetType === 'amount' ? formatMoney(cat.amount, 'EUR', 0) : formatPercent(cat.percent)}${isTop ? ` · ${cat.goalType === 'min' ? 'მინ.' : 'მაქს.'}` : ''}` }) : null,
          el('span', { class: 'chip chip--account', title: 'ვისია', text: personTag(cat.owner || 'shared') }),
          pLabel ? el('span', { class: 'chip', text: pLabel }) : null,
          el('span', { text: String(count) + ' ჩანაწ.' })
        ])
      ]);

      const actions = el('div', { class: 'row__actions' });
      const editBtn = el('button', { class: 'icon-btn', 'aria-label': 'რედაქტირება', text: '✎' });
      editBtn.addEventListener('click', () => openCategoryForm(cat, draw));

      const deleteBtn = el('button', { class: 'icon-btn', 'aria-label': 'წაშლა', text: '🗑' });
      deleteBtn.addEventListener('click', async () => {
        if (count > 0) {
          toast('ჯერ გადაანაწილეთ ტრანზაქციები/შაბლონები სხვა კატეგორიაზე', 'error');
          return;
        }
        if (state.categories.some(c => c.parentId === cat.id)) {
          toast('ჯერ გადაანაწილეთ ამ კატეგორიაში ჩათვლილი კატეგორიები', 'error');
          return;
        }
        const ok = await confirmDialog(`წავშალო კატეგორია „${cat.name}"?`, { danger: true, confirmLabel: 'წაშლა' });
        if (!ok) return;
        updateState(draft => {
          draft.categories = draft.categories.filter(x => x.id !== cat.id);
          draft.settings.dashboardCardOrder = draft.settings.dashboardCardOrder.filter(k => k !== cat.id);
          return draft;
        });
        toast('წაიშალა');
        draw();
      });

      actions.append(editBtn, deleteBtn);
      row.append(main, actions);
      list.appendChild(row);
    });
  }

  addBtn.addEventListener('click', () => openCategoryForm(null, draw));

  draw();
}

function fmtNum(v) {
  const n = Number(v) || 0;
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

/**
 * "📊 გეგმა": every category's target in one place — as % of income OR as € — with the other
 * value calculated live, both people's free money, and the 100 % check.
 */
function renderPlan(wrap, redraw) {
  const state = getState();
  const key = getSelectedMonth();
  const month = state.months[key];
  const T = month ? totalIncome(month) : 0;
  wrap.innerHTML = '';
  const card = el('div', { class: 'card plan-card' });
  card.appendChild(el('div', { class: 'card__title', text: '📊 გეგმა — რამდენი რისთვის' }));
  card.appendChild(el('p', { class: 'card__sub', text: T > 0
    ? `ჩაწერე პროცენტი ან თანხა (€) — მეორე თავისით დაითვლება ${monthLabel(key)}-ის შემოსავლით (${formatMoney(T, 'EUR', 0)}). ათწილადებიც შეიძლება (მაგ. 12,5).`
    : 'ჩაწერე პროცენტი ან თანხა (€). ამ თვეს შემოსავალი ჯერ არ აქვს ჩაწერილი — პროცენტი ↔ თანხის გადათვლა გამოჩნდება, როცა დეშბორდზე ხელფასებს ჩაწერ.' }));

  const rows = el('div', { class: 'plan-rows' });
  const ordered = [];
  state.categories.filter(c => !c.parentId).forEach(top => {
    ordered.push([top, 0]);
    state.categories.filter(c => c.parentId === top.id).forEach(ch => ordered.push([ch, 1]));
  });
  const sumEl = el('div', { class: 'sum-indicator' });
  const updateSum = () => {
    const fresh = getState();
    const sum = sumAllPercents(fresh.settings, fresh.categories, T);
    const ok = Math.abs(sum - 100) < 0.05;
    const diff = Math.round((100 - sum) * 10) / 10;
    sumEl.textContent = ok ? `ჯამი: 100 % ✓` : `ჯამი: ${formatPercent(sum)} — ${diff > 0 ? 'აკლია' : 'მეტია'} ${formatPercent(Math.abs(diff))}${T > 0 ? ` (≈ ${formatMoney(Math.abs(diff) * T / 100, 'EUR', 0)})` : ''}`;
    sumEl.className = 'sum-indicator ' + (ok ? 'sum-indicator--ok' : 'sum-indicator--bad');
  };

  const addRow = (label, depth, color, cfg, save) => {
    const isAmt = cfg.targetType === 'amount';
    const input = el('input', { type: 'text', inputmode: 'decimal', class: 'plan-input tabular-nums', value: fmtNum(isAmt ? cfg.amount : cfg.percent), 'aria-label': `${label} — მიზანი` });
    const unit = el('select', { class: 'plan-unit', 'aria-label': 'ერთეული' }, [el('option', { value: 'percent', text: '%' }), el('option', { value: 'amount', text: '€' })]);
    unit.value = isAmt ? 'amount' : 'percent';
    const other = el('span', { class: 'plan-other tabular-nums' });
    const calc = () => {
      const v = parseAmountInput(input.value, 2);
      const tmp = unit.value === 'amount' ? { targetType: 'amount', amount: v } : { targetType: 'percent', percent: v };
      other.textContent = unit.value === 'amount' ? (T > 0 ? `= ${formatPercent(targetPct(tmp, T))}` : '') : (T > 0 ? `= ${formatMoney(targetEur(tmp, T), 'EUR', 0)}` : '');
    };
    const commit = () => {
      const v = parseAmountInput(input.value, 2);
      save(unit.value, v);
      updateSum();
    };
    input.addEventListener('input', calc);
    input.addEventListener('change', commit);
    unit.addEventListener('change', () => {
      // Switching unit keeps the same money: convert the shown value.
      const v = parseAmountInput(input.value, 2);
      if (T > 0) input.value = fmtNum(unit.value === 'amount' ? v * T / 100 : v / T * 100);
      calc(); commit();
    });
    calc();
    rows.appendChild(el('div', { class: 'plan-row' + (depth ? ' plan-row--child' : '') }, [
      el('span', { class: 'plan-row__name' }, [el('span', { class: 'color-dot', style: `background:${color}` }), ` ${depth ? '↳ ' : ''}${label}`]),
      el('span', { class: 'plan-row__inputs' }, [input, unit]),
      other
    ]));
  };

  ordered.forEach(([c, depth]) => addRow(c.name, depth, c.color, c, (type, v) => updateState(d => {
    const x = d.categories.find(k => k.id === c.id);
    x.targetType = type;
    if (type === 'amount') x.amount = v; else x.percent = v;
    return d;
  })));
  ['giorgi', 'nino'].forEach(p => {
    const cfg = state.settings.planFree[p];
    addRow(`🛍 თავისუფალი (${PAYER_LABELS[p]})`, 0, cfg.color, cfg, (type, v) => updateState(d => {
      const x = d.settings.planFree[p];
      x.targetType = type;
      if (type === 'amount') x.amount = v; else x.percent = v;
      return d;
    }));
  });
  card.appendChild(rows);
  card.appendChild(sumEl);
  card.appendChild(el('p', { class: 'card__sub', text: '„↳" ქვეკატეგორიის მიზანი ემატება თავისი ბლოკის ჯამს დეშბორდზე, მაგრამ ხელფასის განაწილებაში ითვლება მისი „ვისია"-ს მიხედვით (მაგ. ნინოს დანაზოგი — ნინოს წილში).' }));
  updateSum();
  wrap.appendChild(card);
  void redraw;
}

function openCategoryForm(existing, onSaved) {
  const state = getState();
  const isEdit = !!existing;
  const form = el('form', {});

  const nameInput = el('input', { type: 'text', value: existing?.name || '' });

  // Where does this category count on the dashboard?
  const parentSelect = el('select', {});
  parentSelect.appendChild(el('option', { value: '', text: '📊 საკუთარი ბლოკი დეშბორდზე' }));
  parentSelect.appendChild(el('option', { value: FREE_BUCKET_ID, text: `🛍 ${freePseudoCategory().name}` }));
  state.categories
    .filter(c => !c.parentId && c.id !== existing?.id)
    .forEach(c => parentSelect.appendChild(el('option', { value: c.id, text: `↳ ჩაითვალოს „${c.name}"-ის ჯამში` })));
  parentSelect.value = existing?.parentId || '';

  // Target: % of income OR a fixed € amount (decimals allowed); also for sub-categories.
  const isAmount = existing?.targetType === 'amount';
  const percentInput = el('input', { type: 'text', inputmode: 'decimal', value: fmtNum(isAmount ? existing?.amount : existing?.percent) });
  const unitSelect = el('select', { class: 'unit-select' }, [el('option', { value: 'percent', text: '% შემოსავლიდან' }), el('option', { value: 'amount', text: '€ თვეში' })]);
  unitSelect.value = isAmount ? 'amount' : 'percent';
  const percentField = el('div', { class: 'field' }, [el('label', { text: 'მიზანი (გეგმა) — პროცენტით ან კონკრეტული თანხით' }), el('div', { class: 'target-row' }, [percentInput, unitSelect])]);

  const goalSelect = el('select', {}, [
    el('option', { value: 'max', text: 'მაქს. (ხარჯი — ამაზე მეტი არ)' }),
    el('option', { value: 'min', text: 'მინ. (დანაზოგი — ამაზე ნაკლები არ)' })
  ]);
  goalSelect.value = existing?.goalType || 'max';
  const goalField = el('div', { class: 'field' }, [el('label', { text: 'მიზნის ტიპი' }), goalSelect]);

  // Goal type belongs to the dashboard block; a target can also sit on a sub-category
  // (it then adds up in its block). Free-spending categories have no target of their own.
  function syncVisibility() {
    const own = parentSelect.value === '';
    percentField.hidden = parentSelect.value === FREE_BUCKET_ID;
    goalField.hidden = !own;
  }
  parentSelect.addEventListener('change', syncVisibility);

  let color = existing?.color || COLOR_PRESETS[state.categories.length % COLOR_PRESETS.length];
  const colorBtn = el('button', { type: 'button', class: 'color-swatch', style: `background:${color};width:36px;height:36px` });
  colorBtn.addEventListener('click', async () => {
    const c = await pickColor(color);
    if (c) { color = c; colorBtn.style.background = c; }
  });
  const colorField = el('div', { class: 'field' }, [
    el('label', { text: 'ფერი' }),
    el('div', { style: 'display:flex;align-items:center;gap:8px' }, [colorBtn])
  ]);

  // Whose is this category: both (shared 50/50) or one person's (e.g. "ინვესტიცია" = Nino's).
  const ownerSelect = el('select', {}, ['shared', 'giorgi', 'nino'].map(v => el('option', { value: v, text: v === 'shared' ? `${PAYER_LABELS.shared} (ორივესი, 50/50)` : PAYER_LABELS[v] })));
  ownerSelect.value = existing?.owner || 'shared';
  // savings only: short- or long-term (shown apart in the 💰 card); empty = guessed from the name
  const termSelect = el('select', {}, [['', 'სახელიდან (მოკლე… / გრძელ…)'], ['short', 'მოკლევადიანი'], ['long', 'გრძელვადიანი']].map(([v, l]) => el('option', { value: v, text: l })));
  termSelect.value = existing?.term || '';

  form.append(
    el('div', { class: 'field' }, [el('label', { text: 'სახელი' }), nameInput]),
    el('div', { class: 'field' }, [el('label', { text: 'ვისია' }), ownerSelect]),
    el('div', { class: 'field' }, [el('label', { text: 'დანაზოგის ვადა (მხოლოდ დანაზოგისთვის)' }), termSelect]),
    el('div', { class: 'field' }, [el('label', { text: 'სად ჩაითვალოს' }), parentSelect]),
    percentField,
    goalField,
    colorField,
    el('p', { class: 'card__sub', text: '📤 „საქართველოში გადასარიცხი" ახლა თითო შაბლონზე/ტრანზაქციაზე ინიშნება — ასე შეიძლება იყოს აუცილებელიც და არააუცილებელიც.' })
  );
  syncVisibility();

  const actions = el('div', { class: 'btn-row' });
  actions.appendChild(el('button', { class: 'btn btn--primary', type: 'submit', text: isEdit ? 'შენახვა' : 'დამატება' }));
  form.appendChild(actions);

  const { close } = openModal(form, { title: isEdit ? 'კატეგორიის რედაქტირება' : 'ახალი კატეგორია' });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) { toast('შეავსეთ სახელი', 'error'); return; }
    const parentId = parentSelect.value || null;
    const val = parentId === FREE_BUCKET_ID ? 0 : parseAmountInput(percentInput.value, 2);
    const targetType = unitSelect.value === 'amount' ? 'amount' : 'percent';
    const percent = targetType === 'percent' ? val : (existing?.percent || 0);
    const amount = targetType === 'amount' ? val : (existing?.amount ?? null);

    updateState(draft => {
      if (isEdit) {
        const c = draft.categories.find(x => x.id === existing.id);
        Object.assign(c, { name, parentId, percent, amount, targetType, goalType: goalSelect.value, color, georgiaTransfer: false, owner: ownerSelect.value, term: termSelect.value || null });
        if (parentId) {
          // No longer a top-level block — drop from dashboard order.
          draft.settings.dashboardCardOrder = draft.settings.dashboardCardOrder.filter(k => k !== c.id);
        }
      } else {
        const id = uid('cat');
        draft.categories.push({ id, name, parentId, percent, amount, targetType, goalType: goalSelect.value, color, georgiaTransfer: false, owner: ownerSelect.value, term: termSelect.value || null });
      }
      return draft;
    });
    toast('შენახულია ✓');
    close();
    onSaved();
  });
}
