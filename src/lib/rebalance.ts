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
