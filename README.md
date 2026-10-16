# CGT Parcel Tracker

An Australian Capital Gains Tax parcel tracking tool for ETF and share investors.

**Live app:** https://tom-callow.github.io/cgt-parcel-tracker/

## Features

- **Trade tracking** — Buy and sell trades with FIFO, LIFO, Optimised or manual parcel matching
- **CSV import** — Betashares Direct exports as-is, or a standard trades CSV; trades already recorded are skipped, so a full-history export can be re-imported. Sells are matched Optimised by default
- **CGT discount** — 50% discount for parcels held strictly more than 12 months; companies excluded
- **Loss netting** — Capital losses reduce gains before the discount (non-discountable gains first), across the whole financial year
- **AMIT adjustments** — Cost base adjustments from Attribution Managed Investment Trust annual statements
- **Capital Gains** — Disposal history with parcel-level breakdown, filterable by ticker and financial year
- **Tax Summary** — Net capital gain per financial year, ready for lodgement
- **Excel export** — Audit-ready `.xlsx` with Summary, Parcel Detail and Parcel Register sheets using live formulas
- **Portfolio** — Current holdings with cost, live market value, gain/loss and weight
- **Unrealised Gains** — Open parcels with live ASX prices and estimated CGT if sold today
- **Rebalancing** — Target allocations, including tickers you don't hold yet; splits new contributions to move towards target, and shows the buy/sell to reach it, flagging sells that would realise a capital loss
- **Sale Optimiser** — Plan the lowest-tax sale to raise cash across holdings while staying within a drift band of your targets, or sell from one holding by cash or units
- **JSON backup** — Full data export and import
- **Undo** — Any data change can be undone
- **Responsive layout and dark mode**

## Tech Stack

React 19, TypeScript, Vite, Tailwind CSS v4, Supabase, Cloudflare Workers, Vitest

## Running Locally

Create `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then:

```bash
npm install
npm run dev
```

`npm run test` runs the test suite and `npm run lint` the linter.

## Disclaimer

For informational purposes only. Not tax advice — verify with a qualified adviser. Capital losses carried forward from earlier years aren't tracked.
