// views/categories.js — Categories table + re-bucketing §5.4.

import { getState, updateState } from '../state.js';
import { el, openModal, confirmDialog, toast } from '../ui.js';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const BUCKET_OPTIONS = [
  { value: 'essentials', label: 'აუცილებელი' },
  { value: 'georgia', label: 'საქართველო' },
  { value: 'savings', label: 'დანაზოგი' },
  { value: 'free', label: 'თავისუფალი' }
];

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

  const tableWrap = el('div', { class: 'card' });
  container.appendChild(tableWrap);

  function draw() {
    const state = getState();
    tableWrap.innerHTML = '';
    const table = el('table', { class: 'simple-table' });
    const thead = el('thead', {}, [el('tr', {}, [
      el('th', { text: 'სახელი' }),
      el('th', { text: 'ბაკეტი' }),
      el('th', { text: 'გამოყენება' }),
      el('th', { text: '' })
    ])]);
    table.appendChild(thead);

    const tbody = el('tbody');
    state.categories.forEach(cat => {
      const tr = el('tr');
      const nameCell = el('td', { text: cat.name });
      if (!cat.builtin) {
        nameCell.style.cursor = 'pointer';
        nameCell.title = 'დააჭირეთ სახელის შესაცვლელად';
        nameCell.addEventListener('click', () => renameCategory(cat, draw));
      }
      tr.appendChild(nameCell);

      const bucketSelect = el('select', {}, BUCKET_OPTIONS.map(b => el('option', { value: b.value, text: b.label })));
      bucketSelect.value = cat.bucket;
      bucketSelect.addEventListener('change', async () => {
        const newBucket = bucketSelect.value;
        if (newBucket === cat.bucket) return;
        const count = usageCount(state, cat.id);
        const ok = await confirmDialog(
          count > 0
            ? `ამ კატეგორიას იყენებს ${count} შაბლონი/ტრანზაქცია. ბაკეტის შეცვლა დაუყოვნებლივ შეცვლის დეშბორდის გამოთვლებს ყველა თვეში (წარსულის ჩათვლით). გავაგრძელო?`
            : 'ბაკეტის შეცვლა?',
          { confirmLabel: 'დიახ, შევცვალო' }
        );
        if (!ok) { bucketSelect.value = cat.bucket; return; }
        updateState(draft => {
          const c = draft.categories.find(x => x.id === cat.id);
          c.bucket = newBucket;
          return draft;
        });
        toast('ბაკეტი განახლდა ✓');
        draw();
      });
      tr.appendChild(el('td', {}, [bucketSelect]));

      tr.appendChild(el('td', { text: String(usageCount(state, cat.id)) }));

      const actionsCell = el('td');
      if (!cat.builtin) {
        const deleteBtn = el('button', { class: 'icon-btn', 'aria-label': 'წაშლა', text: '🗑' });
        deleteBtn.addEventListener('click', async () => {
          const count = usageCount(state, cat.id);
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
        actionsCell.appendChild(deleteBtn);
      }
      tr.appendChild(actionsCell);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }

  addBtn.addEventListener('click', () => addCategory(draw));

  draw();
}

function addCategory(onSaved) {
  const form = el('form', {});
  const nameInput = el('input', { type: 'text', placeholder: 'მაგ. გართობა' });
  const bucketSelect = el('select', {}, BUCKET_OPTIONS.map(b => el('option', { value: b.value, text: b.label })));
  form.append(
    el('div', { class: 'field' }, [el('label', { text: 'სახელი' }), nameInput]),
    el('div', { class: 'field' }, [el('label', { text: 'ბაკეტი' }), bucketSelect])
  );
  const actions = el('div', { class: 'btn-row' });
  actions.appendChild(el('button', { class: 'btn btn--primary', type: 'submit', text: 'დამატება' }));
  form.appendChild(actions);

  const { close } = openModal(form, { title: 'ახალი კატეგორია' });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) { toast('შეავსეთ სახელი', 'error'); return; }
    updateState(draft => {
      draft.categories.push({ id: uid('cat'), name, bucket: bucketSelect.value, builtin: false });
      return draft;
    });
    toast('დაემატა ✓');
    close();
    onSaved();
  });
}

function renameCategory(cat, onSaved) {
  const form = el('form', {});
  const nameInput = el('input', { type: 'text', value: cat.name });
  form.append(el('div', { class: 'field' }, [el('label', { text: 'სახელი' }), nameInput]));
  const actions = el('div', { class: 'btn-row' });
  actions.appendChild(el('button', { class: 'btn btn--primary', type: 'submit', text: 'შენახვა' }));
  form.appendChild(actions);

  const { close } = openModal(form, { title: 'კატეგორიის რედაქტირება' });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) { toast('შეავსეთ სახელი', 'error'); return; }
    updateState(draft => {
      const c = draft.categories.find(x => x.id === cat.id);
      c.name = name;
      return draft;
    });
    toast('შენახულია ✓');
    close();
    onSaved();
  });
}
