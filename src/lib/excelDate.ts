/** Convert an ISO date (YYYY-MM-DD) to an Excel serial date number (days since 1899-12-30). */
export function toExcelDate(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number)
  const date  = new Date(Date.UTC(y, m - 1, d))
  const epoch = new Date(Date.UTC(1899, 11, 30))  // Excel epoch: 1899-12-30
  return Math.round((date.getTime() - epoch.getTime()) / 86_400_000)
}
