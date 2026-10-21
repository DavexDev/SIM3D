#include <Servo.h>

// Potenciometro en A0 controla el servo (pin 9). Boton a GND en el pin 4:
// mientras se presiona, enciende el LED del pin 13.
Servo servo;
unsigned long lastPrint = 0;

void setup() {
  pinMode(4, INPUT_PULLUP);
  pinMode(13, OUTPUT);
  servo.attach(9);
  Serial.begin(9600);
}

void loop() {
  int v = analogRead(A0);
  servo.write(map(v, 0, 1023, 0, 180));
  digitalWrite(13, digitalRead(4) == LOW);
  if (millis() - lastPrint > 250) {
    lastPrint = millis();
    Serial.print("A0=");
    Serial.println(v);
  }
}
