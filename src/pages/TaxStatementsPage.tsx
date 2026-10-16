import { useState } from "react"
import { useAppState } from "../lib/AppContext"
import { computeFYSummary } from "../lib/cgt"
import { fmt } from "../lib/formatters"

export function TaxStatementsPage() {
  const { disposals, amitAdjustments } = useAppState()
  const summaries = computeFYSummary(disposals, amitAdjustments)
  const [selectedFY, setSelectedFY] = useState("")

  const filtered = selectedFY ? summaries.filter((s) => s.fy === selectedFY) : summaries

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Tax Summary</h1>
        {summaries.length > 0 && (
          <select
            value={selectedFY}
            onChange={(e) => setSelectedFY(e.target.value)}
            className="border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
          >
            <option value="">All years</option>
            {summaries.map((s) => (
              <option key={s.fy} value={s.fy}>{s.fy}</option>
            ))}
          </select>
        )}
      </div>

      {summaries.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-8 text-center text-slate-400">
          No disposals recorded yet.
        </div>
      ) : (
        filtered.map((s) => (
          <div key={s.fy} className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 mb-6 overflow-x-auto">
            <div className="bg-slate-800 dark:bg-slate-900 text-white px-5 py-3 font-semibold">{s.fy}</div>
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-700 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="px-5 py-3">Ticker</th>
                  <th className="px-5 py-3 text-right">Gross Gains</th>
                  <th className="px-5 py-3 text-right">Gross Losses</th>
                  <th className="px-5 py-3 text-right">Net Before Discount</th>
                  <th className="px-5 py-3 text-right">Discount</th>
                  <th className="px-5 py-3 text-right">Net Taxable Gain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {s.rows.map((r) => (
                  <tr key={r.ticker} className="dark:text-slate-300">
                    <td className="px-5 py-2.5 font-medium dark:text-slate-100">{r.ticker}</td>
                    <td className="px-5 py-2.5 text-right text-emerald-700 dark:text-emerald-400">${fmt(r.grossGains)}</td>
                    <td className="px-5 py-2.5 text-right text-red-600 dark:text-red-400">${fmt(r.grossLosses)}</td>
                    <td className="px-5 py-2.5 text-right">${fmt(r.netGainBeforeDiscount)}</td>
                    <td className="px-5 py-2.5 text-right text-slate-300 dark:text-slate-600">—</td>
                    <td className="px-5 py-2.5 text-right text-slate-300 dark:text-slate-600">—</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 dark:bg-slate-700 font-semibold">
                  <td className="px-5 py-3 dark:text-slate-100">TOTAL</td>
                  <td className="px-5 py-3 text-right text-emerald-700 dark:text-emerald-400">${fmt(s.totalGrossGains)}</td>
                  <td className="px-5 py-3 text-right text-red-600 dark:text-red-400">${fmt(s.totalGrossLosses)}</td>
                  <td className="px-5 py-3 text-right dark:text-slate-100">${fmt(s.netGainBeforeDiscount)}</td>
                  <td className="px-5 py-3 text-right dark:text-slate-100">${fmt(s.discountAmount)}</td>
                  <td className={`px-5 py-3 text-right ${s.netTaxableGain >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    ${fmt(s.netTaxableGain)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ))
      )}

      {summaries.length > 0 && (
        <p className="text-xs text-slate-400 mt-4">
          Capital losses are applied to gross gains for the whole year before the 50% discount —
          first against gains that aren't eligible for the discount, then against eligible ones — so
          the discount and net taxable gain are shown for the year, not per ticker. Capital losses
          carried forward from earlier years, and gains from assets not tracked here, aren't included.
        </p>
      )}
      <p className="text-xs text-slate-400 mt-4 italic">
        This is a tool only and does not constitute tax advice. Verify all figures with a qualified tax adviser.
      </p>
    </div>
  )
}
