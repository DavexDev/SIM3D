import { CPU_HZ, UnoBoard } from './board'
import { Pca9685 } from './i2c'
import { parseHex } from './hex'
import { Button, Led, PcaServos, Pot, Servo, Stepper, type Part } from './parts'
import type { PartConfig } from './project'

type Runtime =
  | { cfg: Extract<PartConfig, { type: 'led' }>; part: Led }
  | { cfg: Extract<PartConfig, { type: 'servo' }>; part: Servo }
  | { cfg: Extract<PartConfig, { type: 'stepper' }>; part: Stepper }
  | { cfg: Extract<PartConfig, { type: 'button' }>; part: Button }
  | { cfg: Extract<PartConfig, { type: 'pot' }>; part: Pot }
  | { cfg: Extract<PartConfig, { type: 'pca9685' }>; part: PcaServos }

/** Pose of the DUM-E arm in protocol angles (X/Y/Z/R 0..180, W 0..270). */
export interface DumePose {
  x: number
  y: number
  w: number
  z: number
  r: number
  gripperClosed: boolean
}

/** Firmware power-on pose, used for channels the sketch has not driven yet. */
const DUME_POWER_ON = { y: 136, w: 267, z: 180, r: 180, gripper: 90 }
/** PCA9685 channels in the DUM-E firmware. */
const CH = { y: 1, z: 2, gripper: 3, w: 4, r: 5 }

/** One emulated board plus the virtual parts currently wired to it. */
export class Rig {
  readonly board: UnoBoard
  private runtimes: Runtime[] = []
  /** Pot voltages survive re-wiring, keyed by part id. */
  private potVolts = new Map<string, number>()
  /** PWM chips keep their registers when the wiring panel is edited. */
  private pcaDevices = new Map<number, Pca9685>()

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
        case 'pca9685': {
          let dev = this.pcaDevices.get(cfg.address)
          if (!dev) {
            dev = new Pca9685(cfg.address)
            this.pcaDevices.set(cfg.address, dev)
          }
          return { cfg, part: new PcaServos(this.board, dev, cfg.wide) }
        }
      }
    })
  }

  /**
   * Advance the MCU by up to `cycles`, but give up after `budgetMs` of wall time so the page
   * stays responsive when the emulation cannot keep up. Returns the cycles actually run.
   */
  run(cycles: number, budgetMs = 12): number {
    const start = this.board.cpu.cycles
    const deadline = performance.now() + budgetMs
    let left = cycles
    while (left > 0) {
      const chunk = Math.min(left, 20_000)
      this.board.run(chunk)
      left -= chunk
      if (performance.now() > deadline) break
    }
    return this.board.cpu.cycles - start
  }

  get(id: string): Runtime | undefined {
    return this.runtimes.find((r) => r.cfg.id === id)
  }

  has(type: PartConfig['type']): boolean {
    return this.runtimes.some((r) => r.cfg.type === type)
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

  /** First servo / stepper, which the demo 3D view animates. */
  get firstServo(): Servo | undefined {
    return this.runtimes.find((r) => r.cfg.type === 'servo')?.part as Servo | undefined
  }

  get firstStepper(): Stepper | undefined {
    return this.runtimes.find((r) => r.cfg.type === 'stepper')?.part as Stepper | undefined
  }

  /** DUM-E arm pose read from the PCA9685 outputs and the base stepper (home = 90 deg). */
  dumePose(): DumePose {
    const pca = this.runtimes.find((r) => r.cfg.type === 'pca9685')?.part as PcaServos | undefined
    const step = this.firstStepper
    const gripper = pca?.angle(CH.gripper) ?? DUME_POWER_ON.gripper
    return {
      x: 90 + (step?.angleDeg ?? 0),
      y: pca?.angle(CH.y) ?? DUME_POWER_ON.y,
      w: pca?.angle(CH.w) ?? DUME_POWER_ON.w,
      z: pca?.angle(CH.z) ?? DUME_POWER_ON.z,
      r: pca?.angle(CH.r) ?? DUME_POWER_ON.r,
      // Firmware default: open = 90 deg, closed = 20 deg.
      gripperClosed: gripper < 55,
    }
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
        case 'pca9685': {
          const driven = (r.part as PcaServos).driven()
          out[r.cfg.id] = driven.length
            ? driven.map((d) => `ch${d.ch}: ${d.deg.toFixed(0)} deg`).join(' / ')
            : 'sin pulsos'
          break
        }
      }
    }
    return out
  }
}

/** Emulated seconds per wall second, from two samples. */
export const simSpeed = (cycles: number, wallMs: number) => (cycles / CPU_HZ) / (wallMs / 1000)
