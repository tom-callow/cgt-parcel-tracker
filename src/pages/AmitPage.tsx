import { useState } from "react"
import { v4 as uuidv4 } from "uuid"
import { useAppState } from "../lib/AppContext"
import { getFinancialYear } from "../lib/cgt"
import type { AmitAdjustment } from "../lib/types"

const fmt = (n: number) =>
  n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function AmitPage() {
  const { amitAdjustments, addAmitAdjustment, updateAmitAdjustment, deleteAmitAdjustment, parcels, disposals } =
    useAppState()

  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formTicker, setFormTicker] = useState("")
  const [formYear, setFormYear] = useState("")
  const [formTotal, setFormTotal] = useState("")
  const [error, setError] = useState("")

  const tickers = [...new Set(parcels.map((p) => p.ticker))].sort()

  const sorted = [...amitAdjustments].sort(
    (a, b) => a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date)
  )

  /** Units of a ticker held on a given date, derived from parcel + disposal records. */
  function computeUnitsAtDate(ticker: string, date: string): number {
    const acquired = parcels
      .filter((p) => p.ticker === ticker && p.date <= date)
      .reduce((s, p) => s + p.units, 0)
    const sold = disposals
      .filter((d) => d.ticker === ticker && d.date <= date)
      .reduce((s, d) => s + d.units, 0)
    return acquired - sold
  }

  function resetForm() {
    setEditId(null)
    setFormTicker("")
    setFormYear("")
    setFormTotal("")
    setError("")
  }

  function openAdd() {
    resetForm()
    setShowForm(true)
  }

  function openEdit(a: AmitAdjustment) {
    setEditId(a.id)
    setFormTicker(a.ticker)
    setFormYear(a.date.slice(0, 4))
    setFormTotal(String(a.totalAdjustment))
    setError("")
    setShowForm(true)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    const ticker = formTicker.trim().toUpperCase()
    const year = parseInt(formYear, 10)
    const total = parseFloat(formTotal)

    if (!ticker || isNaN(year) || year < 1990 || year > 2100 || isNaN(total)) {
      setError("Please fill in all fields with valid values.")
      return
    }

    const date = `${year}-06-30`
    const unitsAtDate = computeUnitsAtDate(ticker, date)

    if (unitsAtDate <= 0) {
      setError(`No units of ${ticker} found on 30 June ${year}. Check ticker and year are correct.`)
      return
    }

    if (editId) {
      updateAmitAdjustment({ id: editId, ticker, date, totalAdjustment: total, unitsAtDate })
    } else {
      addAmitAdjustment({ id: uuidv4(), ticker, date, totalAdjustment: total, unitsAtDate })
    }

    setShowForm(false)
    resetForm()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">AMIT Adjustments</h1>
          <p className="text-sm text-slate-500 mt-1">
            Cost base adjustments from Attribution Managed Investment Trusts (e.g. ETFs).
            Applied automatically to capital gains and unrealised gain calculations.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="bg-teal-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-teal-700 shrink-0 ml-8"
        >
          + Add Adjustment
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">{editId ? "Edit Adjustment" : "Add AMIT Adjustment"}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Ticker</label>
              <input
                list="amit-tickers"
                value={formTicker}
                onChange={(e) => setFormTicker(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                placeholder="e.g. VAS"
              />
              <datalist id="amit-tickers">
                {tickers.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Year</label>
              <input
                type="number"
                value={formYear}
                onChange={(e) => setFormYear(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                placeholder="e.g. 2024"
                min="1990"
                max="2100"
              />
              <p className="text-xs text-slate-400 mt-1">Adjustment applied as at 30 June.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Total Adjustment ($)
              </label>
              <input
                type="number"
                step="any"
                value={formTotal}
                onChange={(e) => setFormTotal(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                placeholder="e.g. 420.00 or -85.50"
              />
              <p className="text-xs text-slate-400 mt-1">
                Positive = cost base increase. Negative = decrease.
              </p>
            </div>
            <div className="col-span-full flex gap-2">
              <button
                type="submit"
                className="bg-teal-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-teal-700"
              >
                {editId ? "Update" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm() }}
                className="bg-slate-200 text-slate-700 px-5 py-2 rounded text-sm hover:bg-slate-300"
              >
                Cancel
              </button>
            </div>
            {error && <p className="col-span-full text-red-600 text-sm">{error}</p>}
          </form>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400">
          No AMIT adjustments recorded yet.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3">FY</th>
                <th className="px-4 py-3 text-right">Units at Date</th>
                <th className="px-4 py-3 text-right">Total Adjustment ($)</th>
                <th className="px-4 py-3 text-right">Per Unit ($)</th>
                <th className="px-4 py-3 text-right">Direction</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((a) => {
                const perUnit = a.unitsAtDate > 0 ? a.totalAdjustment / a.unitsAtDate : 0
                return (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium">{a.ticker}</td>
                    <td className="px-4 py-2.5 text-slate-500">{getFinancialYear(a.date)}</td>
                    <td className="px-4 py-2.5 text-right">{fmt(a.unitsAtDate)}</td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {a.totalAdjustment >= 0 ? "" : "−"}${fmt(Math.abs(a.totalAdjustment))}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500 font-mono text-xs">
                      {perUnit >= 0 ? "+" : "−"}${Math.abs(perUnit).toFixed(6)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {a.totalAdjustment >= 0 ? (
                        <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                          Cost base ↑
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded">
                          Cost base ↓
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => openEdit(a)}
                        className="text-slate-400 hover:text-teal-600 text-xs mr-2"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteAmitAdjustment(a.id)}
                        className="text-slate-400 hover:text-red-600 text-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400 mt-4">
        AMIT adjustments are sourced from your fund's Annual Tax Statement (AMAS). Enter the total cost
        base adjustment amount. Adjustments apply to parcels of that ticker acquired on or before 30 June
        of the selected year and disposed of after that date.
      </p>
    </div>
  )
}
