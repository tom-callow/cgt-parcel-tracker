# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Vite dev server
npm run build        # Type-check + production build (tsc -b && vite build)
npm run lint         # Run ESLint (currently passes with zero errors — keep it that way)
npm run test         # Run all tests once (vitest run)
npm run test:watch   # Run tests in watch mode
```

To run a single test file:
```bash
npx vitest run src/lib/cgt.test.ts
```

Local dev needs `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (gitignored; CI gets them from GitHub secrets).

Market data worker (`worker/`, separate package):
```bash
cd worker && npx wrangler dev      # Run locally
cd worker && npx wrangler deploy   # Deploy to Cloudflare (requires `npx wrangler login`)
```

## Deployment
- **Frontend** — GitHub Pages, built and deployed by `.github/workflows/deploy.yml` on every push to `main`.
- **Worker** — Cloudflare Workers, deployed manually with `wrangler deploy`. Not part of CI, so merging worker changes does not deploy them.

## Architecture

React + TypeScript app (Vite, Tailwind v4) for tracking Australian Capital Gains Tax. All CGT logic runs client-side. Two external services:
- **Supabase** (`src/lib/supabase.ts`) — email/password auth and persistence. Each user's entire `AppData` is stored as one JSON row in the `user_data` table (`id` = auth user id).
- **Cloudflare Worker** (`worker/src/index.ts`, deployed as `cgt-market-proxy`) — proxies Yahoo Finance quotes for live ASX prices (`GET /quotes?symbols=VAS.AX,...`, max 20 symbols). Handles Yahoo's cookie/crumb auth, retries once with a fresh crumb on 401/403, and edge-caches responses for 10 min — but only when every symbol has a price, so failed fetches are never cached. Called from `src/lib/marketData.ts`.

### Data model (`src/lib/types.ts`)
- **`Parcel`** — a share purchase (buy trade). Has `unitsRemaining` which decreases as units are disposed.
- **`Disposal`** — a sell event. Stores which parcels were consumed (`parcelsUsed: ParcelUsage[]`) and the matching method used (FIFO/LIFO/optimised/manual). Disposals are immutable once created; deleting one restores `unitsRemaining` on affected parcels.
- **`AmitAdjustment`** — cost base adjustments for AMIT (Attribution Managed Investment Trust) distributions.
- **`AppData`** — the root persisted shape: `{ entityType, parcels, disposals, amitAdjustments, rebalanceTargets }`.

### State management (`src/lib/AppContext.tsx`)
Single React context (`AppProvider` / `useAppState`) holds all app state plus the auth session. Mutations are exposed as named callbacks (`addParcel`, `deleteDisposal`, etc.).

Undo: every mutation — including `setEntityType`, `setRebalanceTargets` and `importData` — pushes a snapshot of the full `AppData` (last 20) first, and `undo` restores all of it. Setters skip the snapshot when the value is unchanged, so no-op edits don't consume undo steps. Internal state setters are suffixed `State` (`setEntityTypeState`); the exposed names are the snapshotting wrappers.

Persistence:
- On login, data is loaded from Supabase. If the user has no row yet, legacy `localStorage` data (key `cgt-tracker-data`) is migrated up.
- `dataLoading` is derived (`loadedUserId !== session.user.id`), not stored. If the load *errors*, `dataLoadError` is set, `App.tsx` shows a "Couldn't load your data" screen with Retry (`retryDataLoad`) / Sign out, and the data stays unloaded.
- **Auto-save is gated on `!dataLoading`**: nothing is ever saved until this user's data has loaded successfully. Saving the empty initial state would overwrite their cloud data — never weaken this guard.
- Changes auto-save to Supabase, debounced 1s. A pending save is flushed immediately when the tab is hidden or closed (`saveOnPageHide`, a raw REST call with `keepalive`; falls back to a normal request for bodies over ~60 KB, the keepalive limit).
- **Supabase query builders are lazy**: a query is only sent when awaited or `.then()`'d. Never fire-and-forget a `supabase.from(...)` call — always go through `saveToSupabase` or await it.
- "Remember me" on login: if unchecked, the session is signed out on the next browser session (`cgt-remember-me` in localStorage, `cgt-session-alive` in sessionStorage).

The `deleteParcelCascade` operation is particularly important: deleting a parcel must also delete all disposals that consumed it, and restore `unitsRemaining` on any other parcels those disposals consumed.

### CGT logic (`src/lib/cgt.ts`)
All tax calculation lives here. Key functions:
- `matchParcels` — selects which parcels to consume for a disposal using FIFO, LIFO, or optimised sorting. The optimised method prioritises: losses first, then gains sorted by effective taxable gain (accounting for the 50% CGT discount for parcels held >12 months).
- `executeDisposal` — calls `matchParcels` then builds the `Disposal` object and returns updated parcels.
- `executeManualDisposal` — builds a disposal from user-chosen parcels (method `"manual"`).
- `computeFYSummary` — aggregates disposals into per-FY, per-ticker summaries, applying AMIT adjustments to cost bases.
- `previewDisposal` — compares all three methods side-by-side without committing (used by OptimiserPage).
- `parseTradesCSV` — parses a CSV of trades; handles both ISO and AU date formats.
- `isDiscountEligible` — the 12-month test (see tax rules below).

### Pages (`src/pages/`)
Each page is a standalone component consuming `useAppState()`. Navigation is a `page` state in `App.tsx` (no router); unauthenticated users see **LoginPage**.
- **TradesPage** — view/add/delete parcels and disposals
- **PortfolioPage** — current holdings with live prices
- **UnrealisedGainsPage** — unrealised P&L on current holdings, using live prices; Excel export via `src/lib/exportUnrealised.ts` (Unrealised Gains + CGT Summary sheets)
- **CapitalGainsPage** — realised CGT summary by FY; Excel export via `src/lib/exportExcel.ts` (Summary, Parcel Detail, Parcel Register sheets with live formulas)
- **TaxStatementsPage** — formatted tax statements for lodgement
- **OptimiserPage** — preview disposal tax outcome across all three methods before committing
- **AmitPage** — manage AMIT cost base adjustments
- **RebalancePage** — target allocation rebalancing recommendations. Inputs show the saved target unless mid-edit (`draftTargets` holds only in-progress edits), so external changes like undo appear without syncing.
- **SaveLoadPage** — JSON import/export and CSV trade import

Shared display helpers (`fmt`, `fmtPct`, `byDate`, `uniqueTickers`) live in `src/lib/formatters.ts`.

Live prices: Portfolio, Unrealised Gains and Rebalance all use `useLivePrices(tickers)` (`src/lib/useLivePrices.ts`) — fetches once on mount, returns `{ prices, loading, lastUpdated, refresh }`. Don't re-implement price fetching per page.

Excel exports are **lazy-loaded**: pages `await import("../lib/exportExcel")` / `import("../lib/exportUnrealised")` inside the Export click handler. `xlsx-js-style` (~860 KB) must only be imported from those export modules — a static import from a page or shared module would pull it back into the main bundle. Type-only imports (`import type`) are fine.

### Lint conventions (React Compiler rules via `eslint-plugin-react-hooks`)
The linter stops at the first error per component, so fixing one can reveal more. Patterns it enforces:
- Don't define components inside other components — lift them to module level and pass state as props (see `SortHeader`, `ResultCard`).
- Don't call `setState` synchronously in an effect — derive values during render, or set state in event handlers / after an `await`.
- Hook dependency lists must be simple identifiers: compute `const tickersKey = tickers.join(",")` first rather than inlining expressions.
- Don't write `ref.current` during render — use `useLayoutEffect`.
- `AppContext.tsx` has one deliberate `react-refresh/only-export-components` disable (it exports `useAppState` with the provider); editing it triggers a full reload in dev.

### Australian tax rules to be aware of
- Financial year: 1 July – 30 June. `getFinancialYear("2024-07-01")` → `"FY2025"`.
- CGT 50% discount: applies to individuals and trusts for assets held **strictly more than** 12 months (exactly 12 months is NOT eligible). Companies never get the discount.
  - Basis: s115-25(1) ITAA 1997 and TD 2002/10 — a clear 12 months must elapse, excluding the acquisition day and the CGT event day, so the first eligible day is anniversary + 1 (ATO example: acquired 2 Feb 2006 → eligible from 3 Feb 2007).
  - 29 Feb acquisitions: the anniversary in a non-leap year is clamped to 28 Feb (Acts Interpretation Act s2G), so a 29 Feb 2024 purchase is eligible from 1 Mar 2025. JS `setFullYear` would roll it to 1 Mar, which is why `isDiscountEligible` clamps. The Excel export uses `EDATE(date, 12)`, which clamps the same way — keep the app and the spreadsheet formulas consistent.
- AMIT adjustments reduce the cost base of parcels held at the adjustment date; they are applied per-unit across all relevant parcels when computing gains.
- **Pending (not implemented):** the 2026–27 Federal Budget proposed replacing the 50% discount with indexation for individuals from 1 July 2027. On hold until it's law; it will require rewriting the discount logic in `cgt.ts` and the export formulas. Don't start this without being asked.
