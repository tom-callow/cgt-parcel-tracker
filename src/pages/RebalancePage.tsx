import { useState } from "react"
import { useAppState } from "../lib/AppContext"

import { useLivePrices } from "../lib/useLivePrices"
import { fmt, fmtPct, fmtPp } from "../lib/formatters"
import { planContribution, type Contribution } from "../lib/rebalance"
import { fetchPrices } from "../lib/marketData"

// Adds a ticker you don't hold yet, after checking it has an ASX price
function AddTickerForm({ existing, onAdd }: { existing: string[]; onAdd: (ticker: string, price: number) => void }) {
  const [value, setValue] = useState("")
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const ticker = value.trim().toUpperCase().replace(/\.AX$/, "")
    if (!ticker) return
    if (existing.includes(ticker)) {
      setError(`${ticker} is already in the table.`)
      return
    }
    setError("")
    setChecking(true)
    const price = (await fetchPrices([ticker]))[ticker]
    setChecking(false)
    if (price == null) {
      setError(`Couldn't find an ASX price for ${ticker}. Check the ticker and try again.`)
      return
    }
    onAdd(ticker, price)
    setValue("")
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <label htmlFor="add-ticker" className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
        Add a ticker you don't hold yet
      </label>
      <input
        id="add-ticker"
        value={value}
        onChange={(e) => { setValue(e.target.value); setError("") }}
        placeholder="e.g. ABC"
        className="w-28 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded text-sm uppercase bg-white dark:bg-slate-700 text-slate-800 dark:text-white placeholder:normal-case placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
      />
      <button
        type="submit"
        disabled={checking || !value.trim()}
        className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-4 py-2 rounded text-sm font-medium hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50"
      >
        {checking ? "Checking..." : "Add"}
      </button>
      {error && <p className="w-full text-sm text-red-600 dark:text-red-400">{error}</p>}
    </form>
  )
}

export function RebalancePage() {
  const { parcels, rebalanceTargets, setRebalanceTargets } = useAppState()
  const [investmentAmount, setInvestmentAmount] = useState("")
  const [draftTargets, setDraftTargets] = useState<Record<string, string>>({})
  // Prices looked up when adding a ticker, until the next full refresh includes it
  const [addedPrices, setAddedPrices] = useState<Record<string, number>>({})

  const holdings = (() => {
    const byTicker = new Map<string, { units: number; costBase: number }>()
    for (const p of parcels) {
      if (p.unitsRemaining <= 0) continue
      const entry = byTicker.get(p.ticker) ?? { units: 0, costBase: 0 }
      entry.units += p.unitsRemaining
      entry.costBase += (p.costBase / p.units) * p.unitsRemaining
      byTicker.set(p.ticker, entry)
    }
    // Tickers with a target but no units are planned investments (or holdings since sold off)
    for (const t of Object.keys(rebalanceTargets)) {
      if (!byTicker.has(t)) byTicker.set(t, { units: 0, costBase: 0 })
    }
    return [...byTicker.entries()]
      .map(([ticker, d]) => ({ ticker, units: d.units }))
      .sort((a, b) => a.ticker.localeCompare(b.ticker))
  })()

  const tickers = holdings.map((h) => h.ticker)
  const { prices: livePrices, loading, lastUpdated, refresh: refreshPrices } = useLivePrices(tickers)
  const prices: Record<string, number | null> = { ...addedPrices, ...livePrices }

  // Inputs show the saved target unless mid-edit — draftTargets only holds in-progress edits,
  // so changes from elsewhere (e.g. undo) show up without any syncing
  const targetText = (t: string) =>
    draftTargets[t] ?? (rebalanceTargets[t] != null ? String(rebalanceTargets[t]) : "")

  const allPricesLoaded = tickers.length > 0 && tickers.every((t) => prices[t] != null)

  const currentValues: Record<string, number> = {}
  if (allPricesLoaded) {
    for (const h of holdings) {
      currentValues[h.ticker] = h.units * prices[h.ticker]!
    }
  }
  const totalCurrentValue = Object.values(currentValues).reduce((s, v) => s + v, 0)

  const targetSum = tickers.reduce((s, t) => {
    const v = parseFloat(targetText(t))
    return s + (isNaN(v) ? 0 : v)
  }, 0)
  const targetsComplete = tickers.every((t) => {
    const v = parseFloat(targetText(t))
    return !isNaN(v)
  })
  const targetsSumTo100 = Math.abs(targetSum - 100) < 0.01

  const investAmt = parseFloat(investmentAmount.replace(/,/g, ""))
  const canRecommend = allPricesLoaded && targetsComplete && targetsSumTo100 && investAmt > 0

  let recommendation: (Contribution & { resultingPct: number })[] | null = null

  if (canRecommend) {
    const newTotal = totalCurrentValue + investAmt
    const targetPcts = Object.fromEntries(tickers.map((t) => [t, parseFloat(targetText(t))]))
    const plan = planContribution(investAmt, currentValues, targetPcts)
    if (plan.length > 0) {
      recommendation = plan.map(({ ticker, amount }) => ({
        ticker,
        amount,
        resultingPct: ((currentValues[ticker] + amount) / newTotal) * 100,
      }))
    }
  }

  function handleAddTicker(ticker: string, price: number) {
    setAddedPrices((prev) => ({ ...prev, [ticker]: price }))
    setRebalanceTargets({ ...rebalanceTargets, [ticker]: 0 })
  }

  function handleRemoveTicker(ticker: string) {
    const next = { ...rebalanceTargets }
    delete next[ticker]
    setRebalanceTargets(next)
    setDraftTargets((prev) => {
      const nextDrafts = { ...prev }
      delete nextDrafts[ticker]
      return nextDrafts
    })
  }

  function handleTargetBlur(ticker: string) {
    const parsed = parseFloat(targetText(ticker))
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
      setRebalanceTargets({ ...rebalanceTargets, [ticker]: parsed })
    }
    // Drop the draft either way: a valid value is now saved, an invalid one reverts to the saved value
    setDraftTargets((prev) => {
      const next = { ...prev }
      delete next[ticker]
      return next
    })
  }

  if (holdings.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-6">Rebalancing</h1>
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-8 text-center text-slate-400 mb-4">
          No holdings yet. Add buy trades, or add a ticker you plan to invest in.
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
          <AddTickerForm existing={tickers} onAdd={handleAddTicker} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Rebalancing</h1>
        <div className="flex flex-wrap items-center gap-3">
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
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
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
            className="w-full pl-7 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded text-sm text-right bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <p className="text-xs text-slate-400">
          Enter the dollar amount you plan to invest to get a rebalancing recommendation.
        </p>
      </div>

      {/* Allocation table */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto mb-4">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-700 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              <th className="px-4 py-3">Ticker</th>
              <th className="px-4 py-3 text-right">Current Value</th>
              <th className="px-4 py-3 text-right">Current Alloc</th>
              <th className="px-4 py-3 text-right">Target Alloc</th>
              <th className="px-4 py-3 text-right">Variance</th>
              <th className="px-4 py-3 text-right">To Target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {holdings.map((h) => {
              const currentValue = currentValues[h.ticker]
              const currentPct = totalCurrentValue > 0 && currentValue != null
                ? (currentValue / totalCurrentValue) * 100
                : null
              const targetPct = parseFloat(targetText(h.ticker))
              const variance = currentPct != null && !isNaN(targetPct)
                ? currentPct - targetPct
                : null
              // The trade that would bring this holding exactly to target at today's prices
              const toTarget = currentValue != null && targetsComplete && targetsSumTo100
                ? (targetPct / 100) * totalCurrentValue - currentValue
                : null

              return (
                <tr key={h.ticker} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                  <td className="px-4 py-2.5 font-medium dark:text-slate-100">
                    {h.ticker}
                    {h.units === 0 && (
                      <>
                        <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">Not held</span>
                        <button
                          onClick={() => handleRemoveTicker(h.ticker)}
                          aria-label={`Remove ${h.ticker}`}
                          title={`Remove ${h.ticker}`}
                          className="ml-2 px-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          ×
                        </button>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right dark:text-slate-300">
                    {loading ? (
                      <span className="text-slate-300 dark:text-slate-600">—</span>
                    ) : currentValue != null ? (
                      `$${fmt(currentValue)}`
                    ) : (
                      <span className="text-slate-400 text-xs">N/A</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right dark:text-slate-300">
                    {loading ? (
                      <span className="text-slate-300 dark:text-slate-600">—</span>
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
                        value={targetText(h.ticker)}
                        onChange={(e) =>
                          setDraftTargets((prev) => ({ ...prev, [h.ticker]: e.target.value }))
                        }
                        onBlur={() => handleTargetBlur(h.ticker)}
                        placeholder="0"
                        className="w-20 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded text-right text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                      <span className="text-slate-400 text-xs">%</span>
                    </div>
                  </td>
                  <td className={`px-4 py-2.5 text-right font-medium ${
                    variance != null && Math.abs(variance) < 0.05 ? "text-slate-400" : "dark:text-slate-300"
                  }`}>
                    {variance != null
                      ? fmtPp(Math.abs(variance) < 0.05 ? 0 : variance)
                      : <span className="text-slate-300 dark:text-slate-600 font-normal">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right dark:text-slate-300">
                    {toTarget == null || Math.abs(toTarget) < 0.5 ? (
                      <span className="text-slate-300 dark:text-slate-600">—</span>
                    ) : (
                      <>
                        <span className="text-xs text-slate-500 dark:text-slate-400 mr-1.5">{toTarget > 0 ? "Buy" : "Sell"}</span>
                        ${fmt(Math.abs(toTarget))}
                      </>
                    )}
                  </td>
                </tr>
              )
            })}

            <tr className="bg-slate-50 dark:bg-slate-700 font-semibold border-t-2 border-slate-200 dark:border-slate-600">
              <td className="px-4 py-3 dark:text-slate-100">TOTAL</td>
              <td className="px-4 py-3 text-right dark:text-slate-100">
                {allPricesLoaded ? `$${fmt(totalCurrentValue)}` : ""}
              </td>
              <td className="px-4 py-3 text-right dark:text-slate-100">
                {allPricesLoaded ? "100.0%" : ""}
              </td>
              <td className="px-4 py-3 text-right">
                <span className={
                  targetsComplete
                    ? targetsSumTo100
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                    : "text-slate-400"
                }>
                  {targetsComplete ? fmtPct(targetSum) : "—"}
                </span>
              </td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4 mb-4">
        <AddTickerForm existing={tickers} onAdd={handleAddTicker} />
      </div>

      {/* Target sum warning */}
      {targetsComplete && !targetsSumTo100 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 mb-4 text-sm text-amber-800 dark:text-amber-300">
          Target allocations sum to {fmtPct(targetSum)}, not 100%. Adjust them before getting a recommendation.
        </div>
      )}

      {/* Recommendation */}
      {canRecommend && recommendation && (
        <div className="bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg px-5 py-4">
          <p className="text-sm font-semibold text-teal-800 dark:text-teal-300 mb-3">Recommendation</p>
          {recommendation.length === 1 ? (
            <p className="text-sm text-teal-900 dark:text-teal-200">
              Invest{" "}
              <span className="font-semibold">${fmt(investAmt)}</span>{" "}
              in{" "}
              <span className="font-semibold">{recommendation[0].ticker}</span>
              {" "}— this would bring its allocation from{" "}
              <span className="font-semibold">{fmtPct((currentValues[recommendation[0].ticker] / totalCurrentValue) * 100)}</span>{" "}
              to{" "}
              <span className="font-semibold">{fmtPct(recommendation[0].resultingPct)}</span>
              {" "}(target:{" "}
              <span className="font-semibold">{fmtPct(parseFloat(targetText(recommendation[0].ticker)))}</span>
              ).
            </p>
          ) : (
            <>
              <p className="text-sm text-teal-900 dark:text-teal-200 mb-3">
                Split your{" "}
                <span className="font-semibold">${fmt(investAmt)}</span>{" "}
                investment as follows to reach your target allocations:
              </p>
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="text-xs font-medium text-teal-700 dark:text-teal-400 uppercase tracking-wider border-b border-teal-200 dark:border-teal-800">
                    <th className="pb-2 text-left">Ticker</th>
                    <th className="pb-2 text-right">Invest</th>
                    <th className="pb-2 text-right">Current Alloc</th>
                    <th className="pb-2 text-right">Resulting Alloc</th>
                    <th className="pb-2 text-right">Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-teal-100 dark:divide-teal-900">
                  {recommendation.map(({ ticker, amount, resultingPct }) => (
                    <tr key={ticker}>
                      <td className="py-2 font-semibold text-teal-900 dark:text-teal-200">{ticker}</td>
                      <td className="py-2 text-right text-teal-900 dark:text-teal-200">${fmt(amount)}</td>
                      <td className="py-2 text-right text-teal-700 dark:text-teal-400">
                        {fmtPct((currentValues[ticker] / totalCurrentValue) * 100)}
                      </td>
                      <td className="py-2 text-right font-semibold text-teal-900 dark:text-teal-200">{fmtPct(resultingPct)}</td>
                      <td className="py-2 text-right text-teal-700 dark:text-teal-400">{fmtPct(parseFloat(targetText(ticker)))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {canRecommend && !recommendation && (
        <div className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-5 py-4 text-sm text-slate-500 dark:text-slate-400">
          All holdings are currently at or above their target allocations.
        </div>
      )}

      <p className="text-xs text-slate-400 mt-3">
        Prices fetched from Yahoo Finance (ASX). May be delayed up to 30 minutes. Target allocations are saved automatically.
      </p>
    </div>
  )
}
