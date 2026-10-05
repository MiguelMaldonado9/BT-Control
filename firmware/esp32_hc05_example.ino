#include <BluetoothSerial.h>

BluetoothSerial SerialBT;

// Pines de ejemplo para L298N
const int ENA = 25;
const int IN1 = 26;
const int IN2 = 27;

const int ENB = 14;
const int IN3 = 12;
const int IN4 = 13;

int speedValue = 200;

void stopMotors() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);

  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);

  analogWrite(ENA, 0);
  analogWrite(ENB, 0);
}

void forward() {
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);

  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);

  analogWrite(ENA, speedValue);
  analogWrite(ENB, speedValue);
}

void backward() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);

  digitalWrite(IN3, LOW);
  digitalWrite(IN4, HIGH);

  analogWrite(ENA, speedValue);
  analogWrite(ENB, speedValue);
}

void left() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);

  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);

  analogWrite(ENA, speedValue);
  analogWrite(ENB, speedValue);
}

void right() {
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);

  digitalWrite(IN3, LOW);
  digitalWrite(IN4, HIGH);

  analogWrite(ENA, speedValue);
  analogWrite(ENB, speedValue);
}

void processCommand(char command) {

  switch (command) {

    case 'F':
      forward();
      break;

    case 'B':
      backward();
      break;

    case 'L':
      left();
      break;

    case 'R':
      right();
      break;

    case 'S':
      stopMotors();
      break;

    default:
      break;
  }
}

void setup() {

  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);

  pinMode(ENB, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);

  stopMotors();

  Serial.begin(115200);

  SerialBT.begin("ESP32-Car");

  Serial.println("ESP32 Bluetooth Car ready");
}

void loop() {

  if (SerialBT.available()) {

    char command = SerialBT.read();

    Serial.print("Command: ");
    Serial.println(command);

    processCommand(command);
  }

  if (Serial.available()) {

    char command = Serial.read();

    processCommand(command);
  }
}