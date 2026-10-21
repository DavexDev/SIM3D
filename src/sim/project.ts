/** A shareable SIM3D project: which firmware runs and how the virtual parts are wired. */

export type PartConfig =
  | { id: string; type: 'led'; pin: number }
  | { id: string; type: 'servo'; pin: number }
  | { id: string; type: 'stepper'; stepPin: number; dirPin: number; stepsPerRev: number }
  | { id: string; type: 'button'; pin: number }
  | { id: string; type: 'pot'; channel: number }

export type PartType = PartConfig['type']

export type Firmware =
  | { kind: 'example'; id: string }
  | { kind: 'hex'; name: string; hex: string }

export interface Project {
  version: 1
  firmware: Firmware
  parts: PartConfig[]
}

export const DIGITAL_PINS = Array.from({ length: 14 }, (_, i) => i)
export const ANALOG_CHANNELS = [0, 1, 2, 3, 4, 5]
export const STEPS_PER_REV = [200, 400, 800, 1600, 3200]

export const pinLabel = (pin: number) => `D${pin}`
export const channelLabel = (ch: number) => `A${ch}`

export const EXAMPLES = [
  { id: 'servo_stepper', label: 'Servo + stepper' },
  { id: 'pot_button', label: 'Potenciometro + boton' },
  { id: 'blink', label: 'Blink' },
]

export const EXAMPLE_PROJECTS: Record<string, Project> = {
  servo_stepper: {
    version: 1,
    firmware: { kind: 'example', id: 'servo_stepper' },
    parts: [
      { id: 'led1', type: 'led', pin: 13 },
      { id: 'servo1', type: 'servo', pin: 9 },
      { id: 'stepper1', type: 'stepper', stepPin: 2, dirPin: 3, stepsPerRev: 200 },
    ],
  },
  pot_button: {
    version: 1,
    firmware: { kind: 'example', id: 'pot_button' },
    parts: [
      { id: 'led1', type: 'led', pin: 13 },
      { id: 'servo1', type: 'servo', pin: 9 },
      { id: 'button1', type: 'button', pin: 4 },
      { id: 'pot1', type: 'pot', channel: 0 },
    ],
  },
  blink: {
    version: 1,
    firmware: { kind: 'example', id: 'blink' },
    parts: [{ id: 'led1', type: 'led', pin: 13 }],
  },
}

/** Digital pins a part occupies. */
export function digitalPinsOf(part: PartConfig): number[] {
  switch (part.type) {
    case 'stepper':
      return [part.stepPin, part.dirPin]
    case 'pot':
      return []
    default:
      return [part.pin]
  }
}

/** Human-readable wiring problems (pin conflicts, serial pins). Empty means OK. */
export function validate(project: Project): string[] {
  const problems: string[] = []
  const owners = new Map<number, string[]>()
  const channels = new Map<number, number>()
  for (const part of project.parts) {
    for (const pin of digitalPinsOf(part)) {
      owners.set(pin, [...(owners.get(pin) ?? []), part.id])
    }
    if (part.type === 'pot') channels.set(part.channel, (channels.get(part.channel) ?? 0) + 1)
    if (part.type === 'stepper' && part.stepPin === part.dirPin) {
      problems.push(`${part.id}: STEP y DIR no pueden usar el mismo pin`)
    }
  }
  for (const [pin, ids] of owners) {
    if (ids.length > 1 && !(ids.length === 2 && ids[0] === ids[1])) {
      problems.push(`${pinLabel(pin)} esta en uso por: ${ids.join(', ')}`)
    }
    if (pin <= 1) problems.push(`${pinLabel(pin)} lo usa el puerto serial (${ids.join(', ')})`)
  }
  for (const [ch, n] of channels) {
    if (n > 1) problems.push(`${channelLabel(ch)} tiene ${n} potenciometros`)
  }
  return problems
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/** Parse and validate a project JSON file. Throws an Error with a readable message. */
export function parseProject(text: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('El archivo no es un JSON valido')
  }
  const obj = raw as Partial<Project>
  if (!obj || obj.version !== 1) throw new Error('Version de proyecto no soportada')

  const fw = obj.firmware
  if (!fw || (fw.kind !== 'example' && fw.kind !== 'hex')) throw new Error('Firmware invalido')
  if (fw.kind === 'example' && !(fw.id in EXAMPLE_PROJECTS)) throw new Error(`Ejemplo desconocido: ${fw.id}`)
  if (fw.kind === 'hex' && (typeof fw.hex !== 'string' || !fw.hex.startsWith(':'))) {
    throw new Error('El firmware .hex incrustado es invalido')
  }

  if (!Array.isArray(obj.parts) || obj.parts.length > 32) throw new Error('Lista de piezas invalida')
  const ids = new Set<string>()
  const parts: PartConfig[] = obj.parts.map((p: PartConfig) => {
    if (typeof p.id !== 'string' || !p.id || ids.has(p.id)) throw new Error('Id de pieza invalido o repetido')
    ids.add(p.id)
    switch (p.type) {
      case 'led':
      case 'servo':
      case 'button':
        if (!isInt(p.pin, 0, 13)) throw new Error(`${p.id}: pin invalido`)
        return { id: p.id, type: p.type, pin: p.pin }
      case 'stepper':
        if (!isInt(p.stepPin, 0, 13) || !isInt(p.dirPin, 0, 13)) throw new Error(`${p.id}: pines invalidos`)
        if (!STEPS_PER_REV.includes(p.stepsPerRev)) throw new Error(`${p.id}: pasos por vuelta invalidos`)
        return { id: p.id, type: 'stepper', stepPin: p.stepPin, dirPin: p.dirPin, stepsPerRev: p.stepsPerRev }
      case 'pot':
        if (!isInt(p.channel, 0, 5)) throw new Error(`${p.id}: canal analogico invalido`)
        return { id: p.id, type: 'pot', channel: p.channel }
      default:
        throw new Error('Tipo de pieza desconocido')
    }
  })
  return { version: 1, firmware: fw as Firmware, parts }
}

/** Next free default wiring for a newly added part. */
export function newPart(type: PartType, project: Project): PartConfig {
  let n = 1
  while (project.parts.some((p) => p.id === `${type}${n}`)) n++
  const id = `${type}${n}`
  const used = new Set(project.parts.flatMap(digitalPinsOf))
  const free = (from: number) => {
    for (let pin = from; pin <= 13; pin++) if (!used.has(pin)) return pin
    return from
  }
  switch (type) {
    case 'stepper': {
      const stepPin = free(2)
      used.add(stepPin)
      return { id, type, stepPin, dirPin: free(2), stepsPerRev: 200 }
    }
    case 'pot': {
      const taken = new Set(project.parts.flatMap((p) => (p.type === 'pot' ? [p.channel] : [])))
      return { id, type, channel: ANALOG_CHANNELS.find((c) => !taken.has(c)) ?? 0 }
    }
    default:
      return { id, type, pin: free(2) }
  }
}
