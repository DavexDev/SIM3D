import type { AVRTWI, TWIEventHandler } from 'avr8js'

/** A device on the emulated I2C bus. */
export interface I2CDevice {
  readonly address: number
  /** Start of a transaction addressed to this device (SLA+W or SLA+R). */
  connect(write: boolean): void
  /** Returns false to NACK the byte. */
  writeByte(value: number): boolean
  readByte(): number
  stop(): void
}

/** Connects the ATmega's TWI peripheral to emulated I2C devices. Everything completes instantly. */
export class I2CBus implements TWIEventHandler {
  private readonly devices = new Map<number, I2CDevice>()
  private active: I2CDevice | undefined
  private readonly twi: AVRTWI

  constructor(twi: AVRTWI) {
    this.twi = twi
    twi.eventHandler = this
  }

  add(device: I2CDevice) {
    this.devices.set(device.address, device)
  }

  remove(device: I2CDevice) {
    if (this.devices.get(device.address) === device) this.devices.delete(device.address)
  }

  start() {
    this.twi.completeStart()
  }

  stop() {
    this.active?.stop()
    this.active = undefined
    this.twi.completeStop()
  }

  connectToSlave(addr: number, write: boolean) {
    this.active = this.devices.get(addr)
    this.active?.connect(write)
    this.twi.completeConnect(this.active !== undefined)
  }

  writeByte(value: number) {
    this.twi.completeWrite(this.active ? this.active.writeByte(value) : false)
  }

  readByte() {
    this.twi.completeRead(this.active ? this.active.readByte() : 0xff)
  }
}

const REG_LED0_ON_L = 0x06
const REG_PRESCALE = 0xfe
const OSCILLATOR_HZ = 25_000_000

/** PCA9685 16-channel PWM driver (the servo board DUM-E uses). Register auto-increment is always on. */
export class Pca9685 implements I2CDevice {
  readonly address: number
  private readonly regs = new Uint8Array(256)
  private pointer = 0
  private expectPointer = true

  constructor(address: number) {
    this.address = address
    this.regs[REG_PRESCALE] = 0x1e // power-on default (200 Hz)
  }

  connect() {
    this.expectPointer = true
  }

  writeByte(value: number) {
    if (this.expectPointer) {
      this.pointer = value
      this.expectPointer = false
    } else {
      this.regs[this.pointer] = value
      this.pointer = (this.pointer + 1) & 0xff
    }
    return true
  }

  readByte() {
    const value = this.regs[this.pointer]
    this.pointer = (this.pointer + 1) & 0xff
    return value
  }

  stop() {}

  get freqHz(): number {
    return OSCILLATOR_HZ / (4096 * (Math.max(this.regs[REG_PRESCALE], 3) + 1))
  }

  /** High time of channel `ch` in microseconds; 0 when the channel is off. */
  pulseUs(ch: number): number {
    const base = REG_LED0_ON_L + 4 * ch
    const onH = this.regs[base + 1]
    const offH = this.regs[base + 3]
    if (offH & 0x10) return 0 // full off
    const periodUs = 1e6 / this.freqHz
    if (onH & 0x10) return periodUs // full on
    const on = this.regs[base] | ((onH & 0x0f) << 8)
    const off = this.regs[base + 2] | ((offH & 0x0f) << 8)
    return (((off - on + 4096) % 4096) / 4096) * periodUs
  }
}
