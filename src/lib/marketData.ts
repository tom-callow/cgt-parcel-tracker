const WORKER_URL = 'https://cgt-market-proxy.cgt-tracker.workers.dev';

// Fetches live ASX prices for the given tickers (no .AX suffix needed).
// Returns a map of ticker → price in AUD, or null if unavailable.
export async function fetchPrices(tickers: string[]): Promise<Record<string, number | null>> {
  if (tickers.length === 0) return {};
  const symbols = tickers.map((t) => `${t}.AX`).join(',');
  try {
    const res = await fetch(`${WORKER_URL}/quotes?symbols=${encodeURIComponent(symbols)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, { price: number; currency: string } | null>;
    return Object.fromEntries(tickers.map((t) => [t, data[`${t}.AX`]?.price ?? null]));
  } catch {
    return Object.fromEntries(tickers.map((t) => [t, null]));
  }
}
