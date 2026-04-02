import { useState } from "react"
import { useAppState } from "../lib/AppContext"
import { previewDisposal, executeDisposal, type OptimiserResult } from "../lib/cgt"

const fmt = (n: number) => n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function OptimiserPage() {
  const state = useAppState()
  const [ticker, setTicker] = useState("")
  const [units, setUnits] = useState("")
  const [price, setPrice] = useState("")
  const [date, setDate] = useState("")
  const [brokerage, setBrokerage] = useState("0")
  const [result, setResult] = useState<{ fifo: OptimiserResult; lifo: OptimiserResult; optimised: OptimiserResult } | null>(null)
  const [error, setError] = useState("")

  const tickers = [...new Set(state.parcels.filter((p) => p.unitsRemaining > 0).map((p) => p.ticker))].sort()

  function handlePreview(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setResult(null)

    const t = ticker.trim().toUpperCase()
    const u = parseFloat(units)
    const p = parseFloat(price)
    const b = parseFloat(brokerage) || 0

    if (!t || !date || isNaN(u) || isNaN(p) || u <= 0 || p <= 0) {
      setError("Please fill in all fields with valid values.")
      return
    }

    try {
      const r = previewDisposal(state.parcels, t, u, p, date, b, state.entityType)
      setResult(r)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function handleRecord(method: "fifo" | "lifo" | "optimised") {
    const t = ticker.trim().toUpperCase()
    const u = parseFloat(units)
    const p = parseFloat(price)
    const b = parseFloat(brokerage) || 0

    try {
      const { disposal, updatedParcels } = executeDisposal(
        state.parcels, t, date, u, p, b, method, state.entityType
      )
      state.addDisposal(disposal, updatedParcels)
      setResult(null)
      setTicker("")
      setUnits("")
      setPrice("")
      setDate("")
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function ResultCard({ r, highlight }: { r: OptimiserResult; highlight?: boolean }) {
    return (
      <div className={`border rounded-lg p-4 ${highlight ? "border-teal-500 bg-teal-50 ring-2 ring-teal-200" : "border-slate-200 bg-white"}`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm uppercase text-slate-700">
            {r.method}
            {highlight && <span className="ml-2 text-teal-600 text-xs font-normal">(Recommended)</span>}
          </h3>
          <button
            onClick={() => handleRecord(r.method)}
            className={`text-xs px-3 py-1.5 rounded font-medium ${
              highlight
                ? "bg-teal-600 text-white hover:bg-teal-700"
                : "bg-slate-200 text-slate-700 hover:bg-slate-300"
            }`}
          >
            Record this sale
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm mb-3">
          <div><span className="text-slate-500">Total Proceeds:</span> <span className="font-medium">${fmt(r.totalProceeds)}</span></div>
          <div><span className="text-slate-500">Total Cost Base:</span> <span className="font-medium">${fmt(r.totalCostBase)}</span></div>
          <div><span className="text-slate-500">Gross Gain:</span>
            <span className={`font-medium ml-1 ${r.totalGrossGain >= 0 ? "text-emerald-700" : "text-red-600"}`}>${fmt(r.totalGrossGain)}</span>
          </div>
          <div><span className="text-slate-500">Net Taxable:</span>
            <span className={`font-semibold ml-1 ${r.totalDiscountedGain >= 0 ? "text-emerald-700" : "text-red-600"}`}>${fmt(r.totalDiscountedGain)}</span>
          </div>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left py-1">Parcel</th>
              <th className="text-left py-1">Acquired</th>
              <th className="text-right py-1">Units</th>
              <th className="text-right py-1">Cost Base</th>
              <th className="text-right py-1">Gain</th>
              <th className="text-right py-1">Discount</th>
              <th className="text-right py-1">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {r.parcelsUsed.map((pu, i) => (
              <tr key={i}>
                <td className="py-1 font-mono">{pu.parcelId.slice(0, 8)}</td>
                <td className="py-1">{pu.acquisitionDate}</td>
                <td className="py-1 text-right">{pu.units}</td>
                <td className="py-1 text-right">${fmt(pu.costBase)}</td>
                <td className={`py-1 text-right ${pu.grossGain >= 0 ? "text-emerald-700" : "text-red-600"}`}>${fmt(pu.grossGain)}</td>
                <td className="py-1 text-right">{pu.discountEligible ? "50%" : "—"}</td>
                <td className={`py-1 text-right font-medium ${pu.discountedGain >= 0 ? "text-emerald-700" : "text-red-600"}`}>${fmt(pu.discountedGain)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Optimiser</h1>
      <p className="text-sm text-slate-600 mb-4">
        Preview how different parcel matching methods affect your taxable gain before recording a sale.
      </p>

      <form onSubmit={handlePreview} className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ticker</label>
            <select value={ticker} onChange={(e) => setTicker(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm">
              <option value="">Select...</option>
              {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Units to sell</label>
            <input type="number" step="any" value={units} onChange={(e) => setUnits(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Sale Price ($)</label>
            <input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Disposal Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Brokerage ($)</label>
            <input type="number" step="any" value={brokerage} onChange={(e) => setBrokerage(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="mt-4 flex gap-2 items-center">
          <button type="submit" className="bg-teal-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-teal-700">
            Compare Methods
          </button>
          {error && <span className="text-red-600 text-sm">{error}</span>}
        </div>
      </form>

      {result && (
        <div className="grid gap-4">
          <ResultCard r={result.optimised} highlight />
          <div className="grid md:grid-cols-2 gap-4">
            <ResultCard r={result.fifo} />
            <ResultCard r={result.lifo} />
          </div>
        </div>
      )}
    </div>
  )
}
