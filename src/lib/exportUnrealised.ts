import * as XLSX from "xlsx-js-style"
import type { AmitAdjustment } from "./types"
import { getFinancialYear } from "./cgt"
import { toExcelDate } from "./excelDate"

// Kept out of UnrealisedGainsPage so the Excel library is only downloaded when exporting

export type GainsRow = {
  id: string
  ticker: string
  acquisitionDate: string
  units: number
  rawCostPerUnit: number
  amitAdjPerUnit: number
  rawCostBase: number
  adjCostBase: number
  marketPrice: number | null
  currentValue: number | null
  unrealisedGain: number | null
  discountEligible: boolean
  effectiveGain: number | null
}

const AMIT_SHEET = "AMIT Allocation"
const DATE_FMT = "dd/mm/yyyy"
const PER_UNIT_FMT = "#,##0.000000"

export function exportUnrealisedGainsXLSX(rows: GainsRow[], entityType: string, amitAdjustments: AmitAdjustment[]) {
  const wb = XLSX.utils.book_new()
  // Same reference date the Unrealised Gains page uses when applying AMIT adjustments
  const asAt = new Date().toISOString().slice(0, 10)

  // The AMIT Allocation sheet lists parcels in the same order as the main sheet, so main-sheet
  // row i links to allocation row i. Work out its layout first so column E can reference it.
  const amit = buildAmitAllocationSheet(rows, amitAdjustments, asAt)

  // ── Sheet 1: Unrealised Gains ──────────────────────────────────────────────
  const MAIN_SHEET = "Unrealised Gains"
  const dataStart = 2          // first data row (1-indexed Excel)
  const dataEnd = dataStart + rows.length - 1
  const totalRow = dataEnd + 1 // totals row (1-indexed Excel)

  const ws1: XLSX.WorkSheet = {}

  const cell = (r: number, c: number, obj: XLSX.CellObject) => {
    ws1[XLSX.utils.encode_cell({ r, c })] = obj
  }
  const bold = { font: { bold: true } }
  const sv  = (v: string, s?: object): XLSX.CellObject => ({ t: "s", v, ...(s ? { s } : {}) })
  const nv  = (v: number, z = "#,##0.00", s?: object): XLSX.CellObject => ({ t: "n", v, z, ...(s ? { s } : {}) })
  const fml = (f: string, z = "#,##0.00", s?: object): XLSX.CellObject => ({ t: "n", f, z, ...(s ? { s } : {}) })
  const dv  = (iso: string): XLSX.CellObject => ({ t: "n", v: toExcelDate(iso), z: DATE_FMT })

  // Headers (row index 0 = Excel row 1)
  const headers = [
    "Ticker", "Acquired", "Units", "Cost/Unit", "AMIT Adj/Unit",
    "Cost Base", "Adj Cost Base", "Market Price", "Current Value",
    "Unrealised Gain", "Discount Eligible", "Effective Gain",
  ]
  headers.forEach((h, c) => cell(0, c, sv(h)))

  // Data rows
  rows.forEach((row, idx) => {
    const r = idx + 1          // 0-indexed sheet row
    const er = r + 1           // 1-indexed Excel row number

    cell(r, 0,  sv(row.ticker))
    cell(r, 1,  dv(row.acquisitionDate))
    cell(r, 2,  nv(row.units, "#,##0.00"))
    cell(r, 3,  nv(row.rawCostPerUnit, "#,##0.00"))
    // E: AMIT Adj/Unit — linked to this parcel's total on the AMIT Allocation sheet
    cell(r, 4,  fml(`'${AMIT_SHEET}'!${amit.totalPerUnitCell(idx)}`, PER_UNIT_FMT))
    // F: Cost Base = Units × Cost/Unit
    cell(r, 5,  fml(`C${er}*D${er}`))
    // G: Adj Cost Base = Units × (Cost/Unit + AMIT Adj/Unit)
    cell(r, 6,  fml(`C${er}*(D${er}+E${er})`))
    // H: Market Price (raw value; blank string if unavailable)
    if (row.marketPrice != null) {
      cell(r, 7, nv(row.marketPrice, "#,##0.00"))
    } else {
      cell(r, 7, sv(""))
    }
    // I: Current Value = Units × Market Price (blank if no price)
    cell(r, 8,  fml(`IF(H${er}="","",C${er}*H${er})`))
    // J: Unrealised Gain = Current Value − Adj Cost Base (blank if no price)
    cell(r, 9,  fml(`IF(I${er}="","",I${er}-G${er})`))
    // K: Discount Eligible
    cell(r, 10, sv(row.discountEligible ? "Yes (50%)" : "No"))
    // L: Effective Gain — applies 50% discount to eligible gains
    cell(r, 11, fml(`IF(J${er}="","",IF(K${er}="Yes (50%)",IF(J${er}>0,J${er}*0.5,J${er}),J${er}))`))
  })

  // Totals row (0-indexed = totalRow - 1)
  const tr = totalRow - 1
  cell(tr, 0,  sv("TOTAL", bold))
  cell(tr, 5,  fml(`SUM(F${dataStart}:F${dataEnd})`, "#,##0.00", bold))
  cell(tr, 6,  fml(`SUM(G${dataStart}:G${dataEnd})`, "#,##0.00", bold))
  // Only show totals for price-dependent columns if all rows have prices
  cell(tr, 8,  fml(`IF(COUNTBLANK(I${dataStart}:I${dataEnd})=0,SUM(I${dataStart}:I${dataEnd}),"N/A")`, "#,##0.00", bold))
  cell(tr, 9,  fml(`IF(COUNTBLANK(J${dataStart}:J${dataEnd})=0,SUM(J${dataStart}:J${dataEnd}),"N/A")`, "#,##0.00", bold))
  cell(tr, 11, fml(`IF(COUNTBLANK(L${dataStart}:L${dataEnd})=0,SUM(L${dataStart}:L${dataEnd}),"N/A")`, "#,##0.00", bold))

  ws1["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: tr, c: 11 } })
  ws1["!cols"] = [
    { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 16 },
    { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
    { wch: 18 }, { wch: 14 },
  ]
  XLSX.utils.book_append_sheet(wb, ws1, MAIN_SHEET)

  // ── Sheet 2: CGT Summary ──────────────────────────────────────────────────
  const ws2: XLSX.WorkSheet = {}
  let r2 = 0  // 0-indexed row cursor for ws2

  const cell2 = (c: number, obj: XLSX.CellObject) => {
    ws2[XLSX.utils.encode_cell({ r: r2, c })] = obj
  }
  // Returns the 1-indexed Excel row for the *current* r2
  const er2 = () => r2 + 1

  const gainRange  = `'${MAIN_SHEET}'!J${dataStart}:J${dataEnd}`
  const discRange  = `'${MAIN_SHEET}'!K${dataStart}:K${dataEnd}`

  // Title
  cell2(0, sv("Unrealised CGT Summary"))
  r2++
  cell2(0, sv("Exported"))
  cell2(1, dv(asAt))
  r2++

  r2++ // blank

  // INPUTS header
  cell2(0, sv("INPUTS"))
  r2++

  // Losses
  const lossesRow = er2()
  cell2(0, sv("Unrealised losses"))
  cell2(1, fml(`SUMIF(${gainRange},"<0",${gainRange})`))
  r2++

  // Short-term gains
  const shortTermRow = er2()
  cell2(0, sv(`Short-term gains — held ≤12 months${entityType !== "company" ? ", no discount" : ""}`))
  cell2(1, fml(`SUMIFS(${gainRange},${gainRange},">0",${discRange},"No")`))
  r2++

  // Long-term gains (non-company only)
  let longTermRow: number | null = null
  if (entityType !== "company") {
    longTermRow = er2()
    cell2(0, sv("Long-term gains, gross — held >12 months, discount eligible"))
    cell2(1, fml(`SUMIFS(${gainRange},${gainRange},">0",${discRange},"Yes (50%)")`))
    r2++
  }

  r2++ // blank

  // AFTER LOSS OFFSET header
  cell2(0, sv("AFTER LOSS OFFSET — losses applied to short-term gains first, then long-term"))
  r2++

  // Net short-term gain
  const netShortRow = er2()
  cell2(0, sv("Net short-term gain"))
  cell2(1, fml(`MAX(0,B${lossesRow}+B${shortTermRow})`))
  r2++

  let netLongTaxableRow: number | null = null
  if (entityType !== "company") {
    // Net long-term gain, gross
    const netLongGrossRow = er2()
    cell2(0, sv("Net long-term gain, gross"))
    cell2(1, fml(`B${longTermRow}+MIN(0,B${lossesRow}+B${shortTermRow})`))
    r2++

    // Less: 50% CGT discount
    const discountRow = er2()
    cell2(0, sv("Less: 50% CGT discount"))
    cell2(1, fml(`IF(B${netLongGrossRow}>0,B${netLongGrossRow}*0.5,0)`))
    r2++

    // Net long-term taxable
    netLongTaxableRow = er2()
    cell2(0, sv("Net long-term taxable"))
    cell2(1, fml(`B${netLongGrossRow}-B${discountRow}`))
    r2++
  }

  r2++ // blank

  // NET TAXABLE GAIN
  cell2(0, sv("NET TAXABLE GAIN"))
  if (entityType !== "company") {
    cell2(1, fml(`B${netShortRow}+B${netLongTaxableRow}`))
  } else {
    // For companies: no discount — net all gains and losses
    cell2(1, fml(`B${lossesRow}+B${shortTermRow}`))
  }
  r2++

  ws2["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r2 - 1, c: 1 } })
  ws2["!cols"] = [{ wch: 65 }, { wch: 18 }]
  XLSX.utils.book_append_sheet(wb, ws2, "CGT Summary")

  // ── Sheet 3: AMIT Allocation ──────────────────────────────────────────────
  XLSX.utils.book_append_sheet(wb, amit.sheet, AMIT_SHEET)

  // ── Download ──────────────────────────────────────────────────────────────
  const date = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `unrealised-gains-${date}.xlsx`)
}

/** Audit trail for AMIT cost base adjustments: the adjustments as entered, how each one is
 *  allocated per unit to every parcel held, and a reconciliation back to the statement totals.
 *  Mirrors calcAmitAdjPerUnit: an adjustment applies to a parcel of the same ticker acquired on
 *  or before the adjustment date, for adjustments dated on or before the as-at date. */
function buildAmitAllocationSheet(rows: GainsRow[], adjustments: AmitAdjustment[], asAt: string) {
  const ws: XLSX.WorkSheet = {}
  const bold = { font: { bold: true } }
  const set = (r: number, c: number, obj: XLSX.CellObject) => { ws[XLSX.utils.encode_cell({ r, c })] = obj }
  const sv  = (v: string, s?: object): XLSX.CellObject => ({ t: "s", v, ...(s ? { s } : {}) })
  const nv  = (v: number, z = "#,##0.00"): XLSX.CellObject => ({ t: "n", v, z })
  const dv  = (iso: string): XLSX.CellObject => ({ t: "n", v: toExcelDate(iso), z: DATE_FMT })
  const fml = (f: string, z = "#,##0.00", s?: object): XLSX.CellObject => ({ t: "n", f, z, ...(s ? { s } : {}) })
  const col = (c: number) => XLSX.utils.encode_col(c)
  const ref = (c: number, r: number) => `${col(c)}${r + 1}`        // relative, 0-indexed row
  const abs = (c: number, r: number) => `$${col(c)}$${r + 1}`      // absolute, 0-indexed row

  const adjs = [...adjustments].sort((a, b) => a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date))
  let r = 0

  set(r++, 0, sv("AMIT Cost Base Adjustments — Allocation to Parcels", bold))
  const asAtRow = r
  set(r, 0, sv("As at")); set(r++, 1, dv(asAt))
  set(r++, 0, sv("Each adjustment is spread per unit across the units held on its date, and applies to parcels of the same ticker acquired on or before that date."))
  r++

  // ── 1. Adjustments ──
  set(r++, 0, sv("1. AMIT ADJUSTMENTS (from annual AMMA statements)", bold))
  ;["Ticker", "Adjustment Date", "Financial Year", "Total Adjustment ($)", "Units Held at Date (recorded)", "Adjustment per Unit ($)"]
    .forEach((h, c) => set(r, c, sv(h, bold)))
  r++
  const adjRow: number[] = []
  adjs.forEach((a) => {
    adjRow.push(r)
    set(r, 0, sv(a.ticker))
    set(r, 1, dv(a.date))
    set(r, 2, sv(getFinancialYear(a.date)))
    set(r, 3, nv(a.totalAdjustment))
    set(r, 4, nv(a.unitsAtDate, "#,##0.0000000000"))
    set(r, 5, fml(`IF(${ref(4, r)}>0,${ref(3, r)}/${ref(4, r)},0)`, PER_UNIT_FMT))
    r++
  })
  if (adjs.length === 0) set(r++, 0, sv("No AMIT adjustments recorded."))
  r++

  // ── 2. Allocation to parcels ──
  set(r++, 0, sv("2. ALLOCATION TO PARCELS HELD (adjustment per unit applied to each parcel)", bold))
  const FIRST_ADJ_COL = 3
  const totalPerUnitCol = FIRST_ADJ_COL + adjs.length
  const totalDollarCol = totalPerUnitCol + 1
  ;["Ticker", "Acquired", "Units Held"].forEach((h, c) => set(r, c, sv(h, bold)))
  adjs.forEach((a, j) => set(r, FIRST_ADJ_COL + j, sv(`${a.ticker} ${getFinancialYear(a.date)}`, bold)))
  set(r, totalPerUnitCol, sv("Total AMIT Adj/Unit ($)", bold))
  set(r, totalDollarCol, sv("Total AMIT Adj ($)", bold))
  r++

  const firstParcelRow = r
  rows.forEach((row) => {
    set(r, 0, sv(row.ticker))
    set(r, 1, dv(row.acquisitionDate))
    set(r, 2, nv(row.units, "#,##0.0000000000"))
    adjs.forEach((_, j) => {
      const ar = adjRow[j]
      set(r, FIRST_ADJ_COL + j, fml(
        `IF(AND($A${r + 1}=${abs(0, ar)},$B${r + 1}<=${abs(1, ar)},${abs(1, ar)}<=${abs(1, asAtRow)}),${abs(5, ar)},0)`,
        PER_UNIT_FMT,
      ))
    })
    set(r, totalPerUnitCol, adjs.length > 0
      ? fml(`SUM(${ref(FIRST_ADJ_COL, r)}:${ref(totalPerUnitCol - 1, r)})`, PER_UNIT_FMT)
      : nv(0, PER_UNIT_FMT))
    set(r, totalDollarCol, fml(`${ref(2, r)}*${ref(totalPerUnitCol, r)}`))
    r++
  })
  const lastParcelRow = r - 1
  set(r, 0, sv("TOTAL", bold))
  if (rows.length > 0) set(r, totalDollarCol, fml(`SUM(${ref(totalDollarCol, firstParcelRow)}:${ref(totalDollarCol, lastParcelRow)})`, "#,##0.00", bold))
  r += 2

  // ── 3. Reconciliation ──
  set(r++, 0, sv("3. RECONCILIATION (allocated to parcels held vs statement total)", bold))
  ;["Ticker", "Adjustment Date", "Total Adjustment ($)", "Allocated to Parcels Held ($)", "Difference ($) — units disposed since"]
    .forEach((h, c) => set(r, c, sv(h, bold)))
  r++
  adjs.forEach((a, j) => {
    const ar = adjRow[j]
    const adjCol = col(FIRST_ADJ_COL + j)
    set(r, 0, sv(a.ticker))
    set(r, 1, dv(a.date))
    set(r, 2, fml(abs(3, ar)))
    set(r, 3, rows.length > 0
      ? fml(`SUMPRODUCT($C$${firstParcelRow + 1}:$C$${lastParcelRow + 1},${adjCol}$${firstParcelRow + 1}:${adjCol}$${lastParcelRow + 1})`)
      : nv(0))
    set(r, 4, fml(`${ref(2, r)}-${ref(3, r)}`))
    r++
  })

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r - 1, 0), c: Math.max(totalDollarCol, 5) } })
  ws["!cols"] = [
    { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 20 }, { wch: 26 }, { wch: 22 },
    ...adjs.slice(3).map(() => ({ wch: 14 })), { wch: 22 }, { wch: 18 },
  ]

  return {
    sheet: ws,
    /** Cell (on this sheet) holding the total AMIT adjustment per unit for main-sheet row `i` */
    totalPerUnitCell: (i: number) => ref(totalPerUnitCol, firstParcelRow + i),
  }
}
