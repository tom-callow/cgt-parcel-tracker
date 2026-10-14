import { useAppState } from "../lib/AppContext"

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
  darkMode,
  onToggleDark,
  open,
  onClose,
}: {
  active: Page
  onNav: (page: Page) => void
  darkMode: boolean
  onToggleDark: () => void
  open: boolean        // drawer state below the md breakpoint; ignored on wider screens
  onClose: () => void
}) {
  const { undo, canUndo, signOut } = useAppState()

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        id="app-nav"
        className={`fixed inset-y-0 left-0 z-50 w-64 max-w-[80vw] transition-transform md:sticky md:top-0 md:bottom-auto md:z-auto md:w-56 md:h-dvh md:translate-x-0 md:visible md:transition-none bg-slate-800 text-white flex flex-col shrink-0 ${
          // invisible when closed so its buttons drop out of the tab order on small screens
          open ? "translate-x-0" : "-translate-x-full invisible"
        }`}
      >
        <div className="px-5 py-6 text-lg font-semibold tracking-tight border-b border-slate-700 flex items-center justify-between">
          CGT Parcel Tracker
          <button onClick={onClose} className="md:hidden text-slate-400 hover:text-white text-xl leading-none" aria-label="Close menu">✕</button>
        </div>
        <nav className="flex-1 py-2 overflow-y-auto">
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
        <div className="border-t border-slate-700">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="w-full text-left px-5 py-3 text-sm transition-colors flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed text-slate-400 hover:bg-slate-700 hover:text-white disabled:hover:bg-transparent disabled:hover:text-slate-400"
          >
            <span>↩</span>
            Undo
          </button>
          <button
            onClick={onToggleDark}
            className="w-full text-left px-5 py-3 text-sm text-slate-400 hover:bg-slate-700 hover:text-white transition-colors flex items-center gap-2"
          >
            <span>{darkMode ? "☀" : "🌙"}</span>
            {darkMode ? "Light mode" : "Dark mode"}
          </button>
        </div>
        <button
          onClick={signOut}
          className="w-full text-left px-5 py-3 text-sm text-slate-400 hover:bg-slate-700 hover:text-white transition-colors flex items-center gap-2 border-t border-slate-700"
        >
          <span>⎋</span>
          Sign out
        </button>
      </aside>
    </>
  )
}
