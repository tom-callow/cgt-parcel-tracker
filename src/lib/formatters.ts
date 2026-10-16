export const fmt = (n: number): string =>
  isFinite(n)
    ? n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—"

export const fmtPct = (n: number): string =>
  isFinite(n)
    ? n.toLocaleString("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%"
    : "—"

/** Percentage-point difference, e.g. "+1.0 pp" / "−1.0 pp" */
export const fmtPp = (n: number): string =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pp`

export const byDate = <T extends { date: string }>(a: T, b: T): number =>
  a.date.localeCompare(b.date)

export const uniqueTickers = <T extends { ticker: string }>(items: T[]): string[] =>
  [...new Set(items.map((i) => i.ticker))].sort()
