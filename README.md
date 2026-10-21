# SIM3D

Simulador de Arduino en el navegador con vista 3D. Alternativa abierta y ligera a Proteus,
pensada para la comunidad.

Corre el firmware real (`.hex`) sobre un ATmega328P emulado con [avr8js](https://github.com/wokwi/avr8js)
y conecta los pines a piezas virtuales (LED, servo, stepper) con modelos 3D en Three.js.

## Estado

MVP en desarrollo.

- [x] M1: emulación AVR, serial y LED en el pin 13
- [x] M2: servo SG90 y stepper STEP/DIR con vista 3D (Three.js)
- [x] M3: panel de piezas y pines, proyecto en JSON, carga de .hex propio
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

## Proyectos y firmware propio

- **Exportar / Importar proyecto**: guarda el cableado (piezas y pines) y el firmware en un `.json` compartible.
- **Cargar .hex**: corre cualquier sketch compilado para Arduino Uno (ATmega328P).
- Piezas: LED, servo SG90, stepper con driver STEP/DIR, boton y potenciometro (A0 a A5).
- La vista 3D anima el primer servo y el primer stepper del proyecto.

## Licencia

MIT
