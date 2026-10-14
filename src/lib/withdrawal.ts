import type { AmitAdjustment, EntityType, Parcel } from "./types"
import { calcAmitAdjPerUnit, isDiscountEligible } from "./cgt"

// ── Withdrawal planner ──────────────────────────────────────────────
//
// Raises a target amount of cash by selling across tickers, minimising the taxable gain while
// keeping every holding within `tolerance` percentage points of its target allocation.
//
// Which parcels are sold within a ticker doesn't change allocations, so that is always done in
// lowest-tax order. The trade-off is only in how many dollars to sell of each ticker: each ticker
// gets a [min, max] sale range from the tolerance band, and dollars are then taken from the
// cheapest parcel slices across all tickers (taxable gain per dollar of proceeds, so tickers at
// different prices compare fairly). Per-ticker costs are convex, so this greedy fill is optimal.

export type WithdrawalParcelSale = {
  parcelId: string
  acquisitionDate: string
  units: number
  costBase: number          // includes AMIT adjustments up to the sale date
  grossGain: number
  discountEligible: boolean
  taxableGain: number       // after the 50% discount; losses are not discounted
}

export type WithdrawalSale = {
  ticker: string
  units: number
  price: number
  grossProceeds: number
  brokerage: number
  taxableGain: number
  parcels: WithdrawalParcelSale[]
}

export type WithdrawalHolding = {
  ticker: string
  valueBefore: number
  valueAfter: number
  pctBefore: number
  pctAfter: number
  targetPct: number | null
}

export type WithdrawalPlan = {
  sales: WithdrawalSale[]
  netProceeds: number
  totalTaxableGain: number
  holdings: WithdrawalHolding[]
  /** False when the withdrawal can't keep every holding inside the band (e.g. one is already far over target) */
  withinTolerance: boolean
}

export type WithdrawalInput = {
  parcels: Parcel[]
  prices: Record<string, number>
  targets: Record<string, number> | null  // ticker → %; null ignores allocations
  amount: number                          // cash wanted after brokerage
  brokeragePerTrade: number
  fractional: boolean                     // broker allows fractional units (to 4 decimal places)
  tolerance: number                       // percentage points; Infinity ignores targets
  date: string
  entityType: EntityType
  amitAdjustments: AmitAdjustment[]
}

type Slice = {
  parcel: Parcel
  costPerUnit: number
  eligible: boolean
  taxPerUnit: number
  taxPerDollar: number
}

function taxablePerUnit(grossPerUnit: number, eligible: boolean): number {
  return grossPerUnit > 0 && eligible ? grossPerUnit * 0.5 : grossPerUnit
}

/** Holdings and parcel slices per ticker, slices in lowest-tax-per-dollar order */
function buildSlices(input: WithdrawalInput): Map<string, Slice[]> {
  const byTicker = new Map<string, Slice[]>()
  for (const parcel of input.parcels) {
    if (parcel.unitsRemaining <= 0) continue
    const price = input.prices[parcel.ticker]
    if (!(price > 0)) throw new Error(`No price for ${parcel.ticker}`)
    const costPerUnit =
      parcel.costBase / parcel.units +
      calcAmitAdjPerUnit(parcel.ticker, parcel.date, input.date, input.amitAdjustments)
    const eligible = isDiscountEligible(parcel.date, input.date, input.entityType)
    const taxPerUnit = taxablePerUnit(price - costPerUnit, eligible)
    const slices = byTicker.get(parcel.ticker) ?? []
    slices.push({ parcel, costPerUnit, eligible, taxPerUnit, taxPerDollar: taxPerUnit / price })
    byTicker.set(parcel.ticker, slices)
  }
  for (const slices of byTicker.values()) {
    slices.sort((a, b) => a.taxPerDollar - b.taxPerDollar || b.costPerUnit - a.costPerUnit)
  }
  return byTicker
}

/** Dollars to sell of each ticker to raise `gross` in total */
function allocateDollars(
  slices: Map<string, Slice[]>,
  values: Map<string, number>,
  input: WithdrawalInput,
  gross: number
): { dollars: Map<string, number>; withinTolerance: boolean } {
  const tickers = [...values.keys()]
  const total = tickers.reduce((s, t) => s + values.get(t)!, 0)
  const after = total - gross

  // Sale range per ticker that keeps its final weight inside the band
  const lo = new Map<string, number>()
  const hi = new Map<string, number>()
  for (const t of tickers) {
    const v = values.get(t)!
    if (input.targets && isFinite(input.tolerance)) {
      const w = (input.targets[t] ?? 0) / 100
      const tol = input.tolerance / 100
      lo.set(t, Math.min(v, Math.max(0, v - (w + tol) * after)))
      hi.set(t, Math.min(v, Math.max(0, v - (w - tol) * after)))
    } else {
      lo.set(t, 0)
      hi.set(t, v)
    }
  }

  let withinTolerance = true
  const sumLo = tickers.reduce((s, t) => s + lo.get(t)!, 0)
  const sumHi = tickers.reduce((s, t) => s + hi.get(t)!, 0)
  if (sumLo > gross) {
    // Overweight holdings need more selling than the withdrawal covers: sell only from them,
    // in proportion to how far each is over the band
    withinTolerance = false
    for (const t of tickers) {
      const share = (lo.get(t)! / sumLo) * gross
      lo.set(t, share)
      hi.set(t, share)
    }
  } else if (sumHi < gross) {
    withinTolerance = false
    for (const t of tickers) hi.set(t, values.get(t)!)
  }

  // Take dollars from each ticker's slices in order; `used` tracks dollars taken per slice
  const used = new Map<Slice, number>()
  const dollars = new Map<string, number>(tickers.map((t) => [t, 0]))
  const take = (t: string, amount: number) => {
    let remaining = amount
    for (const s of slices.get(t)!) {
      if (remaining <= 1e-9) break
      const price = input.prices[t]
      const avail = s.parcel.unitsRemaining * price - (used.get(s) ?? 0)
      const x = Math.min(avail, remaining)
      if (x <= 0) continue
      used.set(s, (used.get(s) ?? 0) + x)
      remaining -= x
    }
    dollars.set(t, dollars.get(t)! + (amount - remaining))
  }

  for (const t of tickers) take(t, lo.get(t)!)

  // Fill the rest from the cheapest next slice of any ticker with room left
  let remaining = gross - tickers.reduce((s, t) => s + dollars.get(t)!, 0)
  while (remaining > 1e-6) {
    let best: { t: string; s: Slice; room: number } | null = null
    for (const t of tickers) {
      const room = hi.get(t)! - dollars.get(t)!
      if (room <= 1e-9) continue
      const s = slices.get(t)!.find(
        (s) => s.parcel.unitsRemaining * input.prices[t] - (used.get(s) ?? 0) > 1e-9
      )
      if (s && (!best || s.taxPerDollar < best.s.taxPerDollar)) best = { t, s, room }
    }
    if (!best) break
    const avail = best.s.parcel.unitsRemaining * input.prices[best.t] - (used.get(best.s) ?? 0)
    const x = Math.min(avail, best.room, remaining)
    take(best.t, x)
    remaining -= x
  }

  return { dollars, withinTolerance }
}

function buildSale(ticker: string, units: number, slices: Slice[], price: number, brokerage: number): WithdrawalSale {
  const parcels: WithdrawalParcelSale[] = []
  let remaining = units
  for (const s of slices) {
    if (remaining <= 1e-9) break
    const u = Math.min(remaining, s.parcel.unitsRemaining)
    const costBase = u * s.costPerUnit
    const grossGain = u * price - costBase
    parcels.push({
      parcelId: s.parcel.id,
      acquisitionDate: s.parcel.date,
      units: u,
      costBase,
      grossGain,
      discountEligible: s.eligible,
      taxableGain: taxablePerUnit(grossGain, s.eligible),
    })
    remaining -= u
  }
  return {
    ticker,
    units,
    price,
    grossProceeds: units * price,
    brokerage,
    taxableGain: parcels.reduce((s, p) => s + p.taxableGain, 0),
    parcels,
  }
}

export function planWithdrawal(input: WithdrawalInput): WithdrawalPlan {
  if (!(input.amount > 0)) throw new Error("Enter an amount to withdraw.")
  const slices = buildSlices(input)
  const values = new Map<string, number>()
  const unitsHeld = new Map<string, number>()
  for (const [t, ss] of slices) {
    const u = ss.reduce((s, x) => s + x.parcel.unitsRemaining, 0)
    unitsHeld.set(t, u)
    values.set(t, u * input.prices[t])
  }
  const total = [...values.values()].reduce((s, v) => s + v, 0)

  // Brokerage depends on how many tickers are sold, which depends on the gross amount:
  // start at one trade and re-solve until the trade count stops growing
  let trades = 1
  let result: { units: Map<string, number>; withinTolerance: boolean } | null = null
  for (let i = 0; i <= slices.size; i++) {
    const gross = input.amount + input.brokeragePerTrade * trades
    if (gross > total) throw new Error("The withdrawal is more than the portfolio is worth.")
    const { dollars, withinTolerance } = allocateDollars(slices, values, input, gross)
    // Round up to whole (or 4-decimal fractional) units so the target is met, capped at what's held
    const step = input.fractional ? 1e4 : 1
    const units = new Map<string, number>()
    for (const [t, d] of dollars) {
      if (d <= 0.005) continue
      const u = Math.ceil((d / input.prices[t]) * step - 1e-6) / step
      units.set(t, Math.min(unitsHeld.get(t)!, u))
    }
    result = { units, withinTolerance }
    if (units.size <= trades) break
    trades = units.size
  }

  const sales = [...result!.units]
    .map(([t, u]) => buildSale(t, u, slices.get(t)!, input.prices[t], input.brokeragePerTrade))
    .sort((a, b) => a.ticker.localeCompare(b.ticker))
  const sold = new Map(sales.map((s) => [s.ticker, s.grossProceeds]))
  const totalAfter = total - sales.reduce((s, x) => s + x.grossProceeds, 0)

  const holdings = [...values]
    .map(([ticker, valueBefore]) => {
      const valueAfter = valueBefore - (sold.get(ticker) ?? 0)
      return {
        ticker,
        valueBefore,
        valueAfter,
        pctBefore: (valueBefore / total) * 100,
        pctAfter: totalAfter > 0 ? (valueAfter / totalAfter) * 100 : 0,
        targetPct: input.targets ? (input.targets[ticker] ?? 0) : null,
      }
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker))

  return {
    sales,
    netProceeds: sales.reduce((s, x) => s + x.grossProceeds - x.brokerage, 0),
    totalTaxableGain: sales.reduce((s, x) => s + x.taxableGain, 0),
    holdings,
    withinTolerance: result!.withinTolerance,
  }
}
