import { useState, useEffect, useCallback } from "react"
import { useAppState } from "../lib/AppContext"
import { fmtDate, isDiscountEligible } from "../lib/cgt"

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

export function UnrealisedGainsPage() {
  const { parcels, entityType } = useAppState()
  const [prices, setPrices] = useState<Record<string, number | null>>({})
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const today = new Date().toISOString().slice(0, 10)

  const activeParcels = parcels.filter((p) => p.unitsRemaining > 0)
  const tickers = [...new Set(activeParcels.map((p) => p.ticker))]

  const refreshPrices = useCallback(async () => {
    if (tickers.length === 0) return
    setLoading(true)
    const results = await Promise.all(
      tickers.map(async (t) => [t, await fetchPrice(t)] as [string, number | null])
    )
    setPrices(Object.fromEntries(results))
    setLastUpdated(new Date())
    setLoading(false)
  }, [tickers.join(",")])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refreshPrices()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Build per-parcel rows
  const rows = activeParcels
    .map((p) => {
      const marketPrice = prices[p.ticker]
      const costPerUnit = p.costBase / p.units
      const currentValue = marketPrice != null ? p.unitsRemaining * marketPrice : null
      const costBase = p.unitsRemaining * costPerUnit
      const unrealisedGain = currentValue != null ? currentValue - costBase : null
      const discountEligible = isDiscountEligible(p.date, today, entityType)
      const effectiveGain =
        unrealisedGain != null
          ? unrealisedGain > 0
            ? unrealisedGain * (discountEligible ? 0.5 : 1)
            : unrealisedGain
          : null

      return {
        id: p.id,
        ticker: p.ticker,
        acquisitionDate: p.date,
        units: p.unitsRemaining,
        costPerUnit,
        costBase,
        marketPrice,
        currentValue,
        unrealisedGain,
        discountEligible,
        effectiveGain,
      }
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.acquisitionDate.localeCompare(b.acquisitionDate))

  const hasAllPrices = rows.length > 0 && rows.every((r) => r.marketPrice != null)
  const totalCostBase = rows.reduce((s, r) => s + r.costBase, 0)
  const totalCurrentValue = hasAllPrices ? rows.reduce((s, r) => s + (r.currentValue ?? 0), 0) : null
  const totalUnrealisedGain = totalCurrentValue != null ? totalCurrentValue - totalCostBase : null

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Unrealised Gains</h1>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-slate-400">
              Updated {lastUpdated.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={refreshPrices}
            disabled={loading || activeParcels.length === 0}
            className="bg-teal-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
          >
            {loading ? "Fetching..." : "Refresh Prices"}
          </button>
        </div>
      </div>

      {activeParcels.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400">
          No open parcels. Add buy trades to see unrealised gains.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3">Acquired</th>
                <th className="px-4 py-3 text-right">Units</th>
                <th className="px-4 py-3 text-right">Cost / Unit</th>
                <th className="px-4 py-3 text-right">Cost Base</th>
                <th className="px-4 py-3 text-right">Market Price</th>
                <th className="px-4 py-3 text-right">Current Value</th>
                <th className="px-4 py-3 text-right">Unrealised Gain</th>
                <th className="px-4 py-3 text-right">Discount?</th>
                <th className="px-4 py-3 text-right">Effective Gain</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">{r.ticker}</td>
                  <td className="px-4 py-2.5">{fmtDate(r.acquisitionDate)}</td>
                  <td className="px-4 py-2.5 text-right">{r.units}</td>
                  <td className="px-4 py-2.5 text-right">${fmt(r.costPerUnit)}</td>
                  <td className="px-4 py-2.5 text-right">${fmt(r.costBase)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {loading ? (
                      <span className="text-slate-300">—</span>
                    ) : r.marketPrice != null ? (
                      `$${fmt(r.marketPrice)}`
                    ) : (
                      <span className="text-slate-400 text-xs">N/A</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {loading ? (
                      <span className="text-slate-300">—</span>
                    ) : r.currentValue != null ? (
                      `$${fmt(r.currentValue)}`
                    ) : (
                      <span className="text-slate-400 text-xs">N/A</span>
                    )}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-medium ${
                    r.unrealisedGain == null ? "" :
                    r.unrealisedGain >= 0 ? "text-emerald-700" : "text-red-600"
                  }`}>
                    {loading ? (
                      <span className="text-slate-300 font-normal">—</span>
                    ) : r.unrealisedGain != null ? (
                      `$${fmt(r.unrealisedGain)}`
                    ) : (
                      <span className="text-slate-400 text-xs font-normal">N/A</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-500">
                    {r.discountEligible ? "Yes (50%)" : "No"}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-medium ${
                    r.effectiveGain == null ? "" :
                    r.effectiveGain >= 0 ? "text-emerald-700" : "text-red-600"
                  }`}>
                    {loading ? (
                      <span className="text-slate-300 font-normal">—</span>
                    ) : r.effectiveGain != null ? (
                      `$${fmt(r.effectiveGain)}`
                    ) : (
                      <span className="text-slate-400 text-xs font-normal">N/A</span>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                <td className="px-4 py-3" colSpan={4}>TOTAL</td>
                <td className="px-4 py-3 text-right">${fmt(totalCostBase)}</td>
                <td className="px-4 py-3 text-right"></td>
                <td className="px-4 py-3 text-right">
                  {totalCurrentValue != null ? `$${fmt(totalCurrentValue)}` : ""}
                </td>
                <td className={`px-4 py-3 text-right ${
                  totalUnrealisedGain == null ? "" :
                  totalUnrealisedGain >= 0 ? "text-emerald-700" : "text-red-600"
                }`}>
                  {totalUnrealisedGain != null ? `$${fmt(totalUnrealisedGain)}` : ""}
                </td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3"></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400 mt-3">
        Prices fetched from Yahoo Finance (ASX). May be delayed up to 20 minutes. Effective gain applies 50% CGT discount to eligible parcels held &gt;12 months.
      </p>
    </div>
  )
}
