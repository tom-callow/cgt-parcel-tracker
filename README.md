# CGT Parcel Tracker

An Australian Capital Gains Tax parcel tracking tool for ETF and share investors.

**Live app:** https://tom-callow.github.io/cgt-parcel-tracker/

## Features

- **Trade tracking** — Buy and sell trades with FIFO, LIFO, or Optimised parcel matching
- **CGT discount** — 50% discount applied automatically for parcels held strictly more than 12 months; companies excluded
- **AMIT adjustments** — Cost base adjustments from Attribution Managed Investment Trust annual statements
- **Capital Gains** — Disposal history with parcel-level breakdown, filterable by ticker and financial year
- **Excel export** — Audit-ready `.xlsx` with Summary, Parcel Detail, and Parcel Register sheets using live formulas
- **Unrealised Gains** — Open parcels with live ASX prices and estimated CGT if sold today
- **Sale Optimiser** — Preview FIFO vs LIFO vs Optimised before committing a disposal
- **Portfolio** — Current holdings with live market values
- **Rebalancing** — Target allocation recommendations
- **CSV import / JSON backup** — Bulk trade import and full data export
- **Undo** — Any data mutation can be undone
- **Dark mode**

## Tech Stack

React 19, TypeScript, Vite, Tailwind CSS v4, Supabase, Cloudflare Workers, Vitest

## Running Locally

```bash
npm install
npm run dev
```

## Disclaimer

For informational purposes only. Not tax advice — verify with a qualified adviser.
