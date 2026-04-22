import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import type { Session } from "@supabase/supabase-js"
import { supabase } from "./supabase"
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
  session: Session | null
  authLoading: boolean
  dataLoading: boolean
  signOut: () => Promise<void>
}

const AppContext = createContext<AppState | null>(null)

export function useAppState() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useAppState must be inside AppProvider")
  return ctx
}

const STORAGE_KEY = "cgt-tracker-data"
const EMPTY: AppData = { entityType: "individual", parcels: [], disposals: [], amitAdjustments: [], rebalanceTargets: {} }

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
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)

  const [entityType, setEntityType] = useState<EntityType>(EMPTY.entityType)
  const [parcels, setParcels] = useState<Parcel[]>(EMPTY.parcels)
  const [disposals, setDisposals] = useState<Disposal[]>(EMPTY.disposals)
  const [amitAdjustments, setAmitAdjustments] = useState<AmitAdjustment[]>(EMPTY.amitAdjustments)
  const [rebalanceTargets, setRebalanceTargets] = useState<Record<string, number>>(EMPTY.rebalanceTargets)
  const [canUndo, setCanUndo] = useState(false)

  const stateRef = useRef<Snapshot>({ parcels, disposals, amitAdjustments })
  stateRef.current = { parcels, disposals, amitAdjustments }

  const historyRef = useRef<Snapshot[]>([])
  const isLoadingRef = useRef(false)

  // Auth setup
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load data from Supabase when the user logs in
  useEffect(() => {
    if (!session) return
    isLoadingRef.current = true
    setDataLoading(true)

    supabase
      .from("user_data")
      .select("data")
      .eq("id", session.user.id)
      .single()
      .then(({ data, error }) => {
        if (!error && data?.data) {
          const appData = data.data as AppData
          setEntityType(appData.entityType ?? "individual")
          setParcels((appData.parcels ?? []).map(sanitiseParcel))
          setDisposals(appData.disposals ?? [])
          setAmitAdjustments(appData.amitAdjustments ?? [])
          setRebalanceTargets(appData.rebalanceTargets ?? {})
        } else {
          // No Supabase data yet — migrate from localStorage
          const local = loadFromStorage()
          setEntityType(local.entityType)
          setParcels(local.parcels)
          setDisposals(local.disposals)
          setAmitAdjustments(local.amitAdjustments)
          setRebalanceTargets(local.rebalanceTargets)
          // Save migration immediately
          supabase.from("user_data").upsert({
            id: session.user.id,
            data: local,
            updated_at: new Date().toISOString(),
          })
        }
        isLoadingRef.current = false
        setDataLoading(false)
      })
  }, [session?.user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save to Supabase (debounced 1s), skipped while data is being loaded
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!session || isLoadingRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      supabase.from("user_data").upsert({
        id: session.user.id,
        data: { entityType, parcels, disposals, amitAdjustments, rebalanceTargets },
        updated_at: new Date().toISOString(),
      }).then(({ error }) => {
        if (error) console.error("Supabase save error:", error)
        else console.log("Supabase save OK")
      })
    }, 1000)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [session, entityType, parcels, disposals, amitAdjustments, rebalanceTargets])

  function saveSnapshot() {
    const snap = { ...stateRef.current }
    historyRef.current = [...historyRef.current.slice(-19), snap]
    setCanUndo(true)
  }

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

  const updateParcel = useCallback((p: Parcel) => {
    saveSnapshot()
    setParcels((prev) => prev.map((x) => (x.id === p.id ? p : x)))
  }, [])

  const deleteParcel = useCallback((id: string) => {
    saveSnapshot()
    setParcels((prev) => prev.filter((x) => x.id !== id))
  }, [])

  const deleteParcelCascade = useCallback((id: string) => {
    saveSnapshot()
    const affected = stateRef.current.disposals.filter((d) => d.parcelsUsed.some((u) => u.parcelId === id))
    const affectedIds = new Set(affected.map((d) => d.id))

    setParcels((prev) => {
      let next = prev.filter((p) => p.id !== id)
      for (const disposal of affected) {
        for (const usage of disposal.parcelsUsed) {
          if (usage.parcelId === id) continue
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

  const deleteDisposal = useCallback((id: string) => {
    saveSnapshot()
    const disposal = stateRef.current.disposals.find((d) => d.id === id)
    if (!disposal) return
    setParcels((prev) =>
      prev.map((p) => {
        const usage = disposal.parcelsUsed.find((u) => u.parcelId === p.id)
        if (!usage) return p
        return { ...p, unitsRemaining: p.unitsRemaining + usage.units }
      })
    )
    setDisposals((prev) => prev.filter((d) => d.id !== id))
  }, [])

  const addAmitAdjustment = useCallback((a: AmitAdjustment) => {
    saveSnapshot()
    setAmitAdjustments((prev) => [...prev, a])
  }, [])

  const updateAmitAdjustment = useCallback((a: AmitAdjustment) => {
    saveSnapshot()
    setAmitAdjustments((prev) => prev.map((x) => (x.id === a.id ? a : x)))
  }, [])

  const deleteAmitAdjustment = useCallback((id: string) => {
    saveSnapshot()
    setAmitAdjustments((prev) => prev.filter((a) => a.id !== id))
  }, [])

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

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

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
        session,
        authLoading,
        dataLoading,
        signOut,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}
