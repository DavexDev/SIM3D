import { useEffect, useRef, useState } from 'react'
import { UnoBoard, CPU_HZ } from './sim/board'
import { parseHex } from './sim/hex'
import './App.css'

const LED_PIN = 13

export default function App() {
  const boardRef = useRef<UnoBoard | null>(null)
  const [led, setLed] = useState(false)
  const [serial, setSerial] = useState('')
  const [running, setRunning] = useState(false)
  const [simMs, setSimMs] = useState(0)

  async function load(url: string) {
    const hex = await (await fetch(url)).text()
    const board = new UnoBoard(parseHex(hex))
    board.onPin((pin, high) => pin === LED_PIN && setLed(high))
    board.onSerial = (b) => setSerial((s) => s + String.fromCharCode(b))
    boardRef.current = board
    setSerial('')
    setLed(false)
    setRunning(true)
  }

  useEffect(() => {
    void load('/examples/blink.hex')
  }, [])

  useEffect(() => {
    if (!running) return
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(now - last, 50)
      last = now
      boardRef.current?.run((dt / 1000) * CPU_HZ)
      setSimMs(boardRef.current?.timeMs ?? 0)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [running])

  return (
    <main className="app">
      <h1>sim3d</h1>
      <p className="sub">Arduino Uno (ATmega328P) emulado en el navegador, M1</p>
      <div className="row">
        <div className={`led ${led ? 'on' : ''}`} title="Pin 13" />
        <span>Pin 13: {led ? 'HIGH' : 'LOW'}</span>
        <span className="muted">t = {(simMs / 1000).toFixed(2)} s</span>
        <button onClick={() => setRunning((r) => !r)}>{running ? 'Pausar' : 'Reanudar'}</button>
        <button onClick={() => load('/examples/blink.hex')}>Reiniciar</button>
      </div>
      <h2>Monitor serial</h2>
      <pre className="serial">{serial}</pre>
    </main>
  )
}
