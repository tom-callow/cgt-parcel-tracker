import { useState, useEffect, useCallback } from "react"
import { useAppState } from "../lib/AppContext"

const fmt = (n: number) => n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function fetchPrice(ticker: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.AX?interval=1d&range=1d`
    const res = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(url)}`)
    if (!res.ok) return null
    const json = await res.json()
    return json?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null
  } catch {
    return null
  }
}

export function PortfolioPage() {
  const { parcels } = useAppState()
  const [prices, setPrices] = useState<Record<string, number | null>>({})
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const holdings = (() => {
    const byTicker = new Map<string, { units: number; costBase: number }>()
    for (const p of parcels) {
      if (p.unitsRemaining <= 0) continue
      const entry = byTicker.get(p.ticker) ?? { units: 0, costBase: 0 }
      entry.units += p.unitsRemaining
      entry.costBase += (p.costBase / p.units) * p.unitsRemaining
      byTicker.set(p.ticker, entry)
    }
    return [...byTicker.entries()]
      .map(([ticker, d]) => ({
        ticker,
        units: d.units,
        costBase: d.costBase,
        avgCost: d.costBase / d.units,
      }))
      .sort((a, b) => a.ticker.localeCompare(b.ticker))
  })()

  const refreshPrices = useCallback(async () => {
    if (holdings.length === 0) return
    setLoading(true)
    const results = await Promise.all(
      holdings.map(async (h) => [h.ticker, await fetchPrice(h.ticker)] as [string, number | null])
    )
    setPrices(Object.fromEntries(results))
    setLastUpdated(new Date())
    setLoading(false)
  }, [holdings.map(h => h.ticker).join(",")])  // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch on mount
  useEffect(() => {
    refreshPrices()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const totalCostBase = holdings.reduce((s, h) => s + h.costBase, 0)
  const totalMarketValue = holdings.reduce((s, h) => {
    const p = prices[h.ticker]
    return p != null ? s + h.units * p : s
  }, 0)
  const allPricesLoaded = holdings.length > 0 && holdings.every(h => prices[h.ticker] != null)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Portfolio</h1>
        <div className="flex items-center gap-3">
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

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
              <th className="px-4 py-3">Ticker</th>
              <th className="px-4 py-3 text-right">Units Held</th>
              <th className="px-4 py-3 text-right">Avg Cost / Unit</th>
              <th className="px-4 py-3 text-right">Total Cost Base</th>
              <th className="px-4 py-3 text-right">Market Price</th>
              <th className="px-4 py-3 text-right">Market Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {holdings.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No holdings yet. Add buy trades to build your portfolio.
                </td>
              </tr>
            ) : (
              <>
                {holdings.map((h) => {
                  const marketPrice = prices[h.ticker]
                  const marketValue = marketPrice != null ? h.units * marketPrice : null
                  return (
                    <tr key={h.ticker} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium">{h.ticker}</td>
                      <td className="px-4 py-2.5 text-right">{h.units}</td>
                      <td className="px-4 py-2.5 text-right">${fmt(h.avgCost)}</td>
                      <td className="px-4 py-2.5 text-right">${fmt(h.costBase)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {loading ? (
                          <span className="text-slate-300">—</span>
                        ) : marketPrice != null ? (
                          `$${fmt(marketPrice)}`
                        ) : (
                          <span className="text-slate-400 text-xs">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        {loading ? (
                          <span className="text-slate-300">—</span>
                        ) : marketValue != null ? (
                          `$${fmt(marketValue)}`
                        ) : (
                          <span className="text-slate-400 text-xs">N/A</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                  <td className="px-4 py-3">TOTAL</td>
                  <td className="px-4 py-3 text-right">{holdings.reduce((s, h) => s + h.units, 0)}</td>
                  <td className="px-4 py-3 text-right"></td>
                  <td className="px-4 py-3 text-right">${fmt(totalCostBase)}</td>
                  <td className="px-4 py-3 text-right"></td>
                  <td className="px-4 py-3 text-right">
                    {allPricesLoaded ? `$${fmt(totalMarketValue)}` : ""}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400 mt-3">
        Prices fetched from Yahoo Finance (ASX). May be delayed up to 20 minutes.
      </p>
    </div>
  )
}
