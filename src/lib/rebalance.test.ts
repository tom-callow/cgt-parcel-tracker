import { describe, it, expect } from "vitest"
import { planContribution, splitWholeDollars } from "./rebalance"

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

describe("splitWholeDollars", () => {
  it("splits evenly without overshooting", () => {
    expect(splitWholeDollars(150, [1, 1])).toEqual([75, 75])
    expect(splitWholeDollars(100, [1, 1, 1])).toEqual([34, 33, 33])
  })

  it("always adds up to the total", () => {
    const amounts = splitWholeDollars(1234, [3.3, 2.2, 1.1])
    expect(sum(amounts)).toBe(1234)
    expect(amounts.every(Number.isInteger)).toBe(true)
  })

  it("gives any cents to the largest share", () => {
    expect(splitWholeDollars(100.5, [3, 1])).toEqual([75.5, 25])
  })

  it("returns zeros when there is nothing to weight by", () => {
    expect(splitWholeDollars(100, [0, 0])).toEqual([0, 0])
  })
})

describe("planContribution", () => {
  it("leaves out holdings whose share rounds to nothing", () => {
    // ABC is $0.40 under target after the contribution, XYZ takes the rest
    const plan = planContribution(1000, { ABC: 2199.6, XYZ: 7800.4 }, { ABC: 20, XYZ: 80 })
    expect(plan).toEqual([{ ticker: "XYZ", amount: 1000 }])
  })

  it("splits in proportion to each holding's shortfall and adds up exactly", () => {
    // New total 10,000: ABC needs 1,000 more, XYZ needs 500 more, DEF is over target
    const plan = planContribution(1500, { ABC: 4000, XYZ: 2500, DEF: 2000 }, { ABC: 50, XYZ: 30, DEF: 20 })
    expect(plan).toEqual([
      { ticker: "ABC", amount: 1000 },
      { ticker: "XYZ", amount: 500 },
    ])
  })

  it("never totals more than the amount invested", () => {
    const plan = planContribution(150, { ABC: 4925, XYZ: 4925 }, { ABC: 50, XYZ: 50 })
    expect(sum(plan.map((c) => c.amount))).toBe(150)
  })
})
