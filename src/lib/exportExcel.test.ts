import { describe, it, expect } from "vitest"
import { buildSummarySheet, nettedDiscount } from "./exportExcel"
import { netCapitalGain } from "./cgt"
import type { Disposal } from "./types"

// Evaluates a formula made only of numbers, + − ×, brackets and MAX — enough for nettedDiscount
function evalFormula(f: string): number {
  return Function(`"use strict"; return (${f.replace(/MAX\(/g, "Math.max(")})`)() as number
}

describe("nettedDiscount formula", () => {
  it("matches netCapitalGain for a spread of gains and losses", () => {
    const cases = [
      [100, 0, -40], [100, 30, -40], [50, 20, -100], [0, 100, -40], [100, 0, 0], [100, 50, -120], [0, 0, -10],
    ]
    for (const [disc, other, loss] of cases) {
      const expected = netCapitalGain([
        { grossGain: disc, discountEligible: true },
        { grossGain: other, discountEligible: false },
        { grossGain: loss, discountEligible: false },
      ]).discountAmount
      expect(evalFormula(nettedDiscount(String(disc), String(other), `(${loss})`, "0.5"))).toBeCloseTo(expected)
    }
  })
})

describe("buildSummarySheet", () => {
  const disposal = (id: string, ticker: string, date: string, proceeds: number, costBase: number, acquired: string, eligible: boolean): Disposal => ({
    id, ticker, date, units: 10, unitPrice: proceeds / 10, brokerage: 0, proceeds, method: "fifo",
    parcelsUsed: [{
      parcelId: `${id}-p`, units: 10, costBase, acquisitionDate: acquired,
      discountEligible: eligible, grossGain: proceeds - costBase, discountedGain: 0,
    }],
  })

  it("nets losses across tickers on the FY total, not per ticker", () => {
    const ws = buildSummarySheet([
      disposal("d1", "ABC", "2025-03-01", 300, 200, "2020-01-01", true),   // +100 discountable
      disposal("d2", "XYZ", "2025-04-01", 60, 100, "2024-12-01", false),   // −40
    ], [], "individual", "FY2025")

    // Find the TOTAL row and read its cached discount (G) and net taxable gain (H)
    const range = ws["!ref"]!.split(":")[1].replace(/[A-Z]+/, "")
    let totalRow = 0
    for (let r = 1; r <= Number(range); r++) if (ws[`B${r}`]?.v === "TOTAL") totalRow = r
    expect(totalRow).toBeGreaterThan(0)
    expect(ws[`G${totalRow}`].v).toBeCloseTo(30)
    expect(ws[`H${totalRow}`].v).toBeCloseTo(30)
    expect(ws[`G${totalRow}`].f).toContain("MAX(")
    // Ticker rows carry no discount or net taxable gain
    expect(ws[`G${totalRow - 1}`]?.v ?? "").toBe("")
  })
})
