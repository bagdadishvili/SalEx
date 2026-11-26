// features.js — optional features the family can switch on/off (v20), so the screens stay
// light: Settings → "🧩 ფუნქციები". Stored in settings.features { key: true|false } (synced);
// a key that is missing uses its default. Each card / prompt asks isOn(key) before showing.

import { getState } from './state.js';

/** [key, icon + name, one-line description, default] — order = order in Settings. */
export const FEATURES = [
  ['payday', '💶 ხელფასის დღის სია', 'ხელფასის შემდეგ — ვინ სად რამდენი გადარიცხოს, ✓-ებით; ერთი დაჭერით პირადი ანგარიშის გადასახადები „⇄ გადატანილად".', true],
  ['calendar', '📅 ჩამოჭრების კალენდარი', 'მომდევნო დღეების ჩამოჭრები თარიღებით; გაფრთხილება, თუ ფული ჯერ არ არის გადატანილი.', true],
  ['bank', '🏦 ბანკის ნაშთთან შედარება', 'ჩაწერ ანგარიშის ნაშთს — აპი აჩვენებს, რამდენი დარჩება ყველა გადასახადის შემდეგ.', true],
  ['reserve', '📆 იშვიათი გადასახადების რეზერვი', '6- და 12-თვიანი გადასახადებისთვის: რამდენი გადადო ყოველთვე.', true],
  ['goals', '🎯 დანაზოგის მიზნები', 'მიზანი თანხით და ვადით — თვეში საჭირო თანხა და პროგრესი.', true],
  ['close', '🔒 თვის დახურვა', 'თვის ბოლოს: ბიუჯეტების დახურვა, გადაუხდელების მოწესრიგება, ნაშთი დანაზოგზე.', true],
  ['forecast', '📈 ცვლადი გადასახადის პროგნოზი', 'ბოლო თვეების საშუალო და ცვლილება ↑↓ — შაბლონებში და თვის მომზადებისას.', true],
  ['templateSync', '🔁 შაბლონის განახლების შეთავაზება', 'თანხა ან სხვა რამ თუ შეიცვალა — გკითხავს, შაბლონიც შეიცვალოს თუ არა (და პირიქით).', true],
  ['trends', '📊 კატეგორიების გრაფიკი', '12 თვის ხარჯი კატეგორიებით, გეგმასთან შედარებით.', true],
  ['fx', '💱 ლარის კურსის გავლენა', 'რამდენი მოიგეთ ან წააგეთ კურსზე ლარის გადახდებში.', true],
  ['whatIf', '🧮 „რა იქნება, თუ…"', 'ხელფასი ან ხარჯი თუ შეიცვლება — როგორ შეიცვლება გადარიცხვები და თავისუფალი თანხა.', true]
];

const DEFAULTS = Object.fromEntries(FEATURES.map(([k, , , d]) => [k, d]));

/** Is this feature switched on (settings, or its default)? */
export function isOn(key, settings = getState()?.settings) {
  const v = settings && settings.features ? settings.features[key] : undefined;
  return typeof v === 'boolean' ? v : DEFAULTS[key] !== false;
}
