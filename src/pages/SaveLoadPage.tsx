import { useRef, useState } from "react"
import { useAppState } from "../lib/AppContext"
import type { AppData, EntityType } from "../lib/types"

export function SaveLoadPage() {
  const state = useAppState()
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState("")

  function handleExport() {
    const data = state.exportData()
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `cgt-tracker-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMessage("Data exported successfully.")
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as AppData
        if (!data.parcels || !data.disposals) {
          throw new Error("Invalid file format")
        }
        state.importData(data)
        const amitCount = data.amitAdjustments?.length ?? 0
        setMessage(`Imported ${data.parcels.length} parcels, ${data.disposals.length} disposals, and ${amitCount} AMIT adjustment${amitCount !== 1 ? "s" : ""}.`)
      } catch {
        setMessage("Error: Could not parse file. Ensure it's a valid CGT Tracker JSON export.")
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-6">Save / Load</h1>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Entity Type */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5">
          <h2 className="font-semibold text-slate-700 dark:text-slate-200 mb-3">Entity Type</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
            Affects CGT discount eligibility. Individuals and trusts get 50% discount after 12 months. Companies get no discount.
          </p>
          <select
            value={state.entityType}
            onChange={(e) => state.setEntityType(e.target.value as EntityType)}
            className="border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm w-full bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
          >
            <option value="individual">Individual</option>
            <option value="trust">Trust</option>
            <option value="company">Company</option>
          </select>
        </div>

        {/* Record counts */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5">
          <h2 className="font-semibold text-slate-700 dark:text-slate-200 mb-3">Current Data</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Parcels (buy events):</span>
              <span className="font-medium dark:text-slate-200">{state.parcels.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Disposals (sell events):</span>
              <span className="font-medium dark:text-slate-200">{state.disposals.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Tickers:</span>
              <span className="font-medium dark:text-slate-200">{[...new Set(state.parcels.map((p) => p.ticker))].length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">AMIT adjustments:</span>
              <span className="font-medium dark:text-slate-200">{state.amitAdjustments.length}</span>
            </div>
          </div>
        </div>

        {/* Export */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5">
          <h2 className="font-semibold text-slate-700 dark:text-slate-200 mb-3">Export Data</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
            Download all data as a JSON file. This is your backup — keep it safe.
          </p>
          <button
            onClick={handleExport}
            className="bg-teal-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-teal-700"
          >
            Download JSON
          </button>
        </div>

        {/* Import */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5">
          <h2 className="font-semibold text-slate-700 dark:text-slate-200 mb-3">Import Data</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
            Load a previously exported JSON file. This will replace all current data.
          </p>
          <button
            onClick={() => fileRef.current?.click()}
            className="bg-slate-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-slate-700"
          >
            Load JSON File
          </button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
        </div>
      </div>

      {message && (
        <div className="mt-4 bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-300 rounded px-4 py-3 text-sm">
          {message}
        </div>
      )}
    </div>
  )
}
