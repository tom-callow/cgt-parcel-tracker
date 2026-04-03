# CGT Parcel Tracker

An Australian Capital Gains Tax parcel tracking tool for ETF and share investors. Built as a single-page app that runs entirely in the browser — no account, no server, no data leaves your device.

**Live app:** https://tom-callow.github.io/cgt-parcel-tracker/

## Features

- **Trade tracking** — Record buy and sell trades with date, ticker, units, price, and brokerage. Supports entering either unit price or total consideration paid.
- **Parcel matching** — Disposals are matched against buy parcels using your choice of FIFO, LIFO, or Optimised method.
- **CGT discount** — Automatically applies the 50% CGT discount for parcels held more than 12 months (individuals and trusts). Companies are ineligible.
- **Optimised method** — Ranks parcels to minimise net taxable gain: realises losses first, then ranks gains by effective taxable amount after discount.
- **AMIT adjustments** — Records annual cost base adjustments from Attribution Managed Investment Trusts (e.g. Vanguard, iShares ETFs). Applied automatically to capital gains, unrealised gains, and tax summary calculations.
- **Capital Gains page** — Lists all disposal events by date with a full parcel-level breakdown showing raw and AMIT-adjusted cost base, filterable by ticker and financial year.
- **Tax Summary page** — Summarises gross gains, gross losses, discount applied, and net taxable gain per ticker per financial year, incorporating any AMIT adjustments.
- **Unrealised Gains page** — Shows open parcels with live ASX prices (via Yahoo Finance), raw and AMIT-adjusted cost base, and estimated CGT liability if sold today.
- **Optimiser page** — Preview how FIFO, LIFO, and Optimised would compare for a hypothetical disposal before committing.
- **Portfolio page** — Shows current holdings with average cost per unit and total units remaining.
- **CSV import** — Bulk import trades from a CSV file.
- **Save / Load** — Export all data as a JSON file for backup or transfer between devices.
- **Persistent storage** — Data is saved automatically to browser localStorage and restored on next visit.

## Australian Tax Rules Applied

- Financial year runs 1 July – 30 June (e.g. FY2025 = 1 Jul 2024 – 30 Jun 2025)
- CGT discount applies to gains where the asset was held **strictly more than 12 months**
- Losses are never discounted
- Cost base includes brokerage on acquisition; proceeds are net of brokerage on disposal
- AMIT cost base adjustments sourced from the fund's Annual Member Tax Statement (AMAS) are applied per-unit, proportionally across parcels held on the adjustment date

## Tech Stack

React 19, TypeScript, Vite, Tailwind CSS 4, Vitest

## Running Locally

```bash
npm install
npm run dev
```

## Disclaimer

This tool is provided for informational purposes only and does not constitute tax advice. Always verify figures with a qualified tax adviser.
