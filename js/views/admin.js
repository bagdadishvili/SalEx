// views/admin.js — "🛠 ადმინი": rename EVERYTHING the family sees — named texts (cards, buttons,
// people) and, v19, every other title / button / hint / message the app has ever shown on this
// device (searchable list). Changes are saved in settings.texts and sync to both phones.

import { getState, updateState } from '../state.js';
import { el, toast, confirmDialog } from '../ui.js';
import { TEXT_GROUPS, t, defaultText, setText, setTextEditMode, isTextEditMode, rawOverrides, seenTexts, RAW } from '../texts.js';
import { navigate, collectAllTexts } from '../app.js';
import { revealInSettings } from './settings.js';

const PAGE_NAMES = {
  dashboard: '🏠 დეშბორდი', transactions: '💳 ტრანზაქციები', templates: '🧾 შაბლონები', categories: '🏷️ კატეგორიები',
  settings: '⚙️ პარამეტრები', assistant: '🤖 AI', admin: '🛠 ადმინი', '': 'სხვა'
};
const pageName = (p) => {
  const [route, dialog] = String(p || '').split(':');
  return `${PAGE_NAMES[route] || route || 'სხვა'}${dialog ? ' — ფანჯარა' : ''}`;
};
const PAGE_SIZE = 60;

export function renderAdmin(root) {
  const container = el('div', { class: 'admin-view' });
  root.appendChild(container);

  const intro = el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: '🛠 ადმინი — ტექსტები და სახელები' }),
    el('p', { class: 'card__sub', text: 'აქ შეგიძლია შეცვალო აპის ნებისმიერი ტექსტი: ბარათების და გვერდების სათაურები, ღილაკები, მინიშნებები, შეტყობინებები, ადამიანების სახელები — კოდის გარეშე. ცარიელი ველი = საწყისი ტექსტი. ცვლილება ყველა მოწყობილობაზე სინქრონდება.' })
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

  // ---- every text of the app (searchable) ----
  const allCard = el('div', { class: 'card admin-all' });
  container.appendChild(allCard);
  let query = '';
  let page = 'all';
  let shown = PAGE_SIZE;
  let onlyChanged = false;

  function textRow(shape) {
    const key = RAW + shape;
    const custom = (getState().settings.texts || {})[key] || '';
    const input = el('input', { type: 'text', value: custom, maxlength: '300', 'aria-label': 'ახალი ტექსტი', 'data-noedit': '' });
    input.placeholder = shape; // the original itself, never translated
    input.addEventListener('change', () => { setText(key, input.value); toast('შენახულია ✓'); });
    const reset = el('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': 'საწყისზე დაბრუნება', title: 'საწყისზე დაბრუნება', text: '↺' });
    reset.addEventListener('click', () => { setText(key, ''); input.value = ''; toast('დაბრუნდა საწყისზე'); });
    const label = el('div', { class: 'admin-row__label', 'data-noedit': '' }, [el('span', {})]);
    label.firstChild.textContent = shape;
    return el('div', { class: 'admin-row' + (custom ? ' admin-row--changed' : '') }, [label, input, reset]);
  }

  function drawAll() {
    allCard.innerHTML = '';
    allCard.appendChild(el('div', { class: 'card__title', text: '🔎 ყველა ტექსტი აპში' }));
    allCard.appendChild(el('p', { class: 'card__sub', text: 'ყველა სათაური, ღილაკი, მინიშნება და შეტყობინება, რაც აპს ამ მოწყობილობაზე უჩვენებია. ფანჯრების ტექსტები სიაში ჩნდება, როცა ფანჯარას ერთხელ მაინც გახსნი. {1}, {2}… — ადგილები, სადაც აპი თავად ჩასვამს ციფრებს.' }));
    const seen = seenTexts();
    // renamed texts are always listed, even if not seen on this device yet
    rawOverrides().forEach(([shape]) => { if (seen[shape] === undefined) seen[shape] = ''; });
    const texts = getState().settings.texts || {};
    const all = Object.entries(seen).map(([shape, pg]) => ({ shape, page: pg || '', custom: texts[RAW + shape] || '' }));
    const pages = [...new Set(all.map(x => x.page.split(':')[0]))].sort();

    const search = el('input', { type: 'search', class: 'tpl-search', placeholder: 'ძებნა (მაგ. გადახდა, ბარათი…)', value: query, 'aria-label': 'ტექსტის ძებნა', 'data-noedit': '' });
    search.addEventListener('input', () => { query = search.value; shown = PAGE_SIZE; drawList(); });
    const pageSel = el('select', { class: 'tpl-select', 'aria-label': 'გვერდი', 'data-noedit': '' }, [
      el('option', { value: 'all', text: 'ყველა გვერდი' }),
      ...pages.map(p => el('option', { value: p, text: pageName(p) }))
    ]);
    pageSel.value = pages.includes(page) ? page : 'all';
    pageSel.addEventListener('change', () => { page = pageSel.value; shown = PAGE_SIZE; drawList(); });
    const changedBtn = el('button', { type: 'button', class: 'filter-btn', 'aria-pressed': String(onlyChanged), text: '✎ მხოლოდ შეცვლილები' });
    changedBtn.addEventListener('click', () => { onlyChanged = !onlyChanged; changedBtn.setAttribute('aria-pressed', String(onlyChanged)); shown = PAGE_SIZE; drawList(); });
    const scan = el('button', { type: 'button', class: 'btn btn--secondary btn--sm', text: '↻ ყველა გვერდის ტექსტების შეგროვება' });
    scan.addEventListener('click', () => {
      const before = Object.keys(seenTexts()).length;
      collectAllTexts();
      toast(`დაემატა ${Math.max(0, Object.keys(seenTexts()).length - before)} ტექსტი ✓`);
      drawAll();
    });
    allCard.appendChild(el('div', { class: 'tpl-toolbar' }, [search, pageSel]));
    allCard.appendChild(el('div', { class: 'filter-row' }, [changedBtn, scan]));
    const list = el('div', { class: 'admin-list' });
    allCard.appendChild(list);

    function drawList() {
      list.innerHTML = '';
      const q = query.trim().toLowerCase();
      const hits = all
        .filter(x => page === 'all' || x.page.split(':')[0] === page)
        .filter(x => !onlyChanged || x.custom)
        .filter(x => !q || x.shape.toLowerCase().includes(q) || x.custom.toLowerCase().includes(q))
        // already renamed texts first, then page by page
        .sort((a, b) => (!!b.custom - !!a.custom) || a.page.localeCompare(b.page) || a.shape.localeCompare(b.shape, 'ka'));
      list.appendChild(el('div', { class: 'card__sub', text: `ნაპოვნია: ${hits.length}` }));
      let lastGroup = null;
      hits.slice(0, shown).forEach(x => {
        const group = x.custom ? '✎ შეცვლილი ტექსტები' : pageName(x.page);
        if (group !== lastGroup) { lastGroup = group; list.appendChild(el('div', { class: 'admin-page', text: group })); }
        list.appendChild(textRow(x.shape));
      });
      if (hits.length > shown) {
        const more = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: `მეტის ჩვენება (კიდევ ${hits.length - shown})` });
        more.addEventListener('click', () => { shown += PAGE_SIZE * 2; drawList(); });
        list.appendChild(el('div', { class: 'btn-row' }, [more]));
      }
    }
    drawList();
  }

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

    groupsWrap.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card__title', text: '🔗 სხვა პარამეტრები' }),
      el('div', { class: 'btn-row' }, [
        linkBtn('🧩 დეშბორდის ბლოკები (დამალვა / თანმიმდევრობა)', () => { navigate('settings'); setTimeout(() => revealInSettings('dashboard-layout'), 60); }),
        linkBtn('🏷️ კატეგორიები (სახელი, ფერი, ვისია, %)', () => navigate('categories')),
        linkBtn('🧾 შაბლონები', () => navigate('templates')),
        linkBtn('⚙️ ყველა პარამეტრი', () => navigate('settings'))
      ])
    ]));
    drawAll();
  }
  // First visit: learn every page's texts right away, so the list is complete.
  if (Object.keys(seenTexts()).length < 50) collectAllTexts();
  draw();
}

function linkBtn(label, onClick) {
  const b = el('button', { type: 'button', class: 'btn btn--secondary btn--sm', text: label });
  b.addEventListener('click', onClick);
  return b;
}
