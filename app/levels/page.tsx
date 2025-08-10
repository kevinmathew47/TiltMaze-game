"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { clearProgress, readProgress, type Progress } from "@/lib/progress"

function formatTime(sec?: number) {
  if (!sec || !Number.isFinite(sec)) return "-"
  return `${sec.toFixed(2)}s`
}

const BATCH = 200 // how many more levels to load each time you hit the bottom

export default function LevelsPage() {
  const [prog, setProg] = useState<Progress>({ bestTimes: {}, lastTimes: {}, highestLevel: 1 })
  const [visibleMax, setVisibleMax] = useState<number>(Math.max(BATCH, 50))
  const [jumpValue, setJumpValue] = useState<string>("")

  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  // Initial read and periodic refresh when coming back from the Game page
  useEffect(() => {
    const refresh = () => setProg(readProgress())
    refresh()
    const onVis = () => {
      if (document.visibilityState === "visible") refresh()
    }
    window.addEventListener("visibilitychange", onVis)
    return () => window.removeEventListener("visibilitychange", onVis)
  }, [])

  // Grow the visible window when you unlock higher levels
  useEffect(() => {
    setVisibleMax((prev) => Math.max(prev, Math.max(BATCH, prog.highestLevel + 50)))
  }, [prog.highestLevel])

  // Infinite loading via IntersectionObserver
  useEffect(() => {
    const el = loadMoreRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisibleMax((prev) => prev + BATCH)
          }
        }
      },
      { rootMargin: "600px 0px 600px 0px" },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMoreRef])

  const levels = useMemo(() => Array.from({ length: visibleMax }, (_, i) => i + 1), [visibleMax])

  const handleResetProgress = () => {
    clearProgress()
    setProg(readProgress())
    setVisibleMax(Math.max(BATCH, 50))
  }

  const handleJump = () => {
    const n = Number(jumpValue)
    if (!Number.isFinite(n) || n < 1) return
    setVisibleMax((prev) => Math.max(prev, Math.floor(n) + 50))
    // Smooth scroll to the approximate card position
    const anchor = document.getElementById(`lvl-${Math.floor(n)}`)
    if (anchor) {
      anchor.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-bold">Levels</h1>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                inputMode="numeric"
                placeholder="Jump to level…"
                value={jumpValue}
                onChange={(e) => setJumpValue(e.target.value)}
                className="h-9 w-40 rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none ring-0 focus:border-neutral-400"
              />
              <Button
                onClick={handleJump}
                variant="outline"
                className="border-neutral-300 text-neutral-800 bg-transparent"
              >
                Jump
              </Button>
            </div>
            <Button asChild variant="outline" className="border-neutral-300 text-neutral-800 bg-transparent">
              <Link href="/">Home</Link>
            </Button>
            <Button
              onClick={handleResetProgress}
              variant="outline"
              className="border-neutral-300 text-neutral-800 bg-transparent"
            >
              Reset Progress
            </Button>
          </div>
        </div>

        <p className="mt-2 text-sm text-neutral-600">
          Levels unlock one-by-one. You can always attempt the next level after your current highest cleared level.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {levels.map((lvl) => {
            const best = prog.bestTimes[lvl]
            const last = prog.lastTimes[lvl]
            const unlocked = lvl <= prog.highestLevel + 1
            return (
              <Card
                key={lvl}
                id={`lvl-${lvl}`}
                className={`p-4 transition ${
                  unlocked ? "border-neutral-200 bg-white" : "border-neutral-200/60 bg-white/70"
                }`}
                aria-disabled={!unlocked}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm text-neutral-600">Level</div>
                    <div className="text-xl font-semibold">{lvl}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-neutral-500">Best</div>
                    <div className="font-mono text-base">{formatTime(best)}</div>
                    <div className="mt-1 text-xs text-neutral-500">Last</div>
                    <div className="font-mono text-sm">{formatTime(last)}</div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    asChild
                    disabled={!unlocked}
                    className={`${
                      unlocked ? "bg-neutral-900 text-white hover:bg-neutral-800" : "bg-neutral-200 text-neutral-500"
                    }`}
                  >
                    <Link href={`/game?level=${lvl}`} aria-disabled={!unlocked}>
                      Play
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="border-neutral-300 text-neutral-800 bg-transparent"
                    title="Start from level 1 and keep going"
                  >
                    <Link href="/game">Endless</Link>
                  </Button>
                </div>
                {!unlocked && (
                  <p className="mt-2 text-xs text-neutral-500">Locked. Beat level {lvl - 1} to unlock this level.</p>
                )}
              </Card>
            )
          })}
        </div>

        {/* Sentinel for infinite loading */}
        <div ref={loadMoreRef} className="h-10 w-full" />
        <div className="mt-2 text-center text-xs text-neutral-400">
          Showing levels 1 – {visibleMax}. Scrolling will load more automatically.
        </div>
      </section>
    </main>
  )
}
