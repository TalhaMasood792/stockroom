// Formatting, dates and the seeded PRNG. Pure helpers with no DOM access, so
// they run unchanged under Node for unit tests.

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat('en-US');

/** Integer cents → "$1,234.50". */
export function formatMoney(cents) {
  return usd.format((cents || 0) / 100);
}
export function formatMoneyCompact(cents) {
  return usdCompact.format((cents || 0) / 100);
}
export function formatQty(n) {
  return intFmt.format(n || 0);
}
/** Signed quantity: "+12", "−4" (true minus sign), "0". */
export function formatSigned(n) {
  if (!n) return '0';
  return (n > 0 ? '+' : '−') + intFmt.format(Math.abs(n));
}
/** Cents → "1234.50" for inputs and CSV. */
export function centsToDecimal(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? '-' + s : s;
}
/** "1,250.5" → 125050 cents without floating point. Null when not a valid non-negative amount. */
export function parseAmount(text) {
  if (text == null) return null;
  const s = String(text).trim().replace(/[,\s$]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s) && !/^\.\d{1,2}$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}
/** Strict integer parse: "12" → 12, "12.5" / "abc" / "" → null. Allows a leading sign. */
export function parseIntStrict(text) {
  const s = String(text ?? '').trim().replace(/,/g, '');
  if (!/^[+-]?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
export function plural(n, one, many = one + 's') {
  return `${formatQty(n)} ${n === 1 ? one : many}`;
}

// ---------- dates (ISO calendar days, compared in UTC) ----------
export function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function todayISO() {
  return localISO(new Date());
}
export function nowStamp() {
  const d = new Date();
  const t = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  return `${localISO(d)}T${t}`;
}
export function isISODate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function addDays(iso, n) {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / 86400000);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export function formatDateShort(iso) {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
export function formatDateTime(stamp) {
  if (!stamp) return '';
  const time = stamp.length > 10 ? stamp.slice(11, 16) : '';
  return `${formatDate(stamp)}${time ? ', ' + time : ''}`;
}
export function relativeDay(iso, today) {
  const d = daysBetween(iso, today);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d > 1 && d < 7) return `${d} days ago`;
  if (d === -1) return 'Tomorrow';
  if (d < -1 && d > -7) return `In ${-d} days`;
  return formatDate(iso);
}

// ---------- deterministic PRNG ----------
/** mulberry32: small, fast, good enough for demo data. */
export function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}
