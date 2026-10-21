import { useEffect, useRef, useState } from 'react'
import { UnoBoard, CPU_HZ } from './sim/board'
import { parseHex } from './sim/hex'
import { Servo, Stepper } from './sim/parts'
import { Viewport } from './Viewport'
import './App.css'

const LED_PIN = 13
const SERVO_PIN = 9
const STEP_PIN = 2
const DIR_PIN = 3

const EXAMPLES = [
  { id: 'servo_stepper', label: 'Servo + stepper' },
  { id: 'blink', label: 'Blink' },
]

interface Sim {
  board: UnoBoard
  servo: Servo
  stepper: Stepper
}

export default function App() {
  const simRef = useRef<Sim | null>(null)
  const [example, setExample] = useState(EXAMPLES[0].id)
  const [led, setLed] = useState(false)
  const [serial, setSerial] = useState('')
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [readout, setReadout] = useState({ ms: 0, servo: 0, pulse: 0, steps: 0 })

  async function load(id: string) {
    const hex = await (await fetch(`/examples/${id}.hex`)).text()
    const board = new UnoBoard(parseHex(hex))
    board.onPin((pin, high) => pin === LED_PIN && setLed(high))
    board.onSerial = (b) => setSerial((s) => s + String.fromCharCode(b))
    simRef.current = {
      board,
      servo: new Servo(board, SERVO_PIN),
      stepper: new Stepper(board, STEP_PIN, DIR_PIN),
    }
    setSerial('')
    setLed(false)
    setRunning(true)
  }

  useEffect(() => {
    void load(example)
  }, [example])

  useEffect(() => {
    if (!running) return
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(now - last, 50)
      last = now
      const sim = simRef.current
      if (sim) {
        sim.board.run((dt / 1000) * CPU_HZ)
        setReadout({
          ms: sim.board.timeMs,
          servo: sim.servo.angle,
          pulse: sim.servo.pulseUs,
          steps: sim.stepper.steps,
        })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [running])

  function sendSerial(e: React.FormEvent) {
    e.preventDefault()
    const board = simRef.current?.board
    if (!board) return
    for (const ch of input + '\n') board.serialWrite(ch.charCodeAt(0))
    setInput('')
  }

  return (
    <main className="app">
      <header>
        <h1>SIM3D</h1>
        <p className="sub">Arduino Uno (ATmega328P) emulado en el navegador</p>
      </header>

      <div className="toolbar">
        <select value={example} onChange={(e) => setExample(e.target.value)}>
          {EXAMPLES.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.label}
            </option>
          ))}
        </select>
        <button onClick={() => setRunning((r) => !r)}>{running ? 'Pausar' : 'Reanudar'}</button>
        <button onClick={() => load(example)}>Reiniciar</button>
        <span className="muted">t = {(readout.ms / 1000).toFixed(2)} s</span>
      </div>

      <Viewport
        pose={() => ({
          servoDeg: simRef.current?.servo.angle ?? 90,
          stepperDeg: simRef.current?.stepper.angleDeg ?? 0,
        })}
      />

      <section className="parts">
        <div className="part">
          <div className={`led ${led ? 'on' : ''}`} />
          <div>
            <strong>LED</strong>
            <div className="muted">
              Pin {LED_PIN}: {led ? 'HIGH' : 'LOW'}
            </div>
          </div>
        </div>
        <div className="part">
          <div>
            <strong>Servo SG90</strong>
            <div className="muted">
              Pin {SERVO_PIN}: {readout.servo.toFixed(0)} deg ({readout.pulse.toFixed(0)} us)
            </div>
          </div>
        </div>
        <div className="part">
          <div>
            <strong>Stepper NEMA-17</strong>
            <div className="muted">
              STEP {STEP_PIN} / DIR {DIR_PIN}: {readout.steps} pasos
            </div>
          </div>
        </div>
      </section>

      <h2>Monitor serial</h2>
      <pre className="serial">{serial}</pre>
      <form onSubmit={sendSerial} className="toolbar">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Enviar al Arduino" />
        <button type="submit">Enviar</button>
      </form>
    </main>
  )
}
