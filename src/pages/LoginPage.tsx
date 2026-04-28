import { useState, useEffect } from "react"
import { supabase } from "../lib/supabase"

export function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("darkMode")
    if (saved !== null) return saved === "true"
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode)
    localStorage.setItem("darkMode", String(darkMode))
  }, [darkMode])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
    } else {
      if (rememberMe) {
        localStorage.setItem("cgt-remember-me", "1")
        sessionStorage.removeItem("cgt-session-alive")
      } else {
        localStorage.removeItem("cgt-remember-me")
        sessionStorage.setItem("cgt-session-alive", "1")
      }
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
      <button
        onClick={() => setDarkMode((d) => !d)}
        className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg transition-colors"
        aria-label="Toggle dark mode"
      >
        {darkMode ? "☀" : "🌙"}
      </button>
      <div className="w-full max-w-sm mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">CGT Parcel Tracker</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Sign in to access your data</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 rounded-lg p-8 flex flex-col gap-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <label className="text-sm text-slate-600 dark:text-slate-300">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 focus:outline-none focus:border-teal-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm text-slate-600 dark:text-slate-300">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 focus:outline-none focus:border-teal-500"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="accent-teal-600"
            />
            Remember me
          </label>
          {error && <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded px-4 py-2 text-sm font-medium transition-colors mt-2"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  )
}
