#include <Servo.h>

// Servo en el pin 9, stepper con driver STEP/DIR en los pines 2 y 3.
const int STEP_PIN = 2;
const int DIR_PIN = 3;
Servo servo;

void moveStepper(bool forward, int steps) {
  digitalWrite(DIR_PIN, forward ? HIGH : LOW);
  for (int i = 0; i < steps; i++) {
    digitalWrite(STEP_PIN, HIGH);
    delayMicroseconds(1000);
    digitalWrite(STEP_PIN, LOW);
    delayMicroseconds(1000);
  }
}

void setup() {
  pinMode(STEP_PIN, OUTPUT);
  pinMode(DIR_PIN, OUTPUT);
  Serial.begin(9600);
  servo.attach(9);
  servo.write(0);
  delay(500);
  Serial.println("servo_stepper listo");
}

void loop() {
  servo.write(180);
  Serial.println("ida");
  moveStepper(true, 200);
  delay(500);
  servo.write(0);
  Serial.println("vuelta");
  moveStepper(false, 200);
  delay(500);
}
