import { useState, useEffect, useCallback } from "react"
import * as XLSX from "xlsx-js-style"
import { useAppState } from "../lib/AppContext"
import { fmtDate, isDiscountEligible, calcAmitAdjPerUnit } from "../lib/cgt"

const fmt = (n: number) => n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function fetchPrice(ticker: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.AX?interval=1d&range=1d`
    const res = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(url)}`)
    if (!res.ok) return null
    const json = await res.json()
    return json?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null
  } catch {
    return null
  }
}

type GainsRow = {
  id: string
  ticker: string
  acquisitionDate: string
  units: number
  rawCostPerUnit: number
  amitAdjPerUnit: number
  rawCostBase: number
  adjCostBase: number
  marketPrice: number | null
  currentValue: number | null
  unrealisedGain: number | null
  discountEligible: boolean
  effectiveGain: number | null
}

function exportToExcel(rows: GainsRow[], entityType: string) {
  const wb = XLSX.utils.book_new()

  // ── Sheet 1: Unrealised Gains ──────────────────────────────────────────────
  const MAIN_SHEET = "Unrealised Gains"
  const dataStart = 2          // first data row (1-indexed Excel)
  const dataEnd = dataStart + rows.length - 1
  const totalRow = dataEnd + 1 // totals row (1-indexed Excel)

  const ws1: XLSX.WorkSheet = {}

  const cell = (r: number, c: number, obj: XLSX.CellObject) => {
    ws1[XLSX.utils.encode_cell({ r, c })] = obj
  }
  const bold = { font: { bold: true } }
  const sv  = (v: string, s?: object): XLSX.CellObject => ({ t: "s", v, ...(s ? { s } : {}) })
  const nv  = (v: number, z = "#,##0.00", s?: object): XLSX.CellObject => ({ t: "n", v, z, ...(s ? { s } : {}) })
  const fml = (f: string, z = "#,##0.00", s?: object): XLSX.CellObject => ({ t: "n", f, z, ...(s ? { s } : {}) })

  // Headers (row index 0 = Excel row 1)
  const headers = [
    "Ticker", "Acquired", "Units", "Cost/Unit", "AMIT Adj/Unit",
    "Cost Base", "Adj Cost Base", "Market Price", "Current Value",
    "Unrealised Gain", "Discount Eligible", "Effective Gain",
  ]
  headers.forEach((h, c) => cell(0, c, sv(h)))

  // Data rows
  rows.forEach((row, idx) => {
    const r = idx + 1          // 0-indexed sheet row
    const er = r + 1           // 1-indexed Excel row number

    cell(r, 0,  sv(row.ticker))
    cell(r, 1,  sv(row.acquisitionDate))
    cell(r, 2,  nv(row.units, "#,##0.00"))
    cell(r, 3,  nv(row.rawCostPerUnit, "#,##0.00"))
    cell(r, 4,  nv(row.amitAdjPerUnit, "#,##0.000000"))
    // F: Cost Base = Units × Cost/Unit
    cell(r, 5,  fml(`C${er}*D${er}`))
    // G: Adj Cost Base = Units × (Cost/Unit + AMIT Adj/Unit)
    cell(r, 6,  fml(`C${er}*(D${er}+E${er})`))
    // H: Market Price (raw value; blank string if unavailable)
    if (row.marketPrice != null) {
      cell(r, 7, nv(row.marketPrice, "#,##0.00"))
    } else {
      cell(r, 7, sv(""))
    }
    // I: Current Value = Units × Market Price (blank if no price)
    cell(r, 8,  fml(`IF(H${er}="","",C${er}*H${er})`))
    // J: Unrealised Gain = Current Value − Adj Cost Base (blank if no price)
    cell(r, 9,  fml(`IF(I${er}="","",I${er}-G${er})`))
    // K: Discount Eligible
    cell(r, 10, sv(row.discountEligible ? "Yes (50%)" : "No"))
    // L: Effective Gain — applies 50% discount to eligible gains
    cell(r, 11, fml(`IF(J${er}="","",IF(K${er}="Yes (50%)",IF(J${er}>0,J${er}*0.5,J${er}),J${er}))`))
  })

  // Totals row (0-indexed = totalRow - 1)
  const tr = totalRow - 1
  cell(tr, 0,  sv("TOTAL", bold))
  cell(tr, 5,  fml(`SUM(F${dataStart}:F${dataEnd})`, "#,##0.00", bold))
  cell(tr, 6,  fml(`SUM(G${dataStart}:G${dataEnd})`, "#,##0.00", bold))
  // Only show totals for price-dependent columns if all rows have prices
  cell(tr, 8,  fml(`IF(COUNTBLANK(I${dataStart}:I${dataEnd})=0,SUM(I${dataStart}:I${dataEnd}),"N/A")`, "#,##0.00", bold))
  cell(tr, 9,  fml(`IF(COUNTBLANK(J${dataStart}:J${dataEnd})=0,SUM(J${dataStart}:J${dataEnd}),"N/A")`, "#,##0.00", bold))
  cell(tr, 11, fml(`IF(COUNTBLANK(L${dataStart}:L${dataEnd})=0,SUM(L${dataStart}:L${dataEnd}),"N/A")`, "#,##0.00", bold))

  ws1["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: tr, c: 11 } })
  ws1["!cols"] = [
    { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 16 },
    { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
    { wch: 18 }, { wch: 14 },
  ]
  XLSX.utils.book_append_sheet(wb, ws1, MAIN_SHEET)

  // ── Sheet 2: CGT Summary ──────────────────────────────────────────────────
  const ws2: XLSX.WorkSheet = {}
  let r2 = 0  // 0-indexed row cursor for ws2

  const cell2 = (c: number, obj: XLSX.CellObject) => {
    ws2[XLSX.utils.encode_cell({ r: r2, c })] = obj
  }
  // Returns the 1-indexed Excel row for the *current* r2
  const er2 = () => r2 + 1

  const gainRange  = `'${MAIN_SHEET}'!J${dataStart}:J${dataEnd}`
  const discRange  = `'${MAIN_SHEET}'!K${dataStart}:K${dataEnd}`

  // Title
  cell2(0, sv("Unrealised CGT Summary"))
  cell2(1, sv(`Exported: ${new Date().toLocaleDateString("en-AU")}`))
  r2++

  r2++ // blank

  // INPUTS header
  cell2(0, sv("INPUTS"))
  r2++

  // Losses
  const lossesRow = er2()
  cell2(0, sv("Unrealised losses"))
  cell2(1, fml(`SUMIF(${gainRange},"<0",${gainRange})`))
  r2++

  // Short-term gains
  const shortTermRow = er2()
  cell2(0, sv(`Short-term gains — held ≤12 months${entityType !== "company" ? ", no discount" : ""}`))
  cell2(1, fml(`SUMIFS(${gainRange},${gainRange},">0",${discRange},"No")`))
  r2++

  // Long-term gains (non-company only)
  let longTermRow: number | null = null
  if (entityType !== "company") {
    longTermRow = er2()
    cell2(0, sv("Long-term gains, gross — held >12 months, discount eligible"))
    cell2(1, fml(`SUMIFS(${gainRange},${gainRange},">0",${discRange},"Yes (50%)")`))
    r2++
  }

  r2++ // blank

  // AFTER LOSS OFFSET header
  cell2(0, sv("AFTER LOSS OFFSET — losses applied to short-term gains first, then long-term"))
  r2++

  // Net short-term gain
  const netShortRow = er2()
  cell2(0, sv("Net short-term gain"))
  cell2(1, fml(`MAX(0,B${lossesRow}+B${shortTermRow})`))
  r2++

  let netLongTaxableRow: number | null = null
  if (entityType !== "company") {
    // Net long-term gain, gross
    const netLongGrossRow = er2()
    cell2(0, sv("Net long-term gain, gross"))
    cell2(1, fml(`B${longTermRow}+MIN(0,B${lossesRow}+B${shortTermRow})`))
    r2++

    // Less: 50% CGT discount
    const discountRow = er2()
    cell2(0, sv("Less: 50% CGT discount"))
    cell2(1, fml(`IF(B${netLongGrossRow}>0,B${netLongGrossRow}*0.5,0)`))
    r2++

    // Net long-term taxable
    netLongTaxableRow = er2()
    cell2(0, sv("Net long-term taxable"))
    cell2(1, fml(`B${netLongGrossRow}-B${discountRow}`))
    r2++
  }

  r2++ // blank

  // NET TAXABLE GAIN
  cell2(0, sv("NET TAXABLE GAIN"))
  if (entityType !== "company") {
    cell2(1, fml(`B${netShortRow}+B${netLongTaxableRow}`))
  } else {
    // For companies: no discount — net all gains and losses
    cell2(1, fml(`B${lossesRow}+B${shortTermRow}`))
  }
  r2++

  ws2["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r2 - 1, c: 1 } })
  ws2["!cols"] = [{ wch: 65 }, { wch: 18 }]
  XLSX.utils.book_append_sheet(wb, ws2, "CGT Summary")

  // ── Download ──────────────────────────────────────────────────────────────
  const date = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `unrealised-gains-${date}.xlsx`)
}

type SortCol = "ticker" | "acquired" | "units" | "costPerUnit" | "costBase" | "adjCostBase" | "marketPrice" | "currentValue" | "unrealisedGain" | "discount" | "effectiveGain"

export function UnrealisedGainsPage() {
  const { parcels, entityType, amitAdjustments } = useAppState()
  const [prices, setPrices] = useState<Record<string, number | null>>({})
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [sortCol, setSortCol] = useState<SortCol>("ticker")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  function handleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => d === "asc" ? "desc" : "asc")
    } else {
      setSortCol(col)
      setSortDir(["ticker", "acquired", "discount"].includes(col) ? "asc" : "desc")
    }
  }

  function SortHeader({ col, label, right }: { col: SortCol; label: string; right?: boolean }) {
    const active = sortCol === col
    return (
      <th
        className={`px-3 py-3 cursor-pointer select-none group hover:text-slate-700 dark:hover:text-slate-200`}
        onClick={() => handleSort(col)}
      >
        <div className={`flex items-center gap-1 ${right ? "justify-end" : "justify-start"}`}>
          <span>{label}</span>
          <span className={active ? "text-teal-500" : "opacity-0 group-hover:opacity-30"}>
            {active ? (sortDir === "asc" ? "▲" : "▼") : "▲"}
          </span>
        </div>
      </th>
    )
  }

  const today = new Date().toISOString().slice(0, 10)

  const activeParcels = parcels.filter((p) => p.unitsRemaining > 0)
  const tickers = [...new Set(activeParcels.map((p) => p.ticker))]

  const refreshPrices = useCallback(async () => {
    if (tickers.length === 0) return
    setLoading(true)
    const results = await Promise.all(
      tickers.map(async (t) => [t, await fetchPrice(t)] as [string, number | null])
    )
    setPrices(Object.fromEntries(results))
    setLastUpdated(new Date())
    setLoading(false)
  }, [tickers.join(",")])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refreshPrices()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Build per-parcel rows
  const rows: GainsRow[] = activeParcels
    .map((p) => {
      const marketPrice = prices[p.ticker]
      const rawCostPerUnit = p.costBase / p.units
      const amitAdjPerUnit = calcAmitAdjPerUnit(p.ticker, p.date, today, amitAdjustments)
      const adjCostPerUnit = rawCostPerUnit + amitAdjPerUnit
      const rawCostBase = p.unitsRemaining * rawCostPerUnit
      const adjCostBase = p.unitsRemaining * adjCostPerUnit
      const currentValue = marketPrice != null ? p.unitsRemaining * marketPrice : null
      const unrealisedGain = currentValue != null ? currentValue - adjCostBase : null
      const discountEligible = isDiscountEligible(p.date, today, entityType)
      const effectiveGain =
        unrealisedGain != null
          ? unrealisedGain > 0
            ? unrealisedGain * (discountEligible ? 0.5 : 1)
            : unrealisedGain
          : null

      return {
        id: p.id,
        ticker: p.ticker,
        acquisitionDate: p.date,
        units: p.unitsRemaining,
        rawCostPerUnit,
        amitAdjPerUnit,
        rawCostBase,
        adjCostBase,
        marketPrice,
        currentValue,
        unrealisedGain,
        discountEligible,
        effectiveGain,
      }
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.acquisitionDate.localeCompare(b.acquisitionDate))

  const sortedRows = [...rows].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1
    const nullLast = (v: number | null, fallback: number) => v ?? (sortDir === "asc" ? Infinity : -Infinity) * fallback
    switch (sortCol) {
      case "ticker":    return dir * a.ticker.localeCompare(b.ticker) || a.acquisitionDate.localeCompare(b.acquisitionDate)
      case "acquired":  return dir * a.acquisitionDate.localeCompare(b.acquisitionDate)
      case "units":     return dir * (a.units - b.units)
      case "costPerUnit":    return dir * (a.rawCostPerUnit - b.rawCostPerUnit)
      case "costBase":       return dir * (a.rawCostBase - b.rawCostBase)
      case "adjCostBase":    return dir * (a.adjCostBase - b.adjCostBase)
      case "marketPrice":    return dir * (nullLast(a.marketPrice, 1) - nullLast(b.marketPrice, 1))
      case "currentValue":   return dir * (nullLast(a.currentValue, 1) - nullLast(b.currentValue, 1))
      case "unrealisedGain": return dir * (nullLast(a.unrealisedGain, 1) - nullLast(b.unrealisedGain, 1))
      case "discount":  return dir * (Number(a.discountEligible) - Number(b.discountEligible))
      case "effectiveGain":  return dir * (nullLast(a.effectiveGain, 1) - nullLast(b.effectiveGain, 1))
      default: return 0
    }
  })

  const hasAllPrices = rows.length > 0 && rows.every((r) => r.marketPrice != null)
  const totalRawCostBase = rows.reduce((s, r) => s + r.rawCostBase, 0)
  const totalAdjCostBase = rows.reduce((s, r) => s + r.adjCostBase, 0)
  const totalCurrentValue = hasAllPrices ? rows.reduce((s, r) => s + (r.currentValue ?? 0), 0) : null
  const totalUnrealisedGain = totalCurrentValue != null ? totalCurrentValue - totalAdjCostBase : null

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Unrealised Gains</h1>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-slate-400">
              Updated {lastUpdated.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={() => exportToExcel(rows, entityType)}
            disabled={rows.length === 0}
            className="bg-emerald-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            Export to Excel
          </button>
          <button
            onClick={refreshPrices}
            disabled={loading || activeParcels.length === 0}
            className="bg-teal-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
          >
            {loading ? "Fetching..." : "Refresh Prices"}
          </button>
        </div>
      </div>

      {activeParcels.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-8 text-center text-slate-400">
          No open parcels. Add buy trades to see unrealised gains.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <SortHeader col="ticker" label="Ticker" />
                <SortHeader col="acquired" label="Acquired" />
                <SortHeader col="units" label="Units" right />
                <SortHeader col="costPerUnit" label="Cost / Unit" right />
                <SortHeader col="costBase" label="Cost Base" right />
                <SortHeader col="adjCostBase" label="Adj Cost Base" right />
                <SortHeader col="marketPrice" label="Market Price" right />
                <SortHeader col="currentValue" label="Current Value" right />
                <SortHeader col="unrealisedGain" label="Unrealised Gain" right />
                <SortHeader col="discount" label="Discount?" right />
                <SortHeader col="effectiveGain" label="Effective Gain" right />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {sortedRows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-slate-300">
                  <td className="px-3 py-2.5 font-medium dark:text-slate-100">{r.ticker}</td>
                  <td className="px-3 py-2.5">{fmtDate(r.acquisitionDate)}</td>
                  <td className="px-3 py-2.5 text-right">{fmt(r.units)}</td>
                  <td className="px-3 py-2.5 text-right">${fmt(r.rawCostPerUnit)}</td>
                  <td className="px-3 py-2.5 text-right">${fmt(r.rawCostBase)}</td>
                  <td className="px-3 py-2.5 text-right">${fmt(r.adjCostBase)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {loading ? (
                      <span className="text-slate-300 dark:text-slate-600">—</span>
                    ) : r.marketPrice != null ? (
                      `$${fmt(r.marketPrice)}`
                    ) : (
                      <span className="text-slate-400 text-xs">N/A</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {loading ? (
                      <span className="text-slate-300 dark:text-slate-600">—</span>
                    ) : r.currentValue != null ? (
                      `$${fmt(r.currentValue)}`
                    ) : (
                      <span className="text-slate-400 text-xs">N/A</span>
                    )}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-medium ${
                    r.unrealisedGain == null ? "" :
                    r.unrealisedGain >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                  }`}>
                    {loading ? (
                      <span className="text-slate-300 dark:text-slate-600 font-normal">—</span>
                    ) : r.unrealisedGain != null ? (
                      `$${fmt(r.unrealisedGain)}`
                    ) : (
                      <span className="text-slate-400 text-xs font-normal">N/A</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-500 dark:text-slate-400">
                    {r.discountEligible ? "Yes (50%)" : "No"}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-medium ${
                    r.effectiveGain == null ? "" :
                    r.effectiveGain >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                  }`}>
                    {loading ? (
                      <span className="text-slate-300 dark:text-slate-600 font-normal">—</span>
                    ) : r.effectiveGain != null ? (
                      `$${fmt(r.effectiveGain)}`
                    ) : (
                      <span className="text-slate-400 text-xs font-normal">N/A</span>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 dark:bg-slate-700 font-semibold border-t-2 border-slate-200 dark:border-slate-600 dark:text-slate-200">
                <td className="px-3 py-3" colSpan={4}>TOTAL</td>
                <td className="px-3 py-3 text-right">${fmt(totalRawCostBase)}</td>
                <td className="px-3 py-3 text-right">${fmt(totalAdjCostBase)}</td>
                <td className="px-3 py-3 text-right"></td>
                <td className="px-3 py-3 text-right">
                  {totalCurrentValue != null ? `$${fmt(totalCurrentValue)}` : ""}
                </td>
                <td className={`px-3 py-3 text-right ${
                  totalUnrealisedGain == null ? "" :
                  totalUnrealisedGain >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                }`}>
                  {totalUnrealisedGain != null ? `$${fmt(totalUnrealisedGain)}` : ""}
                </td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3"></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {hasAllPrices && (() => {
        // Categorise parcels
        const totalLosses = rows.reduce((s, r) => r.unrealisedGain! < 0 ? s + r.unrealisedGain! : s, 0)
        const grossNonDiscounted = rows.reduce((s, r) => r.unrealisedGain! >= 0 && !r.discountEligible ? s + r.unrealisedGain! : s, 0)
        const grossDiscounted = rows.reduce((s, r) => r.unrealisedGain! >= 0 && r.discountEligible ? s + r.unrealisedGain! : s, 0)

        // Step 1: losses offset non-discounted (short-term) gains first
        const afterStep1 = grossNonDiscounted + totalLosses
        const netNonDiscounted = Math.max(0, afterStep1)
        const lossesRemaining = Math.min(0, afterStep1)

        // Step 2: remaining losses offset gross discounted (long-term) gains
        const netDiscountedGross = grossDiscounted + lossesRemaining
        const discountApplied = entityType !== "company" && netDiscountedGross > 0 ? netDiscountedGross * 0.5 : 0
        const netDiscountedTaxable = netDiscountedGross - discountApplied

        const netTaxableGain = netNonDiscounted + netDiscountedTaxable

        const SummaryRow = ({ label, value, sub, positive, negative, bold, dimmed }: {
          label: string; value: string; sub?: boolean
          positive?: boolean; negative?: boolean; bold?: boolean; dimmed?: boolean
        }) => (
          <tr className="border-b border-slate-100 dark:border-slate-700">
            <td className={`py-2.5 text-slate-600 dark:text-slate-400 ${sub ? "pl-10 pr-4" : "px-4"} ${bold ? "font-semibold text-slate-800 dark:text-slate-200" : ""}`}>
              {label}
            </td>
            <td className={`px-4 py-2.5 text-right font-medium ${
              bold ? "font-bold text-base" : ""
            } ${positive ? "text-emerald-600 dark:text-emerald-400" : negative ? "text-red-600 dark:text-red-400" : dimmed ? "text-slate-400" : "text-slate-700 dark:text-slate-300"}`}>
              {value}
            </td>
          </tr>
        )

        return (
          <div className="mt-6 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="bg-slate-50 dark:bg-slate-700 px-4 py-3 border-b border-slate-200 dark:border-slate-600">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                Unrealised CGT Summary
              </h2>
            </div>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-4 py-1.5 text-xs font-medium text-slate-400 uppercase tracking-wider" colSpan={2}>Inputs</td>
                </tr>
                <SummaryRow label="Unrealised losses" value={totalLosses < 0 ? `($${fmt(Math.abs(totalLosses))})` : "$0.00"} negative={totalLosses < 0} />
                <SummaryRow label={`Short-term gains — held ≤12 months${entityType !== "company" ? ", no discount" : ""}`} value={`$${fmt(grossNonDiscounted)}`} positive={grossNonDiscounted > 0} />
                {entityType !== "company" && (
                  <SummaryRow label="Long-term gains, gross — held >12 months, discount eligible" value={`$${fmt(grossDiscounted)}`} positive={grossDiscounted > 0} />
                )}

                <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                  <td className="px-4 py-1.5 text-xs font-medium text-slate-400 uppercase tracking-wider" colSpan={2}>
                    After loss offset — losses applied to short-term gains first, then gross long-term gains
                  </td>
                </tr>
                <SummaryRow sub label="Net short-term gain" value={`$${fmt(netNonDiscounted)}`} positive={netNonDiscounted > 0} dimmed={netNonDiscounted === 0} />
                {entityType !== "company" && (
                  <>
                    <SummaryRow sub label="Net long-term gain, gross" value={netDiscountedGross >= 0 ? `$${fmt(netDiscountedGross)}` : `($${fmt(Math.abs(netDiscountedGross))})`} positive={netDiscountedGross > 0} negative={netDiscountedGross < 0} dimmed={netDiscountedGross === 0} />
                    {discountApplied > 0 && (
                      <SummaryRow sub label="Less: 50% CGT discount" value={`($${fmt(discountApplied)})`} dimmed />
                    )}
                  </>
                )}

                <tr className="bg-slate-50 dark:bg-slate-700 border-t-2 border-slate-300 dark:border-slate-600">
                  <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">Net taxable gain</td>
                  <td className={`px-4 py-3 text-right font-bold text-base ${netTaxableGain >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {netTaxableGain < 0 ? `($${fmt(Math.abs(netTaxableGain))})` : `$${fmt(netTaxableGain)}`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )
      })()}

      <p className="text-xs text-slate-400 mt-3">
        Prices fetched from Yahoo Finance (ASX). May be delayed up to 20 minutes. Effective gain applies 50% CGT discount to eligible parcels held &gt;12 months.
      </p>
    </div>
  )
}
