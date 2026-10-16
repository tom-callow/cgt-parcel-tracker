import { useId, useState } from "react"

type Props = {
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  className?: string
}

/**
 * Text input with a dropdown of suggested tickers: pick one, or type a ticker that isn't listed.
 * Drawn by the page rather than a native <datalist>, whose popup some embedded browsers misplace.
 */
export function TickerInput({ value, onChange, options, placeholder, className = "" }: Props) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)

  const query = value.trim().toUpperCase()
  // Filter while typing, but show everything once the value exactly matches an option
  const filtered = !query || options.includes(query) ? options : options.filter((o) => o.includes(query))
  const showList = open && filtered.length > 0

  function choose(option: string) {
    onChange(option)
    setOpen(false)
    setHighlight(-1)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (!showList) {
        setOpen(true)
        setHighlight(0)
        return
      }
      const step = e.key === "ArrowDown" ? 1 : -1
      setHighlight((h) => (h + step + filtered.length) % filtered.length)
    } else if (e.key === "Enter" && showList && highlight >= 0 && highlight < filtered.length) {
      e.preventDefault()  // pick the option rather than submitting the form
      choose(filtered[highlight])
    } else if (e.key === "Escape" && open) {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlight(-1) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && highlight >= 0 ? `${listId}-${highlight}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        className={`${className} pr-8`}
      />
      {options.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show tickers"
          // Keep focus in the input so the list doesn't close as it opens
          onMouseDown={(e) => { e.preventDefault(); setOpen((o) => !o) }}
          className="absolute inset-y-0 right-0 px-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
            <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
          </svg>
        </button>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-lg py-1 text-sm"
        >
          {filtered.map((o, i) => (
            <li
              key={o}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              // mousedown, not click: it runs before the input's blur closes the list
              onMouseDown={(e) => { e.preventDefault(); choose(o) }}
              onMouseEnter={() => setHighlight(i)}
              className={`px-3 py-1.5 cursor-pointer ${
                i === highlight ? "bg-teal-600 text-white" : "text-slate-800 dark:text-slate-100"
              }`}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
