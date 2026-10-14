import { Fragment, useState } from "react"
import { useAppState } from "../lib/AppContext"
import { getFinancialYear, fmtDate, calcAmitAdjPerUnit } from "../lib/cgt"
import { fmt, byDate, uniqueTickers } from "../lib/formatters"

export function CapitalGainsPage() {
  const { parcels, disposals, amitAdjustments, entityType } = useAppState()

  async function handleExport() {
    // Loaded on demand so the Excel library isn't part of the initial download
    const { exportCapitalGainsXLSX } = await import("../lib/exportExcel")
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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Capital Gains</h1>
        <div className="flex flex-wrap gap-2">
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
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="pl-4 py-3 w-8"></th>
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
                  <Fragment key={d.id}>
                    <tr
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-slate-300"
                      onClick={() => setExpandedId(expanded ? null : d.id)}
                    >
                      <td className="pl-4 py-2.5">
                        <button className="text-slate-400 text-xs" aria-expanded={expanded} aria-label={`Parcel breakdown for ${d.ticker} sale on ${fmtDate(d.date)}`}>
                          {expanded ? "▼" : "▶"}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 font-medium dark:text-slate-100">{d.ticker}</td>
                      <td className="px-4 py-2.5">{fmtDate(d.date)}</td>
                      <td className="px-4 py-2.5">{getFinancialYear(d.date)}</td>
                      <td className="px-4 py-2.5 text-right">{d.units}</td>
                      <td className="px-4 py-2.5 text-right">${fmt(d.proceeds)}</td>
                      <td className="px-4 py-2.5 text-right">${fmt(totalCost)}</td>
                      <td className={`px-4 py-2.5 text-right font-medium ${grossGain >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        ${fmt(grossGain)}
                      </td>
                      <td className="px-4 py-2.5 text-right">${fmt(discountAmt)}</td>
                      <td className={`px-4 py-2.5 text-right font-medium ${discountedGain >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        ${fmt(discountedGain)}
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={10} className="p-0">
                          <div className="bg-slate-50 dark:bg-slate-700 px-8 py-3">
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase">Parcel Breakdown ({d.method.toUpperCase()})</p>
                            <table className="w-full text-xs whitespace-nowrap [&_th:not(:first-child)]:pl-4 [&_td:not(:first-child)]:pl-4">
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
                                      <td className={`py-1 text-right ${amitAdj === 0 ? "text-slate-400" : amitAdj > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                        {amitAdj === 0 ? "—" : `${amitAdj > 0 ? "+" : ""}$${fmt(amitAdj)}`}
                                      </td>
                                      <td className="py-1 text-right">${fmt(effectiveCostBase)}</td>
                                      <td className={`py-1 text-right ${effectiveGrossGain >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                        ${fmt(effectiveGrossGain)}
                                      </td>
                                      <td className="py-1 text-right">{pu.discountEligible ? "Yes (50%)" : "No"}</td>
                                      <td className={`py-1 text-right font-medium ${effectiveDiscountedGain >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                        ${fmt(effectiveDiscountedGain)}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
