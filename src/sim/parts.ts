import { CPU_HZ, type UnoBoard } from './board'

const US_PER_CYCLE = 1e6 / CPU_HZ

/** Every part listens to the board's pins and must be disposed when it is replaced. */
export interface Part {
  dispose(): void
}

/** LED on a digital output pin. */
export class Led implements Part {
  on = false
  private readonly off: () => void

  constructor(board: UnoBoard, pin: number) {
    this.on = board.pinHigh(pin)
    this.off = board.onPin((p, high) => {
      if (p === pin) this.on = high
    })
  }

  dispose() {
    this.off()
  }
}

/**
 * Hobby servo (SG90) driven by a PWM pulse. The angle follows the pulse width the way
 * the Arduino Servo library maps it: 544 us = 0 deg, 2400 us = 180 deg.
 */
export class Servo implements Part {
  angle = 90
  pulseUs = 0
  private riseCycles = 0
  private readonly off: () => void

  constructor(board: UnoBoard, pin: number) {
    this.off = board.onPin((p, high, cycles) => {
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

  dispose() {
    this.off()
  }
}

/** Stepper motor behind an A4988-style STEP/DIR driver: one step per rising STEP edge. */
export class Stepper implements Part {
  steps = 0
  readonly stepsPerRev: number
  private readonly off: () => void

  constructor(board: UnoBoard, stepPin: number, dirPin: number, stepsPerRev = 200) {
    this.stepsPerRev = stepsPerRev
    this.off = board.onPin((p, high) => {
      if (p === stepPin && high) this.steps += board.pinHigh(dirPin) ? 1 : -1
    })
  }

  get angleDeg(): number {
    return (this.steps / this.stepsPerRev) * 360
  }

  dispose() {
    this.off()
  }
}

/** Push button wired to GND: pressing pulls the pin LOW, releasing lets the pull-up win. */
export class Button implements Part {
  pressed = false
  private readonly board: UnoBoard
  private readonly pin: number

  constructor(board: UnoBoard, pin: number) {
    this.board = board
    this.pin = pin
    board.setPin(pin, true)
  }

  press(down: boolean) {
    this.pressed = down
    this.board.setPin(this.pin, !down)
  }

  dispose() {
    this.board.setPin(this.pin, true)
  }
}

/** Potentiometer between 0 V and 5 V on an analog channel (A0..A5). */
export class Pot implements Part {
  volts: number
  private readonly board: UnoBoard
  private readonly channel: number

  constructor(board: UnoBoard, channel: number, volts = 2.5) {
    this.board = board
    this.channel = channel
    this.volts = volts
    board.setAnalog(channel, volts)
  }

  set(volts: number) {
    this.volts = volts
    this.board.setAnalog(this.channel, volts)
  }

  dispose() {
    this.board.setAnalog(this.channel, 0)
  }
}
