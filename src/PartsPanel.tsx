import {
  ANALOG_CHANNELS,
  DIGITAL_PINS,
  STEPS_PER_REV,
  channelLabel,
  pinLabel,
  type PartConfig,
  type PartType,
} from './sim/project'

const TYPE_LABEL: Record<PartType, string> = {
  led: 'LED',
  servo: 'Servo SG90',
  stepper: 'Stepper NEMA-17',
  button: 'Boton',
  pot: 'Potenciometro',
}

interface PinSelectProps {
  label: string
  value: number
  options: number[]
  format: (n: number) => string
  onChange: (n: number) => void
}

function PinSelect({ label, value, options, format, onChange }: PinSelectProps) {
  return (
    <label className="pin">
      <span className="muted">{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((o) => (
          <option key={o} value={o}>
            {format(o)}
          </option>
        ))}
      </select>
    </label>
  )
}

interface Props {
  parts: PartConfig[]
  status: Record<string, string>
  problems: string[]
  onChange: (parts: PartConfig[]) => void
  onAdd: (type: PartType) => void
  onPress: (id: string, down: boolean) => void
  onPot: (id: string, volts: number) => void
}

export function PartsPanel({ parts, status, problems, onChange, onAdd, onPress, onPot }: Props) {
  const update = (id: string, patch: Partial<PartConfig>) =>
    onChange(parts.map((p) => (p.id === id ? ({ ...p, ...patch } as PartConfig) : p)))

  return (
    <section>
      <div className="panel-head">
        <h2>Piezas y pines</h2>
        <select
          value=""
          onChange={(e) => e.target.value && onAdd(e.target.value as PartType)}
          aria-label="Agregar pieza"
        >
          <option value="">Agregar pieza...</option>
          {(Object.keys(TYPE_LABEL) as PartType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      {problems.length > 0 && (
        <ul className="problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="parts">
        {parts.map((p) => (
          <div className="part" key={p.id}>
            <div className="part-main">
              <strong>{TYPE_LABEL[p.type]}</strong>
              <span className="muted"> {p.id}</span>
              <div className="pins">
                {p.type === 'stepper' ? (
                  <>
                    <PinSelect label="STEP" value={p.stepPin} options={DIGITAL_PINS} format={pinLabel} onChange={(n) => update(p.id, { stepPin: n })} />
                    <PinSelect label="DIR" value={p.dirPin} options={DIGITAL_PINS} format={pinLabel} onChange={(n) => update(p.id, { dirPin: n })} />
                    <PinSelect label="Pasos/vuelta" value={p.stepsPerRev} options={STEPS_PER_REV} format={String} onChange={(n) => update(p.id, { stepsPerRev: n })} />
                  </>
                ) : p.type === 'pot' ? (
                  <PinSelect label="Canal" value={p.channel} options={ANALOG_CHANNELS} format={channelLabel} onChange={(n) => update(p.id, { channel: n })} />
                ) : (
                  <PinSelect label="Pin" value={p.pin} options={DIGITAL_PINS} format={pinLabel} onChange={(n) => update(p.id, { pin: n })} />
                )}
              </div>
              <div className="muted">{status[p.id] ?? ''}</div>
              {p.type === 'button' && (
                <button
                  className="hold"
                  onPointerDown={() => onPress(p.id, true)}
                  onPointerUp={() => onPress(p.id, false)}
                  onPointerLeave={() => onPress(p.id, false)}
                >
                  Mantener para presionar
                </button>
              )}
              {p.type === 'pot' && (
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.05}
                  defaultValue={2.5}
                  onChange={(e) => onPot(p.id, Number(e.target.value))}
                  aria-label={`Voltaje de ${p.id}`}
                />
              )}
            </div>
            <button onClick={() => onChange(parts.filter((x) => x.id !== p.id))}>Quitar</button>
          </div>
        ))}
        {parts.length === 0 && <p className="muted">Sin piezas. Agrega una arriba.</p>}
      </div>
    </section>
  )
}
