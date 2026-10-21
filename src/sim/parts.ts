import { CPU_HZ, type UnoBoard } from './board'

const US_PER_CYCLE = 1e6 / CPU_HZ

/**
 * Hobby servo (SG90) driven by a PWM pulse. The angle follows the pulse width the way
 * the Arduino Servo library maps it: 544 us = 0 deg, 2400 us = 180 deg.
 */
export class Servo {
  angle = 90
  pulseUs = 0
  readonly pin: number
  private riseCycles = 0

  constructor(board: UnoBoard, pin: number) {
    this.pin = pin
    board.onPin((p, high, cycles) => {
      if (p !== pin) return
      if (high) {
        this.riseCycles = cycles
        return
      }
      const us = (cycles - this.riseCycles) * US_PER_CYCLE
      if (us < 400 || us > 2600) return // not a servo pulse
      this.pulseUs = us
      this.angle = Math.min(180, Math.max(0, ((us - 544) / (2400 - 544)) * 180))
    })
  }
}

/** Stepper motor behind an A4988-style STEP/DIR driver: one step per rising STEP edge. */
export class Stepper {
  steps = 0
  readonly stepsPerRev: number

  constructor(board: UnoBoard, stepPin: number, dirPin: number, stepsPerRev = 200) {
    this.stepsPerRev = stepsPerRev
    board.onPin((p, high) => {
      if (p === stepPin && high) this.steps += board.pinHigh(dirPin) ? 1 : -1
    })
  }

  get angleDeg(): number {
    return (this.steps / this.stepsPerRev) * 360
  }
}
