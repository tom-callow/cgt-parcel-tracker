import { v4 as uuidv4 } from "uuid"
import type { EntityType, Parcel, ParcelUsage, Disposal } from "./types"

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

/** Held > 12 months (strictly more than). Exactly 12 months = NOT eligible. */
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

  // Disposal must be strictly AFTER the 12-month anniversary
  return disp > threshold
}

/** Discount multiplier for gains: 0.5 for eligible individual/trust, 1.0 otherwise */
export function discountMultiplier(eligible: boolean): number {
  return eligible ? 0.5 : 1.0
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
  entityType: EntityType
): MatchableParcels {
  return [...parcels].sort((a, b) => {
    const costPerUnitA = a.costBase / a.units
    const costPerUnitB = b.costBase / b.units

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
  entityType: EntityType
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
      sorted = sortOptimised(eligible, salePricePerUnit, disposalDate, entityType)
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
  entityType: EntityType
): { disposal: Disposal; updatedParcels: Parcel[] } {
  const parcelsUsed = matchParcels(
    parcels,
    ticker,
    units,
    method,
    unitPrice,
    date,
    entityType
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

// ── Tax summary ─────────────────────────────────────────────────────

export type FYSummaryRow = {
  ticker: string
  grossGains: number
  grossLosses: number
  netGainBeforeDiscount: number
  discountAmount: number
  netTaxableGain: number
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

export function computeFYSummary(disposals: Disposal[]): FYSummary[] {
  const byFY = new Map<string, Disposal[]>()

  for (const d of disposals) {
    const fy = getFinancialYear(d.date)
    if (!byFY.has(fy)) byFY.set(fy, [])
    byFY.get(fy)!.push(d)
  }

  const summaries: FYSummary[] = []

  for (const [fy, fyDisposals] of byFY) {
    const byTicker = new Map<string, ParcelUsage[]>()

    for (const d of fyDisposals) {
      for (const pu of d.parcelsUsed) {
        if (!byTicker.has(d.ticker)) byTicker.set(d.ticker, [])
        byTicker.get(d.ticker)!.push(pu)
      }
    }

    const rows: FYSummaryRow[] = []

    for (const [ticker, usages] of byTicker) {
      let grossGains = 0
      let grossLosses = 0
      let totalDiscountedGain = 0

      for (const u of usages) {
        if (u.grossGain >= 0) {
          grossGains += u.grossGain
        } else {
          grossLosses += u.grossGain // negative number
        }
        totalDiscountedGain += u.discountedGain
      }

      const netGainBeforeDiscount = grossGains + grossLosses
      const discountAmount = netGainBeforeDiscount > 0
        ? netGainBeforeDiscount - totalDiscountedGain
        : 0
      const netTaxableGain = netGainBeforeDiscount > 0
        ? totalDiscountedGain
        : netGainBeforeDiscount

      rows.push({
        ticker,
        grossGains,
        grossLosses,
        netGainBeforeDiscount,
        discountAmount,
        netTaxableGain,
      })
    }

    rows.sort((a, b) => a.ticker.localeCompare(b.ticker))

    const totalGrossGains = rows.reduce((s, r) => s + r.grossGains, 0)
    const totalGrossLosses = rows.reduce((s, r) => s + r.grossLosses, 0)
    const netGainBeforeDiscount = totalGrossGains + totalGrossLosses
    const discountAmount = rows.reduce((s, r) => s + r.discountAmount, 0)
    const netTaxableGain = rows.reduce((s, r) => s + r.netTaxableGain, 0)

    summaries.push({
      fy,
      rows,
      totalGrossGains,
      totalGrossLosses,
      netGainBeforeDiscount,
      discountAmount,
      netTaxableGain,
    })
  }

  summaries.sort((a, b) => a.fy.localeCompare(b.fy))
  return summaries
}

// ── Optimiser preview ───────────────────────────────────────────────

export type OptimiserResult = {
  method: "fifo" | "lifo" | "optimised"
  parcelsUsed: ParcelUsage[]
  totalCostBase: number
  totalProceeds: number
  totalGrossGain: number
  totalDiscountedGain: number
}

export function previewDisposal(
  parcels: Parcel[],
  ticker: string,
  units: number,
  salePricePerUnit: number,
  disposalDate: string,
  brokerage: number,
  entityType: EntityType
): { fifo: OptimiserResult; lifo: OptimiserResult; optimised: OptimiserResult } {
  const methods = ["fifo", "lifo", "optimised"] as const
  const results: Record<string, OptimiserResult> = {}

  for (const method of methods) {
    const parcelsUsed = matchParcels(
      parcels,
      ticker,
      units,
      method,
      salePricePerUnit,
      disposalDate,
      entityType
    )

    const totalCostBase = parcelsUsed.reduce((s, p) => s + p.costBase, 0)
    const totalProceeds = units * salePricePerUnit - brokerage
    const totalGrossGain = parcelsUsed.reduce((s, p) => s + p.grossGain, 0)
    const totalDiscountedGain = parcelsUsed.reduce((s, p) => s + p.discountedGain, 0)

    results[method] = {
      method,
      parcelsUsed,
      totalCostBase,
      totalProceeds,
      totalGrossGain,
      totalDiscountedGain,
    }
  }

  return results as { fifo: OptimiserResult; lifo: OptimiserResult; optimised: OptimiserResult }
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

export function parseTradesCSV(csv: string): CSVTrade[] {
  const lines = csv.trim().split("\n")
  if (lines.length < 2) return []

  const header = lines[0].toLowerCase().split(",").map((h) => h.trim())
  const dateIdx = header.indexOf("date")
  const tickerIdx = header.indexOf("ticker")
  const typeIdx = header.indexOf("type")
  const unitsIdx = header.indexOf("units")
  const priceIdx = header.findIndex((h) => h === "unit price" || h === "unitprice" || h === "price")
  const brokerageIdx = header.indexOf("brokerage")

  if ([dateIdx, tickerIdx, typeIdx, unitsIdx, priceIdx].some((i) => i === -1)) {
    throw new Error("CSV must have columns: date, ticker, type, units, unit price, brokerage")
  }

  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const cols = line.split(",").map((c) => c.trim())
    const type = cols[typeIdx].toLowerCase()
    if (type !== "buy" && type !== "sell") {
      throw new Error(`Invalid type "${cols[typeIdx]}" — must be "buy" or "sell"`)
    }
    return {
      date: cols[dateIdx],
      ticker: cols[tickerIdx].toUpperCase(),
      type,
      units: parseFloat(cols[unitsIdx]),
      unitPrice: parseFloat(cols[priceIdx]),
      brokerage: brokerageIdx >= 0 ? parseFloat(cols[brokerageIdx]) || 0 : 0,
    }
  })
}
