import {
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  CPU,
  PinState,
  avrInstruction,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
} from 'avr8js'

export const CPU_HZ = 16_000_000

/** Arduino Uno pin number -> [port, bit]. Only digital pins for now. */
const UNO_PINS: Record<number, ['B' | 'D', number]> = {
  0: ['D', 0], 1: ['D', 1], 2: ['D', 2], 3: ['D', 3], 4: ['D', 4],
  5: ['D', 5], 6: ['D', 6], 7: ['D', 7], 8: ['B', 0], 9: ['B', 1],
  10: ['B', 2], 11: ['B', 3], 12: ['B', 4], 13: ['B', 5],
}

export type PinListener = (pin: number, high: boolean) => void

/** ATmega328P (Arduino Uno) running a compiled sketch. */
export class UnoBoard {
  readonly cpu: CPU
  readonly usart: AVRUSART
  private readonly ports: { B: AVRIOPort; C: AVRIOPort; D: AVRIOPort }
  private readonly pinListeners = new Set<PinListener>()
  onSerial: (byte: number) => void = () => {}

  constructor(program: Uint16Array) {
    this.cpu = new CPU(program)
    new AVRTimer(this.cpu, timer0Config)
    new AVRTimer(this.cpu, timer1Config)
    new AVRTimer(this.cpu, timer2Config)
    this.ports = {
      B: new AVRIOPort(this.cpu, portBConfig),
      C: new AVRIOPort(this.cpu, portCConfig),
      D: new AVRIOPort(this.cpu, portDConfig),
    }
    this.usart = new AVRUSART(this.cpu, usart0Config, CPU_HZ)
    this.usart.onByteTransmit = (b) => this.onSerial(b)

    for (const [pin, [port, bit]] of Object.entries(UNO_PINS)) {
      this.ports[port].addListener(() => {
        const high = this.ports[port].pinState(bit) === PinState.High
        this.pinListeners.forEach((fn) => fn(Number(pin), high))
      })
    }
  }

  onPin(fn: PinListener): () => void {
    this.pinListeners.add(fn)
    return () => this.pinListeners.delete(fn)
  }

  pinHigh(pin: number): boolean {
    const [port, bit] = UNO_PINS[pin]
    return this.ports[port].pinState(bit) === PinState.High
  }

  /** Advance the emulated MCU by the given number of CPU cycles. */
  run(cycles: number) {
    const end = this.cpu.cycles + cycles
    while (this.cpu.cycles < end) {
      avrInstruction(this.cpu)
      this.cpu.tick()
    }
  }

  get timeMs(): number {
    return (this.cpu.cycles / CPU_HZ) * 1000
  }
}
