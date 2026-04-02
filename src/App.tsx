import { useState } from "react"
import { AppProvider } from "./lib/AppContext"
import { Sidebar } from "./components/Sidebar"
import { TradesPage } from "./pages/TradesPage"
import { PortfolioPage } from "./pages/PortfolioPage"
import { CapitalGainsPage } from "./pages/CapitalGainsPage"
import { TaxStatementsPage } from "./pages/TaxStatementsPage"
import { OptimiserPage } from "./pages/OptimiserPage"
import { UnrealisedGainsPage } from "./pages/UnrealisedGainsPage"
import { SaveLoadPage } from "./pages/SaveLoadPage"

type Page = "trades" | "portfolio" | "unrealised" | "gains" | "tax" | "optimiser" | "saveload"

function App() {
  const [page, setPage] = useState<Page>("trades")

  return (
    <AppProvider>
      <div className="flex min-h-screen">
        <Sidebar active={page} onNav={setPage} />
        <main className="flex-1 bg-slate-100 p-8">
          {page === "trades" && <TradesPage />}
          {page === "portfolio" && <PortfolioPage />}
          {page === "unrealised" && <UnrealisedGainsPage />}
          {page === "gains" && <CapitalGainsPage />}
          {page === "tax" && <TaxStatementsPage />}
          {page === "optimiser" && <OptimiserPage />}
          {page === "saveload" && <SaveLoadPage />}
        </main>
      </div>
    </AppProvider>
  )
}

export default App
