// rates.js — EUR→GEL rate (GEL per 1 EUR, the app's convention).
//
// Primary: Bank of Georgia COMMERCIAL BUY rate — what the bank pays you for 1 € when you
// exchange your euros to lari (the lower of the two bank rates). The bank's API cannot be
// called from a browser (no CORS), so a GitHub Action in this repo copies it every 30 min
// into rates.json on the "rates" branch (see .github/workflows/rates.yml).
// Fallback (only if that file is unavailable): the official NBG rate — clearly labelled.

const OWNER = 'bagdadishvili';
const REPO = 'SalEx';
const STALE_HOURS = 36;

function ratesUrl() {
  let owner = OWNER, repo = REPO;
  if (typeof location !== 'undefined' && /\.github\.io$/.test(location.hostname)) {
    owner = location.hostname.split('.')[0];
    repo = location.pathname.split('/').filter(Boolean)[0] || REPO;
  }
  // The query changes every 5 minutes to get past CDN caching.
  return `https://raw.githubusercontent.com/${owner}/${repo}/rates/rates.json?t=${Math.floor(Date.now() / 300000)}`;
}

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Bank of Georgia rates from rates.json: { buy, sell, official, fetchedAt, stale }. */
export async function fetchBankRates() {
  const data = await getJson(ratesUrl());
  const buy = Number(data.buy), sell = Number(data.sell);
  if (!(buy > 1 && buy < 10)) throw new Error('rates.json: bad buy rate');
  const fetchedAt = String(data.fetchedAt || '');
  const ageH = fetchedAt ? (Date.now() - new Date(fetchedAt).getTime()) / 3600000 : Infinity;
  return { buy, sell: sell > 0 ? sell : null, official: Number(data.official) || null, fetchedAt, stale: ageH > STALE_HOURS };
}

async function fromNbg() {
  const data = await getJson('https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/?currencies=EUR');
  const entry = Array.isArray(data) ? data[0] : null;
  const cur = entry && Array.isArray(entry.currencies) ? entry.currencies.find(c => c.code === 'EUR') : null;
  const rate = cur ? Number(cur.rate) / (Number(cur.quantity) || 1) : NaN;
  if (!(rate > 0)) throw new Error('NBG: no EUR rate');
  return { rate: Math.round(rate * 10000) / 10000, date: String(cur.validFromDate || entry.date || '') };
}

async function fromErApi() {
  const data = await getJson('https://open.er-api.com/v6/latest/EUR');
  const rate = Number(data && data.rates && data.rates.GEL);
  if (!(rate > 0)) throw new Error('fallback: no GEL rate');
  return { rate: Math.round(rate * 10000) / 10000, date: data.time_last_update_unix ? new Date(data.time_last_update_unix * 1000).toISOString() : '' };
}

/**
 * Resolves { rate, sell?, at (ISO), kind: 'bog'|'official', source, stale } or throws (Georgian message).
 * `rate` is the Bank of Georgia BUY rate when available.
 */
export async function fetchEurGelRate() {
  try {
    const r = await fetchBankRates();
    return { rate: r.buy, sell: r.sell, at: r.fetchedAt, kind: 'bog', source: 'საქართველოს ბანკი (ყიდვა)', stale: r.stale };
  } catch (e0) {
    for (const fn of [fromNbg, fromErApi]) {
      try {
        const r = await fn();
        return { rate: r.rate, sell: null, at: r.date, kind: 'official', source: 'ოფიციალური კურსი (ბანკის კურსი ვერ ჩაიტვირთა)', stale: false };
      } catch { /* try next */ }
    }
    console.warn('[rates] all sources failed', e0);
    throw new Error('კურსის ჩამოტვირთვა ვერ მოხერხდა — შეამოწმე ინტერნეტი ან ჩაწერე ხელით');
  }
}
