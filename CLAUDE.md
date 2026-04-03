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

## Architecture

This is a client-side-only React + TypeScript app (Vite, Tailwind v4) for tracking Australian Capital Gains Tax. All data is persisted in `localStorage` — there is no backend.

### Data model (`src/lib/types.ts`)
- **`Parcel`** — a share purchase (buy trade). Has `unitsRemaining` which decreases as units are disposed.
- **`Disposal`** — a sell event. Stores which parcels were consumed (`parcelsUsed: ParcelUsage[]`) and the matching method used (FIFO/LIFO/optimised). Disposals are immutable once created; deleting one restores `unitsRemaining` on affected parcels.
- **`AmitAdjustment`** — cost base adjustments for AMIT (Attribution Managed Investment Trust) distributions.
- **`AppData`** — the root persisted shape: `{ entityType, parcels, disposals, amitAdjustments, rebalanceTargets }`.

### State management (`src/lib/AppContext.tsx`)
Single React context (`AppProvider` / `useAppState`) holds all app state. It loads from and auto-saves to `localStorage` (key: `cgt-tracker-data`). Mutations are exposed as named callbacks (`addParcel`, `deleteDisposal`, etc.).

The `deleteParcelCascade` operation is particularly important: deleting a parcel must also delete all disposals that consumed it, and restore `unitsRemaining` on any other parcels those disposals consumed.

### CGT logic (`src/lib/cgt.ts`)
All tax calculation lives here. Key functions:
- `matchParcels` — selects which parcels to consume for a disposal using FIFO, LIFO, or optimised sorting. The optimised method prioritises: losses first, then gains sorted by effective taxable gain (accounting for the 50% CGT discount for parcels held >12 months).
- `executeDisposal` — calls `matchParcels` then builds the `Disposal` object and returns updated parcels.
- `computeFYSummary` — aggregates disposals into per-FY, per-ticker summaries, applying AMIT adjustments to cost bases.
- `previewDisposal` — compares all three methods side-by-side without committing (used by OptimiserPage).
- `parseTradesCSV` — parses a CSV of trades; handles both ISO and AU date formats.

### Pages (`src/pages/`)
Each page is a standalone component consuming `useAppState()`:
- **TradesPage** — view/add/delete parcels and disposals
- **PortfolioPage** — current holdings
- **UnrealisedGainsPage** — unrealised P&L on current holdings
- **CapitalGainsPage** — realised CGT summary by FY
- **TaxStatementsPage** — formatted tax statements for lodgement
- **OptimiserPage** — preview disposal tax outcome across all three methods before committing
- **AmitPage** — manage AMIT cost base adjustments
- **RebalancePage** — target allocation rebalancing recommendations
- **SaveLoadPage** — JSON import/export and CSV trade import

### Australian tax rules to be aware of
- Financial year: 1 July – 30 June. `getFinancialYear("2024-07-01")` → `"FY2025"`.
- CGT 50% discount: applies to individuals and trusts for assets held **strictly more than** 12 months (exactly 12 months is NOT eligible). Companies never get the discount.
- AMIT adjustments reduce the cost base of parcels held at the adjustment date; they are applied per-unit across all relevant parcels when computing gains.
