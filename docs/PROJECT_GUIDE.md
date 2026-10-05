# Guía técnica y de uso — BT Control

**Actualizada:** 2026-10-05

BT Control es un mando local para Android. Su interfaz React/Vite se empaqueta
con Capacitor; el código Android implementa Bluetooth clásico SPP/RFCOMM y BLE
GATT como transportes separados. No necesita cuenta, backend ni Internet para
usar el mando. El microcontrolador y su firmware deben interpretar los bytes
que se configuren en la aplicación.

El problema que motiva el proyecto es que los estudiantes de la Corporación
Unificada Nacional de Educación Superior (CUN) no contaban con una aplicación
móvil para controlar sus robots educativos. BT Control busca cubrir esa
necesidad con un mando Android local, configurable y compatible con módulos
que expongan SPP o BLE GATT. La compatibilidad final depende del hardware y del
protocolo implementado por cada firmware.

## Contenido

- [Estructura del proyecto](#estructura-del-proyecto)
- [Arquitectura y flujo de comandos](#arquitectura-y-flujo-de-comandos)
- [Bluetooth clásico SPP](#bluetooth-clásico-spprfcomm)
- [Bluetooth LE GATT](#bluetooth-le-gatt)
- [Controles y datos locales](#controles-y-datos-locales)
- [ACK, latencia y distancia](#ack-latencia-y-distancia)
- [Requisitos y comandos de desarrollo](#requisitos-y-comandos-de-desarrollo)
- [Permisos y solución de problemas](#permisos-y-solución-de-problemas)
- [Matriz de verificación física](#matriz-de-verificación-física)
- [Estado de pruebas](#estado-de-pruebas)

## Estructura del proyecto

| Ruta | Responsabilidad |
| --- | --- |
| `src/main.jsx` | Monta React y carga los estilos globales. |
| `src/App.jsx` | Rutas de la aplicación y notificaciones. La ruta del mando es `/`. |
| `src/pages/Home.jsx` | Estado de conexión, selector, transporte de salida, TX, ACK y almacenamiento local. |
| `src/components/controller/ControlPad.jsx` | Presentación e interacción táctil con los botones y joysticks. |
| `src/components/controller/Joystick.jsx` | Convierte el movimiento del puntero táctil en direcciones discretas. |
| `src/components/controller/BluetoothDeviceSheet.jsx` | Selector de clásico/BLE, estados y selector de características GATT. |
| `src/components/controller/ButtonConfigSheet.jsx` | Configuración individual de carácter al pulsar y al soltar. |
| `src/components/controller/GlobalConfigSheet.jsx` | Configuración global y detección visual de caracteres duplicados. |
| `src/lib/controller-config.js` | Valores predeterminados, etiquetas, persistencia y detección de conflictos. |
| `src/lib/controller-layout.js` | Posiciones/tamaños iniciales y carga de la distribución local. |
| `src/lib/bluetooth-classic.js` | Bridge Capacitor del plugin Android RFCOMM. |
| `src/lib/bluetooth-le.js` | Bridge Capacitor del plugin Android GATT. |
| `android/app/src/main/java/com/mandobluetooth/controller/BluetoothClassicPlugin.java` | Permisos, descubrimiento clásico, emparejamiento, socket SPP, lectura RX y transmisión. |
| `android/app/src/main/java/com/mandobluetooth/controller/BluetoothLePlugin.java` | Descubrimiento LE, conexión GATT, servicios/características, notificaciones y escrituras. |
| `android/app/src/main/java/com/mandobluetooth/controller/MainActivity.java` | Registra los plugins nativos, fuerza pantalla completa y oculta temporalmente las barras del sistema. |
| `android/app/src/main/AndroidManifest.xml` | Declaraciones Bluetooth, características de dispositivo y orientación horizontal. |
| `capacitor.config.json` | ID Android `com.mandobluetooth.controller`, nombre y directorio web `dist`. |
| `vite.config.js` | Vite, plugin React y alias `@` hacia `src/`. |
| `package.json` / `package-lock.json` | Scripts y dependencias JavaScript. |

## Arquitectura y flujo de comandos

```text
Botón/joystick
    → ID lógico del control
    → carácter configurado (o carácter de liberación)
    → Home.jsx elige el bridge por el transporte conectado
    → BluetoothClassic.send (SPP) o BluetoothLE.send (GATT)
    → plugin Android nativo
    → microcontrolador/firmware
```

La UI de los controles no implementa sockets ni GATT. `Home.jsx` elige el
transporte asociado a la conexión y registra una transmisión TX cuando la
escritura del bridge termina correctamente. La aceptación de escritura por
Android no confirma que el firmware haya interpretado el comando; esa
confirmación requiere un protocolo de respuesta como ACK.

El botón **Conectar** abre el selector Bluetooth en Android. Al entrar, se
solicitan permisos, se ofrece activar la radio y se ejecutan descubrimientos
clásico y LE. El selector permite alternar entre ambos listados; un dispositivo
BLE no se trata como socket SPP. La dirección guardada y el transporte se usan
para ofrecer reconexión al último dispositivo.

## Bluetooth clásico SPP/RFCOMM

- Usa `BluetoothSocket` y el UUID de puerto serie
  `00001101-0000-1000-8000-00805F9B34FB`.
- Los módulos clásicos no emparejados inician el flujo de bonding de Android;
  una vez emparejados, se intenta abrir RFCOMM.
- Descubrimiento: lista emparejados y recibe los dispositivos anunciados por
  Android. Si Android informa un dispositivo de modo dual como BLE-only o
  classic, la clasificación depende de ese dato del sistema.
- La escritura transmite UTF-8 literalmente, sin añadir salto de línea ni
  terminador. La lectura SPP procesa líneas delimitadas por LF para las
  respuestas del protocolo ACK.
- La UI notifica la desconexión si se cierra el socket, se pierde el enlace o
  se desactiva Bluetooth. El usuario puede volver al selector y reconectar.

### Compatibilidad

HC-05 y HC-06 suelen ofrecer Bluetooth clásico con perfil serie. El modelo,
firmware y modo de funcionamiento concretos deben exponer RFCOMM SPP para que
esta ruta funcione. Un producto anunciado con el nombre “HC-05 BLE” puede ser
un dispositivo LE y debe usarse por GATT si no expone SPP.

## Bluetooth LE GATT

- El plugin nativo `BluetoothLePlugin` escanea con Android BLE y abre una
  conexión GATT LE; no crea un socket RFCOMM.
- Tras conectarse, Android descubre y devuelve los UUID de servicios y
  características, junto con sus propiedades de escritura/notificación.
- Para enviar, se selecciona una característica TX que admita
  `WRITE` o `WRITE_NO_RESPONSE`. No se adivina un UUID de fabricante.
- RX es opcional. Si se selecciona, la característica debe admitir
  `NOTIFY` o `INDICATE` y Android debe activar su descriptor CCCD.
- Las escrituras se serializan en una cola y los datos mayores al payload
  disponible se envían en fragmentos GATT consecutivos. Si el protocolo del
  firmware tiene mensajes más largos, este debe recomponer los fragmentos.
- Se negocia un MTU mayor cuando Android y el periférico lo permiten. La
  conexión sigue siendo BLE aunque la negociación de MTU no prospere.
- Dispositivo anterior, dirección y selección TX/RX quedan en almacenamiento
  local. Si la selección guardada deja de existir en el GATT del periférico,
  hay que volver a elegir las características.
- Si se pierde GATT o se apaga la radio, la app cierra recursos e indica la
  desconexión. Reconectar reabre GATT y redescubre servicios.

## Controles y datos locales

Los IDs de control son `up`, `down`, `left`, `right`, `a`, `b`, `x`, `y`, y
`l_up/l_down/l_left/l_right`, `r_up/r_down/r_left/r_right`, `l2` y `r2`.

Valores iniciales:

| Grupo | Direcciones / acciones |
| --- | --- |
| D-pad | Arriba `U`, abajo `D`, izquierda `L`, derecha `R` |
| Botones de acción | A `A`, B `B`, X `X`, Y `Y` |
| Gatillos | L2 `LT`, R2 `RT` |
| Joystick izquierdo | Arriba `8`, abajo `2`, izquierda `4`, derecha `6` |
| Joystick derecho | Arriba `T`, abajo `G`, izquierda `F`, derecha `H` |

La configuración permite cadenas arbitrarias; la app no añade delimitadores.
Se recomienda usar caracteres ASCII sencillos para firmware serie. Al soltar,
solo se transmite un comando si se configuró `releaseChar`. Un control sin
carácter no envía una cadena vacía; abre su configuración.

La configuración antigua se combina con los valores predeterminados para
rellenar controles nuevos sin reemplazar caracteres personalizados. Los
duplicados personalizados se muestran para corregirlos manualmente; no se
reescriben automáticamente. El editor global calcula los conflictos entre
caracteres de pulsación.

### Claves de almacenamiento WebView

| Clave local | Contenido |
| --- | --- |
| `ble_controller_buttons` | Caracteres de pulsación/liberación por ID lógico. |
| `ble_controller_layout` | Posiciones porcentuales de botones y joysticks. |
| `ble_controller_last_device` | Última dirección, nombre y transporte. Acepta el formato anterior de dirección como texto. |
| `ble_controller_gatt_config` | UUID de servicio y características TX/RX por dirección BLE. |

Los valores se guardan con `localStorage` del WebView; permanecen en el
dispositivo entre aperturas normales de la app, pero se borran al limpiar sus
datos o desinstalarla según las reglas de Android.

### Distribución de pantalla

Engranaje de ajustes → **Personalizar controles**. Arrastra los elementos por
el área del mando; las posiciones se limitan al escenario, pero los elementos
pueden superponerse. Pulsa **Guardar** para salir del modo de edición o
**Restaurar original** para volver a las posiciones y tamaños iniciales.
El tamaño de cada joystick puede ajustarse entre 75 % y 135 %; la terminal de
salida, entre 75 % y 150 %. El tamaño inicial es 100 %. Posiciones y tamaños se
guardan localmente y no cambian los caracteres ni la lógica de los controles.
El texto de crédito permanece centrado al pie de la interfaz y no forma parte
del escenario movible.

El menú de engranaje contiene la configuración de todos los controles, la
personalización, el cierre de la app y **Restablecer** (restaura asignaciones
de botones, no la distribución del mando). No hay botones de configuración
redundantes sobre los joysticks. El selector de transporte actualiza el rótulo
superior al transporte elegido cuando aún no hay conexión y al transporte
activo cuando ya se conectó.

En Android la actividad está bloqueada en horizontal, usa la pantalla completa
incluyendo el área de recorte cuando está disponible y oculta las barras de
estado/navegación; se pueden mostrar temporalmente con el gesto del sistema.

## ACK, latencia y distancia

El indicador de distancia muestra siempre `N/D`; no se estima una distancia a
partir de Bluetooth. La arquitectura puede ampliarse en el futuro con una
fuente de medición confiable, pero no se presenta RSSI como metros.

La medición de latencia es opcional y real:

1. Activa **ACK** en la pantalla del mando.
2. Cada 2 segundos la app envía `~PING:<id>\n`.
3. El microcontrolador responde `~ACK:<id>\n` con el mismo ID y LF (`0x0A`).
4. La app mide tiempo monotónico hasta el ACK correspondiente.
5. Sin ACK en 1,5 segundos, el valor vuelve a `N/D`.

El firmware debe separar esas líneas del parser de comandos. Por BLE se requiere
una RX seleccionada que envíe notificaciones/indicaciones con líneas LF; sin RX,
las órdenes TX pueden seguir utilizándose, pero el ACK no puede medirse.

## Requisitos y comandos de desarrollo

Requisitos de Android para compilar: JDK 21, Android SDK con plataforma 36 y
Android Build Tools instalados. La app declara `minSdk` 24 y `targetSdk` 36.
Vite 8 requiere una versión de Node.js compatible con Vite 8.

Desde PowerShell en la raíz del proyecto:

```powershell
npm install
npm run dev
```

Validaciones web:

```powershell
npm run build
npm run lint
npm run typecheck
```

Sincronizar la aplicación web y plugins Capacitor:

```powershell
npm run build
npm run android:sync
```

Compilar APK debug y ejecutar lint Android:

```powershell
$env:JAVA_HOME = Join-Path $env:LOCALAPPDATA 'Programs\Eclipse Adoptium\Temurin-21'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
Set-Location .\android
.\gradlew.bat lintDebug assembleDebug
```

Artefacto generado:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

Es una APK de depuración firmada con la clave debug local. Para crear una
versión de publicación hace falta configurar una clave de firma de release y
revisar el proceso de distribución; no se debe distribuir una clave privada
ni incluirla en el repositorio.

## Permisos y solución de problemas

- Android 12/API 31 o posterior: solicita `BLUETOOTH_CONNECT` y
  `BLUETOOTH_SCAN` en tiempo de ejecución.
- Android 6–11: usa permisos Bluetooth heredados y solicita ubicación para
  descubrimiento. La app no utiliza la posición del teléfono; versiones de
  Android pueden además requerir activar el servicio de ubicación para buscar.
- BLE se declara como característica opcional del dispositivo. Bluetooth
  clásico sí se declara requerido.
- Si se deniega un permiso, vuelve a concederlo desde Ajustes de Android y
  reinicia el flujo **Conectar**.
- Si no aparece un HC-05/HC-06, confirma que tiene alimentación, que anuncia
  Bluetooth clásico y que el sistema puede emparejarlo. No todos los módulos
  BLE o los dispositivos de modo dual exponen SPP.
- Si BLE conecta pero no transmite, revisa las propiedades GATT y elige una
  TX escribible. Para ACK/RX elige una característica con notificación o
  indicación.
- Si la pantalla queda `OFFLINE`, eso representa que no hay socket SPP ni GATT
  conectado; ver nombres en la lista de búsqueda no significa que exista una
  conexión activa.
- Para investigar una sesión Android por USB se puede usar
  `adb devices -l`, `adb logcat` y `adb shell dumpsys package
  com.mandobluetooth.controller`. No se debe marcar una prueba física como
  aprobada solo por compilar el APK.

## Matriz de verificación física

Realiza las pruebas con hardware propio, firmware compatible y la app instalada.
Para cada caso anota modelo/versión de Android, modelo de módulo, firmware,
estado mostrado y resultado observado. No conectes dispositivos desconocidos.

| Caso | Pasos | Criterio de aprobación | Estado |
| --- | --- | --- | --- |
| Instalación/inicio | Instalar APK y abrir BT Control. | La actividad abre y presenta el mando en horizontal. | Verificado en Infinix X6528 / Android 13 el 2026-10-05. |
| Permisos | Pulsar Conectar y conceder permisos cercanos/Bluetooth. | Android concede permisos y la búsqueda puede empezar. | Reportado previamente por el usuario; no se repitió la solicitud durante la prueba actual. |
| Descubrimiento clásico y BLE | Abrir el selector y revisar ambos tipos. | Lista ambos grupos sin confundir el transporte. | El teléfono mostró resultados clásicos/BLE; ninguno se conectó en esta prueba. |
| Controles de pantalla | Mover un control sobre otro, restaurar y guardar. | Permite superposición y la distribución vuelve a los valores iniciales. | Arrastre superpuesto y restauración verificados en teléfono el 2026-10-05. |
| Emparejamiento SPP | Seleccionar un HC-05/HC-06 propio sin emparejar y aceptar el diálogo Android. | SPP conecta y se muestra dispositivo real como online. | Pendiente de hardware SPP. |
| TX SPP | Pulsar controles repetidamente y observar el receptor serie/controlado. | Firmware recibe en orden los bytes configurados y TX no registra escrituras fallidas. | Pendiente de hardware/firmware SPP. |
| Liberación/joystick | Configurar `releaseChar`, cambiar direcciones y soltar. | Solo se emiten las direcciones válidas y la liberación configurada. | Pendiente de hardware/firmware SPP. |
| Desconexión/reconexión SPP | Desconectar desde app, apagar o alejar módulo y reconectar. | Estado vuelve a offline al perder enlace y reconecta al dispositivo elegido. | Pendiente de hardware SPP. |
| Descubrimiento/conexión BLE | Usar un periférico propio, inspeccionar GATT y elegir TX/RX. | Conecta GATT; solo se habilita TX compatible y las RX escogidas reciben notificaciones. | Pendiente de periférico BLE. |
| TX/RX BLE | Enviar varios comandos y comparar el receptor; recibir ACK por RX. | Comandos llegan al firmware y RX informa los datos reales. | Pendiente de periférico/firmware BLE. |
| Desconexión/reconexión BLE | Desconectar desde app o apagar el periférico; reconectar. | GATT se cierra, estado se actualiza y servicios se redescubren. | Pendiente de periférico BLE. |
| Latencia ACK | Activar ACK en un firmware que responda con el mismo ID. | Se mide RTT de respuesta; timeout retorna a `N/D`. | Pendiente de firmware SPP o BLE con RX. |
| Distancia | Revisar el indicador sin sensor/protocolo de medición fiable. | Muestra `N/D`, nunca una distancia inventada. | Comportamiento no inferido; el sensor físico no está disponible. |

### Pruebas sin robot realizadas el 2026-10-05

Se validó la APK instalada directamente en un Infinix X6528 con Android 13
(pantalla física 720×1612, densidad 320 dpi), sin seleccionar ni conectar un
robot o módulo de destino. La radio local del teléfono pudo descubrir
dispositivos cercanos; ninguno se conectó durante estas pruebas.

| Área | Resultado observado |
| --- | --- |
| Inicio y orientación | La actividad abrió en horizontal y quedó en primer plano. La captura real mostró la interfaz a ancho completo y el crédito centrado. |
| Selector de transporte | Se abrió el selector, se eligió Bluetooth LE y el rótulo cambió a `BLUETOOTH LE · GATT`; se vieron resultados de búsqueda BLE, sin conectarlos. |
| Configuración | Se abrió el menú y el panel global de controles sin modificar asignaciones. |
| Edición de distribución | Se arrastró el D-pad sobre otro control; el movimiento fue aceptado y produjo superposición. Después se usó **Restaurar original** y **Guardar**. |
| Tamaño | En el teléfono, joystick y terminal respondieron a los botones de ajuste (100 % a 105 %). Se restauraron sus valores iniciales antes de cerrar la prueba. |
| Responsive | En navegador a 806×360 CSS px el área del mando midió 806×276 px; no quedó margen izquierdo. La pantalla nativa también mostró el contenido ocupando el ancho visible. |
| Límites de tamaño | En la prueba de navegador los joysticks alcanzaron 75 % y 135 %, y la terminal 75 % y 150 %. No se transmitieron comandos porque la app estaba desconectada. |
| Calidad de código | `npm run build`, `npm run lint`, `npm run typecheck`, `npm run android:sync` y `assembleDebug` finalizaron correctamente. |

Estas son comprobaciones de instalación e interfaz, no una certificación de
Bluetooth con un robot. Emparejamiento, conexión SPP/GATT, recepción real de
comandos, desconexión y ACK continúan pendientes hasta disponer del módulo y
firmware de destino. Los dispositivos encontrados por el teléfono no se
seleccionaron ni conectaron.

### Alcance y procedencia de resultados

Las pruebas anotadas como verificadas el 2026-10-05 se realizaron con la APK
instalada en un Infinix X6528 mediante ADB y operaciones directas en pantalla.
Los reportes anteriores de instalación, permisos y persistencia fueron
informados por el usuario y se etiquetan como tales en la matriz. En ningún
caso se afirma que hubo comunicación validada con un robot: las pruebas de TX,
RX, emparejamiento y firmware requieren hardware de destino.

## Publicar el código en GitHub

El directorio de trabajo usado para esta guía no tenía un repositorio Git ni
un remoto configurado. El [README](../README.md#preparar-la-primera-publicación-en-github)
contiene los comandos para inicializar Git y publicar el primer `main` una vez
creado el repositorio vacío en GitHub. Antes de hacer público el código,
revisa `git status`, el `.gitignore` y define una licencia: este proyecto no
incluye una licencia de distribución.

## Dependencias

La app utiliza React, Vite, Tailwind y Capacitor Android; componentes de UI
existentes y `lucide-react` proveen la interfaz. Los transportes Bluetooth se
implementan con APIs Android nativas; no se agregó un SDK BLE de terceros.
