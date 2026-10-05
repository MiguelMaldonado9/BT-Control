package com.mandobluetooth.controller;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothStatusCodes;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.ArrayDeque;
import java.util.Queue;
import java.util.UUID;

@CapacitorPlugin(
    name = "BluetoothLE",
    permissions = {
        @Permission(alias = "bluetoothConnect", strings = { Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(alias = "bluetoothScan", strings = { Manifest.permission.BLUETOOTH_SCAN }),
        @Permission(alias = "legacyBluetooth", strings = {
            Manifest.permission.BLUETOOTH,
            Manifest.permission.BLUETOOTH_ADMIN
        }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class BluetoothLePlugin extends Plugin {

    private static final UUID CLIENT_CHARACTERISTIC_CONFIG =
        UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private final Queue<PendingWrite> writes = new ArrayDeque<>();
    private BluetoothGatt gatt;
    private BluetoothDevice connectedDevice;
    private BluetoothGattCharacteristic txCharacteristic;
    private BluetoothGattCharacteristic rxCharacteristic;
    private PluginCall connectCall;
    private PluginCall configurationCall;
    private PendingWrite activeWrite;
    private int activeWriteChunkSize;
    private boolean writeInFlight;
    private int mtu = 23;
    private volatile boolean scanning;
    private boolean receiverRegistered;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable scanTimeout = () -> {
        stopScanInternal();
        JSObject event = new JSObject();
        event.put("scanning", false);
        notifyListeners("bleScanFinished", event);
    };
    private final BroadcastReceiver bluetoothReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (BluetoothAdapter.ACTION_STATE_CHANGED.equals(intent.getAction())
                && intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
                    == BluetoothAdapter.STATE_OFF) {
                stopScanInternal();
                closeGatt(gatt);
                resolvePendingCalls("Bluetooth se desactivó.");
                notifyConnectionState(false, false, "Bluetooth se desactivó.");
            }
        }
    };

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            BluetoothDevice device = result.getDevice();
            JSObject event = deviceToJson(device);
            String advertisedName = result.getScanRecord() == null
                ? null
                : result.getScanRecord().getDeviceName();
            if (advertisedName != null && !advertisedName.isEmpty()) {
                event.put("name", advertisedName);
            }
            notifyListeners("bleDeviceFound", event);
        }

        @Override
        public void onScanFailed(int errorCode) {
            scanning = false;
            handler.removeCallbacks(scanTimeout);
            JSObject event = new JSObject();
            event.put("scanning", false);
            event.put("error", "Falló la búsqueda BLE (código " + errorCode + ").");
            notifyListeners("bleScanFinished", event);
        }
    };

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt callbackGatt, int status, int newState) {
            if (callbackGatt != gatt) {
                closeGatt(callbackGatt);
                return;
            }
            if (status != BluetoothGatt.GATT_SUCCESS) {
                failConnection(callbackGatt, "La conexión BLE falló (código " + status + ").");
                return;
            }
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                notifyConnectionState(true, true, null);
                try {
                    if (!callbackGatt.discoverServices()) {
                        failConnection(callbackGatt, "Android no pudo descubrir los servicios BLE.");
                    }
                } catch (SecurityException exception) {
                    failConnection(callbackGatt, "Android denegó el acceso a la conexión GATT.");
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                closeGatt(callbackGatt);
                notifyConnectionState(false, false, "La conexión BLE se cerró.");
                resolvePendingCalls("Se cerró la conexión BLE.");
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt callbackGatt, int status) {
            if (callbackGatt != gatt) return;
            if (status != BluetoothGatt.GATT_SUCCESS) {
                failConnection(callbackGatt, "No se pudieron descubrir los servicios BLE.");
                return;
            }
            JSObject event = deviceToJson(connectedDevice);
            event.put("connected", true);
            event.put("connecting", false);
            event.put("transport", "ble");
            event.put("services", serializeServices(callbackGatt));
            notifyListeners("bleServices", event);
            notifyConnectionState(true, false, null);
            try {
                if (hasBluetoothPermissions()) callbackGatt.requestMtu(247);
            } catch (SecurityException exception) {
                android.util.Log.w("BluetoothLE", "No se pudo solicitar un MTU BLE mayor.", exception);
            }
            PluginCall pendingCall = connectCall;
            connectCall = null;
            if (pendingCall != null) pendingCall.resolve(event);
        }

        @Override
        public void onDescriptorWrite(
            BluetoothGatt callbackGatt,
            BluetoothGattDescriptor descriptor,
            int status
        ) {
            if (callbackGatt != gatt || rxCharacteristic == null
                || descriptor.getCharacteristic() != rxCharacteristic) return;
            PluginCall pendingCall = configurationCall;
            configurationCall = null;
            if (pendingCall == null) return;
            if (status == BluetoothGatt.GATT_SUCCESS) {
                pendingCall.resolve();
            } else {
                pendingCall.reject("No se pudieron activar las notificaciones BLE.", "BLE_NOTIFY_FAILED");
            }
        }

        @Override
        public void onCharacteristicWrite(
            BluetoothGatt callbackGatt,
            BluetoothGattCharacteristic characteristic,
            int status
        ) {
            if (callbackGatt != gatt) return;
            PluginCall completedCall = null;
            synchronized (writes) {
                writeInFlight = false;
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    if (activeWrite != null) completedCall = activeWrite.call;
                    activeWrite = null;
                } else if (activeWrite != null) {
                    activeWrite.offset += activeWriteChunkSize;
                    if (activeWrite.offset >= activeWrite.value.length) {
                        completedCall = activeWrite.call;
                        activeWrite = null;
                    }
                }
            }
            if (completedCall != null) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    completedCall.resolve();
                } else {
                    completedCall.reject("Falló la escritura BLE (código " + status + ").", "BLE_WRITE_FAILED");
                }
            }
            processNextWrite();
        }

        @Override
        public void onMtuChanged(BluetoothGatt callbackGatt, int negotiatedMtu, int status) {
            if (callbackGatt == gatt && status == BluetoothGatt.GATT_SUCCESS) {
                mtu = Math.max(23, negotiatedMtu);
            }
        }

        @Override
        public void onCharacteristicChanged(
            BluetoothGatt callbackGatt,
            BluetoothGattCharacteristic characteristic
        ) {
            if (callbackGatt == gatt && characteristic == rxCharacteristic) {
                publishReceivedData(characteristic.getValue());
            }
        }

        @Override
        public void onCharacteristicChanged(
            BluetoothGatt callbackGatt,
            BluetoothGattCharacteristic characteristic,
            byte[] value
        ) {
            if (callbackGatt == gatt && characteristic == rxCharacteristic) {
                publishReceivedData(value);
            }
        }
    };

    @Override
    public void load() {
        IntentFilter filter = new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED);
        ContextCompat.registerReceiver(
            getContext(),
            bluetoothReceiver,
            filter,
            ContextCompat.RECEIVER_EXPORTED
        );
        receiverRegistered = true;
    }

    @Override
    protected void handleOnDestroy() {
        stopScanInternal();
        closeGatt(gatt);
        resolvePendingCalls("La actividad Android se cerró.");
        if (receiverRegistered) {
            getContext().unregisterReceiver(bluetoothReceiver);
            receiverRegistered = false;
        }
    }

    @PluginMethod
    public void requestBluetoothPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissionForAliases(
                new String[] { "bluetoothConnect", "bluetoothScan" },
                call,
                "onBluetoothPermissionsResult"
            );
        } else {
            requestPermissionForAliases(
                new String[] { "legacyBluetooth", "location" },
                call,
                "onBluetoothPermissionsResult"
            );
        }
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void onBluetoothPermissionsResult(PluginCall call) {
        boolean granted = hasBluetoothPermissions();
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        if (!hasBluetoothPermissions()) {
            call.reject("Se requieren permisos Bluetooth para buscar dispositivos BLE.", "BLUETOOTH_PERMISSION_DENIED");
            return;
        }
        BluetoothAdapter adapter = getAdapter();
        BluetoothLeScanner scanner = adapter == null || !adapter.isEnabled() ? null : adapter.getBluetoothLeScanner();
        if (scanner == null) {
            call.reject("Bluetooth LE no está disponible o activado.", "BLE_UNAVAILABLE");
            return;
        }
        stopScanInternal();
        try {
            scanner.startScan(scanCallback);
            scanning = true;
            handler.removeCallbacks(scanTimeout);
            handler.postDelayed(scanTimeout, 15_000);
            JSObject result = new JSObject();
            result.put("scanning", true);
            call.resolve(result);
        } catch (SecurityException exception) {
            call.reject("Android denegó el permiso de búsqueda BLE.", "BLUETOOTH_PERMISSION_DENIED", exception);
        }
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        stopScanInternal();
        call.resolve();
    }

    private void stopScanInternal() {
        handler.removeCallbacks(scanTimeout);
        if (!hasBluetoothPermissions()) {
            scanning = false;
            return;
        }
        BluetoothAdapter adapter = getAdapter();
        BluetoothLeScanner scanner = adapter == null ? null : adapter.getBluetoothLeScanner();
        if (scanner != null && scanning) {
            try {
                scanner.stopScan(scanCallback);
            } catch (SecurityException exception) {
                android.util.Log.w("BluetoothLE", "No se pudo detener la búsqueda BLE.", exception);
            }
        }
        scanning = false;
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (!hasBluetoothPermissions()) {
            call.reject("Se requieren permisos Bluetooth para conectar por BLE.", "BLUETOOTH_PERMISSION_DENIED");
            return;
        }
        String address = call.getString("address");
        if (address == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            call.reject("La dirección BLE no es válida.", "BLUETOOTH_INVALID_ADDRESS");
            return;
        }
        BluetoothAdapter adapter = getAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth no está activado.", "BLUETOOTH_DISABLED");
            return;
        }
        stopScanInternal();
        closeGatt(gatt);
        resolvePendingCalls("Se inició una nueva conexión BLE.");
        connectedDevice = adapter.getRemoteDevice(address);
        mtu = 23;
        connectCall = call;
        notifyConnectionState(false, true, null);
        try {
            gatt = connectedDevice.connectGatt(
                getContext(),
                false,
                gattCallback,
                BluetoothDevice.TRANSPORT_LE
            );
            if (gatt == null) failConnection(null, "Android no pudo iniciar la conexión BLE.");
        } catch (SecurityException exception) {
            connectCall = null;
            notifyConnectionState(false, false, exception.getMessage());
            call.reject("Android denegó la conexión BLE.", "BLUETOOTH_PERMISSION_DENIED", exception);
        }
    }

    @PluginMethod
    public void getServices(PluginCall call) {
        if (gatt == null || connectedDevice == null) {
            call.reject("No hay un dispositivo BLE conectado.", "BLE_NOT_CONNECTED");
            return;
        }
        JSObject result = new JSObject();
        result.put("services", serializeServices(gatt));
        call.resolve(result);
    }

    @PluginMethod
    public void selectCharacteristics(PluginCall call) {
        if (!hasBluetoothPermissions()) {
            call.reject("Se requieren permisos Bluetooth para configurar GATT.", "BLUETOOTH_PERMISSION_DENIED");
            return;
        }
        if (gatt == null || connectedDevice == null) {
            call.reject("No hay un dispositivo BLE conectado.", "BLE_NOT_CONNECTED");
            return;
        }
        String serviceUuid = call.getString("serviceUuid");
        String txUuid = call.getString("txUuid");
        String rxServiceUuid = call.getString("rxServiceUuid");
        String rxUuid = call.getString("rxUuid");
        BluetoothGattCharacteristic selectedTx = findCharacteristic(serviceUuid, txUuid);
        if (selectedTx == null || !canWrite(selectedTx)) {
            call.reject("Selecciona una característica BLE con permiso de escritura.", "BLE_TX_NOT_WRITABLE");
            return;
        }
        txCharacteristic = selectedTx;
        rxCharacteristic = rxUuid == null || rxUuid.isEmpty()
            ? null
            : findCharacteristic(rxServiceUuid, rxUuid);
        if (rxUuid != null && !rxUuid.isEmpty() && (rxCharacteristic == null || !canNotify(rxCharacteristic))) {
            txCharacteristic = null;
            rxCharacteristic = null;
            call.reject("La característica RX seleccionada no admite notificaciones o indicaciones.", "BLE_RX_NOT_NOTIFY");
            return;
        }
        if (rxCharacteristic == null) {
            call.resolve();
            return;
        }
        BluetoothGattDescriptor descriptor = rxCharacteristic.getDescriptor(CLIENT_CHARACTERISTIC_CONFIG);
        boolean notificationEnabled;
        try {
            notificationEnabled = gatt.setCharacteristicNotification(rxCharacteristic, true);
        } catch (SecurityException exception) {
            txCharacteristic = null;
            rxCharacteristic = null;
            call.reject("Android denegó la activación de notificaciones BLE.", "BLUETOOTH_PERMISSION_DENIED", exception);
            return;
        }
        if (descriptor == null || !notificationEnabled) {
            txCharacteristic = null;
            rxCharacteristic = null;
            call.reject("No se pudo activar la recepción BLE.", "BLE_NOTIFY_FAILED");
            return;
        }
        byte[] value = (rxCharacteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0
            ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            : BluetoothGattDescriptor.ENABLE_INDICATION_VALUE;
        configurationCall = call;
        boolean started;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                started = gatt.writeDescriptor(descriptor, value) == BluetoothStatusCodes.SUCCESS;
            } else {
                descriptor.setValue(value);
                started = gatt.writeDescriptor(descriptor);
            }
        } catch (SecurityException exception) {
            configurationCall = null;
            txCharacteristic = null;
            rxCharacteristic = null;
            call.reject("Android denegó la escritura de configuración BLE.", "BLUETOOTH_PERMISSION_DENIED", exception);
            return;
        }
        if (!started) {
            configurationCall = null;
            txCharacteristic = null;
            rxCharacteristic = null;
            call.reject("Android no pudo solicitar las notificaciones BLE.", "BLE_NOTIFY_FAILED");
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        if (!hasBluetoothPermissions()) {
            call.reject("Se requieren permisos Bluetooth para enviar por BLE.", "BLUETOOTH_PERMISSION_DENIED");
            return;
        }
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("No se puede enviar un comando vacío.", "BLUETOOTH_EMPTY_COMMAND");
            return;
        }
        boolean connected;
        try {
            connected = gattConnected();
        } catch (SecurityException exception) {
            call.reject("Android denegó el acceso a la conexión BLE.", "BLUETOOTH_PERMISSION_DENIED", exception);
            return;
        }
        if (gatt == null || !connected || txCharacteristic == null) {
            call.reject("Conecta BLE y selecciona una característica TX de escritura.", "BLE_TX_NOT_CONFIGURED");
            return;
        }
        synchronized (writes) {
            if (writes.size() >= 64) {
                call.reject("La cola de escritura BLE está llena.", "BLE_WRITE_QUEUE_FULL");
                return;
            }
            writes.add(new PendingWrite(call, data.getBytes(StandardCharsets.UTF_8)));
        }
        processNextWrite();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        BluetoothGatt oldGatt = gatt;
        closeGatt(oldGatt);
        resolvePendingCalls("La conexión BLE se desconectó.");
        notifyConnectionState(false, false, null);
        call.resolve();
    }

    private void processNextWrite() {
        BluetoothGatt currentGatt = gatt;
        PendingWrite next;
        synchronized (writes) {
            if (writeInFlight) return;
            if (activeWrite == null) activeWrite = writes.poll();
            next = activeWrite;
            if (next == null) return;
            if (currentGatt == null || txCharacteristic == null) {
                next.call.reject("No hay una característica TX BLE disponible.", "BLE_TX_NOT_CONFIGURED");
                activeWrite = null;
                processNextWrite();
                return;
            }
            activeWriteChunkSize = Math.min(next.value.length - next.offset, Math.max(1, mtu - 3));
            writeInFlight = true;
        }
        boolean started;
        int properties = txCharacteristic.getProperties();
        int writeType = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0
            ? BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            : BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;
        byte[] chunk = Arrays.copyOfRange(next.value, next.offset, next.offset + activeWriteChunkSize);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                started = currentGatt.writeCharacteristic(txCharacteristic, chunk, writeType)
                    == BluetoothStatusCodes.SUCCESS;
            } else {
                txCharacteristic.setWriteType(writeType);
                txCharacteristic.setValue(chunk);
                started = currentGatt.writeCharacteristic(txCharacteristic);
            }
        } catch (SecurityException exception) {
            started = false;
        }
        if (!started) {
            PluginCall failedCall;
            synchronized (writes) {
                failedCall = activeWrite == null ? null : activeWrite.call;
                activeWrite = null;
                writeInFlight = false;
            }
            if (failedCall != null) failedCall.reject("Android no pudo iniciar la escritura BLE.", "BLE_WRITE_FAILED");
            processNextWrite();
        }
    }

    private JSArray serializeServices(BluetoothGatt currentGatt) {
        JSArray services = new JSArray();
        for (BluetoothGattService service : currentGatt.getServices()) {
            JSObject serviceJson = new JSObject();
            serviceJson.put("uuid", service.getUuid().toString());
            JSArray characteristics = new JSArray();
            for (BluetoothGattCharacteristic characteristic : service.getCharacteristics()) {
                JSObject characteristicJson = new JSObject();
                characteristicJson.put("uuid", characteristic.getUuid().toString());
                characteristicJson.put("properties", characteristic.getProperties());
                characteristicJson.put("write", canWrite(characteristic));
                characteristicJson.put("notify", canNotify(characteristic));
                characteristics.put(characteristicJson);
            }
            serviceJson.put("characteristics", characteristics);
            services.put(serviceJson);
        }
        return services;
    }

    private BluetoothGattCharacteristic findCharacteristic(String serviceUuid, String characteristicUuid) {
        if (serviceUuid == null || characteristicUuid == null || gatt == null) return null;
        try {
            BluetoothGattService service = gatt.getService(UUID.fromString(serviceUuid));
            return service == null ? null : service.getCharacteristic(UUID.fromString(characteristicUuid));
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    private boolean canWrite(BluetoothGattCharacteristic characteristic) {
        int properties = characteristic.getProperties();
        return (properties & (BluetoothGattCharacteristic.PROPERTY_WRITE
            | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0;
    }

    private boolean canNotify(BluetoothGattCharacteristic characteristic) {
        int properties = characteristic.getProperties();
        return (properties & (BluetoothGattCharacteristic.PROPERTY_NOTIFY
            | BluetoothGattCharacteristic.PROPERTY_INDICATE)) != 0;
    }

    private void publishReceivedData(byte[] value) {
        if (value == null || connectedDevice == null) return;
        JSObject event = new JSObject();
        event.put("data", new String(value, StandardCharsets.UTF_8));
        event.put("address", connectedDevice.getAddress());
        notifyListeners("bleDataReceived", event);
    }

    private void failConnection(BluetoothGatt failedGatt, String reason) {
        if (failedGatt != null) closeGatt(failedGatt);
        notifyConnectionState(false, false, reason);
        resolvePendingCalls(reason);
    }

    private void closeGatt(BluetoothGatt oldGatt) {
        if (oldGatt == null) return;
        if (gatt == oldGatt) {
            gatt = null;
            connectedDevice = null;
            txCharacteristic = null;
            rxCharacteristic = null;
        }
        if (hasBluetoothPermissions()) {
            try {
                oldGatt.disconnect();
            } catch (SecurityException exception) {
                android.util.Log.w("BluetoothLE", "No se pudo desconectar GATT.", exception);
            } catch (IllegalArgumentException exception) {
                android.util.Log.w("BluetoothLE", "Android rechazó la desconexión GATT.", exception);
            }
        }
        try {
            oldGatt.close();
        } catch (SecurityException exception) {
            android.util.Log.w("BluetoothLE", "No se pudo cerrar GATT tras perder el permiso.", exception);
        }
    }

    @PluginMethod
    public void getConnectionState(PluginCall call) {
        if (!hasBluetoothPermissions()) {
            call.reject("Se requieren permisos Bluetooth para consultar la conexión BLE.", "BLUETOOTH_PERMISSION_DENIED");
            return;
        }
        JSObject result = new JSObject();
        boolean connected;
        try {
            connected = gattConnected();
        } catch (SecurityException exception) {
            call.reject("Android denegó la consulta de conexión BLE.", "BLUETOOTH_PERMISSION_DENIED", exception);
            return;
        }
        result.put("connected", connected);
        result.put("connecting", connectCall != null);
        result.put("transport", "ble");
        if (connectedDevice != null) {
            result.put("address", connectedDevice.getAddress());
            result.put("name", safeDeviceName(connectedDevice));
        }
        call.resolve(result);
    }

    private void resolvePendingCalls(String reason) {
        PluginCall pendingConnect = connectCall;
        connectCall = null;
        if (pendingConnect != null) pendingConnect.reject(reason, "BLE_CONNECTION_FAILED");
        PluginCall pendingConfiguration = configurationCall;
        configurationCall = null;
        if (pendingConfiguration != null) pendingConfiguration.reject(reason, "BLE_CONNECTION_FAILED");
        synchronized (writes) {
            if (activeWrite != null) {
                activeWrite.call.reject(reason, "BLE_CONNECTION_FAILED");
                activeWrite = null;
            }
            writeInFlight = false;
            while (!writes.isEmpty()) writes.poll().call.reject(reason, "BLE_CONNECTION_FAILED");
        }
    }

    private boolean gattConnected() {
        if (!hasBluetoothPermissions()) {
            throw new SecurityException("Falta el permiso BLUETOOTH_CONNECT.");
        }
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        try {
            return manager != null && connectedDevice != null
                && manager.getConnectionState(connectedDevice, BluetoothProfile.GATT) == BluetoothProfile.STATE_CONNECTED;
        } catch (SecurityException exception) {
            android.util.Log.e("BluetoothLE", "Android denegó consultar el estado GATT.", exception);
            throw exception;
        }
    }

    private void notifyConnectionState(boolean connected, boolean connecting, String error) {
        JSObject event = new JSObject();
        event.put("connected", connected);
        event.put("connecting", connecting);
        event.put("transport", "ble");
        if (connectedDevice != null) {
            event.put("name", safeDeviceName(connectedDevice));
            event.put("address", connectedDevice.getAddress());
        }
        if (error != null && !error.isEmpty()) event.put("error", error);
        notifyListeners("bleConnectionState", event);
    }

    private JSObject deviceToJson(BluetoothDevice device) {
        JSObject result = new JSObject();
        result.put("name", safeDeviceName(device));
        result.put("address", device.getAddress());
        result.put("bonded", false);
        result.put("transport", "ble");
        result.put("type", "Bluetooth LE");
        return result;
    }

    private String safeDeviceName(BluetoothDevice device) {
        if (device == null) return "";
        try {
            String name = device.getName();
            return name == null ? "" : name;
        } catch (SecurityException exception) {
            return "";
        }
    }

    private BluetoothAdapter getAdapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    private boolean hasBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return getPermissionState("bluetoothConnect") == PermissionState.GRANTED
                && getPermissionState("bluetoothScan") == PermissionState.GRANTED;
        }
        return getPermissionState("legacyBluetooth") == PermissionState.GRANTED
            && getPermissionState("location") == PermissionState.GRANTED;
    }

    private static final class PendingWrite {
        final PluginCall call;
        final byte[] value;
        int offset;

        PendingWrite(PluginCall call, byte[] value) {
            this.call = call;
            this.value = value;
        }
    }
}
