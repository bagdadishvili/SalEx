// views/categories.js — Categories table + bucket re-assignment, fully user-editable §5.4.

import { getState, updateState, FREE_BUCKET_ID } from '../state.js';
import { el, openModal, confirmDialog, toast } from '../ui.js';
import { bucketChip } from '../components.js';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function bucketOptions(settings) {
  return [{ id: FREE_BUCKET_ID, name: 'თავისუფალი ხარჯვა', color: '#94a3b8' }, ...settings.buckets];
}

function findBucket(settings, bucketId) {
  return bucketOptions(settings).find(b => b.id === bucketId) || null;
}

function usageCount(state, categoryId) {
  let count = state.templates.filter(t => t.categoryId === categoryId).length;
  Object.values(state.months).forEach(m => {
    count += m.transactions.filter(t => t.categoryId === categoryId).length;
  });
  return count;
}

export function renderCategories(root) {
  const container = el('div', { class: 'categories-view' });
  root.appendChild(container);

  const addBtn = el('button', { class: 'btn btn--primary', text: '+ ახალი კატეგორია' });
  container.appendChild(el('div', { class: 'btn-row' }, [addBtn]));

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

    state.categories.forEach(cat => {
      const bucket = findBucket(state.settings, cat.bucketId);
      const count = usageCount(state, cat.id);

      const row = el('div', { class: 'row' });
      const main = el('div', { class: 'row__main' }, [
        el('div', { class: 'row__name', text: cat.name }),
        el('div', { class: 'row__meta' }, [
          bucketChip(bucket),
          cat.georgiaTransfer ? el('span', { class: 'chip chip--georgia', text: '🇬🇪 საქართველოში გადასარიცხი' }) : null,
          el('span', { text: `გამოყენებულია: ${count}` })
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
        const ok = await confirmDialog(`წავშალო კატეგორია „${cat.name}“?`, { danger: true, confirmLabel: 'წაშლა' });
        if (!ok) return;
        updateState(draft => {
          draft.categories = draft.categories.filter(x => x.id !== cat.id);
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

  const bucketSelect = el('select', {}, bucketOptions(state.settings).map(b => el('option', { value: b.id, text: b.name })));
  bucketSelect.value = existing?.bucketId || state.settings.buckets[0]?.id || FREE_BUCKET_ID;

  const georgiaCheckbox = el('input', { type: 'checkbox' });
  georgiaCheckbox.checked = existing?.georgiaTransfer || false;
  const georgiaField = el('label', { class: 'field', style: 'flex-direction:row;align-items:center;gap:8px' }, [
    georgiaCheckbox,
    el('span', { text: 'ეს კატეგორია საქართველოში გადასარიცხია (ცალკე გამოჩნდება დეშბორდზე)' })
  ]);

  form.append(
    el('div', { class: 'field' }, [el('label', { text: 'სახელი' }), nameInput]),
    el('div', { class: 'field' }, [el('label', { text: 'ბიუჯეტის კატეგორია' }), bucketSelect]),
    georgiaField
  );

  const actions = el('div', { class: 'btn-row' });
  actions.appendChild(el('button', { class: 'btn btn--primary', type: 'submit', text: isEdit ? 'შენახვა' : 'დამატება' }));
  form.appendChild(actions);

  const { close } = openModal(form, { title: isEdit ? 'კატეგორიის რედაქტირება' : 'ახალი კატეგორია' });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) { toast('შეავსეთ სახელი', 'error'); return; }

    updateState(draft => {
      if (isEdit) {
        const c = draft.categories.find(x => x.id === existing.id);
        c.name = name;
        c.bucketId = bucketSelect.value;
        c.georgiaTransfer = georgiaCheckbox.checked;
      } else {
        draft.categories.push({ id: uid('cat'), name, bucketId: bucketSelect.value, georgiaTransfer: georgiaCheckbox.checked });
      }
      return draft;
    });
    toast('შენახულია ✓');
    close();
    onSaved();
  });
}
