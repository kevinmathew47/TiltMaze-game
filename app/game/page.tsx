import TiltingMaze from "@/components/tilting-maze"

export default function GamePage({ searchParams }: { searchParams?: { level?: string } }) {
  const startLevelParam = Number(searchParams?.level ?? "0")
  const startLevel = Number.isFinite(startLevelParam) && startLevelParam > 0 ? Math.floor(startLevelParam) : 1
  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <TiltingMaze startLevel={startLevel} />
    </main>
  )
}
