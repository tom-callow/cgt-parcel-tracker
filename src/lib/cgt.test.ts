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
  parseCSVRows,
  parseBetasharesCSV,
  parseImportCSV,
  splitNewTrades,
  type CSVTrade,
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

  it("matches the ATO guide example: acquired 2 Feb 2006, eligible on or after 3 Feb 2007", () => {
    expect(isDiscountEligible("2006-02-02", "2007-02-02", "individual")).toBe(false)
    expect(isDiscountEligible("2006-02-02", "2007-02-03", "individual")).toBe(true)
  })

  it("leap year edge case: 29 Feb acquisition", () => {
    // No 29 Feb in 2025, so the 12-month period ends on 28 Feb 2025 (Acts Interpretation Act s2G).
    // 1 Mar 2024 – 28 Feb 2025 is a clear year, so a 1 Mar 2025 disposal is eligible.
    expect(isDiscountEligible("2024-02-29", "2025-02-28", "individual")).toBe(false)
    expect(isDiscountEligible("2024-02-29", "2025-03-01", "individual")).toBe(true)
  })

  it("28 Feb acquisition: anniversary stays 28 Feb even when the next year is a leap year", () => {
    expect(isDiscountEligible("2027-02-28", "2028-02-28", "individual")).toBe(false)
    expect(isDiscountEligible("2027-02-28", "2028-02-29", "individual")).toBe(true)
  })

  it("acquisition across a leap day uses the calendar anniversary, not 365 days", () => {
    // 1 Mar 2023 → anniversary 1 Mar 2024 (366 days, includes 29 Feb 2024)
    expect(isDiscountEligible("2023-03-01", "2024-03-01", "individual")).toBe(false)
    expect(isDiscountEligible("2023-03-01", "2024-03-02", "individual")).toBe(true)
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

describe("parseCSVRows", () => {
  it("handles quoted fields with commas, escaped quotes, CRLF, BOM and blank lines", () => {
    const text = '\uFEFFa,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,,""\n'
    expect(parseCSVRows(text)).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'say "hi"'],
      ["2", "", ""],
    ])
  })

  it("lets the standard importer read quoted fields", () => {
    const csv = 'date,ticker,type,units,unit price,brokerage\n2024-01-15,VAS,buy,"1,000","$80.50",0'
    const [t] = parseTradesCSV(csv)
    expect(t.units).toBe(1000)
    expect(t.unitPrice).toBe(80.5)
  })
})

// Made-up rows in the exact Betashares Direct export format (newest first, negative sell quantities,
// negative buy Gross, float noise in Gross, blank Brokerage, quoted empty Details)
const BETASHARES_CSV = `Effective Date,Activity Type,Gross,Symbol,Brokerage,Price,Quantity,Details
15/03/2025,Distribution,$123.4567890123,,,,,""
10/03/2025,Sell,$5299.999999999999,ABC:AU,,$53.00,-100.0000000000000000,""
02/03/2025,Buy,-$2000.000000000004,XYZ:AU,,$123.45,16.2008910490077000,""
01/03/2025,Deposit,$2000.00,,,,,""
05/02/2024,Buy,-$5000.00,ABC:AU,,$50.00,100.0000000000000000,""
04/02/2024,Withdrawal,-$100.00,,,,,""
`

describe("parseBetasharesCSV", () => {
  const { trades, ignored } = parseBetasharesCSV(BETASHARES_CSV)

  it("keeps only buys and sells and counts the other rows", () => {
    expect(trades.map((t) => t.type)).toEqual(["sell", "buy", "buy"])
    expect(ignored).toEqual({ Distribution: 1, Deposit: 1, Withdrawal: 1 })
  })

  it("converts dates, strips the :AU suffix and makes sell quantities positive", () => {
    const sell = trades[0]
    expect(sell).toMatchObject({ date: "2025-03-10", ticker: "ABC", type: "sell", units: 100, brokerage: 0 })
  })

  it("derives the unit price from Gross so cost base equals the amount paid", () => {
    const buy = trades[1]
    expect(buy.ticker).toBe("XYZ")
    expect(buy.units).toBeCloseTo(16.2008910490077, 12)
    expect(buy.units * buy.unitPrice).toBeCloseTo(2000, 6)
    expect(trades[0].units * trades[0].unitPrice).toBeCloseTo(5300, 6)
  })

  it("rejects a trade row with no quantity", () => {
    const bad = BETASHARES_CSV.replace("16.2008910490077000", "")
    expect(() => parseBetasharesCSV(bad)).toThrow("Invalid Buy row")
  })
})

describe("parseImportCSV", () => {
  it("detects a Betashares export", () => {
    const result = parseImportCSV(BETASHARES_CSV)
    expect(result.format).toBe("betashares")
    expect(result.trades).toHaveLength(3)
  })

  it("falls back to the standard format", () => {
    const result = parseImportCSV("date,ticker,type,units,unit price\n2024-01-15,VAS,buy,100,80.50")
    expect(result).toMatchObject({ format: "standard", ignored: {} })
    expect(result.trades).toHaveLength(1)
  })
})

describe("splitNewTrades", () => {
  const trade = (date: string, ticker: string, type: "buy" | "sell", units: number): CSVTrade =>
    ({ date, ticker, type, units, unitPrice: 1, brokerage: 0 })

  it("skips buys already recorded, matching units within manual rounding", () => {
    const { newTrades, duplicates } = splitNewTrades(
      [trade("2025-03-02", "XYZ", "buy", 12.34567890123456), trade("2025-03-09", "XYZ", "buy", 7.654321098765432)],
      [{ date: "2025-03-02", ticker: "XYZ", units: 12.3457 }],
      [],
    )
    expect(duplicates).toHaveLength(1)
    expect(newTrades.map((t) => t.date)).toEqual(["2025-03-09"])
  })

  it("matches sells against disposals, not parcels", () => {
    const sell = trade("2025-05-01", "ABC", "sell", 100)
    expect(splitNewTrades([sell], [{ date: "2025-05-01", ticker: "ABC", units: 100 }], []).newTrades).toHaveLength(1)
    expect(splitNewTrades([sell], [], [{ date: "2025-05-01", ticker: "ABC", units: 100 }]).duplicates).toHaveLength(1)
  })

  it("matches each existing record once, so repeated same-day trades still import", () => {
    const t = trade("2025-05-01", "XYZ", "buy", 10)
    const { newTrades, duplicates } = splitNewTrades([t, { ...t }], [{ date: "2025-05-01", ticker: "XYZ", units: 10 }], [])
    expect(duplicates).toHaveLength(1)
    expect(newTrades).toHaveLength(1)
  })

  it("pairs same-day trades with the closest existing units", () => {
    const { duplicates, newTrades } = splitNewTrades(
      [trade("2025-05-01", "XYZ", "buy", 20.12345678), trade("2025-05-01", "XYZ", "buy", 300)],
      [{ date: "2025-05-01", ticker: "XYZ", units: 300 }, { date: "2025-05-01", ticker: "XYZ", units: 20.1235 }],
      [],
    )
    expect(duplicates).toHaveLength(2)
    expect(newTrades).toHaveLength(0)
  })

  it("does not treat a different date, ticker or clearly different units as a duplicate", () => {
    const existing = [{ date: "2025-05-01", ticker: "XYZ", units: 10 }]
    expect(splitNewTrades([trade("2025-05-02", "XYZ", "buy", 10)], existing, []).newTrades).toHaveLength(1)
    expect(splitNewTrades([trade("2025-05-01", "ABC", "buy", 10)], existing, []).newTrades).toHaveLength(1)
    expect(splitNewTrades([trade("2025-05-01", "XYZ", "buy", 10.01)], existing, []).newTrades).toHaveLength(1)
  })
})
