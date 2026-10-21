/*
 * DUM-E — Firmware Arduino Uno
 * Brazo robótico 4DOF + pinza con giro, controlado 100% desde la PC (app web + mando Marvo
 * GT88, ver web/src/gamepad/) vía protocolo serial — servos vía PCA9685 (I2C) + eje de base por
 * motor paso a paso (NEMA-17 + A4988). Ver protocolo completo en: docs/PROTOCOL.md
 *
 * v1.4: se quitaron los joysticks/botones físicos (control pasó a la PC, ver PROTOCOL.md) —
 * si estás buscando ese código, está en el historial de git antes de este cambio.
 *
 * Requiere la librería "Adafruit PWM Servo Driver Library" (Adafruit_PWMServoDriver).
 * Instalar desde: Arduino IDE > Herramientas > Administrar bibliotecas > buscar "Adafruit PWM Servo Driver"
 */

#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

// ---------- Pines ----------
// A0-A3 y D4/D5 quedaron libres (antes joysticks/botones físicos, ver nota v1.4 arriba).
const uint8_t PIN_STEP_X = 2;       // A4988 STEP (eje X / base, NEMA-17)
const uint8_t PIN_DIR_X = 3;        // A4988 DIR
// ENABLE del A4988 va cableado fijo a GND (siempre habilitado) — no usa pin del Arduino.
const uint8_t PIN_ARM_PULSE = 6;    // pulso digital: 1 por cada movimiento terminado de un brazo (Y, W o Z)
                                     // (reloj del contador de movimientos, ver docs/digital_logic_panel.md)
const unsigned long ARM_HOLD_MS = 300;       // un movimiento "termina" cuando el eje lleva este tiempo sin
                                             // avanzar: así el streaming del mando (~16 MOVE/s) cuenta como
                                             // UN solo movimiento por eje y no como decenas
const uint8_t PIN_PANEL_ARM = A1;    // ARMAR (mando -> app -> serial): pulso en alto; su flanco de subida carga Q=1 en el 74HC74
const uint8_t PIN_PANEL_ESTOP = A2;  // PARO: nivel alto mientras dura; una NAND (inversor) lo convierte en el CLR activo en bajo del 74HC74
                                      // (ver docs/digital_logic_panel.md, seccion 'Actualizacion 2026-10-19'; en reposo valen 0, con pull-down externo)
const unsigned long PANEL_ARM_PULSE_MS = 20;    // ancho del pulso de ARMAR
const unsigned long PANEL_ESTOP_HOLD_MS = 100;  // tiempo que PARO mantiene A2 en alto (el CLR es asincrono, basta un instante)
const unsigned long ARM_PULSE_WIDTH_MS = 5;  // ancho del pulso (y de la pausa entre pulsos), suficiente para un 74LS

// ---------- Canales PCA9685 (X ya no va acá, ver eje X más abajo) ----------
const uint8_t CH_Y = 1;
const uint8_t CH_Z = 2;
const uint8_t CH_GRIPPER = 3;
const uint8_t CH_W = 4;
const uint8_t CH_R = 5;

// ---------- PWM del servo (ajustar si hace falta calibrar) ----------
const uint16_t SERVO_PULSE_MIN = 102;   // ~0°   (a 50Hz, 12 bit)
const uint16_t SERVO_PULSE_MAX = 512;   // ~180° para un servo estándar (mismo pulso mín/máx que
                                         // el resto, ver AXIS_W_FULL_RANGE_DEG más abajo)

// El eje W (tramo intermedio) pasó a un servo de 270° en vez del MG996R estándar de 180° de los
// demás ejes (2026-09-08) -- mismo pulso PWM_MIN/PWM_MAX de arriba, pero ese mismo pulso barre
// 270° en vez de 180° (así es como vienen calibrados los servos "270°" comunes). Ver
// angleToPulse()/applyServo() más abajo, que reciben el rango de cada eje para no asumir 180
// siempre.
const float AXIS_W_FULL_RANGE_DEG = 270;

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);

// Prototipos explícitos: la generación automática de arduino-cli (ctags) no está insertando
// las de funciones con parámetro por defecto en esta versión del toolchain (1.5.1) — sin esto
// falla la compilación de setup()/loop()/writeGripper() con "was not declared in this scope".
struct Axis;
struct MoveWatch;
void watchAxis(MoveWatch &w, bool moved);
uint16_t angleToPulse(float angleDeg, float fullRangeDeg = 180);
void applyServo(Axis &axis, float fullRangeDeg = 180);

// ---------- Estado de ejes ----------
struct Axis {
  float angle;       // ángulo actual (float para interpolación suave)
  float target;       // objetivo (modo PLAY/HOME)
  float minAngle;
  float maxAngle;
  uint8_t channel;
};

// axisX.channel no se usa (X ya no es un servo PCA9685, ver "Eje X (stepper)" más abajo);
// angle/target/min/max sí se siguen usando igual que en los demás ejes.
//
// Pose "home" (2026-09-08): antes era el brazo apilado vertical (todos los ejes en 90°, o en
// 135° para W ahora que su rango es 0-270 -- ver AXIS_W_FULL_RANGE_DEG arriba, 135 es su punto
// medio igual que 90 lo es para los demás). Se cambió a una pose de brazo extendido/reclinado,
// buscada a mano con los sliders de Control Manual en la Vista 3D hasta que coincidió con una
// foto de referencia (confirmada visualmente, no solo estimada) -- pendiente de confirmar aún
// contra el brazo físico. Ver comentario del comando HOME más abajo.
Axis axisX = { 90, 90, 0, 180, 0 };
Axis axisY = { 136, 136, 0, 180, CH_Y };
Axis axisW = { 267, 267, 0, AXIS_W_FULL_RANGE_DEG, CH_W };   // rango 0-270, ver arriba
Axis axisZ = { 180, 180, 0, 180, CH_Z };
Axis axisR = { 180, 180, 0, 180, CH_R };   // giro de pinza: se mueve por MOVE/PLAY (mando -> app -> serial)

// ---------- Eje X (stepper: NEMA-17 + A4988, sin sensor de posición absoluta) ----------
// Relación real del turntable (ver Robot/turntable_components.json): engranaje de 12 dientes
// en el eje del motor -> engranaje de 27 dientes en el plato giratorio = reducción 27/12 = 2.25:1
// (el motor gira más rápido que la base, dando más torque — por eso se eligió NEMA-17 en vez de
// servo, el brazo pesa). Con el A4988 en microstepping 1/16 (3200 pasos/vuelta del motor):
//   pasos por grado de la BASE = 3200 * (27/12) / 360 = 20
// Si el engranaje real resulta distinto, ajustar únicamente esta constante.
const int STEPS_PER_DEG_X = 20;
const unsigned long STEP_PULSE_US = 3;   // ancho del pulso STEP (el A4988 pide ~1µs mínimo)

long stepperStepsX = 0;          // posición física actual, en pasos, relativa al arranque
unsigned long lastStepMicrosX = 0;

// Sin potenciómetro de referencia: al encender, se asume que la base está en su posición
// "home" (90°, igual que los demás ejes) — es lazo abierto, como cualquier stepper sin sensor.
// Si más adelante se agrega un potenciómetro en el turntable, este es el lugar para leerlo en
// setup() y calcular stepperStepsX inicial a partir del ángulo real medido.
float stepperAngleX() {
  return 90.0 + (float)stepperStepsX / STEPS_PER_DEG_X;
}

float gripperOpenAngle = 90;
float gripperClosedAngle = 20;
float gripperMin = 0;
float gripperMax = 180;
bool gripperClosed = false;
float gripperAngle = gripperOpenAngle;

// ---------- Modo ----------
// MANUAL ahora es simplemente "en espera": el brazo mantiene su posición e ignora los MOVE que
// le lleguen (los sigue registrando como target, pero no interpola hacia ellos) hasta que la PC
// mande MODE,PLAY de nuevo — es el estado en el que deja STOP. PLAY es el único modo que mueve
// el brazo, ya sea por reproducción de trayectoria o por control en vivo del mando (ver v1.4).
enum Mode { MANUAL, PLAY };
Mode mode = MANUAL;

// ---------- Velocidades ----------
float playSpeedDegPerSec = 60.0;     // velocidad de interpolación en modo PLAY/HOME

// ---------- Telemetría ----------
unsigned long lastPosSendMs = 0;
const unsigned long POS_INTERVAL_MS = 50;

// ---------- Lectura de línea serial ----------
String serialBuffer = "";

unsigned long lastLoopMs = 0;

// ---------- Detección de movimiento de los brazos (contador de flip-flops externo) ----------
// Se vigilan los tres brazos: inferior (Y), central (W) y superior (Z). Cada eje cuenta POR SEPARADO:
// cuando uno avanza y después se queda quieto ARM_HOLD_MS, se encola 1 pulso. Los pulsos salen por
// D6 de a uno (ARM_PULSE_WIDTH_MS de alto + ARM_PULSE_WIDTH_MS de pausa), para que dos ejes que
// terminan a la vez no se fundan en una sola cuenta. El contador 74LS76 cuenta en el flanco de bajada.
struct MoveWatch {
  unsigned long lastMoveMs;
  bool active;
};
MoveWatch watchY = { 0, false };
MoveWatch watchW = { 0, false };
MoveWatch watchZ = { 0, false };
uint8_t pendingArmPulses = 0;
bool armPulseHigh = false;
unsigned long armPulseEdgeMs = 0;

void watchAxis(MoveWatch &w, bool moved) {
  unsigned long now = millis();
  if (moved) {
    w.lastMoveMs = now;
    w.active = true;
  } else if (w.active && now - w.lastMoveMs >= ARM_HOLD_MS) {
    w.active = false;
    if (pendingArmPulses < 255) pendingArmPulses++;
  }
}

void updateArmPulse() {
  unsigned long now = millis();
  if (armPulseHigh) {
    if (now - armPulseEdgeMs >= ARM_PULSE_WIDTH_MS) {
      digitalWrite(PIN_ARM_PULSE, LOW);     // flanco de bajada: el contador cuenta aquí
      armPulseHigh = false;
      armPulseEdgeMs = now;
      pendingArmPulses--;
    }
  } else if (pendingArmPulses > 0 && now - armPulseEdgeMs >= ARM_PULSE_WIDTH_MS) {
    digitalWrite(PIN_ARM_PULSE, HIGH);
    armPulseHigh = true;
    armPulseEdgeMs = now;
  }
}

// Salidas del panel digital (ARM / ESTOP): sin delay(), igual que el pulso de movimiento.
bool panelArmHigh = false;
unsigned long panelArmStartMs = 0;
bool panelEstopHigh = false;
unsigned long panelEstopStartMs = 0;

void updatePanelOutputs() {
  unsigned long now = millis();
  if (panelArmHigh && now - panelArmStartMs >= PANEL_ARM_PULSE_MS) {
    digitalWrite(PIN_PANEL_ARM, LOW);
    panelArmHigh = false;
  }
  if (panelEstopHigh && now - panelEstopStartMs >= PANEL_ESTOP_HOLD_MS) {
    digitalWrite(PIN_PANEL_ESTOP, LOW);
    panelEstopHigh = false;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_STEP_X, OUTPUT);
  pinMode(PIN_DIR_X, OUTPUT);
  digitalWrite(PIN_STEP_X, LOW);
  pinMode(PIN_ARM_PULSE, OUTPUT);
  digitalWrite(PIN_ARM_PULSE, LOW);
  pinMode(PIN_PANEL_ARM, OUTPUT);
  digitalWrite(PIN_PANEL_ARM, LOW);
  pinMode(PIN_PANEL_ESTOP, OUTPUT);
  digitalWrite(PIN_PANEL_ESTOP, LOW);

  Wire.begin();
  pwm.begin();
  pwm.setPWMFreq(50);
  delay(10);

  applyServo(axisY);
  applyServo(axisW, AXIS_W_FULL_RANGE_DEG);
  applyServo(axisZ);
  applyServo(axisR);
  writeGripper();

  lastLoopMs = millis();
  Serial.print("READY,1.0\n");
}

void loop() {
  unsigned long now = millis();
  float dt = (now - lastLoopMs) / 1000.0;
  if (dt <= 0) dt = 0.001;
  lastLoopMs = now;

  readSerialCommands();

  float yBefore = axisY.angle;
  float wBefore = axisW.angle;
  float zBefore = axisZ.angle;
  if (mode == PLAY) {
    updateInterpolation(axisY, dt, playSpeedDegPerSec);
    updateInterpolation(axisW, dt, playSpeedDegPerSec);
    updateInterpolation(axisZ, dt, playSpeedDegPerSec);
    updateInterpolation(axisR, dt, playSpeedDegPerSec);
  }
  // En MANUAL no se interpola nada: el brazo se queda quieto (ver comentario en "enum Mode").
  // El eje X no usa updateInterpolation: al ser un stepper, el propio avance de pasos
  // (updateStepperX) ya limita la velocidad física, en MANUAL y en PLAY por igual.
  updateStepperX();
  watchAxis(watchY, axisY.angle != yBefore);
  watchAxis(watchW, axisW.angle != wBefore);
  watchAxis(watchZ, axisZ.angle != zBefore);
  updateArmPulse();
  updatePanelOutputs();

  applyServo(axisY);
  applyServo(axisW, AXIS_W_FULL_RANGE_DEG);
  applyServo(axisZ);
  applyServo(axisR);

  if (now - lastPosSendMs >= POS_INTERVAL_MS) {
    lastPosSendMs = now;
    sendPos();
  }
}

// ---------------- Interpolación (modo PLAY / HOME) ----------------

void updateInterpolation(Axis &axis, float dt, float speedDegPerSec) {
  float target = constrain(axis.target, axis.minAngle, axis.maxAngle);
  float diff = target - axis.angle;
  if (fabs(diff) < 0.5) {
    axis.angle = target;
    return;
  }
  float step = speedDegPerSec * dt;
  if (fabs(diff) < step) {
    axis.angle = target;
  } else {
    axis.angle += (diff > 0 ? step : -step);
  }
}

// ---------------- Eje X (stepper) ----------------

// A diferencia de los demás ejes (servo, se mueven casi instantáneo), el stepper avanza de a
// un paso por vez a un ritmo limitado por tiempo real (no por dt de loop) — no bloquea el resto
// del loop() mientras se mueve.
void updateStepperX() {
  long targetSteps = lround((axisX.target - 90.0) * STEPS_PER_DEG_X);
  targetSteps = constrain(targetSteps,
                           lround((axisX.minAngle - 90.0) * STEPS_PER_DEG_X),
                           lround((axisX.maxAngle - 90.0) * STEPS_PER_DEG_X));
  if (targetSteps == stepperStepsX) return;

  // En MANUAL, axisX.target no cambia (no hay joystick ni input físico), así que este bloque
  // en la práctica solo se ejecuta con mode == PLAY — se deja playSpeedDegPerSec siempre por
  // simplicidad, ya no hace falta distinguir una velocidad "manual" separada.
  float stepsPerSec = playSpeedDegPerSec * STEPS_PER_DEG_X;
  if (stepsPerSec < 1) stepsPerSec = 1;
  unsigned long stepIntervalUs = (unsigned long)(1000000.0 / stepsPerSec);

  unsigned long now = micros();
  if (now - lastStepMicrosX < stepIntervalUs) return;
  lastStepMicrosX = now;

  // Si el brazo gira al revés de lo esperado, invertir esta condición (más fácil que
  // recablear las bobinas del motor).
  bool increasing = targetSteps > stepperStepsX;
  digitalWrite(PIN_DIR_X, increasing ? HIGH : LOW);
  digitalWrite(PIN_STEP_X, HIGH);
  delayMicroseconds(STEP_PULSE_US);
  digitalWrite(PIN_STEP_X, LOW);
  stepperStepsX += increasing ? 1 : -1;
}

// ---------------- Pinza ----------------

void writeGripper() {
  gripperAngle = gripperClosed ? gripperClosedAngle : gripperOpenAngle;
  gripperAngle = constrain(gripperAngle, gripperMin, gripperMax);
  uint16_t pulse = angleToPulse(gripperAngle);
  pwm.setPWM(CH_GRIPPER, 0, pulse);
}

// ---------------- Servos ----------------

// fullRangeDeg: barrido físico total del servo (180° para todos salvo W, ver
// AXIS_W_FULL_RANGE_DEG) -- independiente de axis.minAngle/maxAngle, que son solo un clamp
// lógico de seguridad sobre el target y no deben afectar la conversión ángulo->pulso.
uint16_t angleToPulse(float angleDeg, float fullRangeDeg = 180) {
  angleDeg = constrain(angleDeg, 0, fullRangeDeg);
  return (uint16_t)map((long)(angleDeg * 10), 0, (long)(fullRangeDeg * 10), SERVO_PULSE_MIN, SERVO_PULSE_MAX);
}

void applyServo(Axis &axis, float fullRangeDeg = 180) {
  uint16_t pulse = angleToPulse(axis.angle, fullRangeDeg);
  pwm.setPWM(axis.channel, 0, pulse);
}

// ---------------- Telemetría ----------------

void sendPos() {
  Serial.print("POS,");
  Serial.print((int)round(stepperAngleX()));   // posición real del stepper, no la comandada (pueden diferir mientras se mueve)
  Serial.print(",");
  Serial.print((int)round(axisY.angle));
  Serial.print(",");
  Serial.print((int)round(axisW.angle));
  Serial.print(",");
  Serial.print((int)round(axisZ.angle));
  Serial.print(",");
  Serial.print((int)round(axisR.angle));
  Serial.print(",");
  Serial.print(gripperClosed ? 1 : 0);
  Serial.print(",");
  Serial.print(mode == MANUAL ? "MANUAL" : "PLAY");
  Serial.print(",");
  Serial.print(millis());
  Serial.print("\n");
}

// ---------------- Comandos entrantes ----------------

void readSerialCommands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n') {
      serialBuffer.trim();
      if (serialBuffer.length() > 0) {
        handleCommand(serialBuffer);
      }
      serialBuffer = "";
    } else if (c != '\r') {
      serialBuffer += c;
      if (serialBuffer.length() > 120) {
        serialBuffer = "";   // por seguridad ante basura/ruido en la línea
      }
    }
  }
}

void handleCommand(const String &line) {
  int firstComma = line.indexOf(',');
  String cmd = (firstComma == -1) ? line : line.substring(0, firstComma);
  cmd.toUpperCase();

  if (cmd == "PING") {
    Serial.print("PONG\n");
    return;
  }

  if (cmd == "MODE") {
    String arg = line.substring(firstComma + 1);
    arg.toUpperCase();
    if (arg == "MANUAL") {
      mode = MANUAL;
      ackOk("MODE,MANUAL");
    } else if (arg == "PLAY") {
      // al entrar a PLAY, el objetivo arranca en la posición actual (no salta)
      axisX.angle = axisX.target = stepperAngleX();   // X: la posición "real" es la del stepper, no axisX.angle
      axisY.target = axisY.angle;
      axisW.target = axisW.angle;
      axisZ.target = axisZ.angle;
      axisR.target = axisR.angle;
      mode = PLAY;
      ackOk("MODE,PLAY");
    } else {
      err("MODE desconocido");
    }
    return;
  }

  if (cmd == "MOVE") {
    // MOVE,x,y,w,z,r,pinza
    float vals[6];
    if (parseFloats(line.substring(firstComma + 1), vals, 6)) {
      axisX.target = vals[0];
      axisY.target = vals[1];
      axisW.target = vals[2];
      axisZ.target = vals[3];
      axisR.target = vals[4];
      gripperClosed = (vals[5] >= 0.5);
      writeGripper();
      ackOk("MOVE");
    } else {
      err("MOVE formato invalido");
    }
    return;
  }

  if (cmd == "HOME") {
    // Ver comentario junto a la definición de axisX/Y/W/Z/R más arriba: pose reclinada, no la
    // vertical (90/90/90/90/90) de antes -- confirmada a ojo contra una foto de referencia en la
    // Vista 3D, pendiente de confirmar contra el brazo físico.
    axisX.target = 90;
    axisY.target = 136;
    axisW.target = 267;
    axisZ.target = 180;
    axisR.target = 180;
    gripperClosed = false;
    writeGripper();
    mode = PLAY;
    ackOk("HOME");
    return;
  }

  if (cmd == "STOP") {
    axisX.angle = axisX.target = stepperAngleX();   // X: frena donde esté físicamente el stepper
    axisY.target = axisY.angle;
    axisW.target = axisW.angle;
    axisZ.target = axisZ.angle;
    axisR.target = axisR.angle;
    mode = MANUAL;
    ackOk("STOP");
    return;
  }

  if (cmd == "ARM") {
    // ARMAR el panel digital: pulso en A1 (flanco de subida en el CLK del 74HC74). No mueve el brazo.
    if (panelEstopHigh) { err("ARM durante ESTOP"); return; }
    digitalWrite(PIN_PANEL_ARM, HIGH);
    panelArmHigh = true;
    panelArmStartMs = millis();
    ackOk("ARM");
    return;
  }

  if (cmd == "ESTOP") {
    // PARO: hace lo mismo que STOP por software (frena donde esta y vuelve a MANUAL) y ademas sube A2,
    // que el panel convierte en CLR del 74HC74 (Q=0) y corta la alimentacion de los servos por hardware.
    axisX.angle = axisX.target = stepperAngleX();
    axisY.target = axisY.angle;
    axisW.target = axisW.angle;
    axisZ.target = axisZ.angle;
    axisR.target = axisR.angle;
    mode = MANUAL;
    digitalWrite(PIN_PANEL_ARM, LOW);
    panelArmHigh = false;
    digitalWrite(PIN_PANEL_ESTOP, HIGH);
    panelEstopHigh = true;
    panelEstopStartMs = millis();
    ackOk("ESTOP");
    return;
  }

  if (cmd == "SET_LIMITS") {
    // SET_LIMITS,eje,min,max
    String rest = line.substring(firstComma + 1);
    int c1 = rest.indexOf(',');
    int c2 = rest.indexOf(',', c1 + 1);
    if (c1 == -1 || c2 == -1) { err("SET_LIMITS formato invalido"); return; }
    String axisName = rest.substring(0, c1);
    axisName.toUpperCase();
    String minTok = rest.substring(c1 + 1, c2);
    String maxTok = rest.substring(c2 + 1);
    minTok.trim();
    maxTok.trim();
    if (!isValidNumberToken(minTok) || !isValidNumberToken(maxTok)) {
      err("SET_LIMITS formato invalido");
      return;
    }
    float minV = minTok.toFloat();
    float maxV = maxTok.toFloat();
    Axis *a = axisByName(axisName);
    if (a != nullptr) {
      a->minAngle = minV;
      a->maxAngle = maxV;
      ackOk("SET_LIMITS");
    } else if (axisName == "G") {
      gripperMin = minV;
      gripperMax = maxV;
      ackOk("SET_LIMITS");
    } else {
      err("Eje desconocido");
    }
    return;
  }

  if (cmd == "SET_GRIPPER") {
    // SET_GRIPPER,abierta,cerrada
    float vals[2];
    if (parseFloats(line.substring(firstComma + 1), vals, 2)) {
      gripperOpenAngle = vals[0];
      gripperClosedAngle = vals[1];
      writeGripper();
      ackOk("SET_GRIPPER");
    } else {
      err("SET_GRIPPER formato invalido");
    }
    return;
  }

  if (cmd == "SET_SPEED") {
    String tok = line.substring(firstComma + 1);
    tok.trim();
    if (!isValidNumberToken(tok)) { err("Velocidad invalida"); return; }
    float v = tok.toFloat();
    if (v > 0) {
      playSpeedDegPerSec = v;
      ackOk("SET_SPEED");
    } else {
      err("Velocidad invalida");
    }
    return;
  }

  err("Comando desconocido");
}

Axis *axisByName(const String &name) {
  if (name == "X") return &axisX;
  if (name == "Y") return &axisY;
  if (name == "W") return &axisW;
  if (name == "Z") return &axisZ;
  if (name == "R") return &axisR;
  return nullptr;
}

// ---------------- Autómata (validación de tokens numéricos) ----------------
// AFD que reconoce el lenguaje L = { números decimales, con signo "-" opcional } -- ej. "90",
// "-45.5", "0.001" -- y rechaza cualquier otra cosa (letras, comas de más, "1.2.3", etc.). Ver
// docs/automatas_lenguajes.md (materia de Lenguajes y Autómatas) para el diagrama de estados y
// la tabla de transición completa; esta función es la implementación literal de ese autómata.
// Sin esto, `String::toFloat()` es permisivo: basura como "abc" silenciosamente se vuelve 0.0 en
// vez de rechazar el comando, así que se usa ANTES de toFloat() en vez de en su reemplazo.
enum NumState { Q0, QS, Q1, Q2, Q3, QERR };

bool isValidNumberToken(const String &tok) {
  NumState state = Q0;
  for (unsigned int i = 0; i < tok.length(); i++) {
    char c = tok.charAt(i);
    bool isDigit = (c >= '0' && c <= '9');
    switch (state) {
      case Q0:   state = (c == '-') ? QS : (isDigit ? Q1 : QERR); break;
      case QS:   state = isDigit ? Q1 : QERR; break;
      case Q1:   state = isDigit ? Q1 : (c == '.' ? Q2 : QERR); break;
      case Q2:   state = isDigit ? Q3 : QERR; break;
      case Q3:   state = isDigit ? Q3 : QERR; break;
      case QERR: break;
    }
    if (state == QERR) return false;
  }
  return state == Q1 || state == Q3;   // Q1/Q3 = estados de aceptación (entero / decimal)
}

bool parseFloats(String s, float *out, int count) {
  int start = 0;
  for (int i = 0; i < count; i++) {
    int comma = s.indexOf(',', start);
    String token = (i == count - 1) ? s.substring(start) : s.substring(start, comma);
    token.trim();
    if (!isValidNumberToken(token)) return false;
    out[i] = token.toFloat();
    if (comma == -1 && i != count - 1) return false;
    start = comma + 1;
  }
  return true;
}

void ackOk(const char *cmd) {
  Serial.print("ACK,");
  Serial.print(cmd);
  Serial.print("\n");
}

void err(const char *msg) {
  Serial.print("ERR,");
  Serial.print(msg);
  Serial.print("\n");
}
