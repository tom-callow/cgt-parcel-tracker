import { useState } from "react"
import { useAppState } from "../lib/AppContext"
import { useLivePrices } from "../lib/useLivePrices"
import { heldTargets, planHoldingSale, planWithdrawal, type WithdrawalPlan } from "../lib/withdrawal"
import { fmt, fmtPct, uniqueTickers } from "../lib/formatters"
import { fmtDate } from "../lib/cgt"

const inputCls = "w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
const labelCls = "block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
const thCls = "px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider"

const TOLERANCES = [
  { value: 0, label: "Exact" },
  { value: 1, label: "±1%" },
  { value: 2, label: "±2%" },
  { value: 5, label: "±5%" },
  { value: Infinity, label: "Ignore targets" },
]

const FRACTIONAL_KEY = "cgt-fractional-units"
const fmtUnits = (n: number) => n.toLocaleString("en-AU", { maximumFractionDigits: 4 })

const gainCls = (n: number) => (n > 0.005 ? "text-emerald-700 dark:text-emerald-400" : n < -0.005 ? "text-red-600 dark:text-red-400" : "")

function PlanDetail({ plan, showTargets }: { plan: WithdrawalPlan; showTargets: boolean }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        {[
          ["Cash received", `$${fmt(plan.netProceeds)}`, ""],
          ["Net taxable gain", `$${fmt(plan.totalTaxableGain)}`, gainCls(plan.totalTaxableGain)],
          ["Trades", String(plan.sales.length), ""],
        ].map(([label, value, cls]) => (
          <div key={label} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
            <div className={`text-lg font-semibold ${cls || "dark:text-slate-100"}`}>{value}</div>
          </div>
        ))}
      </div>

      {!plan.withinTolerance && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 mb-4 text-sm text-amber-800 dark:text-amber-300">
          Some holdings are already further from target than this withdrawal can fix, so it sells only the most overweight ones to move them back toward target.
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-x-auto mb-4">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-700 text-left">
              <th className={thCls}>Sell</th>
              <th className={`${thCls} text-right`}>Units</th>
              <th className={`${thCls} text-right`}>Price</th>
              <th className={`${thCls} text-right`}>Proceeds</th>
              <th className={`${thCls} text-right`}>Cost Base</th>
              <th className={`${thCls} text-right`}>Discount</th>
              <th className={`${thCls} text-right`}>Taxable Gain</th>
            </tr>
          </thead>
          {plan.sales.map((s) => (
            <tbody key={s.ticker} className="border-t border-slate-200 dark:border-slate-700">
              <tr className="font-semibold dark:text-slate-100">
                <td className="px-3 py-2">{s.ticker}</td>
                <td className="px-3 py-2 text-right">{fmtUnits(s.units)}</td>
                <td className="px-3 py-2 text-right">${fmt(s.price)}</td>
                <td className="px-3 py-2 text-right">${fmt(s.grossProceeds)}</td>
                <td className="px-3 py-2 text-right">${fmt(s.parcels.reduce((t, p) => t + p.costBase, 0))}</td>
                <td className="px-3 py-2" />
                <td className={`px-3 py-2 text-right ${gainCls(s.taxableGain)}`}>${fmt(s.taxableGain)}</td>
              </tr>
              {s.parcels.map((p) => (
                <tr key={p.parcelId} className="text-xs text-slate-500 dark:text-slate-400">
                  <td className="px-3 py-1 pl-6">Parcel bought {fmtDate(p.acquisitionDate)}</td>
                  <td className="px-3 py-1 text-right">{fmtUnits(p.units)}</td>
                  <td className="px-3 py-1" />
                  <td className="px-3 py-1 text-right">${fmt(p.units * s.price)}</td>
                  <td className="px-3 py-1 text-right">${fmt(p.costBase)}</td>
                  <td className="px-3 py-1 text-right">{p.discountEligible && p.grossGain > 0 ? "50%" : "—"}</td>
                  <td className={`px-3 py-1 text-right ${gainCls(p.taxableGain)}`}>${fmt(p.taxableGain)}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-700 text-left">
              <th className={thCls}>Allocation</th>
              <th className={`${thCls} text-right`}>Before</th>
              <th className={`${thCls} text-right`}>After</th>
              {showTargets && <th className={`${thCls} text-right`}>Target</th>}
              {showTargets && <th className={`${thCls} text-right`}>Drift After</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {plan.holdings.map((h) => {
              const drift = h.targetPct != null ? h.pctAfter - h.targetPct : null
              return (
                <tr key={h.ticker} className="dark:text-slate-300">
                  <td className="px-3 py-2 font-medium dark:text-slate-100">{h.ticker}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(h.pctBefore)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtPct(h.pctAfter)}</td>
                  {showTargets && <td className="px-3 py-2 text-right">{fmtPct(h.targetPct ?? 0)}</td>}
                  {showTargets && (
                    <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400">
                      {drift != null ? `${drift > 0 ? "+" : ""}${fmtPct(drift)}` : "—"}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

const toggleCls = (active: boolean) =>
  `px-2 py-0.5 ${active ? "bg-teal-600 text-white" : "bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-600"}`

export function SalePlanner() {
  const { parcels, rebalanceTargets, entityType, amitAdjustments } = useAppState()
  const [sellFrom, setSellFrom] = useState("")  // "" = any holding
  const [sellBy, setSellBy] = useState<"cash" | "units">("cash")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA"))
  const [brokerage, setBrokerage] = useState("0")
  const [tolerance, setTolerance] = useState(2)
  const [fractional, setFractional] = useState(() => {
    try { return localStorage.getItem(FRACTIONAL_KEY) === "1" } catch { return false }
  })

  function handleFractional(on: boolean) {
    setFractional(on)
    try {
      if (on) localStorage.setItem(FRACTIONAL_KEY, "1")
      else localStorage.removeItem(FRACTIONAL_KEY)
    } catch { /* remembering the choice is optional */ }
  }

  const held = parcels.filter((p) => p.unitsRemaining > 0)
  const tickers = uniqueTickers(held)
  const { prices, loading, lastUpdated, refresh } = useLivePrices(tickers)

  // A holding picked earlier may since have been sold off
  const ticker = tickers.includes(sellFrom) ? sellFrom : ""
  const mode = ticker ? sellBy : "cash"
  const unitsHeld = held.filter((p) => p.ticker === ticker).reduce((s, p) => s + p.unitsRemaining, 0)

  function handleSellFrom(t: string) {
    setSellFrom(t)
    if (!t) setSellBy("cash")
  }

  function handleSellAll() {
    setSellBy("units")
    setAmount(String(unitsHeld))
  }

  const targets = heldTargets(rebalanceTargets, tickers)
  const targetsSet = targets != null
  const missingPrices = tickers.filter((t) => prices[t] == null)

  const amt = parseFloat(amount.replace(/,/g, ""))
  const brok = parseFloat(brokerage) || 0

  const base = {
    parcels: held,
    prices: prices as Record<string, number>,
    targets,
    brokeragePerTrade: brok,
    fractional,
    date,
    entityType,
    amitAdjustments,
  }

  // Across all holdings: one plan per tolerance so each option can show its tax cost
  let plans: (WithdrawalPlan | null)[] = []
  let tickerPlan: WithdrawalPlan | null = null
  let error = ""
  if (!loading && missingPrices.length === 0 && amt > 0 && date) {
    try {
      if (ticker) {
        tickerPlan = planHoldingSale({ ...base, ticker, sell: mode === "cash" ? { cash: amt } : { units: amt } })
      } else {
        plans = TOLERANCES.map(({ value }) =>
          targetsSet || !isFinite(value) ? planWithdrawal({ ...base, amount: amt, tolerance: value }) : null
        )
        // A narrower band's plan also fits every wider band. Rounding each ticker up to whole units
        // can make a wider band's split cost more, so carry the cheaper plan forward
        for (let i = 1; i < plans.length; i++) {
          const prev = plans[i - 1]
          const cur = plans[i]
          if (prev && cur && prev.totalTaxableGain < cur.totalTaxableGain) plans[i] = prev
        }
      }
    } catch (err) {
      error = (err as Error).message
    }
  }
  const selectedIdx = targetsSet ? TOLERANCES.findIndex((t) => t.value === tolerance) : TOLERANCES.length - 1
  const plan = ticker ? tickerPlan : (plans[selectedIdx] ?? null)

  if (tickers.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-8 text-center text-slate-400">
        No holdings yet. Add buy trades to plan a sale.
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        Plan a sale with the lowest taxable gain. Sell across your holdings to raise cash while staying near your target allocations, or pick one holding to sell from.
      </p>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <label className={labelCls}>Sell from</label>
            <select value={ticker} onChange={(e) => handleSellFrom(e.target.value)} className={inputCls}>
              <option value="">Any holding (keep targets)</option>
              {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1 h-4">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                {mode === "cash" ? "Cash needed ($)" : "Units to sell"}
              </label>
              {ticker && (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleSellAll}
                    className="text-xs text-teal-600 dark:text-teal-400 hover:underline">
                    Sell all
                  </button>
                  <div className="flex rounded overflow-hidden border border-slate-300 dark:border-slate-600 text-xs font-medium">
                    <button type="button" onClick={() => setSellBy("cash")} className={toggleCls(mode === "cash")}>Cash</button>
                    <button type="button" onClick={() => setSellBy("units")} className={toggleCls(mode === "units")}>Units</button>
                  </div>
                </div>
              )}
            </div>
            <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder={mode === "cash" ? "e.g. 1000" : `up to ${fmtUnits(unitsHeld)}`} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Sale date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Brokerage per trade ($)</label>
            <input type="number" min="0" step="any" value={brokerage} onChange={(e) => setBrokerage(e.target.value)} className={inputCls} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 mb-4">
          <input type="checkbox" checked={fractional} onChange={(e) => handleFractional(e.target.checked)} className="accent-teal-600" />
          My broker lets me sell fractional units
        </label>

        {!ticker && (
          <>
            <label className={labelCls}>How closely to keep your target allocations</label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {TOLERANCES.map((t, i) => {
                const p = plans[i]
                const disabled = !targetsSet && isFinite(t.value)
                const selected = i === selectedIdx
                return (
                  <button key={t.label} type="button" disabled={disabled} onClick={() => setTolerance(t.value)}
                    className={`rounded border px-3 py-2 text-left disabled:opacity-40 disabled:cursor-not-allowed ${
                      selected
                        ? "border-teal-500 bg-teal-50 dark:bg-teal-900/30 ring-1 ring-teal-500"
                        : "border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                    }`}>
                    <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{t.label}</div>
                    <div className={`text-xs ${p ? gainCls(p.totalTaxableGain) || "text-slate-500 dark:text-slate-400" : "text-slate-400"}`}>
                      {p ? `$${fmt(p.totalTaxableGain)} taxable` : "—"}
                    </div>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Each option shows the net taxable gain it would create. Wider bands let the planner favour lower-tax holdings, but your allocations can drift further from target.
            </p>
          </>
        )}

        <div className="flex flex-wrap items-center gap-3 mt-4 text-xs text-slate-400">
          {loading ? <span>Fetching prices…</span> : lastUpdated && (
            <span>Prices updated {lastUpdated.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}</span>
          )}
          <button type="button" onClick={refresh} disabled={loading}
            className="text-teal-600 dark:text-teal-400 hover:underline disabled:opacity-50">
            Refresh prices
          </button>
        </div>
      </div>

      {!ticker && !targetsSet && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 mb-4 text-sm text-amber-800 dark:text-amber-300">
          Set target allocations adding up to 100% on the Rebalancing page to keep your allocations on target. Until then, the planner only minimises tax.
        </div>
      )}
      {!loading && missingPrices.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 mb-4 text-sm text-amber-800 dark:text-amber-300">
          Couldn't get a price for {missingPrices.join(", ")}. Try refreshing prices.
        </div>
      )}
      {error && <div className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</div>}

      {plan && <PlanDetail plan={plan} showTargets={targetsSet} />}

      {plan && (
        <p className="text-xs text-slate-400 mt-3">
          Based on live prices, which may be delayed up to 20 minutes. Taxable gains include AMIT cost base adjustments. Once a sale goes through, record it on the Trades page (or import your broker's export) with the price you actually got.
        </p>
      )}
    </div>
  )
}
