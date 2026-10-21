# SIM3D

Simulador de Arduino en el navegador con vista 3D. Alternativa abierta y ligera a Proteus,
pensada para la comunidad.

Corre el firmware real (`.hex`) sobre un ATmega328P emulado con [avr8js](https://github.com/wokwi/avr8js)
y conecta los pines a piezas virtuales (LED, servo, stepper) con modelos 3D en Three.js.

## Estado

MVP en desarrollo.

- [x] M1: emulación AVR, serial y LED en el pin 13
- [x] M2: servo SG90 y stepper STEP/DIR con vista 3D (Three.js)
- [ ] M3: panel de asignación de pines y proyecto en JSON
- [ ] M4: demo del brazo DUM-E y primer release

## Uso

```bash
npm install
npm run dev
```

Para compilar un sketch a `.hex` (requiere `arduino-cli` con el core `arduino:avr`):

```bash
arduino-cli compile --fqbn arduino:avr:uno --output-dir out examples/blink
cp out/blink.ino.hex public/examples/blink.hex
```

## Licencia

MIT
