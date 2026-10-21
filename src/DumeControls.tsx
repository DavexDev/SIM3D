import { useEffect, useRef, useState } from 'react'

const AXES = [
  { key: 'x', label: 'X base', max: 180 },
  { key: 'y', label: 'Y hombro', max: 180 },
  { key: 'w', label: 'W tramo medio', max: 270 },
  { key: 'z', label: 'Z codo', max: 180 },
  { key: 'r', label: 'R giro de pinza', max: 180 },
] as const

type AxisKey = (typeof AXES)[number]['key']

/** Firmware HOME pose (see DUM-E docs/PROTOCOL.md). */
const HOME = { x: 90, y: 136, w: 267, z: 180, r: 180 }

/** Sends the DUM-E serial protocol to the emulated board, like the DUM-E web app does. */
export function DumeControls({ send: sendNow }: { send: (line: string) => void }) {
  const [axes, setAxes] = useState<Record<AxisKey, number>>(HOME)
  const [closed, setClosed] = useState(false)
  const playing = useRef(false)

  // The Uno's serial RX buffer holds 63 bytes, so lines are released one per tick and
  // pending MOVEs are coalesced, like the throttling in the DUM-E web app.
  const queue = useRef<string[]>([])
  const sendRef = useRef(sendNow)
  useEffect(() => {
    sendRef.current = sendNow
  })
  useEffect(() => {
    const timer = setInterval(() => {
      const line = queue.current.shift()
      if (line) sendRef.current(line)
    }, 40)
    return () => clearInterval(timer)
  }, [])

  const send = (line: string) => {
    const i = line.startsWith('MOVE') ? queue.current.findIndex((l) => l.startsWith('MOVE')) : -1
    if (i >= 0) queue.current[i] = line
    else queue.current.push(line)
  }

  const move = (a: Record<AxisKey, number>, grip: boolean) => {
    if (!playing.current) {
      send('MODE,PLAY')
      playing.current = true
    }
    send(`MOVE,${a.x},${a.y},${a.w},${a.z},${a.r},${grip ? 1 : 0}`)
  }

  const set = (key: AxisKey, value: number) => {
    const next = { ...axes, [key]: value }
    setAxes(next)
    move(next, closed)
  }

  return (
    <section>
      <div className="panel-head">
        <h2>Control DUM-E (protocolo serial)</h2>
      </div>
      <div className="dume-grid">
        {AXES.map((a) => (
          <label key={a.key} className="axis">
            <span>
              {a.label} <span className="muted">{axes[a.key]} deg</span>
            </span>
            <input
              type="range"
              min={0}
              max={a.max}
              value={axes[a.key]}
              onChange={(e) => set(a.key, Number(e.target.value))}
            />
          </label>
        ))}
        <label className="axis">
          <span>Pinza</span>
          <button
            onClick={() => {
              setClosed(!closed)
              move(axes, !closed)
            }}
          >
            {closed ? 'Cerrada (abrir)' : 'Abierta (cerrar)'}
          </button>
        </label>
      </div>
      <div className="toolbar">
        <button
          onClick={() => {
            send('MODE,PLAY')
            playing.current = true
            send('HOME')
            setAxes(HOME)
            setClosed(false)
          }}
        >
          HOME
        </button>
        <button onClick={() => send('STOP')}>STOP</button>
        <button onClick={() => send('ESTOP')}>ESTOP</button>
        <button onClick={() => send('ARM')}>ARM</button>
        <button onClick={() => send('PING')}>PING</button>
      </div>
    </section>
  )
}
