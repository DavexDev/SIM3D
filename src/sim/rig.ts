import { UnoBoard } from './board'
import { parseHex } from './hex'
import { Button, Led, Pot, Servo, Stepper, type Part } from './parts'
import type { PartConfig } from './project'

type Runtime =
  | { cfg: Extract<PartConfig, { type: 'led' }>; part: Led }
  | { cfg: Extract<PartConfig, { type: 'servo' }>; part: Servo }
  | { cfg: Extract<PartConfig, { type: 'stepper' }>; part: Stepper }
  | { cfg: Extract<PartConfig, { type: 'button' }>; part: Button }
  | { cfg: Extract<PartConfig, { type: 'pot' }>; part: Pot }

/** One emulated board plus the virtual parts currently wired to it. */
export class Rig {
  readonly board: UnoBoard
  private runtimes: Runtime[] = []
  /** Pot voltages survive re-wiring, keyed by part id. */
  private potVolts = new Map<string, number>()

  constructor(hex: string) {
    this.board = new UnoBoard(parseHex(hex))
  }

  /** Replace all parts with the given wiring; the MCU keeps running. */
  configure(configs: PartConfig[]) {
    for (const r of this.runtimes) (r.part as Part).dispose()
    this.runtimes = configs.map((cfg): Runtime => {
      switch (cfg.type) {
        case 'led':
          return { cfg, part: new Led(this.board, cfg.pin) }
        case 'servo':
          return { cfg, part: new Servo(this.board, cfg.pin) }
        case 'stepper':
          return { cfg, part: new Stepper(this.board, cfg.stepPin, cfg.dirPin, cfg.stepsPerRev) }
        case 'button':
          return { cfg, part: new Button(this.board, cfg.pin) }
        case 'pot':
          return { cfg, part: new Pot(this.board, cfg.channel, this.potVolts.get(cfg.id) ?? 2.5) }
      }
    })
  }

  run(cycles: number) {
    this.board.run(cycles)
  }

  get(id: string): Runtime | undefined {
    return this.runtimes.find((r) => r.cfg.id === id)
  }

  press(id: string, down: boolean) {
    const r = this.get(id)
    if (r?.cfg.type === 'button') (r.part as Button).press(down)
  }

  setPot(id: string, volts: number) {
    this.potVolts.set(id, volts)
    const r = this.get(id)
    if (r?.cfg.type === 'pot') (r.part as Pot).set(volts)
  }

  /** First servo / stepper, which the 3D view animates. */
  get firstServo(): Servo | undefined {
    return this.runtimes.find((r) => r.cfg.type === 'servo')?.part as Servo | undefined
  }

  get firstStepper(): Stepper | undefined {
    return this.runtimes.find((r) => r.cfg.type === 'stepper')?.part as Stepper | undefined
  }

  /** Short status text per part id, for the panel. */
  status(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const r of this.runtimes) {
      switch (r.cfg.type) {
        case 'led':
          out[r.cfg.id] = (r.part as Led).on ? 'HIGH' : 'LOW'
          break
        case 'servo': {
          const s = r.part as Servo
          out[r.cfg.id] = `${s.angle.toFixed(0)} deg (${s.pulseUs.toFixed(0)} us)`
          break
        }
        case 'stepper': {
          const s = r.part as Stepper
          out[r.cfg.id] = `${s.steps} pasos (${s.angleDeg.toFixed(1)} deg)`
          break
        }
        case 'button':
          out[r.cfg.id] = (r.part as Button).pressed ? 'presionado' : 'suelto'
          break
        case 'pot':
          out[r.cfg.id] = `${(r.part as Pot).volts.toFixed(2)} V`
          break
      }
    }
    return out
  }
}
