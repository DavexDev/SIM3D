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
- [x] M4: demo del brazo DUM-E con su firmware real (PCA9685 por I2C, stepper, protocolo serial)
- [ ] Primer release (v0.1) y pulido

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
- Piezas: LED, servo SG90, stepper con driver STEP/DIR, boton, potenciometro (A0 a A5) y driver de servos PCA9685 por I2C.
- La vista 3D anima el primer servo y el primer stepper del proyecto.

## Demo: brazo DUM-E con su firmware real

El ejemplo **DUM-E** corre sin modificar el firmware de [DUM-E](https://github.com/DavexDev/DUM-E)
(`examples/dume/`, copiado del commit `f5ef506`): sus 5 servos salen del PCA9685 emulado por I2C
(`Adafruit_PWMServoDriver` incluido), la base es un stepper NEMA-17 con driver STEP/DIR, y el brazo 3D
se mueve a partir de los pulsos reales, no de los mensajes `POS`. El panel de control envia el mismo
protocolo serial que la app web (`MODE,PLAY`, `MOVE,...`, `HOME`, `ESTOP`, `ARM`).

Notas de fidelidad:

- El buffer serial de RX del Uno es de 63 bytes: igual que en el hardware real, una rafaga de comandos
  puede perder bytes. El panel de control limita el ritmo, como la app web de DUM-E.
- Los servos se modelan ideales (500 a 2500 us = rango completo); no incluyen la calibracion de un servo fisico.
- La velocidad de emulacion depende del equipo (se muestra como `velocidad xN`; 1.00 es tiempo real).

## Licencia

MIT
