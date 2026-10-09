import * as XLSX from "xlsx-js-style"

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

export function exportUnrealisedGainsXLSX(rows: GainsRow[], entityType: string) {
  const wb = XLSX.utils.book_new()

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
    cell(r, 1,  sv(row.acquisitionDate))
    cell(r, 2,  nv(row.units, "#,##0.00"))
    cell(r, 3,  nv(row.rawCostPerUnit, "#,##0.00"))
    cell(r, 4,  nv(row.amitAdjPerUnit, "#,##0.000000"))
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
  cell2(1, sv(`Exported: ${new Date().toLocaleDateString("en-AU")}`))
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

  // ── Download ──────────────────────────────────────────────────────────────
  const date = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `unrealised-gains-${date}.xlsx`)
}
