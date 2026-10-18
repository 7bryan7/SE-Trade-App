import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AUTH_SESSION_KEY, verifyGoogleCredential } from './auth';
import type { GoogleUser } from './auth';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '';
type GoogleIdentity = {
  initialize: (options: { client_id: string; nonce: string; callback: (response: { credential: string }) => void; auto_select: boolean; ux_mode: string }) => void;
  renderButton: (target: HTMLElement, options: { type: string; theme: string; size: string; text: string; shape: string; width: number }) => void;
  disableAutoSelect: () => void;
};
declare global { interface Window { google?: { accounts: { id: GoogleIdentity } } } }
let libraryPromise: Promise<GoogleIdentity> | null = null;
function loadGoogle() {
  if (window.google?.accounts.id) return Promise.resolve(window.google.accounts.id);
  if (libraryPromise) return libraryPromise;
  libraryPromise = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    const timer = setTimeout(() => { script.remove(); libraryPromise = null; reject(new Error('Google sign-in could not load. Check your connection and retry.')); }, 15000);
    script.onload = () => { clearTimeout(timer); if (window.google?.accounts.id) resolve(window.google.accounts.id); else { libraryPromise = null; reject(new Error('Google sign-in is unavailable. Please retry.')); } };
    script.onerror = () => { clearTimeout(timer); script.remove(); libraryPromise = null; reject(new Error('Google sign-in could not load. Check your connection and retry.')); };
    document.head.appendChild(script);
  });
  return libraryPromise;
}
export default function GoogleAuth({ children }: { children: (user: GoogleUser, signOut: () => void) => ReactNode }) {
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState('');
  const signOut = useCallback(() => {
    setUser(null);
    try { sessionStorage.removeItem(AUTH_SESSION_KEY); } catch { /* Session will be reverified before restoration. */ }
    window.google?.accounts.id.disableAutoSelect();
  }, []);
  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const saved = sessionStorage.getItem(AUTH_SESSION_KEY);
        if (saved && CLIENT_ID) {
          const session = JSON.parse(saved);
          if (typeof session.credential !== 'string' || typeof session.nonce !== 'string') throw new Error('Invalid session');
          const restored = await verifyGoogleCredential(session.credential, CLIENT_ID, session.nonce);
          if (active) setUser(restored);
        }
      } catch { if (active) { signOut(); setError('Your session could not be restored. Please sign in again.'); } }
      finally { if (active) setRestoring(false); }
    }
    void restore(); return () => { active = false; };
  }, [signOut]);
  useEffect(() => {
    if (!user) return;
    const checkExpiry = () => { if (Date.now() >= user.expiresAt) { signOut(); setError('Your session expired. Sign in again to continue with your saved account.'); } };
    const timer = setTimeout(checkExpiry, Math.max(0, user.expiresAt - Date.now()));
    window.addEventListener('focus', checkExpiry); document.addEventListener('visibilitychange', checkExpiry);
    return () => { clearTimeout(timer); window.removeEventListener('focus', checkExpiry); document.removeEventListener('visibilitychange', checkExpiry); };
  }, [user, signOut]);
  async function onCredential(credential: string, nonce: string) {
    const signedIn = await verifyGoogleCredential(credential, CLIENT_ID, nonce);
    // Only the current tab's short-lived ID credential is stored. No refresh/access token or secret.
    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ credential, nonce }));
    setError(''); setUser(signedIn);
  }
  if (restoring) return <div className="auth-loading" role="status">Opening your workspace…</div>;
  if (user && Date.now() < user.expiresAt) return children(user, signOut);
  return <Login onCredential={onCredential} error={error} />;
}
function Login({ onCredential, error: sessionError }: { onCredential: (credential: string, nonce: string) => Promise<void>; error: string }) {
  const target = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!!CLIENT_ID);
  const [verifying, setVerifying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!CLIENT_ID) return;
    let active = true;
    const nonce = crypto.randomUUID();
    setLoading(true); setError('');
    void loadGoogle().then(google => {
      if (!active || !target.current) return;
      google.initialize({ client_id: CLIENT_ID, nonce, auto_select: false, ux_mode: 'popup', callback: response => {
        if (!active) return;
        setVerifying(true); setError('');
        void onCredential(response.credential, nonce).catch(() => { if (active) setError('Google sign-in could not be verified. Please try again.'); }).finally(() => { if (active) setVerifying(false); });
      } });
      target.current.replaceChildren();
      google.renderButton(target.current, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', width: Math.min(340, target.current.clientWidth || 280) });
      setLoading(false);
    }).catch(e => { if (active) {setError(e.message);setLoading(false);} });
    return () => { active = false; };
    // The callback only uses the fixed client configuration and state setters.
  }, [attempt]);
  return <div className="login-shell"><section className="login-story"><a className="login-brand" href="/"><span className="brand-icon">TS</span>TradeSense</a><div className="login-pitch"><span className="eyebrow">YOUR SPACE TO LEARN THE MARKETS</span><h1>Real reference data. <br />A smarter way <br />to practice.</h1><p>Explore forex, test a strategy, and build confidence with a paper trading account of your own.</p><div className="login-features"><span>↗ Published daily FX rates</span><span>◇ Virtual funds, zero real money</span><span>▣ Your account, saved in this browser</span></div></div><span className="login-footnote">Paper trading only. No real orders or payments.</span></section><section className="login-form"><div className="login-card"><span className="badge gold">PAPER TRADING WORKSPACE</span><h2>Welcome to TradeSense</h2><p>Sign in to open your personal practice account.</p><div className="google-button" ref={target} aria-busy={loading || verifying} />{!CLIENT_ID && <><button className="google-unconfigured" disabled><span aria-hidden="true">G</span>Continue with Google</button><p className="login-error" role="status">Google sign-in isn’t configured yet. Add the app’s Google Web Client ID to enable it.</p></>}{loading && <p role="status">Loading Google sign-in…</p>}{verifying && <p role="status">Verifying your Google account…</p>}{(error || sessionError) && <p className="login-error" role="alert">{error || sessionError}</p>}{error && !verifying && <button className="secondary" onClick={() => setAttempt(a => a+1)}>Retry Google sign-in</button>}<div className="login-privacy"><strong>Your practice account stays on this device.</strong><p>Balances, positions, and history are kept separately for each Google account in this browser. Sign out before sharing your device.</p></div></div><p className="login-form-footer">TradeSense · Learn by doing.</p></section></div>;
}
