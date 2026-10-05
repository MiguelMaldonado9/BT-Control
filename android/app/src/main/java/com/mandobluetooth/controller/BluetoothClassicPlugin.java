package com.mandobluetooth.controller;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "BluetoothClassic",
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
public class BluetoothClassicPlugin extends Plugin {

    private static final String SPP_UUID = "00001101-0000-1000-8000-00805F9B34FB";
    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();
    private final Object socketLock = new Object();
    private volatile BluetoothSocket socket;
    private volatile BluetoothSocket connectingSocket;
    private volatile BluetoothDevice connectedDevice;
    private volatile String connectedAddress;
    private volatile PluginCall pendingBondCall;
    private volatile String pendingBondAddress;
    private volatile long pendingBondAttempt;
    private volatile long connectionAttempt;
    private boolean receiverRegistered;
    private volatile boolean scanning;

    private final BroadcastReceiver bluetoothReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (BluetoothDevice.ACTION_FOUND.equals(action)) {
                BluetoothDevice device = getDeviceExtra(intent);
                if (device != null) {
                    notifyDeviceFound(device);
                }
            } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                scanning = false;
                JSObject event = new JSObject();
                event.put("scanning", false);
                notifyListeners("discoveryFinished", event);
            } else if (BluetoothDevice.ACTION_BOND_STATE_CHANGED.equals(action)) {
                BluetoothDevice device = getDeviceExtra(intent);
                if (device != null && device.getAddress().equals(pendingBondAddress)) {
                    int bondState = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.ERROR);
                    if (bondState == BluetoothDevice.BOND_BONDED) {
                        PluginCall call = pendingBondCall;
                        String address = pendingBondAddress;
                        pendingBondCall = null;
                        pendingBondAddress = null;
                        long attempt = pendingBondAttempt;
                        pendingBondAttempt = 0;
                        if (call != null) ioExecutor.execute(() ->
                            connectSocket(call, getBluetoothAdapter(), address, attempt)
                        );
                    } else if (bondState == BluetoothDevice.BOND_NONE) {
                        PluginCall call = pendingBondCall;
                        pendingBondCall = null;
                        pendingBondAddress = null;
                        pendingBondAttempt = 0;
                        if (call != null) call.reject("El emparejamiento Bluetooth fue cancelado.", "BLUETOOTH_PAIRING_CANCELLED");
                        notifyConnectionState(false, null, "El emparejamiento Bluetooth fue cancelado.");
                    }
                }
            } else if (BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(action)) {
                BluetoothDevice device = getDeviceExtra(intent);
                if (device != null && connectedDevice != null && device.getAddress().equals(connectedDevice.getAddress())) {
                    closeSocket();
                    notifyConnectionState(false, null, "El dispositivo Bluetooth se desconectó.");
                }
            } else if (BluetoothAdapter.ACTION_STATE_CHANGED.equals(action)) {
                int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
                if (state == BluetoothAdapter.STATE_OFF) {
                    stopDiscovery();
                    connectionAttempt++;
                    closeSocket();
                    rejectPendingBond("Bluetooth se desactivó.");
                    notifyConnectionState(false, null, "Bluetooth se desactivó.");
                }
            }
        }
    };

    @Override
    public void load() {
        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        filter.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
        filter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);
        filter.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);
        ContextCompat.registerReceiver(getContext(), bluetoothReceiver, filter, ContextCompat.RECEIVER_EXPORTED);
        receiverRegistered = true;
    }

    @Override
    protected void handleOnDestroy() {
        stopDiscovery();
        closeSocket();
        connectionAttempt++;
        rejectPendingBond("La actividad Android se cerró.");
        if (receiverRegistered) {
            getContext().unregisterReceiver(bluetoothReceiver);
            receiverRegistered = false;
        }
        ioExecutor.shutdownNow();
    }

    @PluginMethod
    public void requestBluetoothPermissions(PluginCall call) {
        String[] aliases = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? new String[] { "bluetoothConnect", "bluetoothScan" }
            : new String[] { "legacyBluetooth", "location" };
        requestPermissionForAliases(aliases, call, "onBluetoothPermissionsResult");
    }

    @PermissionCallback
    private void onBluetoothPermissionsResult(PluginCall call) {
        boolean granted;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            granted = getPermissionState("bluetoothConnect") == PermissionState.GRANTED
                && getPermissionState("bluetoothScan") == PermissionState.GRANTED;
        } else {
            granted = getPermissionState("legacyBluetooth") == PermissionState.GRANTED
                && getPermissionState("location") == PermissionState.GRANTED;
        }
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void requestEnable(PluginCall call) {
        if (!hasBluetoothPermissions()) {
            call.reject("Se requieren permisos Bluetooth antes de activarlo.", "BLUETOOTH_PERMISSION_DENIED");
            return;
        }
        BluetoothAdapter adapter = getBluetoothAdapter();
        if (adapter == null) {
            call.reject("Este dispositivo no tiene Bluetooth.", "BLUETOOTH_UNAVAILABLE");
            return;
        }
        if (adapter.isEnabled()) {
            JSObject result = new JSObject();
            result.put("enabled", true);
            call.resolve(result);
            return;
        }
        startActivityForResult(call, new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), "onBluetoothEnableResult");
    }

    @ActivityCallback
    private void onBluetoothEnableResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        JSObject response = new JSObject();
        BluetoothAdapter adapter = getBluetoothAdapter();
        response.put("enabled", result.getResultCode() == android.app.Activity.RESULT_OK && adapter != null && adapter.isEnabled());
        call.resolve(response);
    }

    @PluginMethod
    public void getBondedDevices(PluginCall call) {
        if (!hasBluetoothPermissions()) {
            call.reject("Se requieren permisos Bluetooth.", "BLUETOOTH_PERMISSION_DENIED");
            return;
        }
        BluetoothAdapter adapter = getBluetoothAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth no está activado.", "BLUETOOTH_DISABLED");
            return;
        }
        JSArray devices = new JSArray();
        try {
            for (BluetoothDevice device : adapter.getBondedDevices()) {
                devices.put(deviceToJson(device, true));
            }
        } catch (SecurityException exception) {
            call.reject("Android denegó el acceso a los dispositivos emparejados.", "BLUETOOTH_PERMISSION_DENIED", exception);
            return;
        }
        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    @PluginMethod
    public void startDiscovery(PluginCall call) {
        if (!hasBluetoothPermissions()) {
            call.reject("Se requieren permisos Bluetooth para buscar dispositivos.", "BLUETOOTH_PERMISSION_DENIED");
            return;
        }
        BluetoothAdapter adapter = getBluetoothAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth no está activado.", "BLUETOOTH_DISABLED");
            return;
        }
        stopDiscovery();
        try {
            scanning = adapter.startDiscovery();
        } catch (SecurityException exception) {
            call.reject("Android denegó el permiso para buscar dispositivos Bluetooth.", "BLUETOOTH_PERMISSION_DENIED", exception);
            return;
        }
        if (!scanning) {
            call.reject("Android no pudo iniciar la búsqueda Bluetooth.");
            return;
        }
        JSObject result = new JSObject();
        result.put("scanning", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        stopDiscovery();
        call.resolve();
    }

    @PluginMethod
    public void getConnectionState(PluginCall call) {
        JSObject result = new JSObject();
        BluetoothSocket activeSocket = socket;
        boolean connected = activeSocket != null && activeSocket.isConnected();
        result.put("connected", connected);
        result.put("transport", "classic");
        if (connected && connectedDevice != null) {
            result.put("name", deviceName(connectedDevice));
            result.put("address", connectedAddress);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (!hasBluetoothPermissions()) {
            call.reject("Se requieren permisos Bluetooth para conectar.", "BLUETOOTH_PERMISSION_DENIED");
            return;
        }
        String address = call.getString("address");
        if (address == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            call.reject("La dirección del dispositivo Bluetooth no es válida.", "BLUETOOTH_INVALID_ADDRESS");
            return;
        }
        BluetoothAdapter adapter = getBluetoothAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth no está activado.", "BLUETOOTH_DISABLED");
            return;
        }
        stopDiscovery();
        final long attempt = ++connectionAttempt;
        JSObject connectingEvent = new JSObject();
        connectingEvent.put("connected", false);
        connectingEvent.put("connecting", true);
        connectingEvent.put("address", address);
        notifyListeners("connectionState", connectingEvent);
        try {
            BluetoothDevice device = adapter.getRemoteDevice(address);
            if (device.getBondState() != BluetoothDevice.BOND_BONDED) {
                pendingBondCall = call;
                pendingBondAddress = address;
                pendingBondAttempt = attempt;
                if (!device.createBond()) {
                    pendingBondCall = null;
                    pendingBondAddress = null;
                    pendingBondAttempt = 0;
                    call.reject("Android no pudo iniciar el emparejamiento Bluetooth.", "BLUETOOTH_PAIRING_FAILED");
                }
                return;
            }
        } catch (SecurityException exception) {
            pendingBondCall = null;
            pendingBondAddress = null;
            pendingBondAttempt = 0;
            call.reject("Android denegó el acceso al dispositivo Bluetooth.", "BLUETOOTH_PERMISSION_DENIED", exception);
            notifyConnectionState(false, null, "Android denegó el acceso al dispositivo Bluetooth.");
            return;
        }
        ioExecutor.execute(() -> connectSocket(call, adapter, address, attempt));
    }

    private void connectSocket(PluginCall call, BluetoothAdapter adapter, String address, long attempt) {
        if (attempt != connectionAttempt) {
            call.reject("La conexión Bluetooth fue cancelada.", "BLUETOOTH_CONNECTION_CANCELLED");
            return;
        }
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth se desactivó antes de conectar.", "BLUETOOTH_DISABLED");
            notifyConnectionState(false, null, "Bluetooth se desactivó antes de conectar.");
            return;
        }
        closeSocket();
        BluetoothSocket candidate = null;
        try {
            BluetoothDevice device = adapter.getRemoteDevice(address);
            candidate = device.createRfcommSocketToServiceRecord(UUID.fromString(SPP_UUID));
            synchronized (socketLock) {
                connectingSocket = candidate;
            }
            candidate.connect();
            synchronized (socketLock) {
                if (connectingSocket != candidate || attempt != connectionAttempt) {
                    candidate.close();
                    call.reject("La conexión Bluetooth fue cancelada.", "BLUETOOTH_CONNECTION_CANCELLED");
                    return;
                }
                connectingSocket = null;
                socket = candidate;
                connectedDevice = device;
                connectedAddress = address;
            }
            JSObject result = deviceToJson(device, false);
            result.put("connected", true);
            notifyListeners("connectionState", result);
            call.resolve(result);
            startReader(candidate, device);
        } catch (IOException | SecurityException exception) {
            synchronized (socketLock) {
                if (connectingSocket == candidate) connectingSocket = null;
            }
            if (candidate != null) {
                try {
                    candidate.close();
                } catch (IOException closeException) {
                    exception.addSuppressed(closeException);
                }
            }
            call.reject("No se pudo conectar al dispositivo SPP. Verifica que esté emparejado y dentro del alcance.", "BLUETOOTH_CONNECTION_FAILED", exception);
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        rejectPendingBond("Se canceló la conexión Bluetooth.");
        connectionAttempt++;
        closeSocket();
        notifyConnectionState(false, null, null);
        call.resolve();
    }

    @PluginMethod
    public void send(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("No se puede enviar un comando vacío.", "BLUETOOTH_EMPTY_COMMAND");
            return;
        }
        ioExecutor.execute(() -> {
            BluetoothSocket activeSocket = socket;
            if (activeSocket == null || !activeSocket.isConnected()) {
                call.reject("No hay un dispositivo Bluetooth conectado.", "BLUETOOTH_NOT_CONNECTED");
                return;
            }
            try {
                OutputStream output = activeSocket.getOutputStream();
                output.write(data.getBytes(StandardCharsets.UTF_8));
                output.flush();
                call.resolve();
            } catch (IOException | SecurityException exception) {
                closeSocket();
                notifyConnectionState(false, null, null);
                call.reject("Falló el envío Bluetooth y se cerró la conexión.", "BLUETOOTH_SEND_FAILED", exception);
            }
        });
    }

    private void startReader(BluetoothSocket activeSocket, BluetoothDevice device) {
        Thread readerThread = new Thread(() -> {
            try {
                BufferedReader reader = new BufferedReader(new InputStreamReader(activeSocket.getInputStream(), StandardCharsets.UTF_8));
                String line;
                while ((line = reader.readLine()) != null) {
                    JSObject event = new JSObject();
                    event.put("line", line.trim());
                    event.put("address", device.getAddress());
                    notifyListeners("dataReceived", event);
                }
                handleSocketLoss(activeSocket, "El dispositivo cerró la conexión.");
            } catch (IOException | SecurityException exception) {
                handleSocketLoss(activeSocket, exception.getMessage());
            }
        }, "BluetoothClassic-reader");
        readerThread.setDaemon(true);
        readerThread.start();
    }

    private void handleSocketLoss(BluetoothSocket activeSocket, String reason) {
        boolean wasCurrentSocket;
        synchronized (socketLock) {
            wasCurrentSocket = socket == activeSocket;
        }
        if (wasCurrentSocket) {
            closeSocket();
            notifyConnectionState(false, null, reason);
        }
    }

    private void closeSocket() {
        BluetoothSocket oldSocket;
        BluetoothSocket oldConnectingSocket;
        synchronized (socketLock) {
            oldSocket = socket;
            oldConnectingSocket = connectingSocket;
            socket = null;
            connectingSocket = null;
            connectedDevice = null;
            connectedAddress = null;
        }
        if (oldSocket != null && oldSocket != oldConnectingSocket) {
            try {
                oldSocket.close();
            } catch (IOException exception) {
                android.util.Log.w("BluetoothClassic", "No se pudo cerrar el socket Bluetooth.", exception);
            }
        }
        if (oldConnectingSocket != null) {
            try {
                oldConnectingSocket.close();
            } catch (IOException exception) {
                android.util.Log.w("BluetoothClassic", "No se pudo cancelar el socket Bluetooth.", exception);
            }
        }
    }

    private void rejectPendingBond(String reason) {
        PluginCall pendingCall = pendingBondCall;
        pendingBondCall = null;
        pendingBondAddress = null;
        pendingBondAttempt = 0;
        if (pendingCall != null) pendingCall.reject(reason, "BLUETOOTH_PAIRING_CANCELLED");
    }

    private void stopDiscovery() {
        BluetoothAdapter adapter = getBluetoothAdapter();
        if (adapter != null && hasBluetoothPermissions() && scanning) {
            try {
                adapter.cancelDiscovery();
            } catch (SecurityException exception) {
                android.util.Log.w("BluetoothClassic", "No se pudo cancelar la búsqueda Bluetooth.", exception);
            }
        }
        scanning = false;
    }

    private boolean hasBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return getPermissionState("bluetoothConnect") == PermissionState.GRANTED
                && getPermissionState("bluetoothScan") == PermissionState.GRANTED;
        }
        return getPermissionState("legacyBluetooth") == PermissionState.GRANTED
            && getPermissionState("location") == PermissionState.GRANTED;
    }

    private BluetoothAdapter getBluetoothAdapter() {
        android.bluetooth.BluetoothManager manager =
            (android.bluetooth.BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    private void notifyDeviceFound(BluetoothDevice device) {
        JSObject event = deviceToJson(device, false);
        event.put("transport", "classic");
        event.put("type", "Bluetooth clásico · SPP/RFCOMM");
        notifyListeners("deviceFound", event);
    }

    private JSObject deviceToJson(BluetoothDevice device, boolean bonded) {
        JSObject result = new JSObject();
        boolean bleOnly;
        try {
            bleOnly = device.getType() == BluetoothDevice.DEVICE_TYPE_LE;
        } catch (SecurityException exception) {
            bleOnly = false;
        }
        result.put("name", deviceName(device));
        result.put("address", device.getAddress());
        result.put("bonded", bonded);
        result.put("transport", bleOnly ? "ble" : "classic");
        result.put("type", bleOnly ? "Bluetooth LE" : "Bluetooth clásico · SPP/RFCOMM");
        return result;
    }

    private String deviceName(BluetoothDevice device) {
        try {
            String name = device.getName();
            return name == null ? "" : name;
        } catch (SecurityException exception) {
            return "";
        }
    }

    private void notifyConnectionState(boolean isConnected, BluetoothDevice device, String error) {
        JSObject event = new JSObject();
        event.put("connected", isConnected);
        if (device != null) {
            event.put("name", deviceName(device));
            event.put("address", device.getAddress());
        }
        if (error != null && !error.isEmpty()) {
            event.put("error", error);
        }
        notifyListeners("connectionState", event);
    }

    private BluetoothDevice getDeviceExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class);
        }
        return intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
    }
}
