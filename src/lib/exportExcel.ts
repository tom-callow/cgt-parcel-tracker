import * as XLSX from "xlsx-js-style"
import type { Parcel, Disposal, AmitAdjustment, EntityType } from "./types"
import { calcAmitAdjPerUnit, getFinancialYear, fmtDate } from "./cgt"

// ─── Colours ─────────────────────────────────────────────────────────────────

const C = {
  navy:      "1E3A5F",
  blue:      "2563EB",
  lightBlue: "DBEAFE",
  white:     "FFFFFF",
  offWhite:  "F8FAFC",
  slate:     "64748B",
  green:     "166534",
  red:       "991B1B",
}

// ─── Column layout — Detail sheet (0-indexed) ─────────────────────────────────
//
//  A  FY                  (value)
//  B  Ticker              (value)
//  C  Disposal Date       (Excel date serial)  ← used in P formula
//  D  Method              (value)
//  E  Sale Price/Unit     (value)
//  F  Sale Brokerage      (value)
//  G  Net Proceeds        (value — disposal.proceeds)
//  H  Total Units Sold    (value — disposal.units)
//  I  Parcel Acquired     (Excel date serial)  ← used in P formula
//  J  Units (this parcel) (value)
//  K  Raw Cost Base       (value)
//  L  AMIT Adjustment     (value, 0 if none)
//  M  Adj Cost Base       FORMULA =K+L
//  N  Parcel Proceeds     FORMULA =(J/H)*G
//  O  Gross Gain/Loss     FORMULA =N-M
//  P  Held >12 Months     FORMULA =IF(DATE(YEAR(I)+1,MONTH(I),DAY(I))<C,"Yes","No")
//  Q  CGT Discount Elig.  FORMULA =IF(AND(P="Yes",$B$5<>"company"),"Yes","No")
//  R  Discount Amount     FORMULA =IF(AND(Q="Yes",O>0),O*$F$5,0)
//  S  Net Taxable Gain    FORMULA =O-R

const DC = {
  FY: 0, TICKER: 1, DISP_DATE: 2, METHOD: 3,
  UNIT_PRICE: 4, BROKERAGE: 5, PROCEEDS: 6, DISP_UNITS: 7,
  PARCEL_DATE: 8, PARCEL_UNITS: 9,
  RAW_COST: 10, AMIT: 11,
  ADJ_COST: 12, PARC_PROC: 13, GROSS_GAIN: 14,
  HELD: 15, DISC_ELIG: 16, DISC_AMT: 17, NET_TAX: 18,
}
const NCOLS = 19  // A through S

const ENTITY_REF  = "$B$5"  // entity type string cell
const DISC_RATE_REF = "$F$5"  // computed discount rate (0 or 0.5)

// First data row in the Detail sheet (1-indexed Excel row)
const D_FIRST_DATA = 8

// Max row to use in cross-sheet SUMPRODUCT ranges (generous ceiling)
const MAX_ROW = 10000

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert ISO date string to Excel date serial number */
function toExcelDate(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number)
  const date  = new Date(Date.UTC(y, m - 1, d))
  const epoch = new Date(Date.UTC(1899, 11, 30))  // Excel epoch: 1899-12-30
  return Math.round((date.getTime() - epoch.getTime()) / 86_400_000)
}

/** Column letter(s) for a 0-indexed column */
function colLetter(col: number): string {
  return XLSX.utils.encode_col(col)
}

/** Excel cell address from 0-indexed col and 1-indexed row */
function addr(col: number, row: number): string {
  return `${colLetter(col)}${row}`
}

// ─── Styled-cell constructors ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cell = any

type StrOpts  = { bold?: boolean; fill?: string; color?: string; center?: boolean; italic?: boolean }
type NumOpts  = { bold?: boolean; fill?: string; gain?: boolean; fmt?: string }

function styleOf(font?: object, fill?: string, align?: object) {
  return {
    font,
    fill: fill ? { fgColor: { rgb: fill } } : undefined,
    alignment: align,
  }
}

function titleCell(v: string): Cell {
  return { v, t: "s", s: { font: { bold: true, sz: 13 } } }
}

function metaCell(v: string): Cell {
  return { v, t: "s", s: { font: { color: { rgb: C.slate }, sz: 10 } } }
}

function hdrCell(v: string): Cell {
  return {
    v, t: "s",
    s: styleOf(
      { bold: true, color: { rgb: C.white }, sz: 10 },
      C.navy,
      { horizontal: "center", vertical: "center", wrapText: true },
    ),
  }
}

function subHdrCell(v: string): Cell {
  return {
    v, t: "s",
    s: styleOf({ bold: true, sz: 11 }, C.lightBlue, { horizontal: "left" }),
  }
}

function strCell(v: string, opts: StrOpts = {}): Cell {
  return {
    v, t: "s",
    s: styleOf(
      { bold: opts.bold, italic: opts.italic, ...(opts.color ? { color: { rgb: opts.color } } : {}) },
      opts.fill,
      opts.center ? { horizontal: "center" } : undefined,
    ),
  }
}

function numCell(v: number, opts: NumOpts = {}): Cell {
  const fmt   = opts.fmt ?? '"$"#,##0.00'
  const color = opts.gain != null ? (v >= 0 ? C.green : C.red) : undefined
  return {
    v, t: "n", z: fmt,
    s: styleOf(
      { bold: opts.bold, ...(color ? { color: { rgb: color } } : {}) },
      opts.fill,
      { horizontal: "right" },
    ),
  }
}

function dateCell(isoDate: string, opts: { bold?: boolean; fill?: string } = {}): Cell {
  return {
    v: toExcelDate(isoDate), t: "n", z: "DD/MM/YYYY",
    s: styleOf({ bold: opts.bold }, opts.fill, { horizontal: "center" }),
  }
}

function blankCell(fill?: string): Cell {
  return { v: "", t: "s", s: fill ? { fill: { fgColor: { rgb: fill } } } : {} }
}

/** Numeric formula cell — carries both cached value and formula string */
function fNum(v: number, f: string, opts: NumOpts = {}): Cell {
  const fmt   = opts.fmt ?? '"$"#,##0.00'
  const color = opts.gain != null ? (v >= 0 ? C.green : C.red) : undefined
  return {
    v, t: "n", f, z: fmt,
    s: styleOf(
      { bold: opts.bold, ...(color ? { color: { rgb: color } } : {}) },
      opts.fill,
      { horizontal: "right" },
    ),
  }
}

/** String formula cell */
function fStr(v: string, f: string, opts: StrOpts = {}): Cell {
  return {
    v, t: "s", f,
    s: styleOf(
      { bold: opts.bold, ...(opts.color ? { color: { rgb: opts.color } } : {}) },
      opts.fill,
      { horizontal: opts.center ? "center" : "left" },
    ),
  }
}

function emptyRow(ncols = NCOLS, fill?: string): Cell[] {
  return Array.from({ length: ncols }, () => blankCell(fill))
}

function setColWidths(ws: XLSX.WorkSheet, widths: number[]): void {
  ws["!cols"] = widths.map((w) => ({ wch: w }))
}

// ─── Detail sheet ─────────────────────────────────────────────────────────────

export function buildDetailSheet(
  disposals: Disposal[],
  amitAdjustments: AmitAdjustment[],
  entityType: EntityType,
  fyLabel: string,
): XLSX.WorkSheet {
  const rows: Cell[][] = []

  // Rows 1–4: title / meta / note / spacer  (0-indexed 0–3)
  rows.push([titleCell(`Capital Gains – Parcel Detail  |  ${fyLabel}`)])
  rows.push([metaCell(
    `Generated: ${new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "long", year: "numeric" })}` +
    `   |   All computed columns (M–S) contain live Excel formulas.`
  )])
  rows.push([metaCell(
    "Net proceeds are allocated proportionally across parcels (parcel units ÷ total units × disposal net proceeds). " +
    "Sell brokerage is deducted at the disposal level inside the net proceeds figure (col G)."
  )])
  rows.push(emptyRow())

  // Row 5 (0-indexed 4): config — entity type + discount rate formula
  const discRate = entityType !== "company" ? 0.5 : 0
  const configRow: Cell[] = emptyRow()
  configRow[0] = strCell("Entity Type:", { bold: true })
  configRow[1] = strCell(entityType, { bold: true, color: C.blue })
  configRow[3] = strCell("CGT Discount Rate:", { bold: true })
  configRow[5] = {
    v: discRate, t: "n", z: "0%",
    f: `IF(OR(${ENTITY_REF}="individual",${ENTITY_REF}="trust"),0.5,0)`,
    s: styleOf({ bold: true, color: { rgb: discRate > 0 ? C.green : C.red } }, undefined, { horizontal: "left" }),
  }
  rows.push(configRow)

  // Row 6 (0-indexed 5): spacer
  rows.push(emptyRow())

  // Row 7 (0-indexed 6): column headers  ← D_FIRST_DATA - 1 = 7
  rows.push([
    hdrCell("FY"), hdrCell("Ticker"), hdrCell("Disposal Date"), hdrCell("Method"),
    hdrCell("Sale $/Unit"), hdrCell("Sale Brokerage ($)"), hdrCell("Net Proceeds ($)"), hdrCell("Total Units Sold"),
    hdrCell("Parcel Acquired"), hdrCell("Parcel Units"),
    hdrCell("Raw Cost Base ($)"), hdrCell("AMIT Adj ($)"),
    hdrCell("Adj Cost Base ($)\n=K+L"),
    hdrCell("Parcel Proceeds ($)\n=(J÷H)×G"),
    hdrCell("Gross Gain/Loss ($)\n=N−M"),
    hdrCell("Held\n>12mo?"),
    hdrCell("CGT\nDiscount?"),
    hdrCell("Discount Amt ($)\n=O×disc rate"),
    hdrCell("Net Taxable ($)\n=O−R"),
  ])

  // Data rows — D_FIRST_DATA = 8 (1-indexed), 0-indexed = 7
  // Current rowIdx starts at 7 (the header row just pushed is idx 6)
  let rowIdx = D_FIRST_DATA - 1  // will be incremented before use

  const sorted = [...disposals].sort((a, b) => a.date.localeCompare(b.date))

  // Track subtotal row indices (1-indexed) for grand total SUM formulas
  const subtotalExcelRows: number[] = []

  for (const [di, d] of sorted.entries()) {
    const fill = di % 2 === 0 ? C.offWhite : C.white
    const subFill = C.lightBlue

    const parcelStartExcel = rowIdx + 1  // first parcel row for this disposal

    for (const pu of d.parcelsUsed) {
      rowIdx++
      const r = rowIdx  // current 1-indexed Excel row

      const amitAdj = calcAmitAdjPerUnit(d.ticker, pu.acquisitionDate, d.date, amitAdjustments) * pu.units
      const adjCostBase = pu.costBase + amitAdj
      const proceeds    = (pu.units / d.units) * d.proceeds
      const grossGain   = proceeds - adjCostBase
      const discountAmt = grossGain > 0 && pu.discountEligible ? grossGain * discRate : 0
      const netTaxable  = grossGain - discountAmt

      // Column references for this row
      const C_  = addr(DC.DISP_DATE,    r)
      const G_  = addr(DC.PROCEEDS,     r)
      const H_  = addr(DC.DISP_UNITS,   r)
      const I_  = addr(DC.PARCEL_DATE,  r)
      const J_  = addr(DC.PARCEL_UNITS, r)
      const K_  = addr(DC.RAW_COST,     r)
      const L_  = addr(DC.AMIT,         r)
      const M_  = addr(DC.ADJ_COST,     r)
      const N_  = addr(DC.PARC_PROC,    r)
      const O_  = addr(DC.GROSS_GAIN,   r)
      const P_  = addr(DC.HELD,         r)
      const Q_  = addr(DC.DISC_ELIG,    r)
      const R_  = addr(DC.DISC_AMT,     r)

      const row: Cell[] = []
      row[DC.FY]          = strCell(getFinancialYear(d.date), { fill })
      row[DC.TICKER]      = strCell(d.ticker, { fill })
      row[DC.DISP_DATE]   = dateCell(d.date, { fill })
      row[DC.METHOD]      = strCell(d.method.toUpperCase(), { fill, center: true })
      row[DC.UNIT_PRICE]  = numCell(d.unitPrice, { fill, fmt: '"$"#,##0.00000' })
      row[DC.BROKERAGE]   = numCell(d.brokerage, { fill })
      row[DC.PROCEEDS]    = numCell(d.proceeds,  { fill })
      row[DC.DISP_UNITS]  = { v: d.units,    t: "n", z: "#,##0.###", s: styleOf({ bold: false }, fill, { horizontal: "right" }) }
      row[DC.PARCEL_DATE] = dateCell(pu.acquisitionDate, { fill })
      row[DC.PARCEL_UNITS]= { v: pu.units,   t: "n", z: "#,##0.###", s: styleOf({ bold: false }, fill, { horizontal: "right" }) }
      row[DC.RAW_COST]    = numCell(pu.costBase, { fill })
      row[DC.AMIT]        = numCell(amitAdj,     { fill, fmt: '"$"#,##0.00;-"$"#,##0.00;"—"' })

      // Formula columns
      row[DC.ADJ_COST]    = fNum(adjCostBase, `${K_}+${L_}`,        { fill })
      row[DC.PARC_PROC]   = fNum(proceeds,    `(${J_}/${H_})*${G_}`, { fill })
      row[DC.GROSS_GAIN]  = fNum(grossGain,   `${N_}-${M_}`,        { fill, gain: true })

      row[DC.HELD]        = fStr(
        pu.discountEligible ? "Yes" : "No",
        `IF(DATE(YEAR(${I_})+1,MONTH(${I_}),DAY(${I_}))<${C_},"Yes","No")`,
        { fill, center: true },
      )
      row[DC.DISC_ELIG]   = fStr(
        pu.discountEligible ? "Yes" : "No",
        `IF(AND(${P_}="Yes",${ENTITY_REF}<>"company"),"Yes","No")`,
        { fill, center: true },
      )
      row[DC.DISC_AMT]    = fNum(discountAmt, `IF(AND(${Q_}="Yes",${O_}>0),${O_}*${DISC_RATE_REF},0)`, { fill })
      row[DC.NET_TAX]     = fNum(netTaxable,  `${O_}-${R_}`, { fill, gain: true })

      rows.push(row)
    }

    const parcelEndExcel = rowIdx  // last parcel row for this disposal

    // ── Subtotal row ────────────────────────────────────────────────
    rowIdx++
    const sr = rowIdx  // subtotal Excel row (1-indexed)
    subtotalExcelRows.push(sr)

    const kRange = `${addr(DC.RAW_COST, parcelStartExcel)}:${addr(DC.RAW_COST, parcelEndExcel)}`
    const lRange = `${addr(DC.AMIT,     parcelStartExcel)}:${addr(DC.AMIT,     parcelEndExcel)}`
    const mRange = `${addr(DC.ADJ_COST, parcelStartExcel)}:${addr(DC.ADJ_COST, parcelEndExcel)}`
    const rRange = `${addr(DC.DISC_AMT, parcelStartExcel)}:${addr(DC.DISC_AMT, parcelEndExcel)}`

    const M_sr = addr(DC.ADJ_COST,   sr)
    const N_sr = addr(DC.PARC_PROC,  sr)
    const O_sr = addr(DC.GROSS_GAIN, sr)
    const R_sr = addr(DC.DISC_AMT,   sr)
    const G_sr = addr(DC.PROCEEDS,   sr)

    // Total values for cached results in subtotal row
    const totalAdjCost   = d.parcelsUsed.reduce((s, pu) => {
      const adj = calcAmitAdjPerUnit(d.ticker, pu.acquisitionDate, d.date, amitAdjustments) * pu.units
      return s + pu.costBase + adj
    }, 0)
    const totalGrossGain = d.proceeds - totalAdjCost
    const totalDiscount  = d.parcelsUsed.reduce((s, pu) => {
      const adj = calcAmitAdjPerUnit(d.ticker, pu.acquisitionDate, d.date, amitAdjustments) * pu.units
      const adjCost = pu.costBase + adj
      const proc = (pu.units / d.units) * d.proceeds
      const g = proc - adjCost
      return s + (g > 0 && pu.discountEligible ? g * discRate : 0)
    }, 0)
    const totalNet       = totalGrossGain - totalDiscount

    const subRow: Cell[] = emptyRow(NCOLS, subFill)
    subRow[DC.FY]         = blankCell(subFill)
    subRow[DC.TICKER]     = strCell(
      `${d.ticker} — ${fmtDate(d.date)}   (brokerage on sale: $${d.brokerage.toFixed(2)})`,
      { bold: true, fill: subFill },
    )
    subRow[DC.DISP_DATE]  = dateCell(d.date, { fill: subFill, bold: true })
    subRow[DC.METHOD]     = strCell(d.method.toUpperCase(), { fill: subFill, center: true, bold: true })
    subRow[DC.UNIT_PRICE] = numCell(d.unitPrice, { fill: subFill, bold: true, fmt: '"$"#,##0.00000' })
    subRow[DC.BROKERAGE]  = numCell(d.brokerage, { fill: subFill, bold: true })
    subRow[DC.PROCEEDS]   = numCell(d.proceeds,  { fill: subFill, bold: true })
    subRow[DC.DISP_UNITS] = { v: d.units, t: "n", z: "#,##0.###", s: styleOf({ bold: true }, subFill, { horizontal: "right" }) }
    subRow[DC.PARCEL_DATE]= strCell("DISPOSAL TOTAL", { bold: true, fill: subFill, center: true })
    subRow[DC.PARCEL_UNITS] = blankCell(subFill)
    subRow[DC.RAW_COST]   = fNum(d.parcelsUsed.reduce((s, pu) => s + pu.costBase, 0), `SUM(${kRange})`, { bold: true, fill: subFill })
    subRow[DC.AMIT]       = fNum(
      d.parcelsUsed.reduce((s, pu) => s + calcAmitAdjPerUnit(d.ticker, pu.acquisitionDate, d.date, amitAdjustments) * pu.units, 0),
      `SUM(${lRange})`,
      { bold: true, fill: subFill, fmt: '"$"#,##0.00;-"$"#,##0.00;"—"' },
    )
    subRow[DC.ADJ_COST]   = fNum(totalAdjCost,   `SUM(${mRange})`,     { bold: true, fill: subFill })
    subRow[DC.PARC_PROC]  = fNum(d.proceeds,      `${G_sr}`,            { bold: true, fill: subFill })
    subRow[DC.GROSS_GAIN] = fNum(totalGrossGain,  `${N_sr}-${M_sr}`,   { bold: true, fill: subFill, gain: true })
    subRow[DC.HELD]       = blankCell(subFill)
    subRow[DC.DISC_ELIG]  = blankCell(subFill)
    subRow[DC.DISC_AMT]   = fNum(totalDiscount, `SUM(${rRange})`,     { bold: true, fill: subFill })
    subRow[DC.NET_TAX]    = fNum(totalNet,       `${O_sr}-${R_sr}`,   { bold: true, fill: subFill, gain: true })

    rows.push(subRow)
    rows.push(emptyRow())  // spacer between disposal groups
    rowIdx++               // account for the spacer row
  }

  // ── Grand total row ──────────────────────────────────────────────────────
  rowIdx++
  const gtr = rowIdx

  // Build explicit cell lists for grand total (sum subtotal rows only)
  const sumCells = (col: number) =>
    subtotalExcelRows.map((r) => addr(col, r)).join("+")

  const grandAdjCost  = sorted.reduce((s, d) => {
    return s + d.parcelsUsed.reduce((ps, pu) => {
      const adj = calcAmitAdjPerUnit(d.ticker, pu.acquisitionDate, d.date, amitAdjustments) * pu.units
      return ps + pu.costBase + adj
    }, 0)
  }, 0)
  const grandProceeds = sorted.reduce((s, d) => s + d.proceeds, 0)
  const grandGross    = grandProceeds - grandAdjCost
  const grandDiscount = sorted.reduce((s, d) => {
    return s + d.parcelsUsed.reduce((ps, pu) => {
      const adj = calcAmitAdjPerUnit(d.ticker, pu.acquisitionDate, d.date, amitAdjustments) * pu.units
      const adjCost = pu.costBase + adj
      const proc = (pu.units / d.units) * d.proceeds
      const g = proc - adjCost
      return ps + (g > 0 && pu.discountEligible ? g * discRate : 0)
    }, 0)
  }, 0)
  const grandNet      = grandGross - grandDiscount

  const M_gt = addr(DC.ADJ_COST,   gtr)
  const N_gt = addr(DC.PARC_PROC,  gtr)
  const O_gt = addr(DC.GROSS_GAIN, gtr)
  const R_gt = addr(DC.DISC_AMT,   gtr)

  const grandRow: Cell[] = emptyRow(NCOLS, C.navy)
  grandRow[DC.TICKER]    = strCell("GRAND TOTAL", { bold: true, fill: C.navy, color: C.white })
  grandRow[DC.ADJ_COST]  = fNum(grandAdjCost,  sumCells(DC.ADJ_COST),  { bold: true, fill: C.navy })
  grandRow[DC.PARC_PROC] = fNum(grandProceeds, sumCells(DC.PARC_PROC), { bold: true, fill: C.navy })
  grandRow[DC.GROSS_GAIN]= fNum(grandGross,    `${N_gt}-${M_gt}`,      { bold: true, fill: C.navy, gain: true })
  grandRow[DC.DISC_AMT]  = fNum(grandDiscount, sumCells(DC.DISC_AMT),  { bold: true, fill: C.navy })
  grandRow[DC.NET_TAX]   = fNum(grandNet,      `${O_gt}-${R_gt}`,      { bold: true, fill: C.navy, gain: true })

  // Override colour for grand total gain/loss (use white text instead of green/red on dark bg)
  ;(grandRow[DC.GROSS_GAIN].s as Record<string, unknown>).font = { bold: true, color: { rgb: C.white } }
  ;(grandRow[DC.NET_TAX].s   as Record<string, unknown>).font = { bold: true, color: { rgb: C.white } }

  rows.push(grandRow)

  const ws = XLSX.utils.aoa_to_sheet(rows)

  setColWidths(ws, [8, 10, 14, 10, 14, 16, 16, 14, 14, 12, 16, 12, 16, 16, 18, 10, 12, 14, 16])

  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: NCOLS - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: NCOLS - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: NCOLS - 1 } },
  ]

  return ws
}

// ─── Summary sheet ────────────────────────────────────────────────────────────
//
// Each data cell references the Detail sheet via SUMPRODUCT.
// Column layout:
//   A  FY               (value)
//   B  Ticker           (value)
//   C  Gross Gains      SUMPRODUCT from Detail col O (positive)
//   D  Gross Losses     SUMPRODUCT from Detail col O (negative)
//   E  Net Before Disc  FORMULA =C+D
//   F  CGT Discount     SUMPRODUCT from Detail col R
//   G  Net Taxable      FORMULA =E-F
//   H  Note             (value)

const SC = { FY: 0, TICKER: 1, GAINS: 2, LOSSES: 3, NET_BEF: 4, DISC: 5, NET_TAX: 6, NOTE: 7 }
const S_NCOLS = 8
const DETAIL_SHEET = "'Parcel Detail'"

function detailRange(col: number): string {
  const c = colLetter(col)
  return `${DETAIL_SHEET}!$${c}$${D_FIRST_DATA}:$${c}$${MAX_ROW}`
}

function summaryFormulas(
  fyRef: string,
  tickerRef: string,
): { gains: string; losses: string; disc: string } {
  const fyRange     = detailRange(DC.FY)
  const tickerRange = detailRange(DC.TICKER)
  const oRange      = detailRange(DC.GROSS_GAIN)
  const rRange      = detailRange(DC.DISC_AMT)

  const gains  = `SUMIFS(${oRange},${fyRange},${fyRef},${tickerRange},${tickerRef},${oRange},">0")`
  const losses = `SUMIFS(${oRange},${fyRange},${fyRef},${tickerRange},${tickerRef},${oRange},"<0")`
  const disc   = `SUMIFS(${rRange},${fyRange},${fyRef},${tickerRange},${tickerRef})`

  return { gains, losses, disc }
}

export function buildSummarySheet(
  disposals: Disposal[],
  amitAdjustments: AmitAdjustment[],
  fyLabel: string,
): XLSX.WorkSheet {
  const rows: Cell[][] = []

  rows.push([titleCell(`Capital Gains – Summary  |  ${fyLabel}`)])
  rows.push([metaCell(
    `Generated: ${new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "long", year: "numeric" })}` +
    `   |   All figures are formula-driven from the "Parcel Detail" sheet.`
  )])
  rows.push(emptyRow(S_NCOLS))

  // Aggregate per FY + ticker (for cached values & ordering)
  type AggRow = { fy: string; ticker: string; gains: number; losses: number; disc: number; net: number }
  const aggMap = new Map<string, AggRow>()

  for (const d of disposals) {
    const fy = getFinancialYear(d.date)
    for (const pu of d.parcelsUsed) {
      const key = `${fy}|${d.ticker}`
      if (!aggMap.has(key)) aggMap.set(key, { fy, ticker: d.ticker, gains: 0, losses: 0, disc: 0, net: 0 })
      const row = aggMap.get(key)!
      const amitAdj    = calcAmitAdjPerUnit(d.ticker, pu.acquisitionDate, d.date, amitAdjustments) * pu.units
      const adjCost    = pu.costBase + amitAdj
      const proc       = (pu.units / d.units) * d.proceeds
      const grossGain  = proc - adjCost
      const discRate   = pu.discountEligible ? 0.5 : 0  // NOTE: company check done via Detail col Q
      const discountAmt = grossGain > 0 && pu.discountEligible ? grossGain * discRate : 0
      if (grossGain >= 0) row.gains += grossGain; else row.losses += grossGain
      row.disc += discountAmt
    }
  }
  for (const row of aggMap.values()) {
    row.net = row.gains + row.losses - row.disc
  }

  const aggRows = [...aggMap.values()].sort((a, b) => a.fy.localeCompare(b.fy) || a.ticker.localeCompare(b.ticker))
  const fys     = [...new Set(aggRows.map((r) => r.fy))]

  let rowIdx = 3  // already pushed 3 rows (0-indexed: 0,1,2)

  for (const fy of fys) {
    const fyRows = aggRows.filter((r) => r.fy === fy)

    // FY subheader
    const fySubHdrRow: Cell[] = emptyRow(S_NCOLS, C.lightBlue)
    fySubHdrRow[0] = subHdrCell(fy)
    rows.push(fySubHdrRow)
    rowIdx++

    // Column headers
    rows.push([
      hdrCell("FY"), hdrCell("Ticker"),
      hdrCell("Gross Gains ($)\nSUMPRODUCT from Detail"),
      hdrCell("Gross Losses ($)\nSUMPRODUCT from Detail"),
      hdrCell("Net Before Discount ($)\n=C+D"),
      hdrCell("CGT Discount ($)\nSUMPRODUCT from Detail"),
      hdrCell("Net Taxable Gain ($)\n=E−F"),
      hdrCell("Notes"),
    ])
    rowIdx++

    const tickerStartRow = rowIdx + 1  // first ticker row (1-indexed Excel)

    for (const [idx, agg] of fyRows.entries()) {
      rowIdx++
      const r    = rowIdx  // 1-indexed Excel row
      const fill = idx % 2 === 0 ? C.offWhite : C.white

      const fyRef     = `${addr(SC.FY,     r)}`
      const tickerRef = `${addr(SC.TICKER, r)}`
      const { gains, losses, disc } = summaryFormulas(fyRef, tickerRef)

      const net = agg.gains + agg.losses - agg.disc
      const note = agg.disc > 0
        ? "50% discount applied to eligible gains"
        : agg.gains === 0 ? "Capital loss only" : ""

      const dataRow: Cell[] = []
      dataRow[SC.FY]      = strCell(agg.fy,     { fill })
      dataRow[SC.TICKER]  = strCell(agg.ticker,  { fill })
      const C_ = addr(SC.GAINS,   r)
      const D_ = addr(SC.LOSSES,  r)
      const E_ = addr(SC.NET_BEF, r)
      const F_ = addr(SC.DISC,    r)

      dataRow[SC.GAINS]   = fNum(agg.gains,  gains,  { fill })
      dataRow[SC.LOSSES]  = fNum(agg.losses, losses, { fill })
      dataRow[SC.NET_BEF] = fNum(agg.gains + agg.losses, `${C_}+${D_}`, { fill, gain: true })
      dataRow[SC.DISC]    = fNum(agg.disc,   disc,   { fill })
      dataRow[SC.NET_TAX] = fNum(net,        `${E_}-${F_}`, { fill, gain: true })
      dataRow[SC.NOTE]    = strCell(note, { fill, italic: true, color: C.slate })

      rows.push(dataRow)
    }

    const tickerEndRow = rowIdx  // last ticker row (1-indexed Excel)

    // FY total row
    rowIdx++
    const tr = rowIdx

    const kRange = (col: number) =>
      `${addr(col, tickerStartRow)}:${addr(col, tickerEndRow)}`

    const fyGains   = fyRows.reduce((s, r) => s + r.gains, 0)
    const fyLosses  = fyRows.reduce((s, r) => s + r.losses, 0)
    const fyNet     = fyRows.reduce((s, r) => s + r.gains + r.losses - r.disc, 0)
    const fyDisc    = fyRows.reduce((s, r) => s + r.disc, 0)

    const C_tr = addr(SC.GAINS,   tr)
    const D_tr = addr(SC.LOSSES,  tr)
    const E_tr = addr(SC.NET_BEF, tr)
    const F_tr = addr(SC.DISC,    tr)

    const totalRow: Cell[] = emptyRow(S_NCOLS, C.lightBlue)
    totalRow[SC.FY]      = strCell(fy, { bold: true, fill: C.lightBlue })
    totalRow[SC.TICKER]  = strCell("TOTAL", { bold: true, fill: C.lightBlue })
    totalRow[SC.GAINS]   = fNum(fyGains,  `SUM(${kRange(SC.GAINS)})`,   { bold: true, fill: C.lightBlue })
    totalRow[SC.LOSSES]  = fNum(fyLosses, `SUM(${kRange(SC.LOSSES)})`,  { bold: true, fill: C.lightBlue })
    totalRow[SC.NET_BEF] = fNum(fyGains + fyLosses, `${C_tr}+${D_tr}`, { bold: true, fill: C.lightBlue, gain: true })
    totalRow[SC.DISC]    = fNum(fyDisc,   `SUM(${kRange(SC.DISC)})`,    { bold: true, fill: C.lightBlue })
    totalRow[SC.NET_TAX] = fNum(fyNet,    `${E_tr}-${F_tr}`,            { bold: true, fill: C.lightBlue, gain: true })
    totalRow[SC.NOTE]    = blankCell(C.lightBlue)

    rows.push(totalRow)
    rows.push(emptyRow(S_NCOLS))
    rowIdx += 2
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)

  setColWidths(ws, [10, 12, 22, 22, 22, 20, 20, 38])

  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: S_NCOLS - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: S_NCOLS - 1 } },
  ]

  return ws
}

// ─── Parcel Register sheet ────────────────────────────────────────────────────
//
// Shows every parcel with original units vs units disposed vs units remaining.
// Demonstrates no parcel has been over-sold and cost bases are traceable.
//
// Column layout:
//   A  Ticker              (value)
//   B  Acquisition Date    (Excel date)
//   C  Original Units      (value)
//   D  Unit Price          (value)
//   E  Brokerage           (value)
//   F  Total Cost Base     FORMULA =C*D+E
//   G  Units Disposed      FORMULA =C-H
//   H  Units Remaining     (value)
//   I  Remaining Cost Base FORMULA =(H/C)*F
//   J  Status              FORMULA =IF(H=0,"Fully Disposed",IF(H=C,"Open","Partially Disposed"))

const PR = { TICKER: 0, DATE: 1, ORIG_UNITS: 2, UNIT_PRICE: 3, BROKERAGE: 4, COST_BASE: 5, DISPOSED: 6, REMAINING: 7, REM_COST: 8, STATUS: 9 }
const PR_NCOLS = 10

export function buildParcelRegisterSheet(parcels: Parcel[], fyLabel: string): XLSX.WorkSheet {
  const rows: Cell[][] = []

  rows.push([titleCell(`Parcel Register  |  ${fyLabel}`)])
  rows.push([metaCell(
    `Generated: ${new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "long", year: "numeric" })}` +
    `   |   Shows all parcels to confirm no parcel has been over-disposed.`
  )])
  rows.push(emptyRow(PR_NCOLS))

  // Column headers  (row index 3 = Excel row 4)
  rows.push([
    hdrCell("Ticker"),
    hdrCell("Acquired"),
    hdrCell("Original Units"),
    hdrCell("Unit Price ($)"),
    hdrCell("Brokerage ($)"),
    hdrCell("Total Cost Base ($)\n=C×D+E"),
    hdrCell("Units Disposed\n=C−H"),
    hdrCell("Units Remaining"),
    hdrCell("Remaining Cost Base ($)\n=(H÷C)×F"),
    hdrCell("Status"),
  ])

  const PR_FIRST_DATA = 5  // Excel row 5 (1-indexed)

  const sorted = [...parcels].sort((a, b) =>
    a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date)
  )

  // Group by ticker for subtotals
  const tickers = [...new Set(sorted.map((p) => p.ticker))]
  let rowIdx = PR_FIRST_DATA - 1  // 0-indexed, will increment before use

  const tickerSubtotalRows: number[] = []  // for grand total SUM

  for (const [ti, ticker] of tickers.entries()) {
    const tickerParcels = sorted.filter((p) => p.ticker === ticker)
    const fill = ti % 2 === 0 ? C.offWhite : C.white

    const tickerStartExcel = rowIdx + 2  // +1 for increment, +1 for 1-indexed

    for (const p of tickerParcels) {
      rowIdx++
      const r = rowIdx  // 1-indexed Excel row

      const C_ = addr(PR.ORIG_UNITS, r)
      const D_ = addr(PR.UNIT_PRICE, r)
      const E_ = addr(PR.BROKERAGE,  r)
      const F_ = addr(PR.COST_BASE,  r)
      const H_ = addr(PR.REMAINING,  r)

      const totalCostBase  = p.costBase
      const unitsDisposed  = p.units - p.unitsRemaining
      const remainingCost  = p.unitsRemaining === 0 ? 0 : (p.unitsRemaining / p.units) * p.costBase

      let statusVal: string
      if (p.unitsRemaining === 0)       statusVal = "Fully Disposed"
      else if (p.unitsRemaining === p.units) statusVal = "Open"
      else                              statusVal = "Partially Disposed"

      const statusColor = p.unitsRemaining === 0 ? C.slate : p.unitsRemaining === p.units ? C.green : C.blue

      const row: Cell[] = []
      row[PR.TICKER]    = strCell(p.ticker, { fill })
      row[PR.DATE]      = dateCell(p.date,  { fill })
      row[PR.ORIG_UNITS]= { v: p.units,           t: "n", z: "#,##0.###", s: styleOf(undefined, fill, { horizontal: "right" }) }
      row[PR.UNIT_PRICE]= numCell(p.unitPrice,     { fill, fmt: '"$"#,##0.00000' })
      row[PR.BROKERAGE] = numCell(p.brokerage,     { fill })
      row[PR.COST_BASE] = fNum(totalCostBase,  `${C_}*${D_}+${E_}`, { fill })
      row[PR.DISPOSED]  = fNum(unitsDisposed,  `${C_}-${H_}`,        { fill, fmt: "#,##0.###" })
      row[PR.REMAINING] = { v: p.unitsRemaining,  t: "n", z: "#,##0.###", s: styleOf(undefined, fill, { horizontal: "right" }) }
      row[PR.REM_COST]  = fNum(remainingCost,  `(${H_}/${C_})*${F_}`, { fill })
      row[PR.STATUS]    = fStr(statusVal,
        `IF(${H_}=0,"Fully Disposed",IF(${H_}=${C_},"Open","Partially Disposed"))`,
        { fill, center: true, color: statusColor },
      )

      // Override status cell colour (gain-style colouring not in fStr opts directly)
      row[PR.STATUS].s.font = { color: { rgb: statusColor } }

      rows.push(row)
    }

    const tickerEndExcel = rowIdx

    // Ticker subtotal
    rowIdx++
    const tr = rowIdx
    tickerSubtotalRows.push(tr)

    const origRange = `${addr(PR.ORIG_UNITS, tickerStartExcel)}:${addr(PR.ORIG_UNITS, tickerEndExcel)}`
    const dispRange = `${addr(PR.DISPOSED,   tickerStartExcel)}:${addr(PR.DISPOSED,   tickerEndExcel)}`
    const remRange  = `${addr(PR.REMAINING,  tickerStartExcel)}:${addr(PR.REMAINING,  tickerEndExcel)}`
    const costRange = `${addr(PR.COST_BASE,  tickerStartExcel)}:${addr(PR.COST_BASE,  tickerEndExcel)}`
    const remCostRange = `${addr(PR.REM_COST, tickerStartExcel)}:${addr(PR.REM_COST,  tickerEndExcel)}`

    const totOrig    = tickerParcels.reduce((s, p) => s + p.units, 0)
    const totDisp    = tickerParcels.reduce((s, p) => s + (p.units - p.unitsRemaining), 0)
    const totRem     = tickerParcels.reduce((s, p) => s + p.unitsRemaining, 0)
    const totCost    = tickerParcels.reduce((s, p) => s + p.costBase, 0)
    const totRemCost = tickerParcels.reduce((s, p) => s + (p.unitsRemaining / p.units) * p.costBase, 0)

    const subRow: Cell[] = emptyRow(PR_NCOLS, C.lightBlue)
    subRow[PR.TICKER]    = strCell(ticker, { bold: true, fill: C.lightBlue })
    subRow[PR.DATE]      = strCell("TOTAL", { bold: true, fill: C.lightBlue, center: true })
    subRow[PR.ORIG_UNITS]= fNum(totOrig,    `SUM(${origRange})`,    { bold: true, fill: C.lightBlue, fmt: "#,##0.###" })
    subRow[PR.UNIT_PRICE]= blankCell(C.lightBlue)
    subRow[PR.BROKERAGE] = blankCell(C.lightBlue)
    subRow[PR.COST_BASE] = fNum(totCost,    `SUM(${costRange})`,    { bold: true, fill: C.lightBlue })
    subRow[PR.DISPOSED]  = fNum(totDisp,    `SUM(${dispRange})`,    { bold: true, fill: C.lightBlue, fmt: "#,##0.###" })
    subRow[PR.REMAINING] = fNum(totRem,     `SUM(${remRange})`,     { bold: true, fill: C.lightBlue, fmt: "#,##0.###" })
    subRow[PR.REM_COST]  = fNum(totRemCost, `SUM(${remCostRange})`, { bold: true, fill: C.lightBlue })
    subRow[PR.STATUS]    = blankCell(C.lightBlue)

    rows.push(subRow)
    rows.push(emptyRow(PR_NCOLS))
    rowIdx++
  }

  // Grand total
  rowIdx++

  const sumSubtotals = (col: number) => tickerSubtotalRows.map((r) => addr(col, r)).join("+")

  const grandOrig    = parcels.reduce((s, p) => s + p.units, 0)
  const grandDisp    = parcels.reduce((s, p) => s + (p.units - p.unitsRemaining), 0)
  const grandRem     = parcels.reduce((s, p) => s + p.unitsRemaining, 0)
  const grandCost    = parcels.reduce((s, p) => s + p.costBase, 0)
  const grandRemCost = parcels.reduce((s, p) => s + (p.unitsRemaining / p.units) * p.costBase, 0)

  const grandRow: Cell[] = emptyRow(PR_NCOLS, C.navy)
  grandRow[PR.TICKER]    = strCell("GRAND TOTAL", { bold: true, fill: C.navy, color: C.white })
  grandRow[PR.ORIG_UNITS]= fNum(grandOrig,    sumSubtotals(PR.ORIG_UNITS), { bold: true, fill: C.navy, fmt: "#,##0.###" })
  grandRow[PR.COST_BASE] = fNum(grandCost,    sumSubtotals(PR.COST_BASE),  { bold: true, fill: C.navy })
  grandRow[PR.DISPOSED]  = fNum(grandDisp,    sumSubtotals(PR.DISPOSED),   { bold: true, fill: C.navy, fmt: "#,##0.###" })
  grandRow[PR.REMAINING] = fNum(grandRem,     sumSubtotals(PR.REMAINING),  { bold: true, fill: C.navy, fmt: "#,##0.###" })
  grandRow[PR.REM_COST]  = fNum(grandRemCost, sumSubtotals(PR.REM_COST),   { bold: true, fill: C.navy })
  // White text on navy background
  for (const col of [PR.ORIG_UNITS, PR.COST_BASE, PR.DISPOSED, PR.REMAINING, PR.REM_COST]) {
    grandRow[col].s.font = { bold: true, color: { rgb: C.white } }
  }

  rows.push(grandRow)

  const ws = XLSX.utils.aoa_to_sheet(rows)

  setColWidths(ws, [10, 14, 14, 14, 12, 18, 14, 16, 20, 18])

  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: PR_NCOLS - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: PR_NCOLS - 1 } },
  ]

  return ws
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function exportCapitalGainsXLSX(
  parcels: Parcel[],
  disposals: Disposal[],
  amitAdjustments: AmitAdjustment[],
  entityType: EntityType,
  fyFilter: string | null,
): void {
  const filtered = fyFilter
    ? disposals.filter((d) => getFinancialYear(d.date) === fyFilter)
    : disposals

  if (filtered.length === 0) return

  const fyLabel = fyFilter ?? "All Years"
  const wb      = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(wb, buildSummarySheet(filtered, amitAdjustments, fyLabel), "Summary")
  XLSX.utils.book_append_sheet(wb, buildDetailSheet(filtered, amitAdjustments, entityType, fyLabel), "Parcel Detail")
  XLSX.utils.book_append_sheet(wb, buildParcelRegisterSheet(parcels, fyLabel), "Parcel Register")

  const date     = new Date().toISOString().slice(0, 10)
  const filename = fyFilter
    ? `CGT_${fyFilter}_${date}.xlsx`
    : `CGT_All_Years_${date}.xlsx`

  XLSX.writeFile(wb, filename)
}
