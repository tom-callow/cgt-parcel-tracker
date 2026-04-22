import { useState } from "react"
import { supabase } from "../lib/supabase"

export function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-white tracking-tight">CGT Parcel Tracker</h1>
          <p className="text-slate-400 text-sm mt-1">Sign in to access your data</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-slate-800 rounded-lg p-8 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm text-slate-300">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="bg-slate-700 text-white rounded px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:border-teal-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm text-slate-300">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="bg-slate-700 text-white rounded px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:border-teal-500"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
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
