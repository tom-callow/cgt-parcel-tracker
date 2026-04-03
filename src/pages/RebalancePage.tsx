import { useState, useEffect, useCallback } from "react"
import { useAppState } from "../lib/AppContext"

const fmt = (n: number) =>
  n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtPct = (n: number) =>
  n.toLocaleString("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%"

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

export function RebalancePage() {
  const { parcels, rebalanceTargets, setRebalanceTargets } = useAppState()
  const [prices, setPrices] = useState<Record<string, number | null>>({})
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [investmentAmount, setInvestmentAmount] = useState("")
  // Local draft of targets — committed to context on blur
  const [draftTargets, setDraftTargets] = useState<Record<string, string>>({})

  // Aggregate active parcels into per-ticker holdings
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
      .map(([ticker, d]) => ({ ticker, units: d.units }))
      .sort((a, b) => a.ticker.localeCompare(b.ticker))
  })()

  const tickers = holdings.map((h) => h.ticker)

  const refreshPrices = useCallback(async () => {
    if (tickers.length === 0) return
    setLoading(true)
    const results = await Promise.all(
      tickers.map(async (t) => [t, await fetchPrice(t)] as [string, number | null])
    )
    setPrices(Object.fromEntries(results))
    setLastUpdated(new Date())
    setLoading(false)
  }, [tickers.join(",")]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refreshPrices()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync draft targets when persisted targets or tickers change
  useEffect(() => {
    const draft: Record<string, string> = {}
    for (const t of tickers) {
      draft[t] = rebalanceTargets[t] != null ? String(rebalanceTargets[t]) : ""
    }
    setDraftTargets(draft)
  }, [tickers.join(",")]) // eslint-disable-line react-hooks/exhaustive-deps

  const allPricesLoaded = tickers.length > 0 && tickers.every((t) => prices[t] != null)

  // Per-ticker current values
  const currentValues: Record<string, number> = {}
  if (allPricesLoaded) {
    for (const h of holdings) {
      currentValues[h.ticker] = h.units * prices[h.ticker]!
    }
  }
  const totalCurrentValue = Object.values(currentValues).reduce((s, v) => s + v, 0)

  const targetSum = tickers.reduce((s, t) => {
    const v = parseFloat(draftTargets[t] ?? "")
    return s + (isNaN(v) ? 0 : v)
  }, 0)
  const targetsComplete = tickers.every((t) => {
    const v = parseFloat(draftTargets[t] ?? "")
    return !isNaN(v)
  })
  const targetsSumTo100 = Math.abs(targetSum - 100) < 0.01

  // Recommendation
  const investAmt = parseFloat(investmentAmount.replace(/,/g, ""))
  const canRecommend = allPricesLoaded && targetsComplete && targetsSumTo100 && investAmt > 0

  type Allocation = { ticker: string; amount: number; resultingPct: number }
  let recommendation: Allocation[] | null = null

  if (canRecommend) {
    const newTotal = totalCurrentValue + investAmt

    // Deficit = how much each underweight ticker needs to reach its target share of the new total
    const deficits = tickers
      .map((t) => ({
        ticker: t,
        deficit: Math.max(0, (parseFloat(draftTargets[t]) / 100) * newTotal - currentValues[t]),
      }))
      .filter((d) => d.deficit > 0)

    const totalDeficit = deficits.reduce((s, d) => s + d.deficit, 0)

    if (totalDeficit > 0) {
      // Allocate proportionally to each ticker's deficit.
      // When targets sum to 100% and all tickers are underweight this gives exact target splits.
      // When some tickers are overweight it distributes the available cash as close to target as possible.
      recommendation = deficits.map(({ ticker, deficit }) => {
        const amount = Math.round((investAmt * (deficit / totalDeficit)) / 100) * 100
        const resultingPct = ((currentValues[ticker] + amount) / newTotal) * 100
        return { ticker, amount, resultingPct }
      })
    }
  }

  function handleTargetBlur(ticker: string) {
    const raw = draftTargets[ticker] ?? ""
    const parsed = parseFloat(raw)
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
      setRebalanceTargets({ ...rebalanceTargets, [ticker]: parsed })
    } else {
      // Revert draft to last saved value
      setDraftTargets((prev) => ({
        ...prev,
        [ticker]: rebalanceTargets[ticker] != null ? String(rebalanceTargets[ticker]) : "",
      }))
    }
  }

  if (holdings.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-6">Rebalancing</h1>
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400">
          No holdings yet. Add buy trades to use the rebalancer.
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Rebalancing</h1>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-slate-400">
              Updated {lastUpdated.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={refreshPrices}
            disabled={loading}
            className="bg-teal-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
          >
            {loading ? "Fetching..." : "Refresh Prices"}
          </button>
        </div>
      </div>

      {/* Investment amount input */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-4 flex items-center gap-4">
        <label className="text-sm font-medium text-slate-700 whitespace-nowrap">
          Amount to invest
        </label>
        <div className="relative w-48">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
          <input
            type="number"
            min="0"
            step="100"
            value={investmentAmount}
            onChange={(e) => setInvestmentAmount(e.target.value)}
            placeholder="0.00"
            className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <p className="text-xs text-slate-400">
          Enter the dollar amount you plan to invest to get a rebalancing recommendation.
        </p>
      </div>

      {/* Allocation table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
              <th className="px-4 py-3">Ticker</th>
              <th className="px-4 py-3 text-right">Current Value</th>
              <th className="px-4 py-3 text-right">Current Alloc</th>
              <th className="px-4 py-3 text-right">Target Alloc</th>
              <th className="px-4 py-3 text-right">Variance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {holdings.map((h) => {
              const currentValue = currentValues[h.ticker]
              const currentPct = totalCurrentValue > 0 && currentValue != null
                ? (currentValue / totalCurrentValue) * 100
                : null
              const targetPct = parseFloat(draftTargets[h.ticker] ?? "")
              const variance = currentPct != null && !isNaN(targetPct)
                ? currentPct - targetPct
                : null

              return (
                <tr key={h.ticker} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">{h.ticker}</td>
                  <td className="px-4 py-2.5 text-right">
                    {loading ? (
                      <span className="text-slate-300">—</span>
                    ) : currentValue != null ? (
                      `$${fmt(currentValue)}`
                    ) : (
                      <span className="text-slate-400 text-xs">N/A</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {loading ? (
                      <span className="text-slate-300">—</span>
                    ) : currentPct != null ? (
                      fmtPct(currentPct)
                    ) : (
                      <span className="text-slate-400 text-xs">N/A</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={draftTargets[h.ticker] ?? ""}
                        onChange={(e) =>
                          setDraftTargets((prev) => ({ ...prev, [h.ticker]: e.target.value }))
                        }
                        onBlur={() => handleTargetBlur(h.ticker)}
                        placeholder="0"
                        className="w-20 px-2 py-1 border border-slate-300 rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                      <span className="text-slate-400 text-xs">%</span>
                    </div>
                  </td>
                  <td className={`px-4 py-2.5 text-right font-medium ${
                    variance == null ? "" :
                    Math.abs(variance) < 0.05 ? "text-slate-400" :
                    variance > 0 ? "text-emerald-700" : "text-red-600"
                  }`}>
                    {variance != null
                      ? `${variance > 0 ? "+" : ""}${fmtPct(variance)}`
                      : <span className="text-slate-300 font-normal">—</span>}
                  </td>
                </tr>
              )
            })}

            {/* Totals row */}
            <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
              <td className="px-4 py-3">TOTAL</td>
              <td className="px-4 py-3 text-right">
                {allPricesLoaded ? `$${fmt(totalCurrentValue)}` : ""}
              </td>
              <td className="px-4 py-3 text-right">
                {allPricesLoaded ? "100.0%" : ""}
              </td>
              <td className="px-4 py-3 text-right">
                <span className={
                  targetsComplete
                    ? targetsSumTo100
                      ? "text-emerald-700"
                      : "text-red-600"
                    : "text-slate-400"
                }>
                  {targetsComplete ? fmtPct(targetSum) : "—"}
                </span>
              </td>
              <td className="px-4 py-3" />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Target sum warning */}
      {targetsComplete && !targetsSumTo100 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 text-sm text-amber-800">
          Target allocations sum to {fmtPct(targetSum)}, not 100%. Adjust them before getting a recommendation.
        </div>
      )}

      {/* Recommendation */}
      {canRecommend && recommendation && (
        <div className="bg-teal-50 border border-teal-200 rounded-lg px-5 py-4">
          <p className="text-sm font-semibold text-teal-800 mb-3">Recommendation</p>
          {recommendation.length === 1 ? (
            <p className="text-sm text-teal-900">
              Invest{" "}
              <span className="font-semibold">${fmt(investAmt)}</span>{" "}
              in{" "}
              <span className="font-semibold">{recommendation[0].ticker}</span>
              {" "}— this would bring its allocation from{" "}
              <span className="font-semibold">{fmtPct((currentValues[recommendation[0].ticker] / totalCurrentValue) * 100)}</span>{" "}
              to{" "}
              <span className="font-semibold">{fmtPct(recommendation[0].resultingPct)}</span>
              {" "}(target:{" "}
              <span className="font-semibold">{fmtPct(parseFloat(draftTargets[recommendation[0].ticker]))}</span>
              ).
            </p>
          ) : (
            <>
              <p className="text-sm text-teal-900 mb-3">
                Split your{" "}
                <span className="font-semibold">${fmt(investAmt)}</span>{" "}
                investment as follows to reach your target allocations:
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-medium text-teal-700 uppercase tracking-wider border-b border-teal-200">
                    <th className="pb-2 text-left">Ticker</th>
                    <th className="pb-2 text-right">Invest</th>
                    <th className="pb-2 text-right">Current Alloc</th>
                    <th className="pb-2 text-right">Resulting Alloc</th>
                    <th className="pb-2 text-right">Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-teal-100">
                  {recommendation.map(({ ticker, amount, resultingPct }) => (
                    <tr key={ticker}>
                      <td className="py-2 font-semibold text-teal-900">{ticker}</td>
                      <td className="py-2 text-right text-teal-900">${fmt(amount)}</td>
                      <td className="py-2 text-right text-teal-700">
                        {fmtPct((currentValues[ticker] / totalCurrentValue) * 100)}
                      </td>
                      <td className="py-2 text-right font-semibold text-teal-900">{fmtPct(resultingPct)}</td>
                      <td className="py-2 text-right text-teal-700">{fmtPct(parseFloat(draftTargets[ticker]))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {canRecommend && !recommendation && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-5 py-4 text-sm text-slate-500">
          All holdings are currently at or above their target allocations.
        </div>
      )}

      <p className="text-xs text-slate-400 mt-3">
        Prices fetched from Yahoo Finance (ASX). May be delayed up to 20 minutes. Target allocations are saved automatically.
      </p>
    </div>
  )
}
