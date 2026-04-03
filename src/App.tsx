import { useState, useEffect } from "react"
import { AppProvider } from "./lib/AppContext"
import { Sidebar } from "./components/Sidebar"
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

function App() {
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

  return (
    <AppProvider>
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
    </AppProvider>
  )
}

export default App
