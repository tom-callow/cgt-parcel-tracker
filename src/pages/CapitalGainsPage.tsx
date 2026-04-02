import { useState } from "react"
import { useAppState } from "../lib/AppContext"
import { getFinancialYear, fmtDate } from "../lib/cgt"

const fmt = (n: number) => n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function CapitalGainsPage() {
  const { disposals } = useAppState()
  const [filterTicker, setFilterTicker] = useState("")
  const [filterFY, setFilterFY] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const tickers = [...new Set(disposals.map((d) => d.ticker))].sort()
  const fys = [...new Set(disposals.map((d) => getFinancialYear(d.date)))].sort()

  const filtered = disposals
    .filter((d) => !filterTicker || d.ticker === filterTicker)
    .filter((d) => !filterFY || getFinancialYear(d.date) === filterFY)
    .sort((a, b) => a.date.localeCompare(b.date))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Capital Gains</h1>
        <div className="flex gap-2">
          <select value={filterTicker} onChange={(e) => setFilterTicker(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2 text-sm">
            <option value="">All tickers</option>
            {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterFY} onChange={(e) => setFilterFY(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2 text-sm">
            <option value="">All years</option>
            {fys.map((fy) => <option key={fy} value={fy}>{fy}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400">
          No disposals recorded yet.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
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
            <tbody className="divide-y divide-slate-100">
              {filtered.map((d) => {
                const totalCost = d.parcelsUsed.reduce((s, p) => s + p.costBase, 0)
                const grossGain = d.parcelsUsed.reduce((s, p) => s + p.grossGain, 0)
                const discountedGain = d.parcelsUsed.reduce((s, p) => s + p.discountedGain, 0)
                const discountAmt = grossGain > 0 ? grossGain - discountedGain : 0
                const expanded = expandedId === d.id

                return (
                  <tr key={d.id} className="group">
                    <td colSpan={10} className="p-0">
                      <div>
                        <div
                          className="grid grid-cols-[2rem_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] items-center cursor-pointer hover:bg-slate-50 px-4 py-2.5"
                          onClick={() => setExpandedId(expanded ? null : d.id)}
                        >
                          <span className="text-slate-400 text-xs">{expanded ? "▼" : "▶"}</span>
                          <span className="font-medium">{d.ticker}</span>
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
                          <div className="bg-slate-50 px-8 py-3 border-t border-slate-100">
                            <p className="text-xs font-medium text-slate-500 mb-2 uppercase">Parcel Breakdown ({d.method.toUpperCase()})</p>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="text-left py-1">Parcel ID</th>
                                  <th className="text-left py-1">Acquired</th>
                                  <th className="text-right py-1">Units</th>
                                  <th className="text-right py-1">Cost Base</th>
                                  <th className="text-right py-1">Gross Gain</th>
                                  <th className="text-right py-1">Discount?</th>
                                  <th className="text-right py-1">Net Gain</th>
                                </tr>
                              </thead>
                              <tbody>
                                {d.parcelsUsed.map((pu, i) => (
                                  <tr key={i} className="border-t border-slate-200">
                                    <td className="py-1 font-mono">{pu.parcelId.slice(0, 8)}...</td>
                                    <td className="py-1">{fmtDate(pu.acquisitionDate)}</td>
                                    <td className="py-1 text-right">{pu.units}</td>
                                    <td className="py-1 text-right">${fmt(pu.costBase)}</td>
                                    <td className={`py-1 text-right ${pu.grossGain >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                                      ${fmt(pu.grossGain)}
                                    </td>
                                    <td className="py-1 text-right">{pu.discountEligible ? "Yes (50%)" : "No"}</td>
                                    <td className={`py-1 text-right font-medium ${pu.discountedGain >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                                      ${fmt(pu.discountedGain)}
                                    </td>
                                  </tr>
                                ))}
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
