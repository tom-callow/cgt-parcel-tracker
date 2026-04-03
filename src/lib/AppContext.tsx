import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import type { AppData, EntityType, Parcel, Disposal, AmitAdjustment } from "./types"

type Snapshot = { parcels: Parcel[]; disposals: Disposal[]; amitAdjustments: AmitAdjustment[] }

type AppState = AppData & {
  setEntityType: (t: EntityType) => void
  addParcel: (p: Parcel) => void
  updateParcel: (p: Parcel) => void
  deleteParcel: (id: string) => void
  deleteParcelCascade: (id: string) => void
  addDisposal: (d: Disposal, updatedParcels: Parcel[]) => void
  deleteDisposal: (id: string) => void
  addAmitAdjustment: (a: AmitAdjustment) => void
  updateAmitAdjustment: (a: AmitAdjustment) => void
  deleteAmitAdjustment: (id: string) => void
  setRebalanceTargets: (targets: Record<string, number>) => void
  applyCSVImport: (finalParcels: Parcel[], newDisposals: Disposal[]) => void
  importData: (data: AppData) => void
  exportData: () => AppData
  undo: () => void
  canUndo: boolean
}

const AppContext = createContext<AppState | null>(null)

export function useAppState() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useAppState must be inside AppProvider")
  return ctx
}

const STORAGE_KEY = "cgt-tracker-data"
const EMPTY: AppData = { entityType: "individual", parcels: [], disposals: [], amitAdjustments: [], rebalanceTargets: {} }

/** Coerces any numeric fields that may have been stored as strings back to numbers. */
function sanitiseParcel(p: Parcel): Parcel {
  return {
    ...p,
    units: Number(p.units),
    unitPrice: Number(p.unitPrice),
    brokerage: Number(p.brokerage),
    costBase: Number(p.costBase),
    unitsRemaining: Number(p.unitsRemaining),
  }
}

function loadFromStorage(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const data = JSON.parse(raw) as AppData
    return {
      ...data,
      parcels: data.parcels.map(sanitiseParcel),
      amitAdjustments: data.amitAdjustments ?? [],
      rebalanceTargets: data.rebalanceTargets ?? {},
    }
  } catch {
    return EMPTY
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const saved = loadFromStorage()
  const [entityType, setEntityType] = useState<EntityType>(saved.entityType)
  const [parcels, setParcels] = useState<Parcel[]>(saved.parcels)
  const [disposals, setDisposals] = useState<Disposal[]>(saved.disposals)
  const [amitAdjustments, setAmitAdjustments] = useState<AmitAdjustment[]>(saved.amitAdjustments)
  const [rebalanceTargets, setRebalanceTargets] = useState<Record<string, number>>(saved.rebalanceTargets)
  const [canUndo, setCanUndo] = useState(false)

  // Always-fresh reference to current mutable state for snapshotting
  const stateRef = useRef<Snapshot>({ parcels, disposals, amitAdjustments })
  stateRef.current = { parcels, disposals, amitAdjustments }

  const historyRef = useRef<Snapshot[]>([])

  function saveSnapshot() {
    const snap = { ...stateRef.current }
    historyRef.current = [...historyRef.current.slice(-19), snap]
    setCanUndo(true)
  }

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entityType, parcels, disposals, amitAdjustments, rebalanceTargets }))
  }, [entityType, parcels, disposals, amitAdjustments, rebalanceTargets])

  const undo = useCallback(() => {
    const snap = historyRef.current.pop()
    setCanUndo(historyRef.current.length > 0)
    if (!snap) return
    setParcels(snap.parcels)
    setDisposals(snap.disposals)
    setAmitAdjustments(snap.amitAdjustments)
  }, [])

  const addParcel = useCallback((p: Parcel) => {
    saveSnapshot()
    setParcels((prev) => [...prev, p])
  }, [])

  const updateParcel = useCallback(
    (p: Parcel) => {
      saveSnapshot()
      setParcels((prev) => prev.map((x) => (x.id === p.id ? p : x)))
    },
    []
  )

  const deleteParcel = useCallback(
    (id: string) => {
      saveSnapshot()
      setParcels((prev) => prev.filter((x) => x.id !== id))
    },
    []
  )

  const deleteParcelCascade = useCallback((id: string) => {
    saveSnapshot()
    // All disposals that used the target parcel
    const affected = stateRef.current.disposals.filter((d) => d.parcelsUsed.some((u) => u.parcelId === id))
    const affectedIds = new Set(affected.map((d) => d.id))

    // Restore unitsRemaining on any OTHER parcels consumed by the affected disposals
    setParcels((prev) => {
      let next = prev.filter((p) => p.id !== id)
      for (const disposal of affected) {
        for (const usage of disposal.parcelsUsed) {
          if (usage.parcelId === id) continue // this parcel is being deleted anyway
          next = next.map((p) =>
            p.id === usage.parcelId ? { ...p, unitsRemaining: p.unitsRemaining + usage.units } : p
          )
        }
      }
      return next
    })

    setDisposals((prev) => prev.filter((d) => !affectedIds.has(d.id)))
  }, [])

  const addDisposal = useCallback((d: Disposal, updatedParcels: Parcel[]) => {
    saveSnapshot()
    setDisposals((prev) => [...prev, d])
    setParcels(updatedParcels)
  }, [])

  const deleteDisposal = useCallback(
    (id: string) => {
      saveSnapshot()
      const disposal = stateRef.current.disposals.find((d) => d.id === id)
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
    []
  )

  const addAmitAdjustment = useCallback(
    (a: AmitAdjustment) => {
      saveSnapshot()
      setAmitAdjustments((prev) => [...prev, a])
    },
    []
  )

  const updateAmitAdjustment = useCallback(
    (a: AmitAdjustment) => {
      saveSnapshot()
      setAmitAdjustments((prev) => prev.map((x) => (x.id === a.id ? a : x)))
    },
    []
  )

  const deleteAmitAdjustment = useCallback(
    (id: string) => {
      saveSnapshot()
      setAmitAdjustments((prev) => prev.filter((a) => a.id !== id))
    },
    []
  )

  const applyCSVImport = useCallback((finalParcels: Parcel[], newDisposals: Disposal[]) => {
    saveSnapshot()
    setParcels(finalParcels)
    setDisposals((prev) => [...prev, ...newDisposals])
  }, [])

  const importData = useCallback((data: AppData) => {
    setEntityType(data.entityType)
    setParcels(data.parcels.map(sanitiseParcel))
    setDisposals(data.disposals)
    setAmitAdjustments(data.amitAdjustments ?? [])
    setRebalanceTargets(data.rebalanceTargets ?? {})
  }, [])

  const exportData = useCallback(
    (): AppData => ({ entityType, parcels, disposals, amitAdjustments, rebalanceTargets }),
    [entityType, parcels, disposals, amitAdjustments, rebalanceTargets]
  )

  return (
    <AppContext.Provider
      value={{
        entityType,
        parcels,
        disposals,
        amitAdjustments,
        rebalanceTargets,
        setEntityType,
        addParcel,
        updateParcel,
        deleteParcel,
        deleteParcelCascade,
        addDisposal,
        deleteDisposal,
        addAmitAdjustment,
        updateAmitAdjustment,
        deleteAmitAdjustment,
        setRebalanceTargets,
        applyCSVImport,
        importData,
        exportData,
        undo,
        canUndo,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}
