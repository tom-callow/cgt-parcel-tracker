# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Vite dev server
npm run build        # Type-check + production build (tsc -b && vite build)
npm run lint         # Run ESLint
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
Single React context (`AppProvider` / `useAppState`) holds all app state plus the auth session. Mutations are exposed as named callbacks (`addParcel`, `deleteDisposal`, etc.); each pushes an undo snapshot (last 20) first.

Persistence:
- On login, data is loaded from Supabase. If the user has no row yet, legacy `localStorage` data (key `cgt-tracker-data`) is migrated up. If the load *errors*, nothing is migrated — that would overwrite cloud data.
- Changes auto-save to Supabase, debounced 1s. A pending save is flushed immediately when the tab is hidden or closed (`saveOnPageHide`, a raw REST call with `keepalive`).
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

### Pages (`src/pages/`)
Each page is a standalone component consuming `useAppState()`. Navigation is a `page` state in `App.tsx` (no router); unauthenticated users see **LoginPage**.
- **TradesPage** — view/add/delete parcels and disposals
- **PortfolioPage** — current holdings with live prices
- **UnrealisedGainsPage** — unrealised P&L on current holdings, using live prices
- **CapitalGainsPage** — realised CGT summary by FY; Excel export via `src/lib/exportExcel.ts` (Summary, Parcel Detail, Parcel Register sheets with live formulas)
- **TaxStatementsPage** — formatted tax statements for lodgement
- **OptimiserPage** — preview disposal tax outcome across all three methods before committing
- **AmitPage** — manage AMIT cost base adjustments
- **RebalancePage** — target allocation rebalancing recommendations
- **SaveLoadPage** — JSON import/export and CSV trade import

Shared display helpers (`fmt`, `fmtPct`, `byDate`, `uniqueTickers`) live in `src/lib/formatters.ts`.

### Australian tax rules to be aware of
- Financial year: 1 July – 30 June. `getFinancialYear("2024-07-01")` → `"FY2025"`.
- CGT 50% discount: applies to individuals and trusts for assets held **strictly more than** 12 months (exactly 12 months is NOT eligible). Companies never get the discount.
- AMIT adjustments reduce the cost base of parcels held at the adjustment date; they are applied per-unit across all relevant parcels when computing gains.
