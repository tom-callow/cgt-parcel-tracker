import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import type { AppData, EntityType, Parcel, Disposal } from "./types"

type AppState = AppData & {
  setEntityType: (t: EntityType) => void
  addParcel: (p: Parcel) => void
  updateParcel: (p: Parcel) => void
  deleteParcel: (id: string) => void
  addDisposal: (d: Disposal, updatedParcels: Parcel[]) => void
  deleteDisposal: (id: string) => void
  importData: (data: AppData) => void
  exportData: () => AppData
}

const AppContext = createContext<AppState | null>(null)

export function useAppState() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useAppState must be inside AppProvider")
  return ctx
}

const STORAGE_KEY = "cgt-tracker-data"
const EMPTY: AppData = { entityType: "individual", parcels: [], disposals: [] }

function loadFromStorage(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    return JSON.parse(raw) as AppData
  } catch {
    return EMPTY
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const saved = loadFromStorage()
  const [entityType, setEntityType] = useState<EntityType>(saved.entityType)
  const [parcels, setParcels] = useState<Parcel[]>(saved.parcels)
  const [disposals, setDisposals] = useState<Disposal[]>(saved.disposals)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entityType, parcels, disposals }))
  }, [entityType, parcels, disposals])

  const addParcel = useCallback((p: Parcel) => setParcels((prev) => [...prev, p]), [])

  const updateParcel = useCallback(
    (p: Parcel) => setParcels((prev) => prev.map((x) => (x.id === p.id ? p : x))),
    []
  )

  const deleteParcel = useCallback(
    (id: string) => setParcels((prev) => prev.filter((x) => x.id !== id)),
    []
  )

  const addDisposal = useCallback((d: Disposal, updatedParcels: Parcel[]) => {
    setDisposals((prev) => [...prev, d])
    setParcels(updatedParcels)
  }, [])

  const deleteDisposal = useCallback(
    (id: string) => {
      const disposal = disposals.find((d) => d.id === id)
      if (!disposal) return
      // Restore parcel units
      setParcels((prev) =>
        prev.map((p) => {
          const usage = disposal.parcelsUsed.find((u) => u.parcelId === p.id)
          if (!usage) return p
          return { ...p, unitsRemaining: p.unitsRemaining + usage.units }
        })
      )
      setDisposals((prev) => prev.filter((d) => d.id !== id))
    },
    [disposals]
  )

  const importData = useCallback((data: AppData) => {
    setEntityType(data.entityType)
    setParcels(data.parcels)
    setDisposals(data.disposals)
  }, [])

  const exportData = useCallback(
    (): AppData => ({ entityType, parcels, disposals }),
    [entityType, parcels, disposals]
  )

  return (
    <AppContext.Provider
      value={{
        entityType,
        parcels,
        disposals,
        setEntityType,
        addParcel,
        updateParcel,
        deleteParcel,
        addDisposal,
        deleteDisposal,
        importData,
        exportData,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}
