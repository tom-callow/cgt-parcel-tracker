import { useState } from "react"
import { v4 as uuidv4 } from "uuid"
import { useAppState } from "../lib/AppContext"
import { getFinancialYear } from "../lib/cgt"
import type { AmitAdjustment } from "../lib/types"
import { fmt, uniqueTickers } from "../lib/formatters"

const inputCls = "w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
const labelCls = "block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"

function signedDollars(n: number, decimals: number): string {
  const abs = decimals === 2 ? fmt(Math.abs(n)) : Math.abs(n).toFixed(decimals)
  return `${n < 0 ? "−" : "+"}$${abs}`
}

export function AmitPage() {
  const { amitAdjustments, addAmitAdjustment, updateAmitAdjustment, deleteAmitAdjustment, parcels, disposals } =
    useAppState()

  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formTicker, setFormTicker] = useState("")
  const [formYear, setFormYear] = useState("")
  const [formTotal, setFormTotal] = useState("")
  const [error, setError] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<AmitAdjustment | null>(null)

  const tickers = uniqueTickers(parcels)

  const sorted = [...amitAdjustments].sort(
    (a, b) => a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date)
  )
  const groups: { ticker: string; rows: AmitAdjustment[]; net: number }[] = []
  for (const a of sorted) {
    const last = groups[groups.length - 1]
    if (last?.ticker === a.ticker) {
      last.rows.push(a)
      last.net += a.totalAdjustment
    } else {
      groups.push({ ticker: a.ticker, rows: [a], net: a.totalAdjustment })
    }
  }

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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">AMIT Adjustments</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Cost base adjustments from Attribution Managed Investment Trusts (e.g. ETFs).
            Applied automatically to capital gains and unrealised gain calculations.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="bg-teal-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-teal-700 shrink-0"
        >
          + Add Adjustment
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5 mb-6 shadow-sm">
          <h2 className="text-lg font-semibold dark:text-slate-100 mb-4">{editId ? "Edit Adjustment" : "Add AMIT Adjustment"}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>Ticker</label>
              <input
                list="amit-tickers"
                value={formTicker}
                onChange={(e) => setFormTicker(e.target.value)}
                className={inputCls}
                placeholder="e.g. VAS"
              />
              <datalist id="amit-tickers">
                {tickers.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={labelCls}>Year</label>
              <input
                type="number"
                value={formYear}
                onChange={(e) => setFormYear(e.target.value)}
                className={inputCls}
                placeholder="e.g. 2024"
                min="1990"
                max="2100"
              />
              <p className="text-xs text-slate-400 mt-1">Adjustment applied as at 30 June.</p>
            </div>
            <div>
              <label className={labelCls}>Total Adjustment ($)</label>
              <input
                type="number"
                step="any"
                value={formTotal}
                onChange={(e) => setFormTotal(e.target.value)}
                className={inputCls}
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
                className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-5 py-2 rounded text-sm hover:bg-slate-300 dark:hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
            {error && <p className="col-span-full text-red-600 dark:text-red-400 text-sm">{error}</p>}
          </form>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-8 text-center text-slate-400 w-fit">
          No AMIT adjustments recorded yet.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto w-fit max-w-full">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="px-4 py-3">FY</th>
                <th className="px-4 py-3 text-right">Units at 30 June</th>
                <th className="px-4 py-3 text-right">Adjustment ($)</th>
                <th className="px-4 py-3 text-right">Per Unit ($)</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            {groups.map(({ ticker, rows, net }) => (
              <tbody key={ticker} className="divide-y divide-slate-100 dark:divide-slate-700 border-t border-slate-200 dark:border-slate-600">
                <tr className="bg-slate-50/60 dark:bg-slate-700/40">
                  <td colSpan={2} className="px-4 py-2 font-semibold text-slate-800 dark:text-slate-100">{ticker}</td>
                  <td className="px-4 py-2 text-right font-semibold text-slate-800 dark:text-slate-100">
                    <span className="text-xs font-normal text-slate-500 dark:text-slate-400 mr-2">Net</span>
                    {signedDollars(net, 2)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
                {rows.map((a) => {
                  const perUnit = a.unitsAtDate > 0 ? a.totalAdjustment / a.unitsAtDate : 0
                  return (
                    <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                      <td className="pl-8 pr-4 py-2.5 text-slate-600 dark:text-slate-300">{getFinancialYear(a.date)}</td>
                      <td className="px-4 py-2.5 text-right dark:text-slate-300">{fmt(a.unitsAtDate)}</td>
                      <td className="px-4 py-2.5 text-right font-medium dark:text-slate-200">{signedDollars(a.totalAdjustment, 2)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400 font-mono text-xs">
                        {signedDollars(perUnit, 6)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => openEdit(a)}
                          className="text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 text-xs font-medium px-1.5 py-1"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteTarget(a)}
                          className="text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 text-xs font-medium px-1.5 py-1 ml-2"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">Delete AMIT adjustment?</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-5">
              <span className="font-medium">{deleteTarget.ticker}</span> {getFinancialYear(deleteTarget.date)} adjustment of{" "}
              {signedDollars(deleteTarget.totalAdjustment, 2)}. Cost bases for this ticker will be recalculated without it.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  deleteAmitAdjustment(deleteTarget.id)
                  setDeleteTarget(null)
                }}
                className="px-4 py-2 rounded text-sm bg-red-600 text-white hover:bg-red-700 font-medium"
              >
                Delete adjustment
              </button>
            </div>
          </div>
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
