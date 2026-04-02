import { useState, useRef } from "react"
import { useAppState } from "../lib/AppContext"
import { createParcel, executeDisposal, parseTradesCSV } from "../lib/cgt"
import type { Parcel } from "../lib/types"

const fmt = (n: number) => n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function TradesPage() {
  const state = useAppState()
  const [filter, setFilter] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [formType, setFormType] = useState<"buy" | "sell">("buy")
  const [formTicker, setFormTicker] = useState("")
  const [formDate, setFormDate] = useState("")
  const [formUnits, setFormUnits] = useState("")
  const [formPrice, setFormPrice] = useState("")
  const [formBrokerage, setFormBrokerage] = useState("0")
  const [formMethod, setFormMethod] = useState<"fifo" | "lifo" | "optimised">("fifo")
  const [error, setError] = useState("")

  const tickers = [...new Set(state.parcels.map((p) => p.ticker))].sort()

  const displayed = state.parcels
    .filter((p) => !filter || p.ticker === filter)
    .sort((a, b) => a.date.localeCompare(b.date))

  const disposals = state.disposals
    .filter((d) => !filter || d.ticker === filter)
    .sort((a, b) => a.date.localeCompare(b.date))

  type Row = { kind: "buy"; data: Parcel } | { kind: "sell"; data: typeof disposals[0] }
  const rows: Row[] = [
    ...displayed.map((p) => ({ kind: "buy" as const, data: p })),
    ...disposals.map((d) => ({ kind: "sell" as const, data: d })),
  ].sort((a, b) => a.data.date.localeCompare(b.data.date))

  function resetForm() {
    setFormType("buy")
    setFormTicker("")
    setFormDate("")
    setFormUnits("")
    setFormPrice("")
    setFormBrokerage("0")
    setFormMethod("fifo")
    setEditId(null)
    setError("")
  }

  function openAdd() {
    resetForm()
    setShowForm(true)
  }

  function openEdit(p: Parcel) {
    setFormType("buy")
    setFormTicker(p.ticker)
    setFormDate(p.date)
    setFormUnits(String(p.units))
    setFormPrice(String(p.unitPrice))
    setFormBrokerage(String(p.brokerage))
    setEditId(p.id)
    setShowForm(true)
    setError("")
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    const ticker = formTicker.trim().toUpperCase()
    const units = parseFloat(formUnits)
    const price = parseFloat(formPrice)
    const brokerage = parseFloat(formBrokerage) || 0

    if (!ticker || !formDate || isNaN(units) || isNaN(price) || units <= 0 || price <= 0) {
      setError("Please fill in all fields with valid values.")
      return
    }

    if (formType === "buy") {
      if (editId) {
        const existing = state.parcels.find((p) => p.id === editId)!
        const updated: Parcel = {
          ...existing,
          ticker,
          date: formDate,
          units,
          unitPrice: price,
          brokerage,
          costBase: units * price + brokerage,
          unitsRemaining: existing.unitsRemaining + (units - existing.units),
        }
        state.updateParcel(updated)
      } else {
        state.addParcel(createParcel(ticker, formDate, units, price, brokerage))
      }
    } else {
      try {
        const { disposal, updatedParcels } = executeDisposal(
          state.parcels, ticker, formDate, units, price, brokerage, formMethod, state.entityType
        )
        state.addDisposal(disposal, updatedParcels)
      } catch (err) {
        setError((err as Error).message)
        return
      }
    }

    setShowForm(false)
    resetForm()
  }

  function handleCSVImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const trades = parseTradesCSV(reader.result as string)
        for (const t of trades) {
          if (t.type === "buy") {
            state.addParcel(createParcel(t.ticker, t.date, t.units, t.unitPrice, t.brokerage))
          } else {
            const { disposal, updatedParcels } = executeDisposal(
              state.parcels, t.ticker, t.date, t.units, t.unitPrice, t.brokerage, "fifo", state.entityType
            )
            state.addDisposal(disposal, updatedParcels)
          }
        }
      } catch (err) {
        setError((err as Error).message)
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Trades</h1>
        <div className="flex gap-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2 text-sm">
            <option value="">All tickers</option>
            {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={openAdd}
            className="bg-teal-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-teal-700">
            + Add Trade
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="bg-slate-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-slate-700">
            Import CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSVImport} />
        </div>
      </div>

      {showForm && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">{editId ? "Edit Trade" : "Add Trade"}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {!editId && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                <select value={formType} onChange={(e) => setFormType(e.target.value as "buy" | "sell")}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm">
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Ticker</label>
              <input value={formTicker} onChange={(e) => setFormTicker(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm" placeholder="VAS" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
              <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Units</label>
              <input type="number" step="any" value={formUnits} onChange={(e) => setFormUnits(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Unit Price ($)</label>
              <input type="number" step="any" value={formPrice} onChange={(e) => setFormPrice(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Brokerage ($)</label>
              <input type="number" step="any" value={formBrokerage} onChange={(e) => setFormBrokerage(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
            </div>
            {formType === "sell" && !editId && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Method</label>
                <select value={formMethod} onChange={(e) => setFormMethod(e.target.value as typeof formMethod)}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm">
                  <option value="fifo">FIFO</option>
                  <option value="lifo">LIFO</option>
                  <option value="optimised">Optimised</option>
                </select>
              </div>
            )}
            <div className="col-span-full flex gap-2">
              <button type="submit" className="bg-teal-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-teal-700">
                {editId ? "Update" : "Save"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                className="bg-slate-200 text-slate-700 px-5 py-2 rounded text-sm hover:bg-slate-300">
                Cancel
              </button>
            </div>
            {error && <p className="col-span-full text-red-600 text-sm">{error}</p>}
          </form>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
              <th className="px-4 py-3">Ticker</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">Units</th>
              <th className="px-4 py-3 text-right">Unit Price</th>
              <th className="px-4 py-3 text-right">Brokerage</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-right">Remaining</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  No trades yet. Add a trade or import a CSV.
                </td>
              </tr>
            )}
            {rows.map((row) =>
              row.kind === "buy" ? (
                <tr key={row.data.id} className="bg-emerald-50 hover:bg-emerald-100">
                  <td className="px-4 py-2.5 font-medium">{row.data.ticker}</td>
                  <td className="px-4 py-2.5">
                    <span className="bg-emerald-200 text-emerald-800 text-xs font-medium px-2 py-0.5 rounded">BUY</span>
                  </td>
                  <td className="px-4 py-2.5">{row.data.date}</td>
                  <td className="px-4 py-2.5 text-right">{row.data.units}</td>
                  <td className="px-4 py-2.5 text-right">${fmt(row.data.unitPrice)}</td>
                  <td className="px-4 py-2.5 text-right">${fmt(row.data.brokerage)}</td>
                  <td className="px-4 py-2.5 text-right font-medium">${fmt(row.data.costBase)}</td>
                  <td className="px-4 py-2.5 text-right">{row.data.unitsRemaining}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => openEdit(row.data)} className="text-slate-400 hover:text-teal-600 mr-2 text-xs">Edit</button>
                    <button onClick={() => state.deleteParcel(row.data.id)} className="text-slate-400 hover:text-red-600 text-xs">Delete</button>
                  </td>
                </tr>
              ) : (
                <tr key={row.data.id} className="bg-red-50 hover:bg-red-100">
                  <td className="px-4 py-2.5 font-medium">{row.data.ticker}</td>
                  <td className="px-4 py-2.5">
                    <span className="bg-red-200 text-red-800 text-xs font-medium px-2 py-0.5 rounded">SELL</span>
                  </td>
                  <td className="px-4 py-2.5">{row.data.date}</td>
                  <td className="px-4 py-2.5 text-right">{row.data.units}</td>
                  <td className="px-4 py-2.5 text-right">${fmt(row.data.unitPrice)}</td>
                  <td className="px-4 py-2.5 text-right">${fmt(row.data.brokerage)}</td>
                  <td className="px-4 py-2.5 text-right font-medium">${fmt(row.data.proceeds)}</td>
                  <td className="px-4 py-2.5 text-right">—</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => state.deleteDisposal(row.data.id)} className="text-slate-400 hover:text-red-600 text-xs">Delete</button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
