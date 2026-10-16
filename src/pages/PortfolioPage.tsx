import { useLivePrices } from "../lib/useLivePrices"
import { useAppState } from "../lib/AppContext"

import { fmt, fmtPct } from "../lib/formatters"

const gainCls = (n: number) =>
  n >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"

const signedDollars = (n: number) => `${n < 0 ? "−" : "+"}$${fmt(Math.abs(n))}`
const signedPct = (n: number) => `${n < 0 ? "−" : "+"}${fmtPct(Math.abs(n))}`

const placeholder = <span className="text-slate-300 dark:text-slate-600">—</span>
const unavailable = <span className="text-slate-400 text-xs">N/A</span>

export function PortfolioPage() {
  const { parcels } = useAppState()

  // Cost is the cash actually paid (including brokerage) for the units still held —
  // deliberately not AMIT-adjusted. The tax view lives on Unrealised Gains.
  const holdings = (() => {
    const byTicker = new Map<string, { units: number; cost: number }>()
    for (const p of parcels) {
      if (p.unitsRemaining <= 0) continue
      const entry = byTicker.get(p.ticker) ?? { units: 0, cost: 0 }
      entry.units += p.unitsRemaining
      entry.cost += (p.costBase / p.units) * p.unitsRemaining
      byTicker.set(p.ticker, entry)
    }
    return [...byTicker.entries()]
      .map(([ticker, d]) => ({
        ticker,
        units: d.units,
        cost: d.cost,
        avgCost: d.cost / d.units,
      }))
      .sort((a, b) => a.ticker.localeCompare(b.ticker))
  })()

  const tickers = holdings.map((h) => h.ticker)
  const { prices, loading, lastUpdated, refresh: refreshPrices } = useLivePrices(tickers)

  const totalCost = holdings.reduce((s, h) => s + h.cost, 0)
  const allPricesLoaded = holdings.length > 0 && holdings.every((h) => prices[h.ticker] != null)
  const missingTickers = holdings.filter((h) => prices[h.ticker] == null).map((h) => h.ticker)
  const totalMarketValue = allPricesLoaded
    ? holdings.reduce((s, h) => s + h.units * (prices[h.ticker] ?? 0), 0)
    : null
  const totalGain = totalMarketValue != null ? totalMarketValue - totalCost : null

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Portfolio</h1>
        <div className="flex flex-wrap items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-slate-400">
              Updated {lastUpdated.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={refreshPrices}
            disabled={loading || holdings.length === 0}
            className="bg-teal-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
          >
            {loading ? "Fetching..." : "Refresh Prices"}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-700 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              <th className="px-4 py-3">Ticker</th>
              <th className="px-4 py-3 text-right">Units Held</th>
              <th className="px-4 py-3 text-right">Avg Cost</th>
              <th className="px-4 py-3 text-right">Cost</th>
              <th className="px-4 py-3 text-right">Market Price</th>
              <th className="px-4 py-3 text-right">Market Value</th>
              <th className="px-4 py-3 text-right">Gain/Loss</th>
              <th className="px-4 py-3 text-right">Gain/Loss %</th>
              <th className="px-4 py-3 text-right">Weight</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {holdings.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  No holdings yet. Add buy trades to build your portfolio.
                </td>
              </tr>
            ) : (
              <>
                {holdings.map((h) => {
                  const marketPrice = prices[h.ticker]
                  const marketValue = marketPrice != null ? h.units * marketPrice : null
                  const gain = marketValue != null ? marketValue - h.cost : null
                  const weight =
                    marketValue != null && totalMarketValue ? (marketValue / totalMarketValue) * 100 : null
                  return (
                    <tr key={h.ticker} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                      <td className="px-4 py-2.5 font-medium dark:text-slate-100">{h.ticker}</td>
                      <td className="px-4 py-2.5 text-right dark:text-slate-300">{fmt(h.units)}</td>
                      <td className="px-4 py-2.5 text-right dark:text-slate-300">${fmt(h.avgCost)}</td>
                      <td className="px-4 py-2.5 text-right dark:text-slate-300">${fmt(h.cost)}</td>
                      <td className="px-4 py-2.5 text-right dark:text-slate-300">
                        {loading ? placeholder : marketPrice != null ? `$${fmt(marketPrice)}` : unavailable}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium dark:text-slate-300">
                        {loading ? placeholder : marketValue != null ? `$${fmt(marketValue)}` : unavailable}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-medium ${gain != null && !loading ? gainCls(gain) : ""}`}>
                        {loading ? placeholder : gain != null ? signedDollars(gain) : unavailable}
                      </td>
                      <td className={`px-4 py-2.5 text-right ${gain != null && !loading ? gainCls(gain) : ""}`}>
                        {loading ? placeholder : gain != null ? signedPct((gain / h.cost) * 100) : unavailable}
                      </td>
                      <td className="px-4 py-2.5 text-right dark:text-slate-300">
                        {loading ? placeholder : weight != null ? fmtPct(weight) : unavailable}
                      </td>
                    </tr>
                  )
                })}
                <tr className="bg-slate-50 dark:bg-slate-700 font-semibold border-t-2 border-slate-200 dark:border-slate-600">
                  <td className="px-4 py-3 dark:text-slate-100">TOTAL</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-right dark:text-slate-100">${fmt(totalCost)}</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-right dark:text-slate-100">
                    {loading ? placeholder : totalMarketValue != null ? `$${fmt(totalMarketValue)}` : unavailable}
                  </td>
                  <td className={`px-4 py-3 text-right ${totalGain != null && !loading ? gainCls(totalGain) : ""}`}>
                    {loading ? placeholder : totalGain != null ? signedDollars(totalGain) : unavailable}
                  </td>
                  <td className={`px-4 py-3 text-right ${totalGain != null && !loading ? gainCls(totalGain) : ""}`}>
                    {loading ? placeholder : totalGain != null ? signedPct((totalGain / totalCost) * 100) : unavailable}
                  </td>
                  <td className="px-4 py-3 text-right dark:text-slate-100">
                    {loading ? placeholder : totalMarketValue != null ? fmtPct(100) : unavailable}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {!loading && holdings.length > 0 && missingTickers.length > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400 mt-3">
          Couldn't fetch a price for {missingTickers.join(", ")}, so totals and weights are unavailable. Try Refresh Prices.
        </p>
      )}
      <p className="text-xs text-slate-400 mt-3">
        Prices fetched from Yahoo Finance (ASX). May be delayed up to 30 minutes.
      </p>
    </div>
  )
}
