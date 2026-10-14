import { describe, it, expect } from "vitest"
import { planHoldingSale, planWithdrawal, type WithdrawalInput } from "./withdrawal"
import { computeCostBase } from "./cgt"
import type { Parcel } from "./types"

function parcel(id: string, ticker: string, date: string, units: number, unitPrice: number): Parcel {
  return { id, ticker, date, units, unitPrice, brokerage: 0, costBase: computeCostBase(units, unitPrice, 0), unitsRemaining: units }
}

const SALE_DATE = "2026-06-01"

// ABC: one old low-cost parcel (big discounted gain) and one recent high-cost parcel (small gain)
// XYZ: one recent parcel bought at the current price (no gain)
const parcels = [
  parcel("abc-old", "ABC", "2020-01-01", 100, 50),
  parcel("abc-new", "ABC", "2026-01-01", 100, 95),
  parcel("xyz", "XYZ", "2026-01-01", 200, 100),
]
const prices = { ABC: 100, XYZ: 100 }  // ABC $20,000, XYZ $20,000

function input(overrides: Partial<WithdrawalInput>): WithdrawalInput {
  return {
    parcels,
    prices,
    targets: { ABC: 50, XYZ: 50 },
    amount: 2000,
    brokeragePerTrade: 0,
    fractional: false,
    tolerance: 2,
    date: SALE_DATE,
    entityType: "individual",
    amitAdjustments: [],
    ...overrides,
  }
}

describe("planWithdrawal", () => {
  it("raises the requested amount net of brokerage", () => {
    const plan = planWithdrawal(input({ brokeragePerTrade: 10 }))
    expect(plan.netProceeds).toBeGreaterThanOrEqual(2000)
    expect(plan.netProceeds).toBeLessThan(2000 + 100 * plan.sales.length)
  })

  it("sells fractional units to raise the exact amount", () => {
    const plan = planWithdrawal(input({ prices: { ABC: 163.97, XYZ: 163.97 }, amount: 1000, fractional: true }))
    expect(plan.netProceeds).toBeGreaterThanOrEqual(1000)
    expect(plan.netProceeds).toBeLessThan(1000 + 0.02 * plan.sales.length)
    for (const s of plan.sales) expect(s.units).toBeCloseTo(Number(s.units.toFixed(4)), 10)
  })

  it("with targets ignored, sells only the lowest-tax ticker", () => {
    const plan = planWithdrawal(input({ tolerance: Infinity }))
    expect(plan.sales.map((s) => s.ticker)).toEqual(["XYZ"])
    expect(plan.totalTaxableGain).toBeCloseTo(0)
  })

  it("with exact targets, splits the sale to stay on target", () => {
    const plan = planWithdrawal(input({ tolerance: 0 }))
    expect(plan.sales.map((s) => [s.ticker, s.units])).toEqual([["ABC", 10], ["XYZ", 10]])
    for (const h of plan.holdings) expect(h.pctAfter).toBeCloseTo(50)
  })

  it("sells the lowest-tax parcel within a ticker first", () => {
    const plan = planWithdrawal(input({ tolerance: 0 }))
    const abc = plan.sales.find((s) => s.ticker === "ABC")!
    expect(abc.parcels.map((p) => p.parcelId)).toEqual(["abc-new"])
    expect(abc.taxableGain).toBeCloseTo(50)  // 10 × ($100 − $95), not discounted (< 12 months)
  })

  it("uses the tolerance band to shift selling toward lower-tax tickers", () => {
    const exact = planWithdrawal(input({ tolerance: 0 }))
    const banded = planWithdrawal(input({ tolerance: 2 }))
    expect(banded.totalTaxableGain).toBeLessThan(exact.totalTaxableGain)
    for (const h of banded.holdings) expect(Math.abs(h.pctAfter - h.targetPct!)).toBeLessThanOrEqual(2.01)
    expect(banded.withinTolerance).toBe(true)
  })

  it("sells overweight holdings first and flags when the band can't be met", () => {
    // XYZ is 80% against a 50% target — one $2,000 sale can't fix that
    const plan = planWithdrawal(input({
      parcels: [parcel("abc", "ABC", "2026-01-01", 50, 100), parcel("xyz", "XYZ", "2020-01-01", 200, 50)],
    }))
    expect(plan.sales.map((s) => s.ticker)).toEqual(["XYZ"])
    expect(plan.withinTolerance).toBe(false)
  })

  it("prefers a loss parcel and applies the discount to old gains", () => {
    const plan = planWithdrawal(input({
      parcels: [parcel("loss", "ABC", "2026-01-01", 10, 120), parcel("old", "ABC", "2020-01-01", 100, 60)],
      prices: { ABC: 100 },
      targets: null,
      tolerance: Infinity,
      amount: 3000,
    }))
    const used = plan.sales[0].parcels
    expect(used.map((p) => [p.parcelId, p.units])).toEqual([["loss", 10], ["old", 20]])
    expect(used[0].taxableGain).toBeCloseTo(-200)
    expect(used[1].taxableGain).toBeCloseTo(400)  // 20 × $40 × 50%
  })

  it("includes AMIT cost base adjustments", () => {
    const plan = planWithdrawal(input({
      parcels: [parcel("p", "ABC", "2026-01-01", 100, 90)],
      prices: { ABC: 100 },
      targets: null,
      tolerance: Infinity,
      amount: 1000,
      amitAdjustments: [{ id: "a", ticker: "ABC", date: "2026-03-31", totalAdjustment: -200, unitsAtDate: 100 }],
    }))
    expect(plan.totalTaxableGain).toBeCloseTo(10 * (100 - 88))
  })

  it("rejects a withdrawal larger than the portfolio", () => {
    expect(() => planWithdrawal(input({ amount: 50000 }))).toThrow(/more than the portfolio/)
  })
})

describe("planHoldingSale", () => {
  const base = { ...input({}), ticker: "ABC" }

  it("sells a number of units from the chosen holding, lowest-tax parcel first", () => {
    const plan = planHoldingSale({ ...base, sell: { units: 120 } })
    expect(plan.sales).toHaveLength(1)
    expect(plan.sales[0].parcels.map((p) => [p.parcelId, p.units])).toEqual([["abc-new", 100], ["abc-old", 20]])
    expect(plan.sales[0].taxableGain).toBeCloseTo(100 * 5 + 20 * 50 * 0.5)
  })

  it("raises a cash amount net of brokerage from the chosen holding", () => {
    const plan = planHoldingSale({ ...base, brokeragePerTrade: 10, sell: { cash: 1000 } })
    expect(plan.sales.map((s) => [s.ticker, s.units])).toEqual([["ABC", 11]])
    expect(plan.netProceeds).toBeCloseTo(1090)
  })

  it("can sell the whole holding and shows allocations afterwards", () => {
    const plan = planHoldingSale({ ...base, sell: { units: 200 } })
    expect(plan.holdings.find((h) => h.ticker === "ABC")!.pctAfter).toBeCloseTo(0)
    expect(plan.holdings.find((h) => h.ticker === "XYZ")!.pctAfter).toBeCloseTo(100)
  })

  it("uses AMIT-adjusted cost bases to pick parcels and report gains", () => {
    // +$10/unit AMIT on the old parcel (held on 30 June): $50 → $60 cost base, so its discounted
    // gain per unit ($20) is still above the new parcel's ($5) — but the reported gain is adjusted
    const amit = [{ id: "a", ticker: "ABC", date: "2025-06-30", totalAdjustment: 1000, unitsAtDate: 100 }]
    const plan = planHoldingSale({ ...base, amitAdjustments: amit, sell: { units: 120 } })
    const old = plan.sales[0].parcels.find((p) => p.parcelId === "abc-old")!
    expect(old.costBase).toBeCloseTo(20 * 60)
    expect(old.taxableGain).toBeCloseTo(20 * 40 * 0.5)
  })

  it("rejects selling more than is held", () => {
    expect(() => planHoldingSale({ ...base, sell: { units: 201 } })).toThrow(/only hold 200/)
    expect(() => planHoldingSale({ ...base, sell: { cash: 25000 } })).toThrow(/more than your ABC holding/)
  })
})
