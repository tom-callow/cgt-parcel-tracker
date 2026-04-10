# CGT Parcel Tracker

An Australian Capital Gains Tax parcel tracking tool for ETF and share investors. Built as a single-page app that runs entirely in the browser — no account, no server, no data leaves your device.

**Live app:** https://tom-callow.github.io/cgt-parcel-tracker/

## Features

- **Trade tracking** — Record buy and sell trades with date, ticker, units, price, and brokerage. Supports entering either unit price or total consideration paid.
- **Parcel matching** — Disposals are matched against buy parcels using FIFO, LIFO, or Optimised method. Optimised minimises net taxable gain by realising losses first, then ranking gains by effective taxable amount after the CGT discount.
- **CGT discount** — Automatically applies the 50% discount for parcels held strictly more than 12 months. Individuals and trusts are eligible; companies are not.
- **AMIT adjustments** — Records annual cost base adjustments from Attribution Managed Investment Trusts (e.g. Vanguard, iShares ETFs). Applied automatically across capital gains, unrealised gains, and tax summary calculations.
- **Capital Gains page** — Lists all disposal events with a full parcel-level breakdown showing raw and AMIT-adjusted figures, filterable by ticker and financial year.
- **Excel export** — Exports an `.xlsx` workbook for ATO audit purposes, containing three sheets:
  - *Summary* — Gains, losses, discount, and net taxable gain per ticker per FY, driven by `SUMIFS` formulas referencing the Detail sheet.
  - *Parcel Detail* — One row per parcel consumed within each disposal. All computed columns (adjusted cost base, proceeds allocation, gross gain, held >12mo test, discount, net taxable) are live Excel formulas traceable to their inputs.
  - *Parcel Register* — Full parcel inventory with original units, units disposed, units remaining, and remaining cost base as formulas — demonstrating no parcel has been over-disposed.
- **Tax Summary page** — Summarises gross gains, gross losses, discount applied, and net taxable gain per ticker per financial year.
- **Unrealised Gains page** — Shows open parcels with live ASX prices (via Yahoo Finance), AMIT-adjusted cost base, and estimated CGT liability if sold today.
- **Optimiser page** — Previews how FIFO, LIFO, and Optimised would compare for a hypothetical disposal before committing.
- **Portfolio page** — Current holdings with units held, average cost per unit, total cost base, and live market value (via Yahoo Finance).
- **Rebalancing page** — Enter target allocations and see recommended buy/sell amounts to rebalance your portfolio.
- **CSV import** — Bulk import trades from a CSV file.
- **Save / Load** — Export all data as a JSON file for backup or transfer between devices.
- **Undo** — Undo any data mutation (add/delete trade, disposal, AMIT adjustment, etc.).
- **Dark mode** — Toggles between light and dark themes; preference is saved automatically.
- **Persistent storage** — All data is saved automatically to browser localStorage.

## Australian Tax Rules Applied

- Financial year runs 1 July – 30 June (e.g. FY2025 = 1 Jul 2024 – 30 Jun 2025)
- CGT discount applies to gains where the asset was held **strictly more than 12 months** (exactly 12 months is not eligible)
- Losses are never discounted
- Cost base includes brokerage on acquisition; proceeds are net of brokerage on disposal
- AMIT cost base adjustments from the fund's Annual Member Tax Statement (AMAS) are applied per-unit across all parcels held on the adjustment date

## Tech Stack

React 19, TypeScript, Vite, Tailwind CSS 4, Vitest, xlsx-js-style

## Running Locally

```bash
npm install
npm run dev
```

## Disclaimer

This tool is provided for informational purposes only and does not constitute tax advice. Always verify figures with a qualified tax adviser.
