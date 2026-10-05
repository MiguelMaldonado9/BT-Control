# BT Control

BT Control es una aplicación móvil de mando para los robots educativos de los
estudiantes de la Corporación Unificada Nacional de Educación Superior (CUN).
El proyecto nació porque los estudiantes no contaban con una aplicación móvil
para enviar controles a sus robots. Esta app ofrece una interfaz de botones y
joysticks configurable y conexión local por Bluetooth clásico SPP/RFCOMM o BLE
GATT, según el módulo y el firmware del robot.

La interfaz está hecha con React y Vite y se empaqueta para Android con
Capacitor. La configuración de botones, gatillos, tamaños y distribución queda
en el almacenamiento local del dispositivo. No se necesita cuenta, backend ni
servicio de Internet para usar el mando. El firmware del robot debe implementar
los caracteres o comandos que se configuren en la app.

## Funciones

- D-pad, botones A/B/X/Y, gatillos L2/R2 y dos joysticks configurables.
- Asignación local de comandos al presionar y, de forma opcional, al soltar.
- Personalización de posiciones; los controles pueden superponerse.
- Tamaño ajustable de joysticks (75–135 %) y terminal de salida (75–150 %).
- Conexión Android independiente por SPP/RFCOMM o BLE GATT.
- Orientación horizontal y modo inmersivo para aprovechar la pantalla.
- Indicador opcional de latencia con respuesta ACK del firmware.

Consulta la [guía técnica y de pruebas](./docs/PROJECT_GUIDE.md) para conocer
arquitectura, transporte, comandos, almacenamiento, permisos y resultados
verificados.

## Requisitos

- Node.js compatible con Vite 8 y npm.
- Para Android: JDK 21, Android Studio y Android SDK (plataforma 36).
- Para probar la comunicación: teléfono Android y un módulo/robot propio con
  Bluetooth SPP o BLE compatible. La interfaz se puede probar sin robot.

## Desarrollo web

```powershell
npm install
npm run dev
```

Comprobaciones del frontend:

```powershell
npm run lint
npm run typecheck
npm run build
```

## Compilar y probar en Android

```powershell
npm run build
npm run android:sync
```

Para compilar la APK de depuración desde PowerShell con JDK 21:

```powershell
$env:JAVA_HOME = Join-Path $env:LOCALAPPDATA 'Programs\Eclipse Adoptium\Temurin-21'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
Set-Location .\android
.\gradlew.bat lintDebug assembleDebug
```

El APK debug se genera en
`android\app\build\outputs\apk\debug\app-debug.apk`. No es una versión de
distribución: para publicar una release se debe configurar una clave de firma
segura fuera del repositorio.


## Pruebas y alcance de la validación

Las pruebas de interfaz pueden ejecutarse sin un robot. Las pruebas de conexión
real, transmisión al microcontrolador, recepción y ACK necesitan un módulo y
firmware compatibles. La [guía](./docs/PROJECT_GUIDE.md#estado-de-pruebas)
separa claramente los casos probados en teléfono/navegador de los pendientes
por falta de hardware de destino.
