import { describe, it, expect } from "vitest"
import {
  computeCostBase,
  computeProceeds,
  getFinancialYear,
  isDiscountEligible,
  matchParcels,
  executeDisposal,
  computeFYSummary,
  parseTradesCSV,
} from "./cgt"
import type { Parcel, Disposal } from "./types"

// ── Helpers ─────────────────────────────────────────────────────────

function makeParcel(overrides: Partial<Parcel> & { id: string; ticker: string; date: string; units: number; unitPrice: number }): Parcel {
  const units = overrides.units
  const unitPrice = overrides.unitPrice
  const brokerage = overrides.brokerage ?? 0
  return {
    id: overrides.id,
    ticker: overrides.ticker,
    date: overrides.date,
    units,
    unitPrice,
    brokerage,
    costBase: computeCostBase(units, unitPrice, brokerage),
    unitsRemaining: overrides.unitsRemaining ?? units,
  }
}

// ── Cost base & proceeds ────────────────────────────────────────────

describe("computeCostBase", () => {
  it("calculates cost base as (units * unitPrice) + brokerage", () => {
    expect(computeCostBase(100, 10, 9.95)).toBeCloseTo(1009.95)
  })

  it("handles zero brokerage", () => {
    expect(computeCostBase(50, 20, 0)).toBe(1000)
  })

  it("handles fractional units", () => {
    expect(computeCostBase(10.5, 100, 5)).toBeCloseTo(1055)
  })
})

describe("computeProceeds", () => {
  it("calculates proceeds as (units * unitPrice) - brokerage", () => {
    expect(computeProceeds(100, 15, 9.95)).toBeCloseTo(1490.05)
  })

  it("handles zero brokerage", () => {
    expect(computeProceeds(50, 20, 0)).toBe(1000)
  })
})

// ── Financial year ──────────────────────────────────────────────────

describe("getFinancialYear", () => {
  it("1 July 2023 → FY2024", () => {
    expect(getFinancialYear("2023-07-01")).toBe("FY2024")
  })

  it("30 June 2024 → FY2024", () => {
    expect(getFinancialYear("2024-06-30")).toBe("FY2024")
  })

  it("1 July 2024 → FY2025", () => {
    expect(getFinancialYear("2024-07-01")).toBe("FY2025")
  })

  it("1 January 2024 → FY2024", () => {
    expect(getFinancialYear("2024-01-01")).toBe("FY2024")
  })

  it("31 December 2023 → FY2024", () => {
    expect(getFinancialYear("2023-12-31")).toBe("FY2024")
  })
})

// ── CGT discount eligibility ────────────────────────────────────────

describe("isDiscountEligible", () => {
  it("exactly 12 months = NOT eligible", () => {
    expect(isDiscountEligible("2023-01-15", "2024-01-15", "individual")).toBe(false)
  })

  it("12 months + 1 day = eligible", () => {
    expect(isDiscountEligible("2023-01-15", "2024-01-16", "individual")).toBe(true)
  })

  it("11 months = NOT eligible", () => {
    expect(isDiscountEligible("2023-01-15", "2023-12-15", "individual")).toBe(false)
  })

  it("13 months = eligible", () => {
    expect(isDiscountEligible("2023-01-15", "2024-02-16", "individual")).toBe(true)
  })

  it("company never eligible", () => {
    expect(isDiscountEligible("2020-01-01", "2025-01-01", "company")).toBe(false)
  })

  it("trust eligible after 12 months", () => {
    expect(isDiscountEligible("2023-01-15", "2024-01-16", "trust")).toBe(true)
  })

  it("leap year edge case: 29 Feb acquisition", () => {
    // 2024-02-29 + 12 months → 2025-03-01 (Feb has 28 days in 2025)
    // Disposal on 2025-03-01 should be exactly at threshold, NOT eligible
    expect(isDiscountEligible("2024-02-29", "2025-03-01", "individual")).toBe(false)
    expect(isDiscountEligible("2024-02-29", "2025-03-02", "individual")).toBe(true)
  })
})

// ── FIFO matching ───────────────────────────────────────────────────

describe("matchParcels — FIFO", () => {
  it("selects oldest parcel first", () => {
    const parcels: Parcel[] = [
      makeParcel({ id: "p1", ticker: "VAS", date: "2023-01-01", units: 100, unitPrice: 80 }),
      makeParcel({ id: "p2", ticker: "VAS", date: "2023-06-01", units: 100, unitPrice: 90 }),
    ]

    const result = matchParcels(parcels, "VAS", 50, "fifo", 100, "2024-06-01", "individual")
    expect(result).toHaveLength(1)
    expect(result[0].parcelId).toBe("p1")
    expect(result[0].units).toBe(50)
  })

  it("spans multiple parcels", () => {
    const parcels: Parcel[] = [
      makeParcel({ id: "p1", ticker: "VAS", date: "2023-01-01", units: 30, unitPrice: 80 }),
      makeParcel({ id: "p2", ticker: "VAS", date: "2023-06-01", units: 50, unitPrice: 90 }),
    ]

    const result = matchParcels(parcels, "VAS", 60, "fifo", 100, "2024-06-01", "individual")
    expect(result).toHaveLength(2)
    expect(result[0].parcelId).toBe("p1")
    expect(result[0].units).toBe(30)
    expect(result[1].parcelId).toBe("p2")
    expect(result[1].units).toBe(30)
  })

  it("filters by ticker", () => {
    const parcels: Parcel[] = [
      makeParcel({ id: "p1", ticker: "VAS", date: "2023-01-01", units: 100, unitPrice: 80 }),
      makeParcel({ id: "p2", ticker: "VGS", date: "2023-01-01", units: 100, unitPrice: 80 }),
    ]

    const result = matchParcels(parcels, "VGS", 50, "fifo", 100, "2024-06-01", "individual")
    expect(result).toHaveLength(1)
    expect(result[0].parcelId).toBe("p2")
  })

  it("throws when insufficient units", () => {
    const parcels: Parcel[] = [
      makeParcel({ id: "p1", ticker: "VAS", date: "2023-01-01", units: 10, unitPrice: 80 }),
    ]

    expect(() =>
      matchParcels(parcels, "VAS", 50, "fifo", 100, "2024-06-01", "individual")
    ).toThrow("Insufficient units")
  })

  it("respects unitsRemaining (partial consumption)", () => {
    const parcels: Parcel[] = [
      makeParcel({ id: "p1", ticker: "VAS", date: "2023-01-01", units: 100, unitPrice: 80, unitsRemaining: 20 }),
      makeParcel({ id: "p2", ticker: "VAS", date: "2023-06-01", units: 100, unitPrice: 90 }),
    ]

    const result = matchParcels(parcels, "VAS", 50, "fifo", 100, "2024-06-01", "individual")
    expect(result).toHaveLength(2)
    expect(result[0].parcelId).toBe("p1")
    expect(result[0].units).toBe(20)
    expect(result[1].parcelId).toBe("p2")
    expect(result[1].units).toBe(30)
  })
})

// ── LIFO matching ───────────────────────────────────────────────────

describe("matchParcels — LIFO", () => {
  it("selects newest parcel first", () => {
    const parcels: Parcel[] = [
      makeParcel({ id: "p1", ticker: "VAS", date: "2023-01-01", units: 100, unitPrice: 80 }),
      makeParcel({ id: "p2", ticker: "VAS", date: "2023-06-01", units: 100, unitPrice: 90 }),
    ]

    const result = matchParcels(parcels, "VAS", 50, "lifo", 100, "2024-06-01", "individual")
    expect(result).toHaveLength(1)
    expect(result[0].parcelId).toBe("p2")
    expect(result[0].units).toBe(50)
  })
})

// ── Optimised matching ──────────────────────────────────────────────

describe("matchParcels — optimised", () => {
  it("prefers loss parcels first", () => {
    const parcels: Parcel[] = [
      makeParcel({ id: "gain", ticker: "VAS", date: "2022-01-01", units: 100, unitPrice: 80 }),
      makeParcel({ id: "loss", ticker: "VAS", date: "2022-06-01", units: 100, unitPrice: 120 }),
    ]

    const result = matchParcels(parcels, "VAS", 50, "optimised", 100, "2024-06-01", "individual")
    expect(result).toHaveLength(1)
    expect(result[0].parcelId).toBe("loss")
  })

  it("among gains, prefers discounted (long-term) parcels over short-term when effective tax is lower", () => {
    // Long-term parcel: bought at $90, sale at $100 → gross gain $10, taxable $5
    // Short-term parcel: bought at $92, sale at $100 → gross gain $8, taxable $8
    // Optimiser should prefer long-term ($5 taxable) over short-term ($8 taxable)
    const parcels: Parcel[] = [
      makeParcel({ id: "short", ticker: "VAS", date: "2024-01-01", units: 100, unitPrice: 92 }),
      makeParcel({ id: "long", ticker: "VAS", date: "2022-01-01", units: 100, unitPrice: 90 }),
    ]

    const result = matchParcels(parcels, "VAS", 50, "optimised", 100, "2024-06-01", "individual")
    expect(result).toHaveLength(1)
    expect(result[0].parcelId).toBe("long")
    expect(result[0].discountEligible).toBe(true)
  })

  it("accounts for discount: $1000 long-term gain ≈ $500 short-term gain in tax cost", () => {
    // Long-term: bought at $80, sale at $100 → gross gain $20, taxable $10
    // Short-term: bought at $91, sale at $100 → gross gain $9, taxable $9
    // Taxable: long $10 vs short $9. Short is cheaper → prefer short
    const parcels: Parcel[] = [
      makeParcel({ id: "short", ticker: "VAS", date: "2024-01-01", units: 100, unitPrice: 91 }),
      makeParcel({ id: "long", ticker: "VAS", date: "2022-01-01", units: 100, unitPrice: 80 }),
    ]

    const result = matchParcels(parcels, "VAS", 50, "optimised", 100, "2024-06-01", "individual")
    expect(result).toHaveLength(1)
    expect(result[0].parcelId).toBe("short")
  })

  it("company has no discount, so sorts purely by gross gain", () => {
    const parcels: Parcel[] = [
      makeParcel({ id: "p1", ticker: "VAS", date: "2022-01-01", units: 100, unitPrice: 90 }),
      makeParcel({ id: "p2", ticker: "VAS", date: "2024-01-01", units: 100, unitPrice: 95 }),
    ]

    const result = matchParcels(parcels, "VAS", 50, "optimised", 100, "2024-06-01", "company")
    // p2 has lower gross gain ($5/unit vs $10/unit), both no discount
    expect(result[0].parcelId).toBe("p2")
  })

  it("tie-break: equal taxable gain → prefer higher cost base", () => {
    // Long-term: cost $90, gain $10, taxable $5
    // Short-term: cost $95, gain $5, taxable $5
    // Equal taxable → prefer higher cost base → short-term parcel
    const parcels: Parcel[] = [
      makeParcel({ id: "low-cost", ticker: "VAS", date: "2022-01-01", units: 100, unitPrice: 90 }),
      makeParcel({ id: "high-cost", ticker: "VAS", date: "2024-01-01", units: 100, unitPrice: 95 }),
    ]

    const result = matchParcels(parcels, "VAS", 50, "optimised", 100, "2024-06-01", "individual")
    expect(result[0].parcelId).toBe("high-cost")
  })
})

// ── executeDisposal ─────────────────────────────────────────────────

describe("executeDisposal", () => {
  it("creates disposal and decrements parcel units", () => {
    const parcels: Parcel[] = [
      makeParcel({ id: "p1", ticker: "VAS", date: "2023-01-01", units: 100, unitPrice: 80 }),
    ]

    const { disposal, updatedParcels } = executeDisposal(
      parcels, "VAS", "2024-06-01", 40, 100, 9.95, "fifo", "individual"
    )

    expect(disposal.units).toBe(40)
    expect(disposal.proceeds).toBeCloseTo(40 * 100 - 9.95)
    expect(disposal.parcelsUsed).toHaveLength(1)
    expect(disposal.parcelsUsed[0].units).toBe(40)
    expect(updatedParcels[0].unitsRemaining).toBe(60)
  })

  it("handles disposal across multiple parcels", () => {
    const parcels: Parcel[] = [
      makeParcel({ id: "p1", ticker: "VAS", date: "2023-01-01", units: 30, unitPrice: 80 }),
      makeParcel({ id: "p2", ticker: "VAS", date: "2023-06-01", units: 50, unitPrice: 90 }),
    ]

    const { disposal, updatedParcels } = executeDisposal(
      parcels, "VAS", "2024-06-01", 50, 100, 0, "fifo", "individual"
    )

    expect(disposal.parcelsUsed).toHaveLength(2)
    expect(updatedParcels[0].unitsRemaining).toBe(0)
    expect(updatedParcels[1].unitsRemaining).toBe(30)
  })
})

// ── Gain calculations ───────────────────────────────────────────────

describe("gain calculations in parcel usage", () => {
  it("computes gross gain correctly with brokerage in cost base", () => {
    const parcels: Parcel[] = [
      makeParcel({ id: "p1", ticker: "VAS", date: "2023-01-01", units: 100, unitPrice: 80, brokerage: 10 }),
    ]

    const result = matchParcels(parcels, "VAS", 100, "fifo", 100, "2024-06-01", "individual")
    // costBase = 100*80+10 = 8010, proceeds per unit = 100
    // gross gain = 100*100 - 8010 = 1990
    expect(result[0].grossGain).toBeCloseTo(1990)
  })

  it("applies 50% discount for eligible individual parcel gains", () => {
    const parcels: Parcel[] = [
      makeParcel({ id: "p1", ticker: "VAS", date: "2023-01-01", units: 100, unitPrice: 80 }),
    ]

    const result = matchParcels(parcels, "VAS", 100, "fifo", 100, "2024-02-01", "individual")
    // > 12 months? 2023-01-01 to 2024-02-01 = 13 months → eligible
    expect(result[0].discountEligible).toBe(true)
    expect(result[0].grossGain).toBe(2000)
    expect(result[0].discountedGain).toBe(1000) // 50% discount
  })

  it("no discount on losses even if eligible", () => {
    const parcels: Parcel[] = [
      makeParcel({ id: "p1", ticker: "VAS", date: "2023-01-01", units: 100, unitPrice: 120 }),
    ]

    const result = matchParcels(parcels, "VAS", 100, "fifo", 100, "2024-06-01", "individual")
    expect(result[0].grossGain).toBe(-2000)
    expect(result[0].discountedGain).toBe(-2000) // loss, no discount applied
  })
})

// ── FY Summary ──────────────────────────────────────────────────────

describe("computeFYSummary", () => {
  it("groups disposals by financial year", () => {
    const disposals: Disposal[] = [
      {
        id: "d1", ticker: "VAS", date: "2024-03-01", units: 50, unitPrice: 100,
        brokerage: 0, proceeds: 5000, method: "fifo",
        parcelsUsed: [{
          parcelId: "p1", units: 50, costBase: 4000, acquisitionDate: "2022-01-01",
          discountEligible: true, grossGain: 1000, discountedGain: 500,
        }],
      },
      {
        id: "d2", ticker: "VAS", date: "2024-08-01", units: 50, unitPrice: 110,
        brokerage: 0, proceeds: 5500, method: "fifo",
        parcelsUsed: [{
          parcelId: "p2", units: 50, costBase: 4500, acquisitionDate: "2023-06-01",
          discountEligible: true, grossGain: 1000, discountedGain: 500,
        }],
      },
    ]

    const summaries = computeFYSummary(disposals)
    expect(summaries).toHaveLength(2)
    expect(summaries[0].fy).toBe("FY2024") // March 2024
    expect(summaries[1].fy).toBe("FY2025") // August 2024
  })

  it("calculates summary totals correctly", () => {
    const disposals: Disposal[] = [
      {
        id: "d1", ticker: "VAS", date: "2024-03-01", units: 100, unitPrice: 100,
        brokerage: 0, proceeds: 10000, method: "fifo",
        parcelsUsed: [
          {
            parcelId: "p1", units: 60, costBase: 4800, acquisitionDate: "2022-01-01",
            discountEligible: true, grossGain: 1200, discountedGain: 600,
          },
          {
            parcelId: "p2", units: 40, costBase: 4400, acquisitionDate: "2023-06-01",
            discountEligible: false, grossGain: -400, discountedGain: -400,
          },
        ],
      },
    ]

    const summaries = computeFYSummary(disposals)
    expect(summaries).toHaveLength(1)
    const s = summaries[0]
    expect(s.totalGrossGains).toBe(1200)
    expect(s.totalGrossLosses).toBe(-400)
    expect(s.netGainBeforeDiscount).toBe(800)
  })
})

// ── CSV parsing ─────────────────────────────────────────────────────

describe("parseTradesCSV", () => {
  it("parses valid CSV", () => {
    const csv = `date,ticker,type,units,unit price,brokerage
2024-01-15,VAS,buy,100,80.50,9.95
2024-06-01,VAS,sell,50,90.00,9.95`

    const trades = parseTradesCSV(csv)
    expect(trades).toHaveLength(2)
    expect(trades[0].ticker).toBe("VAS")
    expect(trades[0].type).toBe("buy")
    expect(trades[0].units).toBe(100)
    expect(trades[0].unitPrice).toBe(80.5)
    expect(trades[0].brokerage).toBe(9.95)
    expect(trades[1].type).toBe("sell")
  })

  it("handles missing brokerage column", () => {
    const csv = `date,ticker,type,units,unit price
2024-01-15,VAS,buy,100,80.50`

    const trades = parseTradesCSV(csv)
    expect(trades[0].brokerage).toBe(0)
  })

  it("throws on missing required columns", () => {
    const csv = `date,ticker,amount
2024-01-15,VAS,100`

    expect(() => parseTradesCSV(csv)).toThrow("CSV must have columns")
  })

  it("throws on invalid type", () => {
    const csv = `date,ticker,type,units,unit price
2024-01-15,VAS,hold,100,80.50`

    expect(() => parseTradesCSV(csv)).toThrow('Invalid type')
  })
})
