// views/categories.js — unified category management (v3 model).
// A category IS a dashboard block: it has a percent target, color and goal type.
// It can also be counted inside another category, or as personal free spending.

import { getState, updateState, FREE_BUCKET_ID } from '../state.js';
import { formatPercent } from '../calc.js';
import { el, openModal, confirmDialog, toast } from '../ui.js';
import { pickColor, COLOR_PRESETS, freePseudoCategory } from '../components.js';

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
    text: 'აქ შექმნილი კატეგორია ავტომატურად ჩნდება დეშბორდზე და პარამეტრებში. „მაქს. (ხარჯი)" — მიზანი შესრულებულია, თუ პროცენტზე მეტს არ ხარჯავ; „მინ. (დანაზოგი)" — თუ მინიმუმ ამდენს გადადებ.'
  }));

  const list = el('div', { class: 'list' });
  container.appendChild(list);

  function draw() {
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
          isTop ? el('span', { class: 'chip', text: `${formatPercent(cat.percent, 0)} · ${cat.goalType === 'min' ? 'მინ.' : 'მაქს.'}` }) : null,
          pLabel ? el('span', { class: 'chip', text: pLabel }) : null,
          cat.georgiaTransfer ? el('span', { class: 'chip chip--georgia', text: '🇬🇪' }) : null,
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

  const percentInput = el('input', { type: 'number', min: '0', max: '100', value: String(existing?.percent ?? 0) });
  const percentField = el('div', { class: 'field' }, [el('label', { text: 'სამიზნე პროცენტი შემოსავლიდან (%)' }), percentInput]);

  const goalSelect = el('select', {}, [
    el('option', { value: 'max', text: 'მაქს. (ხარჯი — ამაზე მეტი არ)' }),
    el('option', { value: 'min', text: 'მინ. (დანაზოგი — ამაზე ნაკლები არ)' })
  ]);
  goalSelect.value = existing?.goalType || 'max';
  const goalField = el('div', { class: 'field' }, [el('label', { text: 'მიზნის ტიპი' }), goalSelect]);

  // Percent/goal only make sense for a category with its own dashboard block.
  function syncVisibility() {
    const own = parentSelect.value === '';
    percentField.hidden = !own;
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

  const georgiaCheckbox = el('input', { type: 'checkbox' });
  georgiaCheckbox.checked = existing?.georgiaTransfer || false;
  const georgiaField = el('label', { class: 'field', style: 'flex-direction:row;align-items:center;gap:8px' }, [
    georgiaCheckbox,
    el('span', { text: 'საქართველოში გადასარიცხია — დეშბორდზე ცალკეც გამოჩნდება (ჯამში ჩათვლის გარდა)' })
  ]);

  form.append(
    el('div', { class: 'field' }, [el('label', { text: 'სახელი' }), nameInput]),
    el('div', { class: 'field' }, [el('label', { text: 'სად ჩაითვალოს' }), parentSelect]),
    percentField,
    goalField,
    colorField,
    georgiaField
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
    const percent = parentId ? 0 : (Number(percentInput.value) || 0);

    updateState(draft => {
      if (isEdit) {
        const c = draft.categories.find(x => x.id === existing.id);
        Object.assign(c, { name, parentId, percent, goalType: goalSelect.value, color, georgiaTransfer: georgiaCheckbox.checked });
        if (parentId) {
          // No longer a top-level block — drop from dashboard order.
          draft.settings.dashboardCardOrder = draft.settings.dashboardCardOrder.filter(k => k !== c.id);
        }
      } else {
        const id = uid('cat');
        draft.categories.push({ id, name, parentId, percent, goalType: goalSelect.value, color, georgiaTransfer: georgiaCheckbox.checked });
      }
      return draft;
    });
    toast('შენახულია ✓');
    close();
    onSaved();
  });
}
