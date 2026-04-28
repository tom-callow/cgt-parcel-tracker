import { useState } from "react"
import { useAppState } from "../lib/AppContext"
import { getFinancialYear, fmtDate, calcAmitAdjPerUnit } from "../lib/cgt"
import { exportCapitalGainsXLSX } from "../lib/exportExcel"
import { fmt, byDate, uniqueTickers } from "../lib/formatters"

export function CapitalGainsPage() {
  const { parcels, disposals, amitAdjustments, entityType } = useAppState()

  function handleExport() {
    exportCapitalGainsXLSX(parcels, disposals, amitAdjustments, entityType, filterFY || null)
  }
  const [filterTicker, setFilterTicker] = useState("")
  const [filterFY, setFilterFY] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const tickers = uniqueTickers(disposals)
  const fys = [...new Set(disposals.map((d) => getFinancialYear(d.date)))].sort()

  const filtered = disposals
    .filter((d) => !filterTicker || d.ticker === filterTicker)
    .filter((d) => !filterFY || getFinancialYear(d.date) === filterFY)
    .sort(byDate)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Capital Gains</h1>
        <div className="flex gap-2 ml-8">
          <select value={filterTicker} onChange={(e) => setFilterTicker(e.target.value)}
            className="border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100">
            <option value="">All tickers</option>
            {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterFY} onChange={(e) => setFilterFY(e.target.value)}
            className="border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100">
            <option value="">All years</option>
            {fys.map((fy) => <option key={fy} value={fy}>{fy}</option>)}
          </select>
          {disposals.length > 0 && (
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-3 py-2 rounded transition-colors"
              title="Export parcel-level calculations to Excel for ATO audit trail"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M10 3a.75.75 0 0 1 .75.75v7.69l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 1.06-1.06l2.72 2.72V3.75A.75.75 0 0 1 10 3Zm-6.75 13.5a.75.75 0 0 1 .75-.75h12a.75.75 0 0 1 0 1.5h-12a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
              </svg>
              Export {filterFY || "All"} to Excel
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-8 text-center text-slate-400">
          No disposals recorded yet.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="px-4 py-3"></th>
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3">Disposal Date</th>
                <th className="px-4 py-3">FY</th>
                <th className="px-4 py-3 text-right">Units</th>
                <th className="px-4 py-3 text-right">Proceeds</th>
                <th className="px-4 py-3 text-right">Cost Base</th>
                <th className="px-4 py-3 text-right">Gross Gain</th>
                <th className="px-4 py-3 text-right">Discount</th>
                <th className="px-4 py-3 text-right">Net Taxable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {filtered.map((d) => {
                let totalCost = 0
                let grossGain = 0
                let discountedGain = 0
                for (const pu of d.parcelsUsed) {
                  const amitAdj = calcAmitAdjPerUnit(d.ticker, pu.acquisitionDate, d.date, amitAdjustments) * pu.units
                  const effectiveCostBase = pu.costBase + amitAdj
                  const effectiveGrossGain = pu.grossGain - amitAdj
                  const effectiveDiscountedGain =
                    effectiveGrossGain > 0
                      ? effectiveGrossGain * (pu.discountEligible ? 0.5 : 1)
                      : effectiveGrossGain
                  totalCost += effectiveCostBase
                  grossGain += effectiveGrossGain
                  discountedGain += effectiveDiscountedGain
                }
                const discountAmt = grossGain > 0 ? grossGain - discountedGain : 0
                const expanded = expandedId === d.id

                return (
                  <tr key={d.id} className="group">
                    <td colSpan={10} className="p-0">
                      <div>
                        <div
                          className="grid grid-cols-[2rem_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 px-4 py-2.5 dark:text-slate-300"
                          onClick={() => setExpandedId(expanded ? null : d.id)}
                        >
                          <span className="text-slate-400 text-xs">{expanded ? "▼" : "▶"}</span>
                          <span className="font-medium dark:text-slate-100">{d.ticker}</span>
                          <span>{fmtDate(d.date)}</span>
                          <span>{getFinancialYear(d.date)}</span>
                          <span className="text-right">{d.units}</span>
                          <span className="text-right">${fmt(d.proceeds)}</span>
                          <span className="text-right">${fmt(totalCost)}</span>
                          <span className={`text-right font-medium ${grossGain >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                            ${fmt(grossGain)}
                          </span>
                          <span className="text-right">${fmt(discountAmt)}</span>
                          <span className={`text-right font-medium ${discountedGain >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                            ${fmt(discountedGain)}
                          </span>
                        </div>
                        {expanded && (
                          <div className="bg-slate-50 dark:bg-slate-700 px-8 py-3 border-t border-slate-100 dark:border-slate-600">
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase">Parcel Breakdown ({d.method.toUpperCase()})</p>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-slate-500 dark:text-slate-400">
                                  <th className="text-left py-1">Parcel ID</th>
                                  <th className="text-left py-1">Acquired</th>
                                  <th className="text-right py-1">Units</th>
                                  <th className="text-right py-1">Raw Cost Base</th>
                                  <th className="text-right py-1">AMIT Adj</th>
                                  <th className="text-right py-1">Adj Cost Base</th>
                                  <th className="text-right py-1">Gross Gain</th>
                                  <th className="text-right py-1">Discount?</th>
                                  <th className="text-right py-1">Net Gain</th>
                                </tr>
                              </thead>
                              <tbody>
                                {d.parcelsUsed.map((pu, i) => {
                                  const amitAdj = calcAmitAdjPerUnit(d.ticker, pu.acquisitionDate, d.date, amitAdjustments) * pu.units
                                  const effectiveCostBase = pu.costBase + amitAdj
                                  const effectiveGrossGain = pu.grossGain - amitAdj
                                  const effectiveDiscountedGain =
                                    effectiveGrossGain > 0
                                      ? effectiveGrossGain * (pu.discountEligible ? 0.5 : 1)
                                      : effectiveGrossGain
                                  return (
                                    <tr key={i} className="border-t border-slate-200 dark:border-slate-600 dark:text-slate-300">
                                      <td className="py-1 font-mono">{pu.parcelId.slice(0, 8)}...</td>
                                      <td className="py-1">{fmtDate(pu.acquisitionDate)}</td>
                                      <td className="py-1 text-right">{pu.units}</td>
                                      <td className="py-1 text-right">${fmt(pu.costBase)}</td>
                                      <td className={`py-1 text-right ${amitAdj === 0 ? "text-slate-400" : amitAdj > 0 ? "text-emerald-700" : "text-red-600"}`}>
                                        {amitAdj === 0 ? "—" : `${amitAdj > 0 ? "+" : ""}$${fmt(amitAdj)}`}
                                      </td>
                                      <td className="py-1 text-right">${fmt(effectiveCostBase)}</td>
                                      <td className={`py-1 text-right ${effectiveGrossGain >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                                        ${fmt(effectiveGrossGain)}
                                      </td>
                                      <td className="py-1 text-right">{pu.discountEligible ? "Yes (50%)" : "No"}</td>
                                      <td className={`py-1 text-right font-medium ${effectiveDiscountedGain >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                                        ${fmt(effectiveDiscountedGain)}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
