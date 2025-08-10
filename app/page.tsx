import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

export default function HomePage() {
  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <section className="mx-auto max-w-4xl px-6 py-14">
        <div className="grid gap-8 md:grid-cols-2 items-center">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Tilting Maze</h1>
            <p className="mt-3 text-neutral-600">
              Tilt your phone to guide the ball through an ever‑challenging maze. Avoid traps, time the spikes, and
              reach the goal. From level 6+, control two balls starting from different points.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild className="bg-neutral-900 text-white hover:bg-neutral-800">
                <Link href="/game">Play</Link>
              </Button>
              <Button asChild variant="outline" className="border-neutral-300 text-neutral-800 bg-transparent">
                <Link href="/levels">Levels</Link>
              </Button>
            </div>
          </div>
          <Card className="p-4 bg-white border-neutral-200">
            <div className="aspect-[3/2] w-full rounded-lg border border-neutral-200 bg-neutral-100 grid place-items-center">
              <div className="text-neutral-500 text-sm">Live preview appears in Play</div>
            </div>
            <p className="mt-3 text-sm text-neutral-600">
              Use the Levels screen to jump directly to any level you&apos;ve unlocked and view your best times.
            </p>
          </Card>
        </div>
      </section>
    </main>
  )
}
