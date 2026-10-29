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

function parseRates(data) {
  const buy = Number(data.buy), sell = Number(data.sell);
  if (!(buy > 1 && buy < 10)) throw new Error('rates.json: bad buy rate');
  const fetchedAt = String(data.fetchedAt || '');
  const ageH = fetchedAt ? (Date.now() - new Date(fetchedAt).getTime()) / 3600000 : Infinity;
  return { buy, sell: sell > 0 ? sell : null, official: Number(data.official) || null, fetchedAt, stale: ageH > STALE_HOURS };
}

/** Bank of Georgia rates from rates.json: { buy, sell, official, fetchedAt, stale }. */
export async function fetchBankRates() {
  return parseRates(await getJson(ratesUrl()));
}

/**
 * The same file read through the GitHub API — never served from the 5-minute CDN cache of
 * raw.githubusercontent.com (that cache hid the fresh rate while "⏳" was waiting, v16).
 */
async function fetchBankRatesUncached(token = getRatesToken()) {
  const { owner, repo } = repoParts();
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/rates.json?ref=rates&t=${Date.now()}`;
  const headers = { Accept: 'application/vnd.github.raw+json' };
  let res = await fetch(url, { cache: 'no-store', headers: token ? { ...headers, Authorization: `token ${token}` } : headers });
  if (token && (res.status === 401 || res.status === 403 || res.status === 404)) res = await fetch(url, { cache: 'no-store', headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  // Without the "raw" media type GitHub wraps the file in base64.
  if (body && typeof body.content === 'string' && body.encoding === 'base64') return parseRates(JSON.parse(atob(body.content.replace(/s/g, ''))));
  return parseRates(body);
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

// ---------------- "Update now" (on demand) ----------------
// The bank rate file is refreshed by a GitHub Action. With a small separate token (only
// "Actions: read and write" on this one repository) the app can start that Action right now
// and wait for the fresh file (~30–90 s). The token stays on this device only.

const RATES_TOKEN_KEY = 'familyBudget.ratesToken';

export function getRatesToken() {
  try { return localStorage.getItem(RATES_TOKEN_KEY) || ''; } catch { return ''; }
}
export function setRatesToken(token) {
  try { localStorage.setItem(RATES_TOKEN_KEY, String(token || '').trim()); } catch { /* ignore */ }
}

function repoParts() {
  let owner = OWNER, repo = REPO;
  if (typeof location !== 'undefined' && /\.github\.io$/.test(location.hostname)) {
    owner = location.hostname.split('.')[0];
    repo = location.pathname.split('/').filter(Boolean)[0] || REPO;
  }
  return { owner, repo };
}

/** Starts the rate Action now. Resolves true if GitHub accepted it. */
export async function triggerRatesUpdate(token = getRatesToken()) {
  if (!token) return false;
  const { owner, repo } = repoParts();
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/rates.yml/dispatches`, {
    method: 'POST',
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' })
  });
  if (res.status === 204) return true;
  if (res.status === 401 || res.status === 403 || res.status === 404) throw new Error('კურსის token არ მუშაობს — შეამოწმე (Actions: Read and write, რეპოზიტორია SalEx)');
  throw new Error(`GitHub-მა უარი თქვა (${res.status})`);
}

/** Starts the Action and waits until rates.json is newer than `since`. Resolves the fresh rate or null. */
export async function fetchFreshRateNow({ timeoutMs = 180000, onWait } = {}) {
  const since = Date.now() - 60000;
  const ok = await triggerRatesUpdate();
  if (!ok) return null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise(r => setTimeout(r, 6000));
    if (onWait) onWait(Math.round((Date.now() - started) / 1000));
    try {
      const r = await fetchBankRatesUncached();
      if (r.fetchedAt && new Date(r.fetchedAt).getTime() > since) {
        return { rate: r.buy, sell: r.sell, at: r.fetchedAt, kind: 'bog', source: 'საქართველოს ბანკი (ყიდვა)', stale: false };
      }
    } catch { /* keep waiting */ }
  }
  return null;
}
