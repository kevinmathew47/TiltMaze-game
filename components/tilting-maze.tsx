"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { Menu } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { saveLevelTime } from "@/lib/progress"

type Cell = {
  c: number
  r: number
  walls: { top: boolean; right: boolean; bottom: boolean; left: boolean }
  visited?: boolean
}

type HazardReset = {
  x: number
  y: number
  r: number
}

type HazardSpike = {
  x: number
  y: number
  r: number
  period: number
  duty: number
  phase: number
  cellC: number
  cellR: number
}

type StartSpot = { c: number; r: number; x: number; y: number }

type Maze = {
  cols: number
  rows: number
  cellSize: number
  wallThickness: number
  offsetX: number
  offsetY: number
  cells: Cell[]
  resets: HazardReset[]
  spikes: HazardSpike[]
  path: Array<{ c: number; r: number }>
  startSpots: StartSpot[]
}

type TiltState = {
  beta: number
  gamma: number
  ready: boolean
  permissionNeeded: boolean
}

type Vec2 = { x: number; y: number }

export interface TiltingMazeProps {
  startLevel?: number
}

function idx(c: number, r: number, cols: number) {
  return r * cols + c
}
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}
function length(x: number, y: number) {
  return Math.hypot(x, y)
}
function normalize(x: number, y: number): Vec2 {
  const len = Math.hypot(x, y)
  if (len === 0) return { x: 0, y: 0 }
  return { x: x / len, y: y / len }
}
function manhattan(a: { c: number; r: number }, b: { c: number; r: number }) {
  return Math.abs(a.c - b.c) + Math.abs(a.r - b.r)
}

function randomMaze(cols: number, rows: number): Cell[] {
  const grid: Cell[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid.push({
        c,
        r,
        walls: { top: true, right: true, bottom: true, left: true },
        visited: false,
      })
    }
  }
  const stack: Cell[] = []
  const start = grid[0]
  start.visited = true
  stack.push(start)
  function neighbors(cell: Cell) {
    const list: Cell[] = []
    const { c, r } = cell
    if (r > 0) list.push(grid[idx(c, r - 1, cols)])
    if (c < cols - 1) list.push(grid[idx(c + 1, r, cols)])
    if (r < rows - 1) list.push(grid[idx(c, r + 1, cols)])
    if (c > 0) list.push(grid[idx(c - 1, r, cols)])
    return list.filter((n) => !n.visited)
  }
  while (stack.length) {
    const current = stack[stack.length - 1]
    const unvis = neighbors(current)
    if (unvis.length) {
      const next = unvis[Math.floor(Math.random() * unvis.length)]
      const dc = next.c - current.c
      const dr = next.r - current.r
      if (dc === 1) {
        current.walls.right = false
        next.walls.left = false
      } else if (dc === -1) {
        current.walls.left = false
        next.walls.right = false
      } else if (dr === 1) {
        current.walls.bottom = false
        next.walls.top = false
      } else if (dr === -1) {
        current.walls.top = false
        next.walls.bottom = false
      }
      next.visited = true
      stack.push(next)
    } else {
      stack.pop()
    }
  }
  for (const c of grid) c.visited = false
  return grid
}

function computePath(cells: Cell[], cols: number, rows: number) {
  const start = idx(0, 0, cols)
  const goal = idx(cols - 1, rows - 1, cols)
  const q: number[] = [start]
  const visited = new Array(cells.length).fill(false)
  const parent = new Array<number>(cells.length).fill(-1)
  visited[start] = true
  const tryPush = (from: number, toC: number, toR: number) => {
    if (toC < 0 || toR < 0 || toC >= cols || toR >= rows) return
    const to = idx(toC, toR, cols)
    if (!visited[to]) {
      visited[to] = true
      parent[to] = from
      q.push(to)
    }
  }
  while (q.length) {
    const cur = q.shift()!
    if (cur === goal) break
    const cell = cells[cur]
    const c = cell.c
    const r = cell.r
    if (!cell.walls.top) tryPush(cur, c, r - 1)
    if (!cell.walls.right) tryPush(cur, c + 1, r)
    if (!cell.walls.bottom) tryPush(cur, c, r + 1)
    if (!cell.walls.left) tryPush(cur, c - 1, r)
  }
  const path: Array<{ c: number; r: number }> = []
  let cur = goal
  if (!visited[goal]) return [{ c: 0, r: 0 }]
  while (cur !== -1) {
    const cell = cells[cur]
    path.push({ c: cell.c, r: cell.r })
    if (cur === start) break
    cur = parent[cur]
  }
  path.reverse()
  return path
}

function collectWallRectsNear(ball: Vec2, maze: Maze) {
  const rects: { x: number; y: number; w: number; h: number }[] = []
  const { cellSize: s, wallThickness: t, cols, rows, offsetX, offsetY } = maze
  const c = clamp(Math.floor((ball.x - offsetX) / s), 0, cols - 1)
  const r = clamp(Math.floor((ball.y - offsetY) / s), 0, rows - 1)
  const addCellWalls = (cc: number, rr: number) => {
    if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) return
    const cell = maze.cells[idx(cc, rr, cols)]
    const x0 = offsetX + cc * s
    const y0 = offsetY + rr * s
    if (cell.walls.top) rects.push({ x: x0, y: y0 - t / 2, w: s, h: t })
    if (cell.walls.bottom) rects.push({ x: x0, y: y0 + s - t / 2, w: s, h: t })
    if (cell.walls.left) rects.push({ x: x0 - t / 2, y: y0, w: t, h: s })
    if (cell.walls.right) rects.push({ x: x0 + s - t / 2, y: y0, w: t, h: s })
  }
  for (let rr = r - 1; rr <= r + 1; rr++) {
    for (let cc = c - 1; cc <= c + 1; cc++) {
      addCellWalls(cc, rr)
    }
  }
  const width = cols * s
  const height = rows * s
  rects.push({ x: offsetX, y: offsetY - t / 2, w: width, h: t })
  rects.push({ x: offsetX, y: offsetY + height - t / 2, w: width, h: t })
  rects.push({ x: offsetX - t / 2, y: offsetY, w: t, h: height })
  rects.push({ x: offsetX + width - t / 2, y: offsetY, w: t, h: height })
  return rects
}

function resolveCircleRectCollision(
  pos: Vec2,
  vel: Vec2,
  r: number,
  rect: { x: number; y: number; w: number; h: number },
  restitution = 0.12,
) {
  const closestX = clamp(pos.x, rect.x, rect.x + rect.w)
  const closestY = clamp(pos.y, rect.y, rect.y + rect.h)
  let dx = pos.x - closestX
  let dy = pos.y - closestY
  let dist = length(dx, dy)
  if (dist === 0) {
    const rectCenterX = rect.x + rect.w / 2
    const rectCenterY = rect.y + rect.h / 2
    const diffX = pos.x - rectCenterX
    const diffY = pos.y - rectCenterY
    if (Math.abs(diffX) > Math.abs(diffY)) {
      dx = Math.sign(diffX)
      dy = 0
    } else {
      dx = 0
      dy = Math.sign(diffY)
    }
    dist = 1
  }
  if (dist < r) {
    const n = normalize(dx, dy)
    const penetration = r - dist
    pos.x += n.x * penetration
    pos.y += n.y * penetration
    const vn = vel.x * n.x + vel.y * n.y
    if (vn < 0) {
      vel.x -= (1 + restitution) * vn * n.x
      vel.y -= (1 + restitution) * vn * n.y
    } else {
      vel.x -= Math.min(vn, 0) * n.x
      vel.y -= Math.min(vn, 0) * n.y
    }
    return true
  }
  return false
}

function useDeviceTilt() {
  const [state, setState] = useState<TiltState>({
    beta: 0,
    gamma: 0,
    ready: false,
    permissionNeeded: false,
  })
  const calibration = useRef<{ beta0: number; gamma0: number }>({ beta0: 0, gamma0: 0 })

  const handleOrientation = useCallback((e: DeviceOrientationEvent) => {
    const beta = e.beta ?? 0
    const gamma = e.gamma ?? 0
    setState((prev) => ({ ...prev, beta, gamma, ready: true }))
  }, [])

  const handleMotion = useCallback((e: DeviceMotionEvent) => {
    void e
  }, [])

  const requestPermission = useCallback(async () => {
    try {
      if (typeof (DeviceMotionEvent as any)?.requestPermission === "function") {
        const res = await (DeviceMotionEvent as any).requestPermission()
        if (res !== "granted") {
          setState((s) => ({ ...s, permissionNeeded: true, ready: false }))
          return false
        }
      }
      if (typeof (DeviceOrientationEvent as any)?.requestPermission === "function") {
        const res = await (DeviceOrientationEvent as any).requestPermission()
        if (res !== "granted") {
          setState((s) => ({ ...s, permissionNeeded: true, ready: false }))
          return false
        }
      }
      return true
    } catch {
      return true
    }
  }, [])

  const enable = useCallback(async () => {
    const ok = await requestPermission()
    if (!ok) {
      setState((s) => ({ ...s, permissionNeeded: true, ready: false }))
      return false
    }
    window.addEventListener("deviceorientation", handleOrientation, true)
    window.addEventListener("devicemotion", handleMotion, true)
    setTimeout(() => {
      setState((s) => ({ ...s, ready: true, permissionNeeded: false }))
    }, 200)
    return true
  }, [handleMotion, handleOrientation, requestPermission])

  const disable = useCallback(() => {
    window.removeEventListener("deviceorientation", handleOrientation, true)
    window.removeEventListener("devicemotion", handleMotion, true)
    setState((s) => ({ ...s, ready: false }))
  }, [handleMotion, handleOrientation])

  const calibrate = useCallback(() => {
    calibration.current.beta0 = state.beta
    calibration.current.gamma0 = state.gamma
  }, [state.beta, state.gamma])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const w = window.innerWidth
      const h = window.innerHeight
      const gamma = clamp((e.clientX / w - 0.5) * 2 * 45, -45, 45)
      const beta = clamp((e.clientY / h - 0.5) * 2 * 45, -45, 45)
      setState((prev) => ({ ...prev, gamma, beta }))
    }
    if (!("DeviceOrientationEvent" in window)) {
      window.addEventListener("mousemove", onMouseMove)
      setState((s) => ({ ...s, ready: true }))
    }
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
    }
  }, [])

  const getAccel = useCallback(
    (maxG = 1500) => {
      const gamma = state.gamma - calibration.current.gamma0
      const beta = state.beta - calibration.current.beta0
      const ax = Math.sin((gamma * Math.PI) / 180) * maxG
      const ay = Math.sin((beta * Math.PI) / 180) * maxG
      return { ax, ay }
    },
    [state.beta, state.gamma],
  )

  return {
    state,
    enable,
    disable,
    calibrate,
    getAccel,
  }
}

export default function TiltingMaze({ startLevel = 1 }: TiltingMazeProps) {
  const wallThickness = 10

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number>(0)
  const tickRef = useRef<(t: number) => void>(() => {})

  const ballPos = useRef<Vec2[]>([{ x: 0, y: 0 }])
  const ballVel = useRef<Vec2[]>([{ x: 0, y: 0 }])
  const currentMaze = useRef<Maze | null>(null)

  const device = useDeviceTilt()
  const disableRef = useRef<() => void>(() => {})
  useEffect(() => {
    disableRef.current = device.disable
  }, [device.disable])

  const [playing, setPlaying] = useState(false)
  const [won, setWon] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startTimeRef = useRef<number>(0)

  const levelRef = useRef(startLevel > 0 ? Math.floor(startLevel) : 1)
  const [level, setLevel] = useState(levelRef.current)

  const maxAccelRef = useRef(1700)
  const dampingRef = useRef(0.995)

  const [musicOn, setMusicOn] = useState(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const musicGainRef = useRef<GainNode | null>(null)
  const musicOscsRef = useRef<OscillatorNode[]>([])
  const lfoRef = useRef<OscillatorNode | null>(null)
  const lfoGainRef = useRef<GainNode | null>(null)

  const [photoImg, setPhotoImg] = useState<HTMLImageElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  
  useEffect(() => {
    const next = startLevel > 0 ? Math.floor(startLevel) : 1
    if (next !== levelRef.current) {
      levelRef.current = next
      setLevel(next)
      rebuildMazeForLevel(next)
    }
    
  }, [startLevel])

  
  const startMusic = useCallback(async () => {
    try {
      if (!audioCtxRef.current) {
        const Ctor: any = (window as any).AudioContext || (window as any).webkitAudioContext
        const ctx = new Ctor()
        audioCtxRef.current = ctx
        const gain = ctx.createGain()
        gain.gain.value = 0.045
        gain.connect(ctx.destination)
        musicGainRef.current = gain
        const lfo = ctx.createOscillator()
        lfo.type = "sine"
        lfo.frequency.value = 5
        const lfoGain = ctx.createGain()
        lfoGain.gain.value = 3
        lfo.connect(lfoGain)
        lfo.start()
        lfoRef.current = lfo
        lfoGainRef.current = lfoGain
        const freqs = [110, 138.59, 164.81]
        const oscs: OscillatorNode[] = []
        for (let i = 0; i < freqs.length; i++) {
          const o = ctx.createOscillator()
          o.type = i === 0 ? "sine" : i === 1 ? "triangle" : "sawtooth"
          o.frequency.value = freqs[i]
          o.detune.value = (i - 1) * 2
          lfoGain.connect(o.detune)
          o.connect(gain)
          o.start()
          oscs.push(o)
        }
        musicOscsRef.current = oscs
      } else if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume()
      }
      setMusicOn(true)
    } catch {}
  }, [])
  const stopMusic = useCallback(async () => {
    try {
      const ctx = audioCtxRef.current
      const gain = musicGainRef.current
      if (ctx && gain) {
        const now = ctx.currentTime
        gain.gain.cancelScheduledValues(now)
        gain.gain.setTargetAtTime(0.0001, now, 0.1)
        setTimeout(() => {
          musicOscsRef.current.forEach((o) => {
            try {
              o.stop()
              o.disconnect()
            } catch {}
          })
          musicOscsRef.current = []
          try {
            lfoRef.current?.stop()
            lfoRef.current?.disconnect()
            lfoGainRef.current?.disconnect()
          } catch {}
          lfoRef.current = null
          lfoGainRef.current = null
          try {
            gain.disconnect()
          } catch {}
          musicGainRef.current = null
          ctx.suspend().catch(() => {})
        }, 180)
      }
    } catch {
    } finally {
      setMusicOn(false)
    }
  }, [])
  const toggleMusic = useCallback(() => {
    if (musicOn) void stopMusic()
    else void startMusic()
  }, [musicOn, startMusic, stopMusic])

 
  function computeDifficulty(levelNum: number) {
    const cols = 11
    const rows = 17
    const totalCells = cols * rows
    const maxSpikesArea = Math.max(1, Math.floor(totalCells / 24))
    const maxResetsArea = Math.max(1, Math.floor(totalCells / 18))
    const spikeDesired = clamp(Math.floor(1 + levelNum * 0.6), 1, maxSpikesArea)
    const resetDesired = clamp(Math.floor(2 + levelNum * 0.8), 2, maxResetsArea)
    const spikePeriod = clamp(2.4 - levelNum * 0.06, 1.2, 2.4)
    const spikeDuty = clamp(0.45 + levelNum * 0.01, 0.45, 0.65)
    const maxAccel = clamp(1700 + levelNum * 45, 1700, 2500)
    const dampingPerFrame60fps = clamp(0.995 - levelNum * 0.0004, 0.986, 0.995)
    const twoBalls = levelNum >= 6
    const minGapCellsPath = 3
    const minGapCellsDeadEnd = 3
    return {
      cols,
      rows,
      spikeDesired,
      resetDesired,
      spikePeriod,
      spikeDuty,
      maxAccel,
      dampingPerFrame60fps,
      twoBalls,
      minGapCellsPath,
      minGapCellsDeadEnd,
    }
  }

  const getBallRadius = (maze: Maze) => Math.max(8, Math.min(16, maze.cellSize * 0.28))

  function getDeadEnds(cells: Cell[]) {
    const dead: Array<{ c: number; r: number }> = []
    for (const cell of cells) {
      const open =
        (cell.walls.top ? 0 : 1) + (cell.walls.right ? 0 : 1) + (cell.walls.bottom ? 0 : 1) + (cell.walls.left ? 0 : 1)
      if (open === 1) dead.push({ c: cell.c, r: cell.r })
    }
    return dead
  }

  const rebuildMazeForLevel = useCallback(
    (levelNum: number) => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return

      const dpr = window.devicePixelRatio || 1
      const padding = 16
      const cw = container.clientWidth - padding * 2
      const ch = container.clientHeight - padding * 2

      const {
        cols,
        rows,
        spikeDesired,
        resetDesired,
        spikePeriod,
        spikeDuty,
        maxAccel,
        dampingPerFrame60fps,
        twoBalls,
        minGapCellsPath,
        minGapCellsDeadEnd,
      } = computeDifficulty(levelNum)

      const cellSize = Math.floor(Math.min(cw / cols, ch / rows))
      const width = cellSize * cols
      const height = cellSize * rows
      const offsetX = Math.floor((container.clientWidth - width) / 2)
      const offsetY = Math.floor((container.clientHeight - height) / 2)

      canvas.width = Math.floor(container.clientWidth * dpr)
      canvas.height = Math.floor(container.clientHeight * dpr)
      canvas.style.width = `${container.clientWidth}px`
      canvas.style.height = `${container.clientHeight}px`
      const ctx = canvas.getContext("2d")
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const cells = randomMaze(cols, rows)
      const path = computePath(cells, cols, rows)

      const startCells: Array<{ c: number; r: number }> = twoBalls
        ? [
            { c: 0, r: 0 },
            { c: 0, r: rows - 1 },
          ]
        : [{ c: 0, r: 0 }]
      const startSpots: StartSpot[] = startCells.map(({ c, r }) => ({
        c,
        r,
        x: offsetX + c * cellSize + cellSize / 2,
        y: offsetY + r * cellSize + cellSize / 2,
      }))

      const forbid = new Set<string>()
      const markNeighbors = (c: number, r: number) => {
        for (let rr = r - 1; rr <= r + 1; rr++) {
          for (let cc = c - 1; cc <= c + 1; cc++) {
            if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) forbid.add(`${cc},${rr}`)
          }
        }
      }
      for (const s of startCells) markNeighbors(s.c, s.r)
      markNeighbors(cols - 1, rows - 1)

      const tempMaze: Maze = {
        cols,
        rows,
        cellSize,
        wallThickness,
        offsetX,
        offsetY,
        cells,
        resets: [],
        spikes: [],
        path,
        startSpots,
      }
      const radius = getBallRadius(tempMaze)
      const resetR = Math.max(6, Math.min(14, cellSize * 0.22))
      const spikeR = Math.max(6, Math.min(14, cellSize * 0.22))

      const pathBody = path.slice(2, Math.max(2, path.length - 2))
      const spikes: HazardSpike[] = []
      if (pathBody.length > 0) {
        const target = Math.min(spikeDesired, Math.floor(pathBody.length / 3) || 1)
        const chosen: Array<{ c: number; r: number }> = []
        const candidates = [...pathBody]
        for (let i = candidates.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
        }
        for (const cell of candidates) {
          if (spikes.length >= target) break
          if (forbid.has(`${cell.c},${cell.r}`)) continue
          if (chosen.some((p) => manhattan(p, cell) < minGapCellsPath)) continue
          chosen.push(cell)
          forbid.add(`${cell.c},${cell.r}`)
          const cx = offsetX + cell.c * cellSize + cellSize / 2
          const cy = offsetY + cell.r * cellSize + cellSize / 2
          spikes.push({
            x: cx,
            y: cy,
            r: spikeR,
            period: spikePeriod,
            duty: spikeDuty,
            phase: Math.random() * spikePeriod,
            cellC: cell.c,
            cellR: cell.r,
          })
        }
      }

      const pathSet = new Set(path.map(({ c, r }) => `${c},${r}`))
      const deadEnds = getDeadEnds(cells).filter(({ c, r }) => !pathSet.has(`${c},${r}`))
      for (let i = deadEnds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[deadEnds[i], deadEnds[j]] = [deadEnds[j], deadEnds[i]]
      }
      const resets: HazardReset[] = []
      const resetChosen: Array<{ c: number; r: number }> = []
      for (const d of deadEnds) {
        if (resets.length >= resetDesired) break
        const key = `${d.c},${d.r}`
        if (forbid.has(key)) continue
        if (resetChosen.some((p) => manhattan(p, d) < minGapCellsDeadEnd)) continue
        resetChosen.push(d)
        forbid.add(key)
        const cx = offsetX + d.c * cellSize + cellSize / 2
        const cy = offsetY + d.r * cellSize + cellSize / 2
        const biasX = (Math.random() < 0.5 ? -1 : 1) * Math.min(cellSize * 0.12, radius * 0.8)
        const biasY = (Math.random() < 0.5 ? -1 : 1) * Math.min(cellSize * 0.12, radius * 0.8)
        resets.push({ x: cx + biasX, y: cy + biasY, r: resetR })
      }

      currentMaze.current = {
        cols,
        rows,
        cellSize,
        wallThickness,
        offsetX,
        offsetY,
        cells,
        resets,
        spikes,
        path,
        startSpots,
      }

      maxAccelRef.current = maxAccel
      dampingRef.current = dampingPerFrame60fps

      const count = twoBalls ? 2 : 1
      ballPos.current = new Array(count).fill(0).map((_, i) => {
        const spot = currentMaze.current!.startSpots[Math.min(i, currentMaze.current!.startSpots.length - 1)]
        return { x: spot.x, y: spot.y }
      })
      ballVel.current = new Array(count).fill(0).map(() => ({ x: 0, y: 0 }))

      setWon(false)
      setElapsed(0)
    },
    [wallThickness],
  )

  
  useEffect(() => {
    rebuildMazeForLevel(levelRef.current)
    const onResize = () => rebuildMazeForLevel(levelRef.current)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [rebuildMazeForLevel])

  
  useEffect(() => {
    try {
      const dataUrl = localStorage.getItem("tm_profile_photo")
      if (dataUrl) {
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => setPhotoImg(img)
        img.src = dataUrl
      }
    } catch {}
  }, [])

  // Photo helpers
  const readFileAsDataURL = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result as string)
      fr.onerror = reject
      fr.readAsDataURL(file)
    })
  const downscaleDataUrl = async (dataUrl: string, maxSide = 512): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = "anonymous"
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement("canvas")
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h)
          resolve(canvas.toDataURL("image/jpeg", 0.85))
        } else {
          resolve(dataUrl)
        }
      }
      img.src = dataUrl
    })
  }
  const handlePhotoFile = useCallback(async (file: File) => {
    try {
      const raw = await readFileAsDataURL(file)
      const dataUrl = await downscaleDataUrl(raw, 512)
      const img = new Image()
      img.crossOrigin = "anonymous"
      img.onload = () => {
        setPhotoImg(img)
        try {
          localStorage.setItem("tm_profile_photo", dataUrl)
        } catch {}
      }
      img.src = dataUrl
    } catch {}
  }, [])
  const clearPhoto = useCallback(() => {
    setPhotoImg(null)
    try {
      localStorage.removeItem("tm_profile_photo")
    } catch {}
  }, [])

  
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, maze: Maze, tSec: number) => {
      const { cols, rows, cellSize: s, wallThickness: t, offsetX: ox, offsetY: oy } = maze
      ctx.clearRect(0, 0, ctx.canvas.clientWidth, ctx.canvas.clientHeight)
      ctx.fillStyle = "#fafaf9"
      ctx.fillRect(0, 0, ctx.canvas.clientWidth, ctx.canvas.clientHeight)
      ctx.fillStyle = "#f5f5f4"
      ctx.fillRect(ox, oy, cols * s, rows * s)

      // Start markers
      ctx.fillStyle = "#d4d4d4"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.font = `${Math.floor(s * 0.23)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
      for (const spot of maze.startSpots) {
        ctx.fillText("S", spot.x, spot.y)
      }

      
      const goalX = ox + (cols - 1) * s
      const goalY = oy + (rows - 1) * s
      const goalPad = s * 0.2
      const grad = ctx.createLinearGradient(goalX, goalY, goalX + s, goalY + s)
      grad.addColorStop(0, "#e6ffed")
      grad.addColorStop(1, "#d1fae5")
      ctx.fillStyle = grad
      ctx.fillRect(goalX + goalPad, goalY + goalPad, s - 2 * goalPad, s - 2 * goalPad)

     
      ctx.fillStyle = "#57534e"
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = maze.cells[idx(c, r, cols)]
          const x0 = ox + c * s
          const y0 = oy + r * s
          if (cell.walls.top) ctx.fillRect(x0, y0 - t / 2, s, t)
          if (cell.walls.bottom) ctx.fillRect(x0, y0 + s - t / 2, s, t)
          if (cell.walls.left) ctx.fillRect(x0 - t / 2, y0, t, s)
          if (cell.walls.right) ctx.fillRect(x0 + s - t / 2, y0, t, s)
        }
      }
      ctx.fillRect(ox, oy - t / 2, cols * s, t)
      ctx.fillRect(ox, oy + rows * s - t / 2, cols * s, t)
      ctx.fillRect(ox - t / 2, oy, t, rows * s)
      ctx.fillRect(ox + cols * s - t / 2, oy, t, rows * s)

      
      for (const hz of maze.resets) {
        ctx.beginPath()
        ctx.arc(hz.x, hz.y, hz.r, 0, Math.PI * 2)
        const g = ctx.createRadialGradient(hz.x - hz.r * 0.4, hz.y - hz.r * 0.4, hz.r * 0.2, hz.x, hz.y, hz.r)
        g.addColorStop(0, "#fee2e2")
        g.addColorStop(1, "#fecaca")
        ctx.fillStyle = g
        ctx.fill()
        ctx.strokeStyle = "rgba(185, 28, 28, 0.7)"
        ctx.lineWidth = Math.max(1, hz.r * 0.18)
        ctx.stroke()
      }

      
      for (const sp of maze.spikes) {
        const f = ((tSec + sp.phase) % sp.period) / sp.period
        const active = f < sp.duty
        ctx.save()
        ctx.translate(sp.x, sp.y)
        const spikes = 6
        const inner = sp.r * 0.35
        const outer = sp.r * (active ? 1.2 : 0.9)
        ctx.beginPath()
        for (let i = 0; i < spikes * 2; i++) {
          const angle = (i * Math.PI) / spikes
          const rad = i % 2 === 0 ? outer : inner
          const px = Math.cos(angle) * rad
          const py = Math.sin(angle) * rad
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        ctx.fillStyle = active ? "#f59e0b" : "rgba(234, 179, 8, 0.35)"
        ctx.fill()
        ctx.strokeStyle = active ? "rgba(146, 64, 14, 0.9)" : "rgba(146, 64, 14, 0.5)"
        ctx.lineWidth = Math.max(1, sp.r * 0.15)
        ctx.stroke()
        ctx.restore()
      }

      
      const radius = getBallRadius(maze)
      ballPos.current.forEach((b, idx) => {
        const tintAlpha = ballPos.current.length === 2 && idx === 1 ? 0.18 : 0
        if (photoImg) {
          ctx.save()
          ctx.globalAlpha = 0.22
          ctx.beginPath()
          ctx.ellipse(b.x + radius * 0.2, b.y + radius * 0.2, radius * 0.9, radius * 0.6, 0, 0, Math.PI * 2)
          ctx.fillStyle = "#000000"
          ctx.fill()
          ctx.restore()

          ctx.save()
          ctx.beginPath()
          ctx.arc(b.x, b.y, radius, 0, Math.PI * 2)
          ctx.clip()
          const sw = photoImg.naturalWidth || photoImg.width
          const sh = photoImg.naturalHeight || photoImg.height
          const side = Math.min(sw, sh)
          const sx = (sw - side) / 2
          const sy = (sh - side) / 2
          ctx.drawImage(photoImg, sx, sy, side, side, b.x - radius, b.y - radius, radius * 2, radius * 2)
          if (tintAlpha > 0) {
            ctx.fillStyle = `rgba(59,130,246,${tintAlpha})`
            ctx.fillRect(b.x - radius, b.y - radius, radius * 2, radius * 2)
          }
          ctx.restore()

          ctx.beginPath()
          ctx.arc(b.x, b.y, radius, 0, Math.PI * 2)
          ctx.strokeStyle = "rgba(0,0,0,0.35)"
          ctx.lineWidth = Math.max(1, radius * 0.08)
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.arc(b.x, b.y, radius, 0, Math.PI * 2)
          const ballGrad = ctx.createRadialGradient(
            b.x - radius * 0.5,
            b.y - radius * 0.5,
            radius * 0.2,
            b.x,
            b.y,
            radius,
          )
          ballGrad.addColorStop(0, idx === 1 ? "#1f2937" : "#262626")
          ballGrad.addColorStop(1, idx === 1 ? "#9ca3af" : "#737373")
          ctx.fillStyle = ballGrad
          ctx.fill()
          ctx.globalAlpha = 0.2
          ctx.beginPath()
          ctx.ellipse(b.x + radius * 0.2, b.y + radius * 0.2, radius * 0.9, radius * 0.6, 0, 0, Math.PI * 2)
          ctx.fillStyle = "#000000"
          ctx.fill()
          ctx.globalAlpha = 1
        }
      })
    },
    [photoImg],
  )

  
  const winRecordedRef = useRef(false)
  const step = useCallback(
    (t: number) => {
      const canvas = canvasRef.current
      const maze = currentMaze.current
      if (!canvas || !maze) return
      const ctx = canvas.getContext("2d")
      if (!ctx) return

      const last = lastTimeRef.current || t
      let dt = (t - last) / 1000
      dt = Math.min(dt, 0.033)
      lastTimeRef.current = t
      const tSec = t / 1000

      if (playing && !won) {
        const tilt = device.getAccel(maxAccelRef.current)
        const ax = -tilt.ax
        const ay = -tilt.ay

        const rBall = getBallRadius(maze)
        for (let i = 0; i < ballPos.current.length; i++) {
          ballVel.current[i].x += ax * dt
          ballVel.current[i].y += ay * dt
          const damping = Math.pow(dampingRef.current, dt * 60)
          ballVel.current[i].x *= damping
          ballVel.current[i].y *= damping
          ballPos.current[i].x += ballVel.current[i].x * dt
          ballPos.current[i].y += ballVel.current[i].y * dt

          const walls = collectWallRectsNear(ballPos.current[i], maze)
          for (let k = 0; k < walls.length; k++) {
            resolveCircleRectCollision(ballPos.current[i], ballVel.current[i], rBall, walls[k], 0.12)
          }

          for (const hz of maze.resets) {
            const dx = ballPos.current[i].x - hz.x
            const dy = ballPos.current[i].y - hz.y
            if (dx * dx + dy * dy <= (rBall + hz.r) * (rBall + hz.r)) {
              const spot = maze.startSpots[Math.min(i, maze.startSpots.length - 1)]
              ballPos.current[i].x = spot.x
              ballPos.current[i].y = spot.y
              ballVel.current[i].x = 0
              ballVel.current[i].y = 0
            }
          }
          for (const sp of maze.spikes) {
            const f = ((tSec + sp.phase) % sp.period) / sp.period
            const active = f < sp.duty
            if (!active) continue
            const dx = ballPos.current[i].x - sp.x
            const dy = ballPos.current[i].y - sp.y
            if (dx * dx + dy * dy <= (rBall + sp.r) * (rBall + sp.r)) {
              const spot = maze.startSpots[Math.min(i, maze.startSpots.length - 1)]
              ballPos.current[i].x = spot.x
              ballPos.current[i].y = spot.y
              ballVel.current[i].x = 0
              ballVel.current[i].y = 0
            }
          }
        }

        
        const gx = maze.offsetX + (maze.cols - 1) * maze.cellSize
        const gy = maze.offsetY + (maze.rows - 1) * maze.cellSize
        const pad = maze.cellSize * 0.25
        const inGoal = (b: Vec2) =>
          b.x > gx + pad && b.x < gx + maze.cellSize - pad && b.y > gy + pad && b.y < gy + maze.cellSize - pad

        const allInGoal = ballPos.current.every(inGoal)
        if (allInGoal) {
          
          if (!winRecordedRef.current) {
            winRecordedRef.current = true
            saveLevelTime(levelRef.current, (performance.now() - startTimeRef.current) / 1000)
          }
          setWon(true)
          setPlaying(false)
        }

        setElapsed((performance.now() - startTimeRef.current) / 1000)
      }

      draw(ctx, maze, tSec)
    },
    [device, draw, playing, won],
  )

  useEffect(() => {
    tickRef.current = step
  }, [step])

  
  useEffect(() => {
    const loop = (t: number) => {
      tickRef.current(t)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      try {
        disableRef.current()
      } catch {}
      try {
        void stopMusic()
      } catch {}
    }
  }, [stopMusic])

  
  const beginLevel = useCallback(() => {
    rebuildMazeForLevel(levelRef.current)
    startTimeRef.current = performance.now()
    setElapsed(0)
    setPlaying(true)
    setWon(false)
    winRecordedRef.current = false
    lastTimeRef.current = 0
  }, [rebuildMazeForLevel])

  const nextLevel = useCallback(() => {
    levelRef.current += 1
    setLevel(levelRef.current)
    beginLevel()
  }, [beginLevel])

  useEffect(() => {
    if (!won) return
    const id = setTimeout(() => {
      nextLevel()
    }, 1200)
    return () => clearTimeout(id)
  }, [won, nextLevel])

  
  const startGame = useCallback(async () => {
    const ok = await device.enable()
    if (!ok) return
    
    beginLevel()
    if (!musicOn) void startMusic()
  }, [device, beginLevel, musicOn, startMusic])

  const pauseGame = useCallback(() => setPlaying(false), [])
  const resumeGame = useCallback(() => {
    if (won) return
    startTimeRef.current = performance.now() - elapsed * 1000
    setPlaying(true)
  }, [elapsed, won])
  const resetGame = useCallback(() => {
    beginLevel()
  }, [beginLevel])

  return (
    <div
      ref={containerRef}
      className={cn("relative mx-auto h-[100svh] w-full touch-none select-none overflow-hidden", "p-2 sm:p-4")}
    >
      <canvas ref={canvasRef} className="block w-full h-full rounded-xl border border-neutral-200 shadow-sm bg-white" />

      
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handlePhotoFile(file)
          e.currentTarget.value = ""
        }}
      />

      
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <div className="flex items-center justify-between p-3 sm:p-4">
          <div className="pointer-events-auto">
            <Card className="px-3 py-1.5 text-sm font-medium bg-white/80 backdrop-blur border-neutral-200">
              <div className="flex items-center gap-4">
                <span>Level</span>
                <span className="tabular-nums">{level}</span>
                <span className="opacity-40">|</span>
                <span>Time</span>
                <span className="tabular-nums">{elapsed.toFixed(2)}s</span>
                <span className="opacity-40">|</span>
                <span>Balls</span>
                <span className="tabular-nums">{ballPos.current.length}</span>
              </div>
            </Card>
          </div>

          
          <div className="pointer-events-auto">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="border-neutral-300 text-neutral-800 bg-white/80 backdrop-blur"
                >
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[85vw] sm:w-96">
                <SheetHeader>
                  <SheetTitle>Game Menu</SheetTitle>
                </SheetHeader>

                <div className="mt-4 space-y-6">
                  <section>
                    <h4 className="text-sm font-medium text-neutral-700 mb-2">Game</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {!playing ? (
                        <Button
                          onClick={resumeGame}
                          disabled={won}
                          className="bg-neutral-800 text-white hover:bg-neutral-700"
                        >
                          Resume
                        </Button>
                      ) : (
                        <Button
                          onClick={pauseGame}
                          variant="outline"
                          className="border-neutral-300 text-neutral-800 bg-transparent"
                        >
                          Pause
                        </Button>
                      )}
                      <Button
                        onClick={resetGame}
                        variant="outline"
                        className="border-neutral-300 text-neutral-800 bg-transparent"
                      >
                        Restart Level
                      </Button>
                      <Button onClick={nextLevel} className="bg-emerald-600 text-white hover:bg-emerald-500 col-span-2">
                        Next Level
                      </Button>
                      <Button
                        onClick={device.calibrate}
                        variant="outline"
                        className="border-neutral-300 text-neutral-800 bg-transparent col-span-2"
                      >
                        Calibrate
                      </Button>
                    </div>
                  </section>

                  <section>
                    <h4 className="text-sm font-medium text-neutral-700 mb-2">Navigation</h4>
                    <div className="flex gap-2">
                      <Button asChild variant="outline" className="border-neutral-300 text-neutral-800 bg-transparent">
                        <Link href="/levels">Levels</Link>
                      </Button>
                      <Button asChild variant="outline" className="border-neutral-300 text-neutral-800 bg-transparent">
                        <Link href="/">Home</Link>
                      </Button>
                    </div>
                  </section>

                  <section>
                    <h4 className="text-sm font-medium text-neutral-700 mb-2">Audio</h4>
                    <div className="grid grid-cols-1 gap-2">
                      <Button
                        onClick={toggleMusic}
                        variant={musicOn ? "default" : "outline"}
                        className={
                          musicOn
                            ? "bg-neutral-800 text-white hover:bg-neutral-700"
                            : "border-neutral-300 text-neutral-800"
                        }
                      >
                        {musicOn ? "Mute Music" : "Play Music"}
                      </Button>
                    </div>
                  </section>

                  <section>
                    <h4 className="text-sm font-medium text-neutral-700 mb-2">Avatar</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        onClick={() => fileInputRef.current?.click()}
                        variant="outline"
                        className="border-neutral-300 text-neutral-800 bg-transparent"
                      >
                        {photoImg ? "Change Photo" : "Upload Photo"}
                      </Button>
                      <Button
                        onClick={clearPhoto}
                        disabled={!photoImg}
                        variant="outline"
                        className="border-neutral-300 text-neutral-800 bg-transparent disabled:opacity-50"
                      >
                        Clear Photo
                      </Button>
                    </div>
                  </section>

                  <section>
                    <h4 className="text-sm font-medium text-neutral-700 mb-2">Hazards</h4>
                    <p className="text-sm text-neutral-600">
                      Red orbs sit in dead-ends and reset you if touched. Yellow spikes lie on the main path but toggle
                      on/off, so there&apos;s always a timing window to pass. Two balls start at two different points
                      from level 6+. Tilt is inverted by design.
                    </p>
                  </section>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>

      
      {!device.state.ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur">
          <Card className="max-w-sm w-full p-5 border-neutral-200">
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-neutral-900">Enable Motion Controls</h2>
              <p className="text-sm text-neutral-600">
                This game uses your phone&apos;s gyroscope/accelerometer to move the ball. On iOS, tap the button below
                to grant access.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={async () => {
                    await device.enable()
                    startGame()
                  }}
                  className="bg-neutral-900 text-white hover:bg-neutral-800"
                >
                  Enable & Start
                </Button>
                <Button
                  onClick={() => {
                    startGame()
                  }}
                  variant="outline"
                  className="border-neutral-300 text-neutral-800"
                >
                  Start without sensors
                </Button>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  variant="outline"
                  className="border-neutral-300 text-neutral-800"
                >
                  Upload Photo
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      
      {won && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/75 backdrop-blur">
          <Card className="max-w-sm w-full p-6 border-neutral-200 text-center space-y-3">
            <h3 className="text-xl font-semibold text-neutral-900">Level Complete!</h3>
            <p className="text-neutral-700">
              Time: <span className="font-mono">{elapsed.toFixed(2)}s</span>
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <Button asChild className="bg-emerald-600 text-white hover:bg-emerald-500">
                <Link href="/levels">Levels</Link>
              </Button>
              <Button onClick={nextLevel} className="bg-neutral-900 text-white hover:bg-neutral-800">
                Next Level
              </Button>
              <Button
                onClick={resetGame}
                variant="outline"
                className="border-neutral-300 text-neutral-800 bg-transparent"
              >
                Replay Level
              </Button>
            </div>
            <p className="text-xs text-neutral-500 pt-1">Auto advancing…</p>
          </Card>
        </div>
      )}
    </div>
  )
}
