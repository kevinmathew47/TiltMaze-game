"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { Menu } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"

type Cell = {
  c: number
  r: number
  walls: { top: boolean; right: boolean; bottom: boolean; left: boolean }
  visited?: boolean
}

type Maze = {
  cols: number
  rows: number
  cellSize: number
  wallThickness: number
  offsetX: number
  offsetY: number
  cells: Cell[]
}

type TiltState = {
  beta: number
  gamma: number
  ready: boolean
  permissionNeeded: boolean
}

type Vec2 = { x: number; y: number }

function idx(c: number, r: number, cols: number) {
  return r * cols + c
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

  return grid
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

  return { state, enable, disable, calibrate, getAccel }
}

export default function TiltingMaze() {
  const wallThickness = 10
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number>(0)
  const tickRef = useRef<(t: number) => void>(() => {})

  const ballPos = useRef<Vec2>({ x: 0, y: 0 })
  const ballVel = useRef<Vec2>({ x: 0, y: 0 })
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
  const levelRef = useRef(1)
  const [level, setLevel] = useState(1)

  const maxAccelRef = useRef(1800)
  const dampingRef = useRef(0.995)

  const [musicOn, setMusicOn] = useState(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const musicGainRef = useRef<GainNode | null>(null)
  const musicOscsRef = useRef<OscillatorNode[]>([])
  const lfoRef = useRef<OscillatorNode | null>(null)
  const lfoGainRef = useRef<GainNode | null>(null)

  const [photoImg, setPhotoImg] = useState<HTMLImageElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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
    } catch {
      // ignore
    }
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
      // ignore
    } finally {
      setMusicOn(false)
    }
  }, [])

  const toggleMusic = useCallback(() => {
    if (musicOn) void stopMusic()
    else void startMusic()
  }, [musicOn, startMusic, stopMusic])

  function computeDifficulty(levelNum: number, cw: number, ch: number) {
    const baseCols = 11
    const baseRows = 17
    const inc = levelNum - 1
    let desiredCols = baseCols + inc * 2
    let desiredRows = baseRows + inc * 2
    desiredCols = Math.min(41, desiredCols)
    desiredRows = Math.min(61, desiredRows)
    const minCell = 16

    let cols = desiredCols
    let rows = desiredRows
    while (cols > baseCols || rows > baseRows) {
      const cellSize = Math.floor(Math.min(cw / cols, ch / rows))
      if (cellSize >= minCell) break
      cols -= 2
      rows -= 2
    }
    cols = Math.max(baseCols, cols)
    rows = Math.max(baseRows, rows)

    const sizeMaxed = cols === desiredCols && rows === desiredRows
    const accelBase = 1800
    const accelGrowth = 60
    const dampingBase = 0.995
    const dampingDrop = 0.0008

    let extraLevels = 0
    if (sizeMaxed) {
      extraLevels = Math.max(0, levelNum - Math.floor(Math.min(cols - baseCols, rows - baseRows) / 2) - 1)
    }

    const maxAccel = accelBase + extraLevels * accelGrowth
    const dampingPerFrame60fps = Math.max(0.98, dampingBase - extraLevels * dampingDrop)

    return { cols, rows, maxAccel, dampingPerFrame60fps }
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

      const { cols, rows, maxAccel, dampingPerFrame60fps } = computeDifficulty(levelNum, cw, ch)
      maxAccelRef.current = maxAccel
      dampingRef.current = dampingPerFrame60fps

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
      currentMaze.current = {
        cols,
        rows,
        cellSize,
        wallThickness,
        offsetX,
        offsetY,
        cells,
      }

      ballPos.current = { x: offsetX + cellSize / 2, y: offsetY + cellSize / 2 }
      ballVel.current = { x: 0, y: 0 }
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
    (ctx: CanvasRenderingContext2D, maze: Maze) => {
      const { cols, rows, cellSize: s, wallThickness: t, offsetX: ox, offsetY: oy } = maze
      ctx.clearRect(0, 0, ctx.canvas.clientWidth, ctx.canvas.clientHeight)

      ctx.fillStyle = "#fafaf9"
      ctx.fillRect(0, 0, ctx.canvas.clientWidth, ctx.canvas.clientHeight)

      ctx.fillStyle = "#f5f5f4"
      ctx.fillRect(ox, oy, cols * s, rows * s)

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

      const b = ballPos.current
      const radius = Math.max(8, Math.min(16, s * 0.28))
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
        ballGrad.addColorStop(0, "#262626")
        ballGrad.addColorStop(1, "#737373")
        ctx.fillStyle = ballGrad
        ctx.fill()

        ctx.globalAlpha = 0.2
        ctx.beginPath()
        ctx.ellipse(b.x + radius * 0.2, b.y + radius * 0.2, radius * 0.9, radius * 0.6, 0, 0, Math.PI * 2)
        ctx.fillStyle = "#000000"
        ctx.fill()
        ctx.globalAlpha = 1
      }

      ctx.fillStyle = "#a3a3a3"
      ctx.font = `${Math.floor(s * 0.25)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText("S", ox + s / 2, oy + s / 2)
      ctx.fillText("G", goalX + s / 2, goalY + s / 2)
    },
    [photoImg],
  )

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

      if (playing && !won) {
        const tilt = device.getAccel(maxAccelRef.current)
        const ax = -tilt.ax
        const ay = -tilt.ay

        ballVel.current.x += ax * dt
        ballVel.current.y += ay * dt

        const damping = Math.pow(dampingRef.current, dt * 60)
        ballVel.current.x *= damping
        ballVel.current.y *= damping

        ballPos.current.x += ballVel.current.x * dt
        ballPos.current.y += ballVel.current.y * dt

        const r = Math.max(8, Math.min(16, maze.cellSize * 0.28))
        const walls = collectWallRectsNear(ballPos.current, maze)
        for (let i = 0; i < walls.length; i++) {
          resolveCircleRectCollision(ballPos.current, ballVel.current, r, walls[i], 0.12)
        }

        const goalC = maze.cols - 1
        const goalR = maze.rows - 1
        const gx = maze.offsetX + goalC * maze.cellSize
        const gy = maze.offsetY + goalR * maze.cellSize
        const pad = maze.cellSize * 0.25
        if (
          ballPos.current.x > gx + pad &&
          ballPos.current.x < gx + maze.cellSize - pad &&
          ballPos.current.y > gy + pad &&
          ballPos.current.y < gy + maze.cellSize - pad
        ) {
          setWon(true)
          setPlaying(false)
        }

        setElapsed((performance.now() - startTimeRef.current) / 1000)
      }

      draw(ctx, maze)
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
    levelRef.current = 1
    setLevel(1)
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
      <canvas ref={canvasRef} className="block h-full w-full rounded-xl border border-neutral-200 bg-white shadow-sm" />

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
            <Card className="bg-white/80 border-neutral-200 px-3 py-1.5 text-sm font-medium backdrop-blur">
              <div className="flex items-center gap-4">
                <span>Level</span>
                <span className="tabular-nums">{level}</span>
                <span className="opacity-40">{"|"}</span>
                <span>Time</span>
                <span className="tabular-nums">{elapsed.toFixed(2)}s</span>
              </div>
            </Card>
          </div>

          <div className="pointer-events-auto">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="bg-white/80 border-neutral-300 text-neutral-800 backdrop-blur"
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
                    <h4 className="mb-2 text-sm font-medium text-neutral-700">Game</h4>
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
                          className="border-neutral-300 bg-transparent text-neutral-800"
                        >
                          Pause
                        </Button>
                      )}
                      <Button
                        onClick={resetGame}
                        variant="outline"
                        className="border-neutral-300 bg-transparent text-neutral-800"
                      >
                        Restart Level
                      </Button>
                      <Button onClick={nextLevel} className="col-span-2 bg-emerald-600 text-white hover:bg-emerald-500">
                        Next Level
                      </Button>
                      <Button
                        onClick={device.calibrate}
                        variant="outline"
                        className="col-span-2 border-neutral-300 bg-transparent text-neutral-800"
                      >
                        Calibrate
                      </Button>
                    </div>
                  </section>

                  <section>
                    <h4 className="mb-2 text-sm font-medium text-neutral-700">Audio</h4>
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
                    <h4 className="mb-2 text-sm font-medium text-neutral-700">Avatar</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        onClick={() => fileInputRef.current?.click()}
                        variant="outline"
                        className="border-neutral-300 bg-transparent text-neutral-800"
                      >
                        {photoImg ? "Change Photo" : "Upload Photo"}
                      </Button>
                      <Button
                        onClick={clearPhoto}
                        disabled={!photoImg}
                        variant="outline"
                        className="border-neutral-300 bg-transparent text-neutral-800 disabled:opacity-50"
                      >
                        Clear Photo
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-neutral-500">
                      Tilt is inverted by design at all levels (confuse mode always on).
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
          <Card className="w-full max-w-sm border-neutral-200 p-5">
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
          <Card className="w-full max-w-sm border-neutral-200 p-6 text-center">
            <h3 className="text-xl font-semibold text-neutral-900">Level Complete!</h3>
            <p className="text-neutral-700">
              Time: <span className="font-mono">{elapsed.toFixed(2)}s</span>
            </p>
            <div className="pt-2 flex justify-center gap-2">
              <Button onClick={nextLevel} className="bg-emerald-600 text-white hover:bg-emerald-500">
                Next Level
              </Button>
              <Button
                onClick={resetGame}
                variant="outline"
                className="border-neutral-300 bg-transparent text-neutral-800"
              >
                Replay Level
              </Button>
            </div>
            <p className="pt-1 text-xs text-neutral-500">{"Auto advancing…"}</p>
          </Card>
        </div>
      )}
    </div>
  )
}
