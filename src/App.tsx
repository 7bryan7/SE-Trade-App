import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { PAIRS, fetchMarket, latest, rate, usable } from './market';
import type { Market, Pair } from './market';
import { closePosition, emptyAccount, fund, openPosition, pnl } from './engine';
import type { Account, Side } from './engine';
import GoogleAuth from './GoogleAuth';
import type { GoogleUser } from './auth';
import { createAccountStore } from './account-store';

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const price = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 5 });
const number = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 });
const dateTime = (s: string | number) => new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const nav = [['dashboard','◫','Dashboard'], ['trade','⇄','Trade'], ['wallet','▣','Wallet'], ['portfolio','▥','Portfolio'], ['history','↺','History'], ['profile','⚙','Data & settings']];
function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section>; }
function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="empty"><span className="empty-icon">↗</span><h3>{title}</h3><p>{children}</p></div>; }
function Change({ value, currency = false }: { value: number | null; currency?: boolean }) { return <span className={value === null ? 'muted' : value >= 0 ? 'positive' : 'negative'}>{value === null ? 'Unavailable' : `${value > 0 ? '+' : ''}${currency ? money(value) : value.toFixed(2) + '%'}`}</span>; }

export default function App() { return <BrowserRouter><GoogleAuth>{(user, signOut) => <Workspace key={user.id} user={user} signOut={signOut} />}</GoogleAuth></BrowserRouter>; }
function Workspace({ user, signOut }: { user: GoogleUser; signOut: () => void }) {
  const store = useMemo(() => createAccountStore(user.id, {
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: key => localStorage.removeItem(key),
  }), [user.id]);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  function leave() { active.current = false; signOut(); }
  const [account, setAccount] = useState<Account>(emptyAccount);
  const [storageError, setStorageError] = useState('');
  const [market, setMarket] = useState<Market | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const refreshing = useRef(false);
  const mutating = useRef(false);
  const [pair, setPair] = useState<Pair>('EUR/USD');
  const navigate = useNavigate();
  useEffect(() => {
    function restore() { try { setAccount(store.read()); setStorageError(''); } catch { setStorageError('Saved account data could not be read. Export or recover your browser data before clearing it in settings. Changes are blocked.'); } }
    function onStorage(e: StorageEvent) { if (e.storageArea === localStorage && (e.key === store.key || e.key === null)) restore(); }
    restore(); window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [store]);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true; setLoading(true);
    try { setMarket(await fetchMarket()); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to reach the reference data provider. Check your connection and retry.'); }
    finally { refreshing.current = false; setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); const id = setInterval(() => void refresh(), 15 * 60_000); const tick = setInterval(() => setClock(Date.now()), 30_000); return () => { clearInterval(id); clearInterval(tick); }; }, [refresh]);
  void clock;
  const tradable = usable(market) && !error;
  const day = market ? latest(market) : null;
  const change = (p: Pair) => market ? (rate(latest(market), p) / rate(market.days[market.days.length - 2], p) - 1) * 100 : null;
  const openPnl = day ? account.positions.reduce((sum, p) => sum + pnl(p, day), 0) : account.positions.length ? null : 0;
  const collateral = account.positions.reduce((sum, p) => sum + p.collateral, 0);
  const realized = account.events.reduce((sum, e) => sum + (e.pnl ?? 0), 0);
  const deposits = account.events.filter(e => e.type === 'fund').reduce((sum, e) => sum + e.amount, 0);
  const equity = openPnl === null ? null : account.cash + collateral + openPnl;
  async function mutate(fn: (a: Account) => Account, success: string) {
    if (mutating.current) return;
    mutating.current = true; setBusy(true); setMessage('');
    try {
      const commit = async () => {
        if (!active.current || Date.now() >= user.expiresAt) { signOut(); throw new Error('Sign in again before updating your account.'); }
        const next = fn(store.read());
        store.write(next);
        setAccount(next); setStorageError(''); setMessage(success);
      };
      if (navigator.locks) await navigator.locks.request(store.key, commit); else await commit();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save the account. Check browser storage permissions.'); }
    finally { mutating.current = false; setBusy(false); }
  }
  function trade(side: Side, units: number) {
    if (!tradable || !market) { setMessage('Freshly fetched reference data is required. Refresh before trading.'); return; }
    void mutate(a => openPosition(a, pair, side, units, latest(market)), `Paper ${side} opened for ${pair}.`);
  }
  function close(id: string) {
    if (!tradable || !market) { setMessage('Reference data is unavailable or stale. Refresh before closing.'); return; }
    void mutate(a => closePosition(a, id, latest(market)), 'Paper position closed. Proceeds returned to your virtual wallet.');
  }
  function selectPair(p: Pair) { setPair(p); navigate('/trade'); }
  function positions() {
    return <Card><div className="card-heading"><h2>Open positions <span className="count">{account.positions.length}</span></h2><span className="muted">Paper positions · USD P/L</span></div>{!account.positions.length ? <Empty title="Your next move starts here">Add virtual funds, explore a currency pair, and place your first paper trade.</Empty> : <div className="table-scroll"><table><thead><tr>{['Pair / direction','Units','Entry','Reference','Open P/L',''].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{account.positions.map(p => <tr key={p.id}><td><strong>{p.pair}</strong><small className={p.side === 'buy' ? 'positive' : 'negative'}>{p.side === 'buy' ? 'Buy / long' : 'Sell / short'} · {p.sourceDate}</small></td><td>{number(p.units)}</td><td>{price(p.entry)}</td><td>{day ? price(rate(day, p.pair)) : 'Unavailable'}</td><td><Change value={day ? pnl(p, day) : null} currency /></td><td><button className="secondary compact" disabled={!tradable || busy || !!storageError} onClick={() => close(p.id)}>Close</button></td></tr>)}</tbody></table></div>}</Card>;
  }
  function history(limit?: number) {
    const events = limit ? account.events.slice(0, limit) : account.events;
    return !events.length ? <Empty title="A clean trading journal">Your virtual funding and completed paper orders will appear here.</Empty> : <div className="table-scroll"><table><thead><tr>{['Executed at','Activity','Pair / units','Reference rate','Cash movement','Realized P/L'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{events.map(e => <tr key={e.id}><td>{dateTime(e.time)}<small>{e.sourceDate ? `Reference: ${e.sourceDate}` : 'Virtual funds only'}</small></td><td><span className="badge">{e.type === 'fund' ? 'Virtual funding' : `${e.type === 'open' ? 'Opened' : 'Closed'} ${e.side}`}</span></td><td>{e.pair ?? '—'}{e.units && <small>{number(e.units)} units</small>}</td><td>{e.price ? price(e.price) : '—'}</td><td>{money(e.amount)}</td><td>{e.pnl !== undefined ? <Change value={e.pnl} currency /> : '—'}</td></tr>)}</tbody></table></div>;
  }
  function exportCsv() {
    const rows = [['id','executed_at','type','pair','side','units','reference_rate','cash_movement_usd','realized_pnl_usd','reference_date'], ...account.events.map(e => [e.id,e.time,e.type,e.pair ?? '',e.side ?? '',e.units ?? '',e.price ?? '',e.amount,e.pnl ?? '',e.sourceDate ?? ''])];
    const blob = new Blob([rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `tradesense-paper-history-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  const summary = <div className="stats">
    {[
      ['Available funds', money(account.cash), 'Virtual USD · ready to trade', '▣'],
      ['Account equity', equity === null ? 'Unavailable' : money(equity), 'Available + collateral + open P/L', '▥'],
      ['Open profit / loss', <Change value={openPnl} currency />, `${account.positions.length} open paper positions`, '↗'],
      ['Realized profit / loss', <Change value={realized} currency />, `${account.events.filter(e => e.type === 'close').length} closed paper trades`, '⇄'],
    ].map(([label,value,note,icon], i) => <Card key={i}><div className="stat-label">{label}<span>{icon}</span></div><div className="stat-value">{value}</div><p className="muted">{note}</p></Card>)}
  </div>;
  return <div className="app-shell">
    <aside className="sidebar"><a href="/dashboard" className="brand"><span className="brand-icon">TS</span>TradeSense</a><div className="workspace-label">TRADING WORKSPACE</div><nav>{nav.map(([path,icon,label]) => <NavLink key={path} to={'/' + path}><span className="nav-icon">{icon}</span>{label}</NavLink>)}</nav><div className="sidebar-bottom"><div className="practice-symbol">◇</div><strong>Practice with purpose.</strong><p>Real reference data.<br />Room to learn.</p><span className="badge gold">Paper trading only</span></div></aside>
    <div className="workspace"><header className="topbar"><span className="breadcrumb">Workspace <span>/</span> Paper account</span><div className="topbar-right"><span className="badge gold"><span className="dot" />Simulation</span><span className="signed-in-user" title={user.email}>{user.name}</span><span className="avatar" title={user.email}>{user.name.slice(0, 2).toUpperCase()}</span><button className="secondary compact sign-out" onClick={leave}>Sign out</button></div></header>
    <main><Routes>
      <Route path="/dashboard" element={<><PageTitle eyebrow="YOUR TRADING WORKSPACE" title="Dashboard" subtitle="A clear view of your practice account. Every trade is a learning opportunity."><button onClick={() => navigate('/trade')}>New paper trade <span>↗</span></button></PageTitle>{summary}<div className="dashboard-grid"><Card><div className="card-heading"><h2>Market watch</h2><span className="badge gold">Daily reference</span></div><MarketTable market={market} selectPair={selectPair} change={change} /></Card><Card className="start-card"><span className="eyebrow">A SAFE SPACE TO PRACTICE</span><h2>Real markets.<br />Your next move.</h2><p>Build your strategy using published FX reference rates and a virtual USD balance.</p><div className="start-details"><span>Market data</span><strong>Frankfurter</strong><span>Execution</span><strong>Daily reference rate</strong><span>Real money</span><strong>Never involved</strong></div><button className="secondary" onClick={() => navigate('/wallet')}>{deposits ? 'Manage virtual funds' : 'Add virtual funds'} <span>→</span></button></Card></div>{positions()}<Card><div className="card-heading"><h2>Recent activity</h2><NavLink to="/history" className="text-link">View all →</NavLink></div>{history(5)}</Card></>} />
      <Route path="/trade" element={<><PageTitle eyebrow="EXPLORE THE MARKET" title="Trade" subtitle="Practice long or short positions at published daily FX reference rates." /><div className="trade-grid"><div><Card><div className="chart-heading"><div><label className="sr-only" htmlFor="chart-pair">Currency pair</label><select id="chart-pair" className="pair-select" value={pair} onChange={e => setPair(e.target.value as Pair)}>{PAIRS.map(p => <option key={p}>{p}</option>)}</select><p className="muted">{pair.split('/')[1]} per 1 {pair.split('/')[0]}</p></div><div className="quote"><strong>{day ? price(rate(day,pair)) : '—'}</strong><Change value={change(pair)} /></div></div><Chart market={market} pair={pair} /><div className="chart-footer"><span>Frankfurter · daily observations</span><span>Reference date: {day?.date ?? 'Unavailable'}</span></div></Card><div className="notice"><span>ⓘ</span><p>Daily reference rates are not executable broker quotes. Paper fills use the displayed reference rate with no invented spread, fees, or slippage. Each position reserves 100% of its entry notional in virtual USD.</p></div></div><OrderForm key={pair} pair={pair} market={market} cash={account.cash} disabled={!tradable || busy || !!storageError} onTrade={trade} /></div>{positions()}</>} />
      <Route path="/portfolio" element={<><PageTitle eyebrow="TRACK YOUR STRATEGY" title="Portfolio" subtitle="Your open paper positions, valued using the latest fetched FX reference data." />{summary}{positions()}<div className="notice"><span>ⓘ</span><p>Equity includes reserved collateral and unrealized P/L. P/L is converted from the pair’s quote currency into USD using the same dated reference data. Short-position losses can exceed their reserved collateral.</p></div></>} />
      <Route path="/wallet" element={<><PageTitle eyebrow="YOUR PRACTICE CAPITAL" title="Paper wallet" subtitle="Add virtual funds to your local practice account. No deposits, payments, or real money." />{summary}<div className="dashboard-grid"><FundingForm busy={busy || !!storageError} onFund={amount => void mutate(a => fund(a, amount), `${money(amount)} in virtual funds added.`)} /><Card><div className="card-heading"><h2>Balance breakdown</h2><span className="badge gold">Virtual USD</span></div><dl className="breakdown"><dt>Total virtual funds added</dt><dd>{money(deposits)}</dd><dt>Available funds</dt><dd>{money(account.cash)}</dd><dt>Reserved position collateral</dt><dd>{money(collateral)}</dd><dt>Realized P/L</dt><dd><Change value={realized} currency /></dd><dt>Open P/L</dt><dd><Change value={openPnl} currency /></dd></dl><p className="panel-note">The wallet is an internal simulation ledger, generated only by your actions. There is no connection to a bank or broker.</p></Card></div><Card><div className="card-heading"><h2>Wallet & trading activity</h2></div>{history(10)}</Card></>} />
      <Route path="/history" element={<><PageTitle eyebrow="YOUR TRADING JOURNAL" title="History" subtitle="A record of your own paper activity, including the source date used for every fill."><button className="secondary" onClick={exportCsv} disabled={!account.events.length}>↓ Export CSV</button></PageTitle><Card><div className="card-heading"><h2>Account activity</h2><span className="muted">{account.events.length} records · newest first</span></div>{history()}</Card></>} />
      <Route path="/profile" element={<><PageTitle eyebrow="TRANSPARENT BY DESIGN" title="Data & settings" subtitle="Know where your prices come from and how your paper account works." /><div className="settings-grid"><Card><div className="card-heading"><h2>Market data source</h2><span className="badge gold">No API key required</span></div><div className="panel-body"><h3>Frankfurter API v2</h3><p>Public daily foreign exchange reference rates sourced from central banks and official institutions. Cross rates are derived from one complete set of USD-based observations for each date.</p><a className="text-link" href="https://frankfurter.dev/" target="_blank" rel="noreferrer">Read the provider documentation ↗</a><dl className="breakdown"><dt>Latest observation</dt><dd>{day?.date ?? 'Unavailable'}</dd><dt>Last successful fetch</dt><dd>{market ? dateTime(market.receivedAt) : 'Never'}</dd><dt>Refresh frequency</dt><dd>Every 15 minutes while open</dd><dt>Trading data limit</dt><dd>Fetched within 20 minutes; reference under 7 days old</dd></dl>{market && <a className="endpoint" href={market.endpoint} target="_blank" rel="noreferrer">{market.endpoint}</a>}<p className="panel-note">No synthetic prices, candles, volume, bid/ask spreads, or seeded trade history. Missing data remains unavailable. Weekend or holiday reference dates may lag; refreshes do not make daily data intraday.</p></div></Card><Card><div className="card-heading"><h2>Your local paper account</h2></div><div className="panel-body"><p>Signed in as {user.email || user.name}. Your balances, positions, and history are saved separately for this Google account in this browser. There is no cloud sync or brokerage connection.</p><p>Signing out keeps your saved account. Sign in with the same Google account to return to it. Other Google accounts start with their own empty ledger.</p><p>Keep a copy of your activity before clearing browser storage.</p><button className="secondary" onClick={exportCsv} disabled={!account.events.length}>Export history as CSV</button><hr /><h3>Clear local account</h3><p>Deletes only your signed-in account’s virtual balance, positions, and activity in this browser. This cannot be undone.</p><button className="danger" disabled={busy} onClick={() => { if (window.confirm('Permanently delete your signed-in paper account’s balance, positions, and history in this browser?')) { void mutate(() => emptyAccount(), 'Local paper account cleared.'); } }}>Clear paper account</button>{storageError && <button className="danger" onClick={() => { if (window.confirm('Discard unreadable saved data for your signed-in account permanently?')) { try { store.clear(); setAccount(emptyAccount()); setStorageError(''); } catch { setMessage('Browser storage is unavailable.'); } } }}>Discard unreadable saved data</button>}</div></Card></div></>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </main><footer><span>TradeSense <span className="footer-divider">/</span> Paper trading workspace</span><span>Virtual funds only · No real orders</span></footer></div>
    <div className={`data-status ${error || (!loading && !usable(market)) ? 'warning' : ''}`} role="status"><span className="dot" /><span>{loading ? 'Fetching daily reference data…' : error ? `Data unavailable — trading paused. ${error}` : market ? `Frankfurter · reference ${day?.date} · fetched ${dateTime(market.receivedAt)}${!usable(market) ? ' · Stale: trading paused' : ''}` : 'Waiting for reference data'}</span><button className="text-link" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : '↻ Refresh'}</button></div>
    {storageError && <div className="storage-alert" role="alert">{storageError} <NavLink to="/profile">Settings →</NavLink></div>}
    {message && <div className="toast" role="status"><span>{message}</span><button aria-label="Dismiss message" onClick={() => setMessage('')}>×</button></div>}
  </div>;
}
function PageTitle({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle: string; children?: ReactNode }) { return <div className="page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{children}</div>; }
function MarketTable({ market, selectPair, change }: { market: Market | null; selectPair: (p: Pair) => void; change: (p: Pair) => number | null }) {
  return <div className="table-scroll"><table className="market-table"><thead><tr><th>Currency pair</th><th>Reference rate</th><th>Prev. observation</th><th /></tr></thead><tbody>{PAIRS.map(p => <tr key={p}><td><div className="pair-cell"><span className="currency-icon">{p.slice(0,1)}</span><div><strong>{p}</strong><small>{p.startsWith('USD') ? 'US dollar' : p.startsWith('EUR') ? 'Euro' : p.startsWith('GBP') ? 'British pound' : 'Australian dollar'}</small></div></div></td><td>{market ? price(rate(latest(market),p)) : '—'}</td><td><Change value={change(p)} /></td><td><button className="row-action" aria-label={`Trade ${p}`} onClick={() => selectPair(p)}>↗</button></td></tr>)}</tbody></table></div>;
}
function Chart({ market, pair }: { market: Market | null; pair: Pair }) {
  const [range, setRange] = useState(30);
  const [hover, setHover] = useState<number | null>(null);
  const days = market?.days.filter(d => Date.parse(d.date) >= Date.parse(latest(market).date) - range * 86400_000) ?? [];
  const values = days.map(d => rate(d,pair));
  const min = Math.min(...values), max = Math.max(...values), pad = (max-min || max * 0.001) * .18;
  const low = min-pad, high = max+pad;
  const x = (i: number) => 25 + i / Math.max(1,values.length-1) * 715;
  const y = (n: number) => 230 - (n-low) / (high-low) * 205;
  const points = values.map((v,i) => `${x(i)},${y(v)}`).join(' ');
  const active = hover === null ? null : days[hover];
  return <><div className="chart-toolbar"><span>REFERENCE RATE HISTORY</span><div>{[30,90].map(r => <button key={r} className={r === range ? 'selected' : ''} onClick={() => {setRange(r);setHover(null);}}>{r}D</button>)}</div></div>{values.length < 2 ? <Empty title="Chart awaiting reference data">Published daily observations will appear when the provider is reachable.</Empty> : <div className="chart"><div className="chart-tooltip">{active ? `${active.date} · ${price(rate(active,pair))}` : `${days[0].date} — ${days[days.length-1].date} · ${days.length} observations`}</div><svg viewBox="0 0 840 275" role="img" aria-label={`${pair} published daily reference rates over ${range} days`} onMouseLeave={() => setHover(null)} onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0,Math.min(values.length-1,Math.round(((e.clientX-r.left)/r.width*840-25)/715*(values.length-1))))); }}><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b77900" stopOpacity=".16"/><stop offset="100%" stopColor="#b77900" stopOpacity="0"/></linearGradient></defs>{[0,1,2,3,4].map(i => {const v = low+(high-low)*i/4; return <g key={i}><line x1="25" x2="740" y1={y(v)} y2={y(v)} stroke="#e9edf1" strokeDasharray="4 5"/><text x="758" y={y(v)+4}>{price(v)}</text></g>;})}<polygon points={`25,245 ${points} 740,245`} fill="url(#area)"/><polyline points={points} fill="none" stroke="#b77900" strokeWidth="2.4" strokeLinejoin="round"/>{hover !== null && values[hover] !== undefined && <g><line x1={x(hover)} x2={x(hover)} y1="20" y2="245" stroke="#b77900" strokeDasharray="3 4"/><circle cx={x(hover)} cy={y(values[hover])} r="4" fill="#b77900" stroke="white" strokeWidth="2"/></g>}{[0,Math.floor((days.length-1)/2),days.length-1].map((i,j) => <text key={j} x={x(i)} y="268" textAnchor={j === 0 ? 'start' : j === 2 ? 'end' : 'middle'}>{days[i].date.slice(5)}</text>)}</svg></div>}</>;
}
function OrderForm({ pair, market, cash, disabled, onTrade }: { pair: Pair; market: Market | null; cash: number; disabled: boolean; onTrade: (s: Side,n: number) => void }) {
  const [side,setSide] = useState<Side>('buy'); const [units,setUnits] = useState('');
  const n = Number(units); const d = market ? latest(market) : null; const r = d ? rate(d,pair) : null;
  const baseUsd = d ? 1/d.rates[pair.split('/')[0]] : null;
  const estimate = baseUsd === null || !Number.isFinite(n) ? null : n * baseUsd;
  const valid = Number.isFinite(n) && n > 0 && n <= 1e9 && estimate !== null && estimate <= cash;
  return <Card className="order-card"><div className="card-heading"><h2>Place paper order</h2><span className="badge">1×</span></div><form className="panel-body" onSubmit={e => {e.preventDefault();if(valid && !disabled) onTrade(side,n);}}><div className="side-switch">{(['buy','sell'] as const).map(s => <button type="button" key={s} aria-pressed={s===side} className={s===side ? s : ''} onClick={() => setSide(s)}>{s === 'buy' ? 'Buy / Long' : 'Sell / Short'}</button>)}</div><label>Execution model<div className="fixed-input">Daily reference <span className="badge gold">Paper</span></div></label><label htmlFor="units">Amount ({pair.split('/')[0]} units)</label><input id="units" type="number" min="0.000001" max="1000000000" step="any" placeholder="Enter quantity" required value={units} onChange={e => setUnits(e.target.value)} /><div className="available"><span>Available funds</span><strong>{money(cash)}</strong></div><dl className="order-summary"><dt>Reference rate</dt><dd>{r === null ? '—' : price(r)}</dd><dt>Reference date</dt><dd>{d?.date ?? '—'}</dd><dt>USD collateral</dt><dd>{estimate === null ? '—' : money(estimate)}</dd><dt>Simulation fee</dt><dd>{money(0)}</dd></dl>{estimate !== null && estimate > cash && <p className="negative">Insufficient virtual funds. Add funds in Wallet.</p>}<button className={`submit-order ${side}`} disabled={disabled || !valid}>Open paper {side === 'buy' ? 'buy' : 'sell'} <span>→</span></button><p className="order-note">Virtual funds. Reference-rate fills.<br />No real orders are sent.</p></form></Card>;
}
function FundingForm({ busy, onFund }: { busy: boolean; onFund: (n: number) => void }) { const [amount,setAmount] = useState(''); return <Card><div className="card-heading"><h2>Add virtual funds</h2><span className="badge gold">Simulation</span></div><form className="panel-body" onSubmit={e => {e.preventDefault();onFund(Number(amount));}}><p>Choose how much virtual USD you want to practice with.</p><label htmlFor="funds">Virtual USD amount</label><input id="funds" type="number" step="0.01" min="0.01" max="1000000" required placeholder="e.g. 10000" value={amount} onChange={e => setAmount(e.target.value)} /><div className="amount-presets">{[1000,10000,100000].map(n => <button type="button" className="secondary compact" key={n} onClick={() => setAmount(String(n))}>{money(n)}</button>)}</div><button disabled={busy || !Number.isFinite(Number(amount)) || Number(amount) <= 0}>Add virtual funds <span>+</span></button><p className="panel-note">This creates simulation capital in your browser. It is not a deposit and has no monetary value.</p></form></Card>; }
