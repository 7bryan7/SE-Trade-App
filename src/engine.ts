import { PAIRS, rate, quoteUsd } from './market.ts';
import type { Day, Pair } from './market.ts';
export type Side = 'buy' | 'sell';
export type Position = { id: string; pair: Pair; side: Side; units: number; entry: number; collateral: number; openedAt: string; sourceDate: string };
export type Event = { id: string; time: string; type: 'fund' | 'open' | 'close'; pair?: Pair; side?: Side; units?: number; price?: number; amount: number; pnl?: number; sourceDate?: string };
export type Account = { version: 1; cash: number; positions: Position[]; events: Event[] };
export function emptyAccount(): Account { return { version: 1, cash: 0, positions: [], events: [] }; }
function positive(n: number) { return Number.isFinite(n) && n > 0; }
function finite(n: unknown): n is number { return typeof n === 'number' && Number.isFinite(n); }
function stamp() { return new Date().toISOString(); }
export function parseAccount(raw: string): Account {
  const a = JSON.parse(raw);
  if (a?.version !== 1 || !finite(a.cash) || !Array.isArray(a.positions) || !Array.isArray(a.events)) throw new Error('Invalid saved account');
  for (const p of a.positions) {
    if (!p || typeof p.id !== 'string' || !PAIRS.includes(p.pair) || !['buy','sell'].includes(p.side) || !positive(p.units) || !positive(p.entry) || !positive(p.collateral) || !Number.isFinite(Date.parse(p.openedAt)) || !Number.isFinite(Date.parse(p.sourceDate))) throw new Error('Invalid saved position');
  }
  if (new Set(a.positions.map((p: Position) => p.id)).size !== a.positions.length) throw new Error('Duplicate saved positions');
  for (const e of a.events) {
    if (!e || typeof e.id !== 'string' || !['fund','open','close'].includes(e.type) || !finite(e.amount) || !Number.isFinite(Date.parse(e.time)) || (e.pnl !== undefined && !finite(e.pnl)) || (e.type !== 'fund' && (!PAIRS.includes(e.pair) || !['buy','sell'].includes(e.side) || !positive(e.units) || !positive(e.price) || !Number.isFinite(Date.parse(e.sourceDate))))) throw new Error('Invalid saved event');
  }
  return a;
}
export function fund(a: Account, amount: number): Account {
  if (!positive(amount) || amount > 1_000_000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) throw new Error('Enter an amount between $0.01 and $1,000,000 with up to two decimals.');
  return { ...a, cash: a.cash + amount, events: [{ id: crypto.randomUUID(), time: stamp(), type: 'fund', amount }, ...a.events] };
}
export function pnl(p: Position, day: Day) { return (rate(day, p.pair) - p.entry) * p.units * (p.side === 'buy' ? 1 : -1) * quoteUsd(day, p.pair); }
export function openPosition(a: Account, pair: Pair, side: Side, units: number, day: Day): Account {
  if (!PAIRS.includes(pair) || !['buy','sell'].includes(side) || !positive(units) || units > 1_000_000_000) throw new Error('Enter a valid quantity greater than zero.');
  const price = rate(day, pair);
  const collateral = units * price * quoteUsd(day, pair);
  if (!positive(collateral)) throw new Error('A valid market reference rate is required.');
  if (collateral > a.cash) throw new Error('Insufficient virtual funds. Add funds in your paper wallet.');
  const p: Position = { id: crypto.randomUUID(), pair, side, units, entry: price, collateral, openedAt: stamp(), sourceDate: day.date };
  return { ...a, cash: a.cash - collateral, positions: [...a.positions, p], events: [{ id: crypto.randomUUID(), type: 'open', time: p.openedAt, pair, side, units, price, amount: -collateral, sourceDate: day.date }, ...a.events] };
}
export function closePosition(a: Account, id: string, day: Day): Account {
  const p = a.positions.find(p => p.id === id);
  if (!p) throw new Error('This position has already been closed.');
  const profit = pnl(p, day);
  if (!Number.isFinite(profit)) throw new Error('A valid reference rate is required to close.');
  const amount = p.collateral + profit;
  return { ...a, cash: a.cash + amount, positions: a.positions.filter(p => p.id !== id), events: [{ id: crypto.randomUUID(), time: stamp(), type: 'close', pair: p.pair, side: p.side, units: p.units, price: rate(day, p.pair), amount, pnl: profit, sourceDate: day.date }, ...a.events] };
}
