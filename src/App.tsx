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
  const { authLoading, dataLoading, session } = useAppState()
  const [page, setPage] = useState<Page>("trades")
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("darkMode")
    if (saved !== null) return saved === "true"
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode)
    localStorage.setItem("darkMode", String(darkMode))
  }, [darkMode])

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    )
  }

  if (!session) return <LoginPage />

  if (dataLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading your data…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar active={page} onNav={setPage} darkMode={darkMode} onToggleDark={() => setDarkMode((d) => !d)} />
      <main className="flex-1 bg-slate-100 dark:bg-slate-900 p-8">
        {page === "trades" && <TradesPage />}
        {page === "portfolio" && <PortfolioPage />}
        {page === "unrealised" && <UnrealisedGainsPage />}
        {page === "gains" && <CapitalGainsPage />}
        {page === "tax" && <TaxStatementsPage />}
        {page === "optimiser" && <OptimiserPage />}
        {page === "amit" && <AmitPage />}
        {page === "saveload" && <SaveLoadPage />}
        {page === "rebalance" && <RebalancePage />}
      </main>
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
