# TradeSense

A forex paper-trading web application based on the supplied Figma React export. It preserves the light sidebar, gold accents, rounded cards, dashboard, trading, wallet, portfolio, and history structure.

## Run locally

Requires Node.js 22.12+ (tested on 22.23.3) and npm.

```bash
npm install
npm run dev -- --port 5173
```

Configure Google sign-in below, then open http://localhost:5173 (or an authorized 127.0.0.1 origin). For production output:

```bash
npm run check
npm test
npm run build
npm run preview
```

`dist/` is the static production build. A static host must rewrite application paths such as `/trade` to `index.html` for direct navigation. There is no server or client secret to configure. Set the public Google Web Client ID at build time.

## Deploy to Vercel

The repository is configured for a static Vite deployment. No Supabase service, server function, or database is required.

1. Push the project to your Git repository and import it into Vercel. Use this project directory as the Root Directory.
2. Vercel reads `vercel.json`: framework **Vite**, install command **`npm ci`**, build command **`npm run build:vercel`**, output **`dist`**. `package.json` selects Node.js **22.x**. The build runs the TypeScript check, all tests, and the production build.
3. In **Project Settings → Environment Variables**, set this value for **Production** and any **Preview** environments where Google login is needed:

   ```text
   VITE_GOOGLE_CLIENT_ID=503552468670-530p8fdbdpffhts7og1tllad66u6l9em.apps.googleusercontent.com
   ```

   This is a public OAuth client ID, not a secret. `.env.local` is excluded from Git and Vercel uploads; configure the hosted value explicitly. A production build fails with a clear error if the ID is missing or malformed. Environment changes require a new deployment because Vite embeds the value at build time.

4. In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials), open that OAuth Web Client and add the exact HTTPS site origin under **Authorized JavaScript origins** (for example, `https://your-project.vercel.app`). Include a custom domain separately if you use one. Origins have no path or trailing slash. This application uses the Google JavaScript popup callback, so it does not need a Vercel callback route or an authorized redirect URI. Configure consent-screen test users if the OAuth app remains in testing mode.
5. Deploy. Open `/trade` directly and refresh to check the SPA rewrite. Sign in, add virtual funds, sign out, and sign back in to confirm the account is restored. Check that a second Google account starts with its own empty ledger.

`vercel.json` provides the React Router fallback to `index.html` and `Cross-Origin-Opener-Policy: same-origin-allow-popups` for Google popup compatibility. `.vercelignore` excludes local environment files, reference imports, screenshots, and generated build/dependency directories from CLI uploads.

For preview authentication, use an exact stable preview origin registered in Google Cloud Console; a wildcard Vercel origin does not replace exact origin registration. Register each origin you actually use. A deployment protection/login screen must be passed before testing the app itself.

Browser data remains local to each origin. Moving from localhost to Vercel, from a preview URL to production, or to a new domain creates a separate local account store; existing balances and positions are not automatically transferred. A stable production domain preserves the same origin across deployments.

This prepares the project for deployment; it does not create or publish a Vercel project. Google account login on the hosted domain must be verified after that domain is registered and deployed.

References: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite), [Google client setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

## Data provenance

All market prices and chart observations are fetched from **Frankfurter v2**:

- Documentation: https://frankfurter.dev/
- Endpoint: https://api.frankfurter.dev/v2/rates
- Parameters: `base=USD&quotes=EUR,GBP,JPY,CHF,AUD,CAD&from=YYYY-MM-DD`
- The date is calculated at runtime for the preceding 100 calendar days.
- Free public HTTPS API; no API key or signup. This is a REST market-data API, not a blockchain RPC.
- Daily reference rates from central banks and official sources, not intraday executable broker quotes.
- Public browser CORS and successful live responses verified during development.
- Eight supported pairs: EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD, EUR/GBP, GBP/JPY.

A complete USD-based set for each date is used to calculate cross rates: `pair_rate = USD_to_quote / USD_to_base`. Percentage change uses consecutive complete observations, which are not necessarily consecutive trading days. Charts connect the actual dated observations; the app does not invent OHLC, volume, spread, or intermediate quotes.

The app fetches on load, every 15 minutes while open, and on manual refresh. It pauses opening and closing positions on fetch failure, when the fetch is older than 20 minutes, or when the latest observation is at least seven days old. Existing fetched observations remain visible with the reference date. No fake-data fallback is included. Browser storage is used for account records only, not as a fallback market feed.

Kraken public market data and Twelve Data were researched, but are not integrated because the requested UI is forex-focused and daily FX reference data was accepted. Kraken is crypto-oriented. Twelve Data offers a free API-key tier, but intraday data and display rights need checking against the intended usage before integration. No key is required for this implementation.

## Paper trading model

The account starts at **zero** with **no seeded trades**. Use Wallet to add virtual USD. Every account amount is derived from those actions, positions, and the market feed. Account balances and trade history are internal simulation records, clearly distinguished from external market data.

- Buy opens a long paper position; sell opens a short paper position.
- A position reserves 100% of the entry USD notional; no leverage is applied.
- Entry notional: `units × pair_rate × USD_per_quote_currency`.
- Open P/L: `(current_rate − entry_rate) × units × direction × current_USD_per_quote`.
- Closing releases entry collateral plus P/L into available funds.
- Equity: available funds + reserved collateral + open P/L.
- No invented fees, spreads, slippage, limit fills, or broker execution claims.
- This is a directional paper contract simulation, not ownership of currency balances. Short losses can exceed reserved collateral. There is no forced liquidation engine.
- History includes execution time, reference observation date, rates, cash movements, and realized P/L, with CSV export.

## Google sign-in

Sign-in uses the official Google Identity Services button. There is no guest login or fabricated identity fallback.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), select/create an OAuth client of type **Web application**. Configure the Google consent screen and test users if the app is in testing mode.
2. Add the exact JavaScript origin(s) used locally to **Authorized JavaScript origins**: `http://localhost:5173` and, if used, `http://127.0.0.1:5173`. Add your exact HTTPS deployment origin before hosting. This implementation uses the JavaScript popup callback; no backend redirect endpoint is used.
3. Copy `.env.example` to `.env.local` and set `VITE_GOOGLE_CLIENT_ID` to your public Web Client ID. The supplied client ID has already been written to the ignored `.env.local` in this workspace. Do not put a client secret in a Vite variable.
4. Restart the dev server after changing the environment file. Production builds require the same environment variable at build time.

The app retrieves Google's public signing keys and uses `jose` to validate the ID token signature, audience, issuer, expiry, issued-at time, and login nonce before opening the workspace. The stable Google `sub` identifies the account; an email change does not change the ledger owner. Token verification fails closed when validation or signing-key retrieval fails.

The short-lived ID credential and nonce are kept in `sessionStorage` for the current tab and reverified on reload. Expiry returns to sign-in; signing out clears that tab's session and disables automatic Google account selection without deleting its ledger. No Google access token, refresh token, password, or client secret is stored. Google receives the sign-in interaction; balances and trade records are never sent to Google.

References: [Google setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [button integration](https://developers.google.com/identity/gsi/web/guides/display-button), [ID token validation](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## Storage and scope

Each Google user's paper account lives in a separate `localStorage` key:

```text
tradesense.paper.v2.google.<encoded-google-subject>
```

All reads, writes, storage event listeners, resets, and browser locks are scoped to that user's key. Switching accounts remounts the workspace and clears the previous user's visible state. Sign-out leaves the saved ledger intact; signing back in with the same Google account restores it. Another browser, device, or origin has its own local records. Sessions are per tab, so different tabs can sign in to different Google accounts. If stored account data is unreadable, the app blocks updates rather than overwriting it.

The former shared `tradesense.paper.v1` account is preserved and **not automatically migrated** to any Google user, because its owner cannot be established. Existing QA records in that shared key do not appear in signed-in accounts. Every new Google user starts empty.

This provides account separation within the application, not encryption or protection from someone with access to browser developer tools, the browser profile, or injected same-origin JavaScript. There is no cloud sync or server authorization. When integrating Supabase later, replace the auth/session adapter and account store with Supabase Auth plus database Row Level Security, and validate identity on the server. Never trust the browser's claimed user ID as server authorization.

No real payments, bank details, brokerage/exchange credentials, or fake admin users are present.

## Verification

- TypeScript check and Vite production build.
- Engine regression tests cover empty accounts, decimal funding, invalid inputs, collateral, USD/JPY notional, cross-currency P/L, short direction, close proceeds, duplicate closes, storage parsing, provider validation, and stale-data rejection. Fixed numeric fixtures exist only in tests and are never imported into the app.
- Auth tests: signed and forged tokens, audience, nonce, issuer, expiry, per-user storage, reset isolation, and preservation of legacy shared data. Real Google account login requires authorized origins in Google Cloud Console.
- Browser (original trading implementation): real external data load, virtual funding, opening a position, persistence across reload, closing and history, and desktop/mobile layout checks.

## Source layout

- `src/App.tsx`: protected routes and trading UI.
- `src/GoogleAuth.tsx`: Google button, sign-in gate, session restoration, expiry, and sign-out.
- `src/auth.ts`: Google ID token validation.
- `src/account-store.ts`: Google-user-scoped browser ledger adapter.
- `tests/auth.test.ts`: signed credential validation and cross-user storage isolation.
- `src/index.css`: responsive styling.
- `src/market.ts`: public data access, validation, freshness, and cross-rate calculations.
- `src/engine.ts`: simulation ledger, positions, and P/L.
- `tests/engine.test.ts`: isolated calculation and data-validation tests.
- `src/imports/`: unused reference material retained from the supplied export; not application instructions or runtime market data.

The original export's scripted deployment instructions, mock users, hardcoded prices, demo activity, and payment-like flows were not adopted as product requirements.
