import { useState, useEffect } from "react"
import { AppProvider, useAppState } from "./lib/AppContext"
import { Sidebar } from "./components/Sidebar"
import { LoginPage } from "./pages/LoginPage"
import { TradesPage } from "./pages/TradesPage"
import { PortfolioPage } from "./pages/PortfolioPage"
import { CapitalGainsPage } from "./pages/CapitalGainsPage"
import { TaxStatementsPage } from "./pages/TaxStatementsPage"
import { OptimiserPage } from "./pages/OptimiserPage"
import { UnrealisedGainsPage } from "./pages/UnrealisedGainsPage"
import { AmitPage } from "./pages/AmitPage"
import { SaveLoadPage } from "./pages/SaveLoadPage"
import { RebalancePage } from "./pages/RebalancePage"

type Page = "trades" | "portfolio" | "unrealised" | "gains" | "tax" | "optimiser" | "amit" | "saveload" | "rebalance"

function AppShell() {
  const { authLoading, dataLoading, dataLoadError, retryDataLoad, session, signOut } = useAppState()
  const [page, setPage] = useState<Page>("trades")
  const [navOpen, setNavOpen] = useState(false)
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("darkMode")
    if (saved !== null) return saved === "true"
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode)
    localStorage.setItem("darkMode", String(darkMode))
  }, [darkMode])

  // Close the mobile menu with Escape
  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNavOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navOpen])

  function navigate(p: Page) {
    setPage(p)
    setNavOpen(false)
  }

  if (authLoading) {
    return (
      <div className="min-h-dvh flex-1 bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    )
  }

  if (!session) return <LoginPage />

  if (dataLoadError) {
    return (
      <div className="min-h-dvh flex-1 bg-slate-100 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-sm text-center">
          <p className="text-slate-800 dark:text-slate-100 font-medium mb-2">Couldn't load your data</p>
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-1">
            Your saved data is safe — nothing has been changed. Check your connection and try again.
          </p>
          <p className="text-slate-500 text-xs mb-6">{dataLoadError}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={retryDataLoad}
              className="bg-teal-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-teal-700"
            >
              Retry
            </button>
            <button
              onClick={signOut}
              className="bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200 px-5 py-2 rounded text-sm font-medium hover:bg-slate-300 dark:hover:bg-slate-600"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (dataLoading) {
    return (
      <div className="min-h-dvh flex-1 bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading your data…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-dvh min-w-0">
      <Sidebar
        active={page}
        onNav={navigate}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((d) => !d)}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 bg-slate-800 text-white px-4 h-14">
          <button
            onClick={() => setNavOpen(true)}
            className="text-xl leading-none p-1 -ml-1"
            aria-label="Open menu"
            aria-controls="app-nav"
            aria-expanded={navOpen}
          >
            ☰
          </button>
          <span className="font-semibold tracking-tight">CGT Parcel Tracker</span>
        </header>
        {/* min-w-0 lets wide tables scroll inside their cards instead of stretching the page */}
        <main className="flex-1 min-w-0 bg-slate-100 dark:bg-slate-900 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            {page === "trades" && <TradesPage />}
            {page === "portfolio" && <PortfolioPage />}
            {page === "unrealised" && <UnrealisedGainsPage />}
            {page === "gains" && <CapitalGainsPage />}
            {page === "tax" && <TaxStatementsPage />}
            {page === "optimiser" && <OptimiserPage />}
            {page === "amit" && <AmitPage />}
            {page === "saveload" && <SaveLoadPage />}
            {page === "rebalance" && <RebalancePage />}
          </div>
        </main>
      </div>
    </div>
  )
}

function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  )
}

export default App
