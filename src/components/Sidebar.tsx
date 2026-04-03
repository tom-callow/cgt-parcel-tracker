type Page = "trades" | "portfolio" | "unrealised" | "gains" | "tax" | "optimiser" | "amit" | "saveload" | "rebalance"

const NAV: { id: Page; label: string }[] = [
  { id: "trades", label: "Trades" },
  { id: "amit", label: "AMIT Adjustments" },
  { id: "portfolio", label: "Portfolio" },
  { id: "unrealised", label: "Unrealised Gains" },
  { id: "rebalance", label: "Rebalancing" },
  { id: "optimiser", label: "Sale Optimiser" },
  { id: "gains", label: "Capital Gains" },
  { id: "tax", label: "Tax Summary" },
  { id: "saveload", label: "Save / Load" },
]

export function Sidebar({
  active,
  onNav,
}: {
  active: Page
  onNav: (page: Page) => void
}) {
  return (
    <aside className="w-56 min-h-screen bg-slate-800 text-white flex flex-col shrink-0">
      <div className="px-5 py-6 text-lg font-semibold tracking-tight border-b border-slate-700">
        CGT Tracker
      </div>
      <nav className="flex-1 py-2">
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => onNav(item.id)}
            className={`w-full text-left px-5 py-3 text-sm transition-colors ${
              active === item.id
                ? "bg-teal-600 text-white font-medium"
                : "text-slate-300 hover:bg-slate-700 hover:text-white"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="px-5 py-4 text-xs text-slate-500 border-t border-slate-700">
        AU CGT Parcel Tracker
      </div>
    </aside>
  )
}
