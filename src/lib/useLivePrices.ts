import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react"
import { fetchPrices } from "./marketData"

/** Live ASX prices for the given tickers: fetched once on mount, then on demand via `refresh`. */
export function useLivePrices(tickers: string[]) {
  const [prices, setPrices] = useState<Record<string, number | null>>({})
  const [loading, setLoading] = useState(tickers.length > 0) // mount fetch starts immediately
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Always fetch the latest tickers without re-creating callbacks when holdings change
  const tickersRef = useRef(tickers)
  useLayoutEffect(() => {
    tickersRef.current = tickers
  })

  const load = useCallback(async () => {
    const results = await fetchPrices(tickersRef.current)
    setPrices(results)
    setLastUpdated(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    if (tickersRef.current.length > 0) load()
  }, [load])

  const refresh = useCallback(() => {
    if (tickersRef.current.length === 0) return
    setLoading(true)
    load()
  }, [load])

  return { prices, loading, lastUpdated, refresh }
}
