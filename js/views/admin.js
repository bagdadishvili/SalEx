// views/admin.js — "🛠 ადმინი": rename everything the family sees (cards, buttons, people),
// without touching code. Changes are saved in settings.texts and sync to both phones.

import { getState, updateState } from '../state.js';
import { el, toast, confirmDialog } from '../ui.js';
import { TEXT_GROUPS, t, defaultText, setText, setTextEditMode, isTextEditMode, rawOverrides, RAW } from '../texts.js';
import { navigate } from '../app.js';

export function renderAdmin(root) {
  const container = el('div', { class: 'admin-view' });
  root.appendChild(container);

  const intro = el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: '🛠 ადმინი — ტექსტები და სახელები' }),
    el('p', { class: 'card__sub', text: 'აქ შეგიძლია შეცვალო ბარათების სათაურები, ღილაკების სახელები და ადამიანების სახელები — კოდის გარეშე. ნებისმიერი სხვა ტექსტი (ღილაკი, მინიშნება, წარწერა): „✎ ეკრანზე რედაქტირება" → შეეხე მას. ცარიელი ველი = საწყისი ტექსტი. ცვლილება ყველა მოწყობილობაზე სინქრონდება.' })
  ]);
  const modeBtn = el('button', { class: 'btn btn--primary', type: 'button', text: '✎ ეკრანზე რედაქტირება (შეეხე ტექსტს და შეცვალე)' });
  modeBtn.addEventListener('click', () => {
    setTextEditMode(!isTextEditMode());
    if (isTextEditMode()) { toast('შეეხე ხაზგასმულ ტექსტს, რომ შეცვალო'); navigate('dashboard'); }
  });
  const resetAll = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '↺ ყველაფრის საწყისზე დაბრუნება' });
  resetAll.addEventListener('click', async () => {
    const ok = await confirmDialog('ყველა შეცვლილი ტექსტი დაბრუნდეს საწყისზე?', { confirmLabel: 'დაბრუნება' });
    if (!ok) return;
    updateState(d => { d.settings.texts = {}; return d; });
    toast('ტექსტები საწყისზეა ✓');
    draw();
  });
  intro.appendChild(el('div', { class: 'btn-row' }, [modeBtn, resetAll]));
  container.appendChild(intro);

  const groupsWrap = el('div', {});
  container.appendChild(groupsWrap);

  function draw() {
    groupsWrap.innerHTML = '';
    const custom = getState().settings.texts || {};
    TEXT_GROUPS.forEach(([, title, items]) => {
      const card = el('div', { class: 'card' }, [el('div', { class: 'card__title', text: title })]);
      Object.keys(items).forEach(key => {
        const input = el('input', { type: 'text', value: custom[key] || '', placeholder: defaultText(key), maxlength: '80' });
        input.addEventListener('change', () => { setText(key, input.value); toast('შენახულია ✓'); });
        const reset = el('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': 'საწყისზე დაბრუნება', title: 'საწყისზე დაბრუნება', text: '↺' });
        reset.addEventListener('click', () => { setText(key, ''); input.value = ''; toast('დაბრუნდა საწყისზე'); });
        card.appendChild(el('div', { class: 'admin-row' }, [
          el('div', { class: 'admin-row__label' }, [el('span', { text: defaultText(key) }), custom[key] ? el('small', { text: `→ ${t(key)}` }) : null]),
          input,
          reset
        ]));
      });
      groupsWrap.appendChild(card);
    });

    // Free texts renamed on screen (any button / hint / label)
    const raws = rawOverrides();
    const rawCard = el('div', { class: 'card' }, [el('div', { class: 'card__title', text: '✎ ეკრანზე შეცვლილი სხვა ტექსტები' })]);
    if (!raws.length) rawCard.appendChild(el('p', { class: 'card__sub', text: 'ჯერ არაფერი. „✎ ეკრანზე რედაქტირება" → შეეხე ნებისმიერ ტექსტს (ღილაკს, მინიშნებას).' }));
    raws.forEach(([original, now]) => {
      const key = RAW + original;
      const input = el('input', { type: 'text', value: now, maxlength: '300' });
      input.addEventListener('change', () => { setText(key, input.value); toast('შენახულია ✓'); draw(); });
      const reset = el('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': 'საწყისზე დაბრუნება', title: 'საწყისზე დაბრუნება', text: '↺' });
      reset.addEventListener('click', () => { setText(key, ''); toast('დაბრუნდა საწყისზე'); draw(); });
      const label = el('div', { class: 'admin-row__label' }, [el('span', {})]);
      label.firstChild.textContent = original; // the original wording itself, never translated
      rawCard.appendChild(el('div', { class: 'admin-row' }, [label, input, reset]));
    });
    groupsWrap.appendChild(rawCard);

    groupsWrap.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card__title', text: '🔗 სხვა პარამეტრები' }),
      el('div', { class: 'btn-row' }, [
        linkBtn('🧩 დეშბორდის ბლოკები (დამალვა / თანმიმდევრობა)', () => { navigate('settings'); setTimeout(() => document.getElementById('dashboard-layout')?.scrollIntoView({ behavior: 'smooth' }), 60); }),
        linkBtn('🏷️ კატეგორიები (სახელი, ფერი, ვისია, %)', () => navigate('categories')),
        linkBtn('🧾 შაბლონები', () => navigate('templates')),
        linkBtn('⚙️ ყველა პარამეტრი', () => navigate('settings'))
      ])
    ]));
  }
  draw();
}

function linkBtn(label, onClick) {
  const b = el('button', { type: 'button', class: 'btn btn--secondary btn--sm', text: label });
  b.addEventListener('click', onClick);
  return b;
}
