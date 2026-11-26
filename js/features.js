// features.js — optional features the family can switch on/off (v20), so the screens stay
// light: Settings → "🧩 ფუნქციები". Stored in settings.features { key: true|false } (synced);
// a key that is missing uses its default. Each card / prompt asks isOn(key) before showing.

import { getState } from './state.js';

/** [key, icon + name, one-line description, default] — order = order in Settings. */
export const FEATURES = [
  ['payday', '✅ ხელფასის დღის სია', 'ხელფასის შემდეგ ვინ სად რამდენი უნდა გადარიცხოს — ერთი მონიშვნით პირადი ანგარიშის გადასახადები გადატანილად აღინიშნება.', true],
  ['calendar', '🗓 მომდევნო ჩამოჭრები', 'უახლოესი დღეების ჩამოჭრები თარიღებით და გაფრთხილებით, თუ თანხა ჯერ არ გადატანილა.', true],
  ['bank', '🏦 ბანკის ნაშთის შემოწმება', 'ჩაწერ რეალურ ნაშთს — აპი გაჩვენებს, რამდენი დაგრჩება ყველა გადასახადის შემდეგ.', true],
  ['reserve', '📆 იშვიათი ხარჯების რეზერვი', 'რამდენი უნდა გადადო ყოველთვე 6- და 12-თვიანი გადასახადებისთვის.', true],
  ['goals', '🎯 დანაზოგის მიზნები', 'მიზნობრივი თანხა და ვადა — თვეში საჭირო შენატანი და პროგრესი.', true],
  ['close', '🔒 თვის დახურვა', 'თვის ბოლოს: ბიუჯეტების დახურვა, ღია გადასახადების მოწესრიგება და ნაშთის გადატანა დანაზოგზე.', true],
  ['forecast', '📈 ცვლადი ხარჯის პროგნოზი', 'ბოლო თვეების საშუალო და ცვლილება (↑↓) შაბლონებსა და თვის მომზადებაში.', true],
  ['templateSync', '🔁 შაბლონის ავტო-განახლება', 'თუ ხარჯის თანხა ან პარამეტრი შეიცვალა, გკითხავს — შაბლონიც განახლდეს თუ არა.', true],
  ['trends', '📊 ხარჯების დინამიკა', 'ბოლო 12 თვის ხარჯი კატეგორიებით, გეგმასთან შედარებით.', true],
  ['fx', '📈 ლარის კურსის გავლენა', 'რამდენი დაიზოგა ან მეტი დაჯდა ლარის გადახდებში კურსის ცვლილებით.', true],
  ['whatIf', '🧮 ბიუჯეტის სიმულატორი', 'ხელფასის ან ახალი ხარჯის ცვლილების წინასწარი გაანგარიშება მონაცემების შეცვლის გარეშე.', true]
];

const DEFAULTS = Object.fromEntries(FEATURES.map(([k, , , d]) => [k, d]));

/** Is this feature switched on (settings, or its default)? */
export function isOn(key, settings = getState()?.settings) {
  const v = settings && settings.features ? settings.features[key] : undefined;
  return typeof v === 'boolean' ? v : DEFAULTS[key] !== false;
}
