import { useState, useRef } from "react"
import { useAppState } from "../lib/AppContext"
import { createParcel, executeDisposal, parseTradesCSV, fmtDate } from "../lib/cgt"
import type { Parcel, Disposal } from "../lib/types"

const fmt = (n: number) => {
  const num = Number(n)
  return isFinite(num)
    ? num.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—"
}

export function TradesPage() {
  const state = useAppState()
  const [filter, setFilter] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const unitsRef = useRef<HTMLInputElement>(null)

  const [formType, setFormType] = useState<"buy" | "sell">("buy")
  const [formTicker, setFormTicker] = useState("")
  const [formDate, setFormDate] = useState("")
  const [formUnits, setFormUnits] = useState("")
  const [formPrice, setFormPrice] = useState("")
  const [priceMode, setPriceMode] = useState<"total" | "unit">("total")
  const [formBrokerage, setFormBrokerage] = useState("0")
  const [formMethod, setFormMethod] = useState<"fifo" | "lifo" | "optimised">("fifo")
  const [error, setError] = useState("")
  const [showCSV, setShowCSV] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ parcel: Parcel; affectedDisposals: Disposal[] } | null>(null)
  const [csvError, setCSVError] = useState("")
  const [csvSuccess, setCSVSuccess] = useState("")
  const [csvMethod, setCSVMethod] = useState<"fifo" | "lifo" | "optimised">("optimised")

  type TradeResult =
    | { status: "ok";    type: "buy";  ticker: string; date: string; units: number; unitPrice: number; brokerage: number; amount: number }
    | { status: "ok";    type: "sell"; ticker: string; date: string; units: number; unitPrice: number; brokerage: number; proceeds: number; disposal: Disposal }
    | { status: "error"; type: "buy" | "sell"; ticker: string; date: string; units: number; unitPrice: number; brokerage: number; error: string }
  type CSVPreview = { results: TradeResult[]; finalParcels: Parcel[]; newDisposals: Disposal[] }
  const [csvPreview, setCSVPreview] = useState<CSVPreview | null>(null)

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
    setPriceMode("total")
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
    const rawPrice = parseFloat(formPrice)
    const price = priceMode === "total" ? rawPrice / units : rawPrice
    const brokerage = priceMode === "total" ? 0 : (parseFloat(formBrokerage) || 0)

    if (!ticker || !formDate || isNaN(units) || isNaN(rawPrice) || units <= 0 || rawPrice <= 0) {
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
          .sort((a, b) => a.date.localeCompare(b.date) || (a.type === "buy" ? -1 : 1))

        // Simulate all trades in order, threading workingParcels through each step
        // so sells always see the up-to-date parcel state (fixes stale-state bug).
        let workingParcels = [...state.parcels]
        const newDisposals: Disposal[] = []
        const results: TradeResult[] = []

        for (const t of trades) {
          if (t.type === "buy") {
            const parcel = createParcel(t.ticker, t.date, t.units, t.unitPrice, t.brokerage)
            workingParcels = [...workingParcels, parcel]
            results.push({ status: "ok", type: "buy", ticker: t.ticker, date: t.date, units: t.units, unitPrice: t.unitPrice, brokerage: t.brokerage, amount: parcel.costBase })
          } else {
            try {
              const { disposal, updatedParcels } = executeDisposal(
                workingParcels, t.ticker, t.date, t.units, t.unitPrice, t.brokerage, csvMethod, state.entityType
              )
              workingParcels = updatedParcels
              newDisposals.push(disposal)
              results.push({ status: "ok", type: "sell", ticker: t.ticker, date: t.date, units: t.units, unitPrice: t.unitPrice, brokerage: t.brokerage, proceeds: disposal.proceeds, disposal })
            } catch (err) {
              results.push({ status: "error", type: "sell", ticker: t.ticker, date: t.date, units: t.units, unitPrice: t.unitPrice, brokerage: t.brokerage, error: (err as Error).message })
            }
          }
        }

        setCSVPreview({ results, finalParcels: workingParcels, newDisposals })
        setCSVError("")
        setCSVSuccess("")
      } catch (err) {
        setCSVError((err as Error).message)
        setCSVSuccess("")
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  function handleConfirmImport() {
    if (!csvPreview) return
    const hasErrors = csvPreview.results.some((r) => r.status === "error")
    if (hasErrors) return
    state.applyCSVImport(csvPreview.finalParcels, csvPreview.newDisposals)
    const count = csvPreview.results.length
    setCSVSuccess(`Successfully imported ${count} trade${count !== 1 ? "s" : ""}.`)
    setCSVPreview(null)
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Trades</h1>
        <div className="flex gap-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100">
            <option value="">All tickers</option>
            {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={openAdd}
            className="bg-teal-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-teal-700">
            + Add Trade
          </button>
          <button onClick={() => { setShowCSV(true); setShowForm(false); setCSVError(""); setCSVSuccess("") }}
            className="bg-slate-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-slate-700">
            Import CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSVImport} />
        </div>
      </div>

      {showCSV && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6 mb-6 shadow-sm w-full">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold dark:text-slate-100">Import CSV</h2>
            <button onClick={() => { setShowCSV(false); setCSVPreview(null); setCSVError(""); setCSVSuccess("") }} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm">✕ Close</button>
          </div>

          {!csvPreview ? (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                Your CSV file must include the following columns. The header row is required.
                Rows are sorted by date before processing.
              </p>
              <div className="flex items-center gap-3 mb-4">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">Sell matching method</label>
                <select
                  value={csvMethod}
                  onChange={(e) => setCSVMethod(e.target.value as typeof csvMethod)}
                  className="border border-slate-300 dark:border-slate-600 rounded px-3 py-1.5 text-sm bg-white dark:bg-slate-700 dark:text-slate-100"
                >
                  <option value="optimised">Optimised (minimise taxable gain)</option>
                  <option value="fifo">FIFO</option>
                  <option value="lifo">LIFO</option>
                </select>
              </div>

              <div className="bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded p-4 mb-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Required columns</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-600">
                      <th className="pb-2 pr-6">Column</th>
                      <th className="pb-2 pr-6">Format</th>
                      <th className="pb-2">Example</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-600">
                    {[
                      ["date", "DD/MM/YYYY or YYYY-MM-DD", "16/07/2024"],
                      ["ticker", "ASX code", "VAS"],
                      ["type", "buy or sell", "buy"],
                      ["units", "Decimal", "100.00"],
                      ["unit price", "Decimal", "105.40"],
                      ["brokerage", "Decimal (optional, defaults to 0)", "0"],
                    ].map(([col, fmtStr, ex]) => (
                      <tr key={col}>
                        <td className="py-1.5 pr-6 font-mono text-slate-800 dark:text-slate-200">{col}</td>
                        <td className="py-1.5 pr-6 text-slate-500 dark:text-slate-400">{fmtStr}</td>
                        <td className="py-1.5 text-slate-500 dark:text-slate-400">{ex}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded p-4 mb-5">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Example file</p>
                <pre className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{`date,ticker,type,units,unit price,brokerage
2024-01-15,VAS,buy,100,105.40,0
2024-03-20,VGS,buy,50,130.00,0
2024-09-01,VAS,sell,30,112.00,0`}</pre>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="bg-teal-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-teal-700"
                >
                  Choose CSV File
                </button>
                <button
                  onClick={() => {
                    const template = "date,ticker,type,units,unit price,brokerage\n2024-01-15,VAS,buy,100,105.40,0\n2024-03-20,VGS,buy,50,130.00,0\n2024-09-01,VAS,sell,30,112.00,0"
                    const blob = new Blob([template], { type: "text/csv" })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement("a")
                    a.href = url
                    a.download = "trades-template.csv"
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-5 py-2 rounded text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-600 border border-slate-300 dark:border-slate-500"
                >
                  Download Template
                </button>
                {csvSuccess && <span className="text-emerald-600 text-sm font-medium">{csvSuccess}</span>}
                {csvError && <span className="text-red-600 text-sm">{csvError}</span>}
              </div>
            </>
          ) : (
            <>
              {(() => {
                const hasErrors = csvPreview.results.some((r) => r.status === "error")
                const buys = csvPreview.results.filter((r) => r.type === "buy").length
                const sells = csvPreview.results.filter((r) => r.type === "sell").length
                return (
                  <>
                    <div className="flex items-center gap-3 mb-4">
                      <span className="text-sm text-slate-600 dark:text-slate-400">
                        {csvPreview.results.length} trade{csvPreview.results.length !== 1 ? "s" : ""} parsed —{" "}
                        <span className="text-emerald-700 font-medium">{buys} buy{buys !== 1 ? "s" : ""}</span>,{" "}
                        <span className="text-red-600 font-medium">{sells} sell{sells !== 1 ? "s" : ""}</span>
                      </span>
                      {hasErrors && (
                        <span className="text-xs bg-red-100 text-red-700 font-medium px-2 py-0.5 rounded">
                          Fix errors before importing
                        </span>
                      )}
                    </div>

                    <div className="border border-slate-200 dark:border-slate-600 rounded overflow-hidden mb-5">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-700 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2">Ticker</th>
                            <th className="px-3 py-2">Type</th>
                            <th className="px-3 py-2 text-right">Units</th>
                            <th className="px-3 py-2 text-right">Unit Price</th>
                            <th className="px-3 py-2 text-right">Brokerage</th>
                            <th className="px-3 py-2 text-right">Amount</th>
                            <th className="px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                          {csvPreview.results.map((r, i) => (
                            <tr key={i} className={
                              r.status === "error"
                                ? "bg-red-50 dark:bg-red-900/20"
                                : r.type === "buy"
                                  ? "bg-emerald-50 dark:bg-emerald-900/20"
                                  : "bg-red-50/40 dark:bg-red-900/10"
                            }>
                              <td className="px-3 py-2 dark:text-slate-300">{fmtDate(r.date)}</td>
                              <td className="px-3 py-2 font-medium dark:text-slate-200">{r.ticker}</td>
                              <td className="px-3 py-2">
                                {r.type === "buy"
                                  ? <span className="bg-emerald-200 text-emerald-800 text-xs font-medium px-2 py-0.5 rounded">BUY</span>
                                  : <span className="bg-red-200 text-red-800 text-xs font-medium px-2 py-0.5 rounded">SELL</span>}
                              </td>
                              <td className="px-3 py-2 text-right dark:text-slate-300">{fmt(r.units)}</td>
                              <td className="px-3 py-2 text-right dark:text-slate-300">${fmt(r.unitPrice)}</td>
                              <td className="px-3 py-2 text-right dark:text-slate-300">${fmt(r.brokerage)}</td>
                              <td className="px-3 py-2 text-right font-medium dark:text-slate-200">
                                {r.status === "ok"
                                  ? `$${fmt(r.type === "buy" ? r.amount : r.proceeds)}`
                                  : <span className="text-slate-400">—</span>}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {r.status === "error"
                                  ? <span className="text-red-600 text-xs">{r.error}</span>
                                  : <span className="text-emerald-600 text-xs">✓</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleConfirmImport}
                        disabled={hasErrors}
                        className="bg-teal-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Confirm Import
                      </button>
                      <button
                        onClick={() => { setCSVPreview(null); setCSVError(""); setCSVSuccess("") }}
                        className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-5 py-2 rounded text-sm hover:bg-slate-300 dark:hover:bg-slate-600"
                      >
                        Back
                      </button>
                    </div>
                  </>
                )
              })()}
            </>
          )}
        </div>
      )}

      {showForm && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5 mb-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4 dark:text-slate-100">{editId ? "Edit Trade" : "Add Trade"}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {!editId && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Type</label>
                <select value={formType} onChange={(e) => setFormType(e.target.value as "buy" | "sell")}
                  className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100">
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Ticker</label>
              <input value={formTicker} onChange={(e) => setFormTicker(e.target.value)}
                className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100" placeholder="VAS" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Date</label>
              <input
                type="date"
                value={formDate}
                min="1900-01-01"
                onChange={(e) => {
                  const val = e.target.value
                  if (val && val.split("-")[0].length > 4) return
                  setFormDate(val)
                }}
                onKeyDown={(e) => { if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); unitsRef.current?.focus() } }}
                className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Units</label>
              <input type="number" step="any" value={formUnits} onChange={(e) => setFormUnits(e.target.value)}
                ref={unitsRef}
                className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1 min-w-0">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate">
                  {priceMode === "total" ? "Total Consideration ($)" : "Unit Price ($)"}
                </label>
                <div className="flex rounded overflow-hidden border border-slate-300 dark:border-slate-600 text-xs font-medium">
                  <button type="button" onClick={() => setPriceMode("total")}
                    className={`px-2 py-0.5 ${priceMode === "total" ? "bg-teal-600 text-white" : "bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-600"}`}>
                    Total
                  </button>
                  <button type="button" onClick={() => setPriceMode("unit")}
                    className={`px-2 py-0.5 ${priceMode === "unit" ? "bg-teal-600 text-white" : "bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-600"}`}>
                    Unit
                  </button>
                </div>
              </div>
              <input type="number" step="any" value={formPrice} onChange={(e) => setFormPrice(e.target.value)}
                placeholder={priceMode === "total" ? "e.g. 5000.00" : "e.g. 50.00"}
                className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100" />
            </div>
            <div className={priceMode === "total" ? "invisible" : ""}>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Brokerage ($)</label>
              <input type="number" step="any" value={priceMode === "total" ? "0" : formBrokerage}
                onChange={(e) => setFormBrokerage(e.target.value)}
                tabIndex={priceMode === "total" ? -1 : 0}
                className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100" />
            </div>
            {formType === "sell" && !editId && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Method</label>
                <select value={formMethod} onChange={(e) => setFormMethod(e.target.value as typeof formMethod)}
                  className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100">
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
                className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-5 py-2 rounded text-sm hover:bg-slate-300 dark:hover:bg-slate-600">
                Cancel
              </button>
            </div>
            {error && <p className="col-span-full text-red-600 text-sm">{error}</p>}
          </form>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-700 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
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
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  No trades yet. Add a trade or import a CSV.
                </td>
              </tr>
            )}
            {rows.map((row) =>
              row.kind === "buy" ? (
                <tr key={row.data.id} className="bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 dark:text-slate-300">
                  <td className="px-4 py-2.5 font-medium dark:text-slate-100">{row.data.ticker}</td>
                  <td className="px-4 py-2.5">
                    <span className="bg-emerald-200 text-emerald-800 text-xs font-medium px-2 py-0.5 rounded">BUY</span>
                  </td>
                  <td className="px-4 py-2.5">{fmtDate(row.data.date)}</td>
                  <td className="px-4 py-2.5 text-right">{fmt(row.data.units)}</td>
                  <td className="px-4 py-2.5 text-right">${fmt(row.data.unitPrice)}</td>
                  <td className="px-4 py-2.5 text-right">${fmt(row.data.brokerage)}</td>
                  <td className="px-4 py-2.5 text-right font-medium">${fmt(row.data.costBase)}</td>
                  <td className="px-4 py-2.5 text-right">{fmt(row.data.unitsRemaining)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => openEdit(row.data)} className="text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 mr-2 text-xs">Edit</button>
                    <button onClick={() => {
                      const affected = state.disposals.filter((d) => d.parcelsUsed.some((u) => u.parcelId === row.data.id))
                      if (affected.length > 0) {
                        setDeleteTarget({ parcel: row.data, affectedDisposals: affected })
                      } else {
                        state.deleteParcel(row.data.id)
                      }
                    }} className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 text-xs">Delete</button>
                  </td>
                </tr>
              ) : (
                <tr key={row.data.id} className="bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 dark:text-slate-300">
                  <td className="px-4 py-2.5 font-medium dark:text-slate-100">{row.data.ticker}</td>
                  <td className="px-4 py-2.5">
                    <span className="bg-red-200 text-red-800 text-xs font-medium px-2 py-0.5 rounded">SELL</span>
                  </td>
                  <td className="px-4 py-2.5">{fmtDate(row.data.date)}</td>
                  <td className="px-4 py-2.5 text-right">{fmt(row.data.units)}</td>
                  <td className="px-4 py-2.5 text-right">${fmt(row.data.unitPrice)}</td>
                  <td className="px-4 py-2.5 text-right">${fmt(row.data.brokerage)}</td>
                  <td className="px-4 py-2.5 text-right font-medium">${fmt(row.data.proceeds)}</td>
                  <td className="px-4 py-2.5 text-right">—</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => state.deleteDisposal(row.data.id)} className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 text-xs">Delete</button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">Delete buy parcel?</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              <span className="font-medium">{deleteTarget.parcel.ticker}</span> acquired{" "}
              {fmtDate(deleteTarget.parcel.date)} ({fmt(deleteTarget.parcel.units)} units) was used
              in {deleteTarget.affectedDisposals.length} sell trade{deleteTarget.affectedDisposals.length !== 1 ? "s" : ""}.
              Deleting it will also remove those sell records.
            </p>
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 mb-5">
              <p className="text-xs font-medium text-red-700 dark:text-red-400 uppercase tracking-wider mb-2">Sell trades that will be removed</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-red-600 dark:text-red-400 border-b border-red-200 dark:border-red-800">
                    <th className="pb-1">Date</th>
                    <th className="pb-1">Units</th>
                    <th className="pb-1 text-right">Proceeds</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-100 dark:divide-red-900/30">
                  {deleteTarget.affectedDisposals.map((d) => (
                    <tr key={d.id} className="dark:text-slate-300">
                      <td className="py-1">{fmtDate(d.date)}</td>
                      <td className="py-1">{fmt(d.units)}</td>
                      <td className="py-1 text-right">${fmt(d.proceeds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  state.deleteParcelCascade(deleteTarget.parcel.id)
                  setDeleteTarget(null)
                }}
                className="px-4 py-2 rounded text-sm bg-red-600 text-white hover:bg-red-700 font-medium"
              >
                Delete parcel and {deleteTarget.affectedDisposals.length} sell trade{deleteTarget.affectedDisposals.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
