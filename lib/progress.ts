export type Progress = {
  bestTimes: Record<number, number> // level -> best seconds
  lastTimes: Record<number, number> // level -> last seconds
  highestLevel: number
}

const BEST_KEY = "tm_best_times"
const LAST_KEY = "tm_last_times"
const HIGH_KEY = "tm_highest_level"

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function readProgress(): Progress {
  if (typeof window === "undefined") {
    return { bestTimes: {}, lastTimes: {}, highestLevel: 1 }
  }
  try {
    const bestTimes = safeParse<Record<number, number>>(localStorage.getItem(BEST_KEY), {})
    const lastTimes = safeParse<Record<number, number>>(localStorage.getItem(LAST_KEY), {})
    const highestLevel = Number(localStorage.getItem(HIGH_KEY) ?? "1") || 1
    return { bestTimes, lastTimes, highestLevel }
  } catch {
    return { bestTimes: {}, lastTimes: {}, highestLevel: 1 }
  }
}

export function saveLevelTime(level: number, seconds: number) {
  if (typeof window === "undefined") return
  try {
    const prog = readProgress()
    prog.lastTimes[level] = seconds
    const prevBest = prog.bestTimes[level]
    if (prevBest === undefined || seconds < prevBest) {
      prog.bestTimes[level] = seconds
    }
    if (level > prog.highestLevel) {
      prog.highestLevel = level
    }
    localStorage.setItem(BEST_KEY, JSON.stringify(prog.bestTimes))
    localStorage.setItem(LAST_KEY, JSON.stringify(prog.lastTimes))
    localStorage.setItem(HIGH_KEY, String(prog.highestLevel))
  } catch {
    // ignore storage errors
  }
}

export function clearProgress() {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(BEST_KEY)
    localStorage.removeItem(LAST_KEY)
    localStorage.removeItem(HIGH_KEY)
  } catch {
    // ignore
  }
}
