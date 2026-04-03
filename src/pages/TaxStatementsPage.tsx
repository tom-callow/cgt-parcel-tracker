import { useAppState } from "../lib/AppContext"
import { computeFYSummary } from "../lib/cgt"

const fmt = (n: number) => n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function TaxStatementsPage() {
  const { disposals, amitAdjustments } = useAppState()
  const summaries = computeFYSummary(disposals, amitAdjustments)

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Tax Summary</h1>

      {summaries.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400">
          No disposals recorded yet.
        </div>
      ) : (
        summaries.map((s) => (
          <div key={s.fy} className="bg-white rounded-lg border border-slate-200 mb-6 overflow-hidden">
            <div className="bg-slate-800 text-white px-5 py-3 font-semibold">{s.fy}</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-3">Ticker</th>
                  <th className="px-5 py-3 text-right">Gross Gains</th>
                  <th className="px-5 py-3 text-right">Gross Losses</th>
                  <th className="px-5 py-3 text-right">Net Before Discount</th>
                  <th className="px-5 py-3 text-right">Discount</th>
                  <th className="px-5 py-3 text-right">Net Taxable Gain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {s.rows.map((r) => (
                  <tr key={r.ticker}>
                    <td className="px-5 py-2.5 font-medium">{r.ticker}</td>
                    <td className="px-5 py-2.5 text-right text-emerald-700">${fmt(r.grossGains)}</td>
                    <td className="px-5 py-2.5 text-right text-red-600">${fmt(r.grossLosses)}</td>
                    <td className="px-5 py-2.5 text-right">${fmt(r.netGainBeforeDiscount)}</td>
                    <td className="px-5 py-2.5 text-right">${fmt(r.discountAmount)}</td>
                    <td className={`px-5 py-2.5 text-right font-semibold ${r.netTaxableGain >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      ${fmt(r.netTaxableGain)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-5 py-3">TOTAL</td>
                  <td className="px-5 py-3 text-right text-emerald-700">${fmt(s.totalGrossGains)}</td>
                  <td className="px-5 py-3 text-right text-red-600">${fmt(s.totalGrossLosses)}</td>
                  <td className="px-5 py-3 text-right">${fmt(s.netGainBeforeDiscount)}</td>
                  <td className="px-5 py-3 text-right">${fmt(s.discountAmount)}</td>
                  <td className={`px-5 py-3 text-right ${s.netTaxableGain >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                    ${fmt(s.netTaxableGain)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ))
      )}

      <p className="text-xs text-slate-400 mt-4 italic">
        This is a tool only and does not constitute tax advice. Verify all figures with a qualified tax adviser.
      </p>
    </div>
  )
}
