import { v4 as uuidv4 } from "uuid"
import type { EntityType, Parcel, ParcelUsage, Disposal, AmitAdjustment } from "./types"

// ── Date formatting ─────────────────────────────────────────────────

/** Converts ISO date string "YYYY-MM-DD" to UK format "DD/MM/YYYY" */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

// ── Cost base & proceeds ────────────────────────────────────────────

export function computeCostBase(units: number, unitPrice: number, brokerage: number): number {
  return units * unitPrice + brokerage
}

export function computeProceeds(units: number, unitPrice: number, brokerage: number): number {
  return units * unitPrice - brokerage
}

// ── Financial year ──────────────────────────────────────────────────

/** Returns the FY label for a date. AU FY runs 1 Jul – 30 Jun.
 *  e.g. "2024-07-01" → "FY2025", "2024-06-30" → "FY2024" */
export function getFinancialYear(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00")
  const month = d.getMonth() // 0-indexed: 0=Jan, 6=Jul
  const year = d.getFullYear()
  return month >= 6 ? `FY${year + 1}` : `FY${year}`
}

// ── CGT discount eligibility ────────────────────────────────────────

/** Held > 12 months (strictly more than). Exactly 12 months = NOT eligible.
 *  s115-25(1) ITAA 1997 / TD 2002/10: a clear 12 months must elapse, excluding the day of
 *  acquisition and the day of the CGT event — so the first eligible day is anniversary + 1. */
export function isDiscountEligible(
  acquisitionDate: string,
  disposalDate: string,
  entityType: EntityType
): boolean {
  if (entityType === "company") return false

  const acq = new Date(acquisitionDate + "T00:00:00")
  const disp = new Date(disposalDate + "T00:00:00")

  // Add exactly 12 months to acquisition date
  const threshold = new Date(acq)
  threshold.setFullYear(threshold.getFullYear() + 1)
  // 29 Feb has no anniversary in a non-leap year: JS rolls it to 1 Mar, but the 12-month period
  // ends with the last day of February (Acts Interpretation Act s2G), so clamp back to 28 Feb
  if (threshold.getMonth() !== acq.getMonth()) threshold.setDate(0)

  // Disposal must be strictly AFTER the 12-month anniversary
  return disp > threshold
}

function discountMultiplier(eligible: boolean): number {
  return eligible ? 0.5 : 1.0
}

// ── Net capital gain ────────────────────────────────────────────────

export type NetCapitalGain = {
  grossGains: number
  grossLosses: number            // negative number
  netGainBeforeDiscount: number
  discountAmount: number
  netTaxableGain: number         // negative = net capital loss
}

/**
 * Nets gains and losses the way the ATO does (s102-5 ITAA 1997): capital losses reduce gross
 * capital gains first — non-discountable gains before discountable ones, which leaves the most
 * gain eligible for the discount — and only then is the 50% discount applied to what's left.
 * Halving each gain before subtracting losses understates the tax.
 */
export function netCapitalGain(items: { grossGain: number; discountEligible: boolean }[]): NetCapitalGain {
  let nonDiscount = 0
  let discountable = 0
  let losses = 0
  for (const { grossGain, discountEligible } of items) {
    if (grossGain < 0) losses -= grossGain
    else if (discountEligible) discountable += grossGain
    else nonDiscount += grossGain
  }

  const lossLeftAfterNonDiscount = Math.max(0, losses - nonDiscount)
  const nonDiscountLeft = Math.max(0, nonDiscount - losses)
  const discountableLeft = Math.max(0, discountable - lossLeftAfterNonDiscount)
  const unusedLoss = Math.max(0, lossLeftAfterNonDiscount - discountable)
  const discountAmount = discountableLeft * (1 - discountMultiplier(true))

  return {
    grossGains: nonDiscount + discountable,
    grossLosses: -losses,
    netGainBeforeDiscount: nonDiscount + discountable - losses,
    discountAmount,
    netTaxableGain: unusedLoss > 0 ? -unusedLoss : nonDiscountLeft + discountableLeft - discountAmount,
  }
}

// ── AMIT cost base adjustments ──────────────────────────────────────

/**
 * Returns the total AMIT adjustment per unit for a given parcel in the context
 * of a specific disposal or valuation date.
 *
 * Only includes adjustments where:
 *  - the ticker matches
 *  - the adjustment date is on or after the parcel's acquisition date
 *    (i.e. the parcel was held when the adjustment was made)
 *  - the adjustment date is on or before the reference date (disposal/today)
 */
export function calcAmitAdjPerUnit(
  ticker: string,
  parcelAcquisitionDate: string,
  referenceDate: string,
  adjustments: AmitAdjustment[]
): number {
  return adjustments
    .filter(
      (a) =>
        a.ticker === ticker &&
        a.date >= parcelAcquisitionDate &&
        a.date <= referenceDate &&
        a.unitsAtDate > 0
    )
    .reduce((s, a) => s + a.totalAdjustment / a.unitsAtDate, 0)
}

// ── Parcel creation ─────────────────────────────────────────────────

export function createParcel(
  ticker: string,
  date: string,
  units: number,
  unitPrice: number,
  brokerage: number
): Parcel {
  return {
    id: uuidv4(),
    ticker: ticker.toUpperCase(),
    date,
    units,
    unitPrice,
    brokerage,
    costBase: computeCostBase(units, unitPrice, brokerage),
    unitsRemaining: units,
  }
}

// ── Parcel matching ─────────────────────────────────────────────────

type MatchableParcels = Pick<Parcel, "id" | "date" | "unitPrice" | "brokerage" | "units" | "unitsRemaining" | "costBase">[]

function sortFIFO(parcels: MatchableParcels): MatchableParcels {
  return [...parcels].sort((a, b) => a.date.localeCompare(b.date))
}

function sortLIFO(parcels: MatchableParcels): MatchableParcels {
  return [...parcels].sort((a, b) => b.date.localeCompare(a.date))
}

function sortOptimised(
  parcels: MatchableParcels,
  salePricePerUnit: number,
  disposalDate: string,
  entityType: EntityType,
  amitAdjPerUnit: (p: MatchableParcels[number]) => number
): MatchableParcels {
  return [...parcels].sort((a, b) => {
    // Rank on the AMIT-adjusted cost base, since that's what the gain will be taxed on
    const costPerUnitA = a.costBase / a.units + amitAdjPerUnit(a)
    const costPerUnitB = b.costBase / b.units + amitAdjPerUnit(b)

    const gainA = salePricePerUnit - costPerUnitA
    const gainB = salePricePerUnit - costPerUnitB

    const isLossA = gainA < 0
    const isLossB = gainB < 0

    // 1. Losses first (regardless of age)
    if (isLossA && !isLossB) return -1
    if (!isLossA && isLossB) return 1

    // Both losses: prefer larger loss (more negative gain = smaller taxable position)
    if (isLossA && isLossB) {
      if (gainA !== gainB) return gainA - gainB // more negative first
      return costPerUnitB - costPerUnitA // tie-break: higher cost base
    }

    // 2. Both gains: rank by effective taxable gain per unit
    const discountA = isDiscountEligible(a.date, disposalDate, entityType)
    const discountB = isDiscountEligible(b.date, disposalDate, entityType)
    const taxableA = gainA * discountMultiplier(discountA)
    const taxableB = gainB * discountMultiplier(discountB)

    if (taxableA !== taxableB) return taxableA - taxableB // lower taxable gain first

    // 3. Tie-break: prefer higher cost base
    return costPerUnitB - costPerUnitA
  })
}

export function matchParcels(
  availableParcels: Parcel[],
  ticker: string,
  units: number,
  method: "fifo" | "lifo" | "optimised",
  salePricePerUnit: number,
  disposalDate: string,
  entityType: EntityType,
  amitAdjustments: AmitAdjustment[] = []
): ParcelUsage[] {
  const eligible = availableParcels.filter(
    (p) => p.ticker === ticker && p.unitsRemaining > 0
  )

  let sorted: MatchableParcels
  switch (method) {
    case "fifo":
      sorted = sortFIFO(eligible)
      break
    case "lifo":
      sorted = sortLIFO(eligible)
      break
    case "optimised":
      sorted = sortOptimised(eligible, salePricePerUnit, disposalDate, entityType, (p) =>
        calcAmitAdjPerUnit(ticker, p.date, disposalDate, amitAdjustments)
      )
      break
  }

  const result: ParcelUsage[] = []
  let remaining = units

  for (const parcel of sorted) {
    if (remaining <= 0) break

    const take = Math.min(remaining, parcel.unitsRemaining)
    const costBasePerUnit = parcel.costBase / parcel.units
    const parcelCostBase = take * costBasePerUnit
    const parcelProceeds = take * salePricePerUnit
    const grossGain = parcelProceeds - parcelCostBase
    const eligible = isDiscountEligible(parcel.date, disposalDate, entityType)
    const discounted = grossGain > 0
      ? grossGain * discountMultiplier(eligible)
      : grossGain // losses are not discounted

    result.push({
      parcelId: parcel.id,
      units: take,
      costBase: parcelCostBase,
      acquisitionDate: parcel.date,
      discountEligible: eligible,
      grossGain,
      discountedGain: discounted,
    })

    remaining -= take
  }

  if (remaining > 0) {
    throw new Error(
      `Insufficient units: need ${units} of ${ticker}, only ${units - remaining} available`
    )
  }

  return result
}

// ── Execute disposal ────────────────────────────────────────────────

export function executeDisposal(
  parcels: Parcel[],
  ticker: string,
  date: string,
  units: number,
  unitPrice: number,
  brokerage: number,
  method: "fifo" | "lifo" | "optimised",
  entityType: EntityType,
  amitAdjustments: AmitAdjustment[] = []
): { disposal: Disposal; updatedParcels: Parcel[] } {
  // AMIT only affects which parcels "optimised" picks: the stored ParcelUsage values stay
  // unadjusted, because computeFYSummary applies AMIT adjustments when reporting
  const parcelsUsed = matchParcels(
    parcels,
    ticker,
    units,
    method,
    unitPrice,
    date,
    entityType,
    amitAdjustments
  )

  const disposal: Disposal = {
    id: uuidv4(),
    ticker: ticker.toUpperCase(),
    date,
    units,
    unitPrice,
    brokerage,
    proceeds: computeProceeds(units, unitPrice, brokerage),
    method,
    parcelsUsed,
  }

  // Decrement unitsRemaining on consumed parcels
  const updatedParcels = parcels.map((p) => {
    const usage = parcelsUsed.find((u) => u.parcelId === p.id)
    if (!usage) return p
    return { ...p, unitsRemaining: p.unitsRemaining - usage.units }
  })

  return { disposal, updatedParcels }
}

// ── Manual (specific identification) disposal ───────────────────────

export function executeManualDisposal(
  parcels: Parcel[],
  ticker: string,
  date: string,
  units: number,
  unitPrice: number,
  brokerage: number,
  allocations: { parcelId: string; units: number }[],
  entityType: EntityType
): { disposal: Disposal; updatedParcels: Parcel[] } {
  const parcelsUsed: ParcelUsage[] = []

  for (const alloc of allocations) {
    if (alloc.units <= 0) continue
    const parcel = parcels.find((p) => p.id === alloc.parcelId)
    if (!parcel) throw new Error(`Parcel not found`)
    if (alloc.units > parcel.unitsRemaining + 0.0001) {
      throw new Error(
        `Cannot allocate ${alloc.units} units from parcel acquired ${fmtDate(parcel.date)} — only ${parcel.unitsRemaining} remaining`
      )
    }

    const costBasePerUnit = parcel.costBase / parcel.units
    const parcelCostBase = alloc.units * costBasePerUnit
    const grossGain = alloc.units * unitPrice - parcelCostBase
    const eligible = isDiscountEligible(parcel.date, date, entityType)
    const discounted = grossGain > 0 ? grossGain * discountMultiplier(eligible) : grossGain

    parcelsUsed.push({
      parcelId: parcel.id,
      units: alloc.units,
      costBase: parcelCostBase,
      acquisitionDate: parcel.date,
      discountEligible: eligible,
      grossGain,
      discountedGain: discounted,
    })
  }

  const totalAllocated = parcelsUsed.reduce((s, p) => s + p.units, 0)
  if (Math.abs(totalAllocated - units) > 0.0001) {
    throw new Error(`Total allocated (${totalAllocated}) must equal units sold (${units})`)
  }

  const disposal: Disposal = {
    id: uuidv4(),
    ticker: ticker.toUpperCase(),
    date,
    units,
    unitPrice,
    brokerage,
    proceeds: computeProceeds(units, unitPrice, brokerage),
    method: "manual",
    parcelsUsed,
  }

  const updatedParcels = parcels.map((p) => {
    const usage = parcelsUsed.find((u) => u.parcelId === p.id)
    if (!usage) return p
    return { ...p, unitsRemaining: p.unitsRemaining - usage.units }
  })

  return { disposal, updatedParcels }
}

// ── Tax summary ─────────────────────────────────────────────────────

// Per-ticker rows show gross figures only: losses offset gains across the whole year before the
// discount, so the discount and net taxable gain exist only for the year as a whole
export type FYSummaryRow = {
  ticker: string
  grossGains: number
  grossLosses: number
  netGainBeforeDiscount: number
}

export type FYSummary = {
  fy: string
  rows: FYSummaryRow[]
  totalGrossGains: number
  totalGrossLosses: number
  netGainBeforeDiscount: number
  discountAmount: number
  netTaxableGain: number
}

export function computeFYSummary(
  disposals: Disposal[],
  amitAdjustments: AmitAdjustment[] = []
): FYSummary[] {
  const byFY = new Map<string, Disposal[]>()

  for (const d of disposals) {
    const fy = getFinancialYear(d.date)
    if (!byFY.has(fy)) byFY.set(fy, [])
    byFY.get(fy)!.push(d)
  }

  const summaries: FYSummary[] = []

  for (const [fy, fyDisposals] of byFY) {
    // AMIT-adjusted gross gain of every parcel sold this year, grouped by ticker
    const byTicker = new Map<string, { grossGain: number; discountEligible: boolean }[]>()
    for (const d of fyDisposals) {
      for (const pu of d.parcelsUsed) {
        const amitAdj = calcAmitAdjPerUnit(d.ticker, pu.acquisitionDate, d.date, amitAdjustments) * pu.units
        if (!byTicker.has(d.ticker)) byTicker.set(d.ticker, [])
        byTicker.get(d.ticker)!.push({ grossGain: pu.grossGain - amitAdj, discountEligible: pu.discountEligible })
      }
    }

    const rows: FYSummaryRow[] = [...byTicker]
      .map(([ticker, items]) => {
        const { grossGains, grossLosses, netGainBeforeDiscount } = netCapitalGain(items)
        return { ticker, grossGains, grossLosses, netGainBeforeDiscount }
      })
      .sort((a, b) => a.ticker.localeCompare(b.ticker))

    const year = netCapitalGain([...byTicker.values()].flat())
    summaries.push({
      fy,
      rows,
      totalGrossGains: year.grossGains,
      totalGrossLosses: year.grossLosses,
      netGainBeforeDiscount: year.netGainBeforeDiscount,
      discountAmount: year.discountAmount,
      netTaxableGain: year.netTaxableGain,
    })
  }

  summaries.sort((a, b) => a.fy.localeCompare(b.fy))
  return summaries
}

// ── CSV parsing ─────────────────────────────────────────────────────

export type CSVTrade = {
  date: string
  ticker: string
  type: "buy" | "sell"
  units: number
  unitPrice: number
  brokerage: number
}

/** Normalise a date string to ISO 8601 (YYYY-MM-DD).
 *  Handles YYYY-MM-DD (already ISO) and D/M/YYYY or DD/MM/YYYY (AU format). */
function normaliseDate(raw: string): string {
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const parts = s.split("/")
  if (parts.length === 3) {
    const [d, m, y] = parts
    return `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  return s // return as-is and let validation catch it
}

/** Split CSV text into rows of fields. Handles quoted fields (with embedded commas, quotes
 *  and newlines), CRLF line endings and a leading BOM. Blank lines are dropped. */
export function parseCSVRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  const src = text.replace(/^\uFEFF/, "")

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      row.push(field.trim()); field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++
      row.push(field.trim()); field = ""
      if (row.some((f) => f !== "")) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  row.push(field.trim())
  if (row.some((f) => f !== "")) rows.push(row)
  return rows
}

/** Strip currency symbols and thousands commas then parse as float. */
function parseNumericField(raw: string): number {
  return parseFloat((raw ?? "").replace(/[$,\s]/g, ""))
}

export function parseTradesCSV(csv: string): CSVTrade[] {
  const rows = parseCSVRows(csv)
  if (rows.length < 2) return []

  const header = rows[0].map((h) => h.toLowerCase())
  const dateIdx = header.indexOf("date")
  const tickerIdx = header.indexOf("ticker")
  const typeIdx = header.indexOf("type")
  const unitsIdx = header.indexOf("units")
  const priceIdx = header.findIndex(
    (h) => h === "unit price" || h === "unitprice" || h === "price" || h === "unit_price"
  )
  const brokerageIdx = header.indexOf("brokerage")

  if ([dateIdx, tickerIdx, typeIdx, unitsIdx, priceIdx].some((i) => i === -1)) {
    throw new Error("CSV must have columns: date, ticker, type, units, unit price, brokerage")
  }

  return rows.slice(1).map((cols) => {
    const type = cols[typeIdx].toLowerCase()
    if (type !== "buy" && type !== "sell") {
      throw new Error(`Invalid type "${cols[typeIdx]}" — must be "buy" or "sell"`)
    }
    return {
      date: normaliseDate(cols[dateIdx]),
      ticker: cols[tickerIdx].toUpperCase(),
      type,
      units: parseNumericField(cols[unitsIdx]),
      unitPrice: parseNumericField(cols[priceIdx]),
      brokerage: brokerageIdx >= 0 ? parseNumericField(cols[brokerageIdx]) || 0 : 0,
    }
  })
}

// ── CSV import de-duplication ───────────────────────────────────────

// Brokers export fractional units to 16 decimals, but manually entered trades are often rounded
// (e.g. 12.3457 vs 12.3456789012345678). Allow anything up to 2-decimal rounding.
const UNITS_MATCH_TOLERANCE = 0.005

/** Split imported trades into ones not yet recorded and ones that already exist, so a broker's
 *  full-history export can be re-imported safely. A buy matches a parcel, and a sell matches a
 *  disposal, with the same date and ticker and units within rounding (closest match wins). Each
 *  existing record matches at most one imported trade, so genuinely repeated trades on the same
 *  day are still imported. */
export function splitNewTrades(
  trades: CSVTrade[],
  parcels: Pick<Parcel, "date" | "ticker" | "units">[],
  disposals: Pick<Disposal, "date" | "ticker" | "units">[],
): { newTrades: CSVTrade[]; duplicates: CSVTrade[] } {
  const unmatchedBuys = [...parcels]
  const unmatchedSells = [...disposals]
  const newTrades: CSVTrade[] = []
  const duplicates: CSVTrade[] = []

  for (const t of trades) {
    const pool = t.type === "buy" ? unmatchedBuys : unmatchedSells
    let i = -1
    let bestDiff = Infinity
    pool.forEach((r, j) => {
      const diff = Math.abs(r.units - t.units)
      if (r.date === t.date && r.ticker === t.ticker && diff <= UNITS_MATCH_TOLERANCE && diff < bestDiff) {
        i = j
        bestDiff = diff
      }
    })
    if (i === -1) {
      newTrades.push(t)
    } else {
      pool.splice(i, 1)
      duplicates.push(t)
    }
  }
  return { newTrades, duplicates }
}

// ── Import format detection ─────────────────────────────────────────

export type CSVImport = {
  format: "standard" | "betashares"
  trades: CSVTrade[]
  /** Non-trade rows that were skipped, by activity type (e.g. { Deposit: 3, Distribution: 2 }) */
  ignored: Record<string, number>
}

/** Parse a Betashares Direct transactions export.
 *  Columns: Effective Date (dd/mm/yyyy), Activity Type, Gross, Symbol (e.g. "ABC:AU"), Brokerage,
 *  Price, Quantity, Details. Only Buy and Sell rows are trades; Deposit, Withdrawal, Distribution
 *  etc. are reported in `ignored`. Sell quantities are negative and buy Gross amounts are negative.
 *  Gross equals Price × Quantity to the cent (brokerage is separate and has always been blank), so
 *  the unit price is derived from Gross — it's the amount actually paid or received. */
export function parseBetasharesCSV(csv: string): { trades: CSVTrade[]; ignored: Record<string, number> } {
  const rows = parseCSVRows(csv)
  const header = rows[0].map((h) => h.toLowerCase())
  const col = (name: string) => {
    const i = header.indexOf(name)
    if (i === -1) throw new Error(`Betashares CSV is missing the "${name}" column`)
    return i
  }
  const dateIdx = col("effective date")
  const typeIdx = col("activity type")
  const grossIdx = col("gross")
  const symbolIdx = col("symbol")
  const qtyIdx = col("quantity")
  const brokerageIdx = header.indexOf("brokerage")

  const trades: CSVTrade[] = []
  const ignored: Record<string, number> = {}
  for (const cols of rows.slice(1)) {
    const activity = cols[typeIdx]
    const type = activity.toLowerCase()
    if (type !== "buy" && type !== "sell") {
      ignored[activity] = (ignored[activity] ?? 0) + 1
      continue
    }
    const units = Math.abs(parseNumericField(cols[qtyIdx]))
    const gross = Math.abs(parseNumericField(cols[grossIdx]))
    if (!(units > 0) || !isFinite(gross)) {
      throw new Error(`Invalid ${activity} row on ${cols[dateIdx]}: quantity "${cols[qtyIdx]}", gross "${cols[grossIdx]}"`)
    }
    trades.push({
      date: normaliseDate(cols[dateIdx]),
      ticker: cols[symbolIdx].split(":")[0].trim().toUpperCase(),
      type,
      units,
      unitPrice: gross / units,
      brokerage: brokerageIdx >= 0 ? parseNumericField(cols[brokerageIdx]) || 0 : 0,
    })
  }
  return { trades, ignored }
}

/** Parse an imported trades CSV, detecting whether it's a Betashares Direct export or the
 *  standard date/ticker/type/units/unit price/brokerage format. */
export function parseImportCSV(csv: string): CSVImport {
  const header = (parseCSVRows(csv)[0] ?? []).map((h) => h.toLowerCase())
  if (header.includes("effective date") && header.includes("activity type")) {
    return { format: "betashares", ...parseBetasharesCSV(csv) }
  }
  return { format: "standard", trades: parseTradesCSV(csv), ignored: {} }
}
