import { planHoldingSale, type HoldingSaleInput } from "./withdrawal"

export type Contribution = { ticker: string; amount: number }

// Splits `total` across `weights` in whole dollars that add up exactly to `total`
// (largest remainder method). Any cents in `total` go to the largest share.
export function splitWholeDollars(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((s, w) => s + w, 0)
  if (weights.length === 0 || weightSum <= 0) return weights.map(() => 0)

  const totalCents = Math.round(total * 100)
  const dollars = Math.floor(totalCents / 100)
  const raw = weights.map((w) => (dollars * w) / weightSum)
  const amounts = raw.map(Math.floor)

  let remaining = dollars - amounts.reduce((s, a) => s + a, 0)
  const byRemainder = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac)
  for (const { i } of byRemainder) {
    if (remaining <= 0) break
    amounts[i] += 1
    remaining -= 1
  }

  const largest = amounts.indexOf(Math.max(...amounts))
  amounts[largest] = (amounts[largest] * 100 + (totalCents - dollars * 100)) / 100
  return amounts
}

// Splits a new contribution across holdings that are below target after the contribution,
// in proportion to how far below target each is. Amounts are whole dollars that add up
// exactly to `investAmt`; holdings that would get nothing are left out.
export function planContribution(
  investAmt: number,
  currentValues: Record<string, number>,
  targetPcts: Record<string, number>,
): Contribution[] {
  const tickers = Object.keys(currentValues)
  const newTotal = tickers.reduce((s, t) => s + currentValues[t], 0) + investAmt
  const deficits = tickers
    .map((ticker) => ({ ticker, deficit: (targetPcts[ticker] / 100) * newTotal - currentValues[ticker] }))
    .filter((d) => d.deficit > 0)
  const amounts = splitWholeDollars(investAmt, deficits.map((d) => d.deficit))
  return deficits
    .map(({ ticker }, i) => ({ ticker, amount: amounts[i] }))
    .filter((c) => c.amount > 0)
}

// Net capital gain (negative = net capital loss) from selling `cash` worth of one holding in
// lowest-tax parcel order, as the Sale Optimiser would. Losses offset gross gains before the CGT
// discount, so the sign comes from the gross total — summing per-parcel discounted gains can
// show a loss when the sale actually makes a net gain. Null if the sale isn't possible.
export function rebalanceSaleGain(
  input: Omit<HoldingSaleInput, "sell" | "targets" | "brokeragePerTrade" | "fractional"> & { cash: number },
): number | null {
  try {
    const plan = planHoldingSale({
      ...input,
      targets: null,
      brokeragePerTrade: 0,
      fractional: true,
      sell: { cash: input.cash },
    })
    return plan.sales.reduce((s, sale) => s + sale.parcels.reduce((t, p) => t + p.grossGain, 0), 0)
  } catch {
    return null
  }
}
