export const PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'EUR/GBP', 'GBP/JPY'] as const;
export type Pair = typeof PAIRS[number];
export const CURRENCIES = ['EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD'];
export type Day = { date: string; rates: Record<string, number> };
export type Market = { days: Day[]; receivedAt: number; endpoint: string };
export const SOURCE = 'https://api.frankfurter.dev/v2/rates';
export function rate(day: Day, pair: Pair) {
  const [base, quote] = pair.split('/');
  return day.rates[quote] / day.rates[base];
}
export function quoteUsd(day: Day, pair: Pair) { return 1 / day.rates[pair.split('/')[1]]; }
export function latest(m: Market) { return m.days[m.days.length - 1]; }
export function usable(m: Market | null): m is Market {
  if (!m || !m.days.length) return false;
  const age = Date.now() - Date.parse(latest(m).date + 'T00:00:00Z');
  return Date.now() - m.receivedAt < 20 * 60_000 && age >= -86400_000 && age < 7 * 86400_000;
}
export function parseRates(rows: unknown, now = Date.now()): Day[] {
  if (!Array.isArray(rows)) throw new Error('Market provider returned an invalid response.');
  const grouped = new Map<string, Record<string, number>>();
  for (const row of rows) {
    if (!row || row.base !== 'USD' || !CURRENCIES.includes(row.quote) || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || typeof row.rate !== 'number' || !Number.isFinite(row.rate) || row.rate <= 0) continue;
    if (Date.parse(row.date + 'T00:00:00Z') > now + 86400_000) continue;
    const rates = grouped.get(row.date) ?? { USD: 1 };
    rates[row.quote] = row.rate;
    grouped.set(row.date, rates);
  }
  const days = [...grouped].filter(([, r]) => CURRENCIES.every(c => Number.isFinite(r[c]))).sort(([a], [b]) => a.localeCompare(b)).map(([date, rates]) => ({ date, rates }));
  if (days.length < 2) throw new Error('Not enough complete reference data from the provider.');
  return days;
}
export async function fetchMarket(): Promise<Market> {
  const from = new Date(Date.now() - 100 * 86400_000).toISOString().slice(0, 10);
  const endpoint = `${SOURCE}?base=USD&quotes=${CURRENCIES.join(',')}&from=${from}`;
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Market provider returned HTTP ${response.status}. Try again shortly.`);
  const market = { days: parseRates(await response.json()), receivedAt: Date.now(), endpoint };
  if (!usable(market)) throw new Error('The latest reference data is over seven days old. Trading is paused.');
  return market;
}
