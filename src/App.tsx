import { useEffect, useRef, useState } from 'react'
import { CPU_HZ } from './sim/board'
import { Rig } from './sim/rig'
import {
  EXAMPLES,
  EXAMPLE_PROJECTS,
  newPart,
  parseProject,
  validate,
  type Firmware,
  type PartConfig,
  type PartType,
  type Project,
} from './sim/project'
import { DumeControls } from './DumeControls'
import { PartsPanel } from './PartsPanel'
import { Viewport } from './Viewport'
import './App.css'

const SERIAL_LIMIT = 20_000

export default function App() {
  const rigRef = useRef<Rig | null>(null)
  const [project, setProject] = useState<Project>(EXAMPLE_PROJECTS.dume)
  const projectRef = useRef(project)
  const [bootId, setBootId] = useState(0)
  const [serial, setSerial] = useState('')
  const [hidePos, setHidePos] = useState(true)
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [readout, setReadout] = useState<{ ms: number; speed: number; status: Record<string, string> }>({
    ms: 0,
    speed: 1,
    status: {},
  })

  useEffect(() => {
    projectRef.current = project
  })

  async function boot(fw: Firmware) {
    const hex = fw.kind === 'example' ? await (await fetch(`/examples/${fw.id}.hex`)).text() : fw.hex
    const rig = new Rig(hex)
    rig.board.onSerial = (b) => setSerial((s) => (s + String.fromCharCode(b)).slice(-SERIAL_LIMIT))
    rig.configure(projectRef.current.parts)
    rigRef.current = rig
    setSerial('')
    setBootId((n) => n + 1)
    setRunning(true)
  }

  useEffect(() => {
    void boot(project.firmware)
  }, [project.firmware])

  useEffect(() => {
    rigRef.current?.configure(project.parts)
  }, [project.parts])

  useEffect(() => {
    if (!running) return
    let raf = 0
    let last = performance.now()
    let speed = 1
    const frame = (now: number) => {
      const dt = Math.min(now - last, 50)
      last = now
      const rig = rigRef.current
      if (rig && dt > 0) {
        const ran = rig.run((dt / 1000) * CPU_HZ)
        speed = speed * 0.9 + ((ran / CPU_HZ) / (dt / 1000)) * 0.1
        setReadout({ ms: rig.board.timeMs, speed, status: rig.status() })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [running])

  const setParts = (parts: PartConfig[]) => setProject((p) => ({ ...p, parts }))
  const addPart = (type: PartType) => setProject((p) => ({ ...p, parts: [...p.parts, newPart(type, p)] }))

  function sendLine(line: string) {
    const board = rigRef.current?.board
    if (!board) return
    for (const ch of line + '\n') board.serialWrite(ch.charCodeAt(0))
  }

  function sendSerial(e: React.FormEvent) {
    e.preventDefault()
    sendLine(input)
    setInput('')
  }

  function exportProject() {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'sim3d-project.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function importProject(file: File | undefined) {
    if (!file) return
    try {
      setProject(parseProject(await file.text()))
      setMessage(`Proyecto cargado: ${file.name}`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'No se pudo cargar el proyecto')
    }
  }

  async function loadHex(file: File | undefined) {
    if (!file) return
    const hex = await file.text()
    if (!hex.startsWith(':')) {
      setMessage('El archivo no parece un .hex de Intel')
      return
    }
    setProject((p) => ({ ...p, firmware: { kind: 'hex', name: file.name, hex } }))
    setMessage(`Firmware cargado: ${file.name}`)
  }

  const fw = project.firmware
  const hasDume = project.parts.some((p) => p.type === 'pca9685')
  const shownSerial = hidePos
    ? serial
        .split('\n')
        .filter((l) => !l.startsWith('POS,'))
        .join('\n')
    : serial

  return (
    <main className="app">
      <header>
        <h1>SIM3D</h1>
        <p className="sub">Arduino Uno (ATmega328P) emulado en el navegador</p>
      </header>

      <div className="toolbar">
        <select
          value={fw.kind === 'example' ? fw.id : 'custom'}
          onChange={(e) => e.target.value !== 'custom' && setProject(EXAMPLE_PROJECTS[e.target.value])}
          aria-label="Ejemplo"
        >
          {EXAMPLES.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.label}
            </option>
          ))}
          {fw.kind === 'hex' && <option value="custom">{fw.name}</option>}
        </select>
        <button onClick={() => setRunning((r) => !r)}>{running ? 'Pausar' : 'Reanudar'}</button>
        <button onClick={() => void boot(project.firmware)}>Reiniciar</button>
        <span className="muted">
          t = {(readout.ms / 1000).toFixed(2)} s, velocidad x{readout.speed.toFixed(2)}
        </span>
      </div>

      <div className="toolbar">
        <button onClick={exportProject}>Exportar proyecto</button>
        <label className="filebtn">
          Importar proyecto
          <input type="file" accept=".json,application/json" onChange={(e) => void importProject(e.target.files?.[0])} />
        </label>
        <label className="filebtn">
          Cargar .hex
          <input type="file" accept=".hex" onChange={(e) => void loadHex(e.target.files?.[0])} />
        </label>
        {message && <span className="muted">{message}</span>}
      </div>

      <Viewport
        pose={() => {
          const rig = rigRef.current
          if (hasDume && rig) return { kind: 'dume', ...rig.dumePose() }
          return {
            kind: 'demo',
            servoDeg: rig?.firstServo?.angle ?? 90,
            stepperDeg: rig?.firstStepper?.angleDeg ?? 0,
          }
        }}
      />

      {hasDume && <DumeControls key={bootId} send={sendLine} />}

      <PartsPanel
        parts={project.parts}
        status={readout.status}
        problems={validate(project)}
        onChange={setParts}
        onAdd={addPart}
        onPress={(id, down) => rigRef.current?.press(id, down)}
        onPot={(id, v) => rigRef.current?.setPot(id, v)}
      />

      <div className="panel-head">
        <h2>Monitor serial</h2>
        <label className="muted">
          <input type="checkbox" checked={hidePos} onChange={(e) => setHidePos(e.target.checked)} /> Ocultar POS
        </label>
      </div>
      <pre className="serial">{shownSerial}</pre>
      <form onSubmit={sendSerial} className="toolbar">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Enviar al Arduino" />
        <button type="submit">Enviar</button>
      </form>
    </main>
  )
}
