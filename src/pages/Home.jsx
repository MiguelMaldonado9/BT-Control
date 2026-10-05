import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  Activity,
  Bluetooth,
  LogOut,
  Power,
  Radio,
  Ruler,
  Settings2,
  Terminal,
  Trash2,
} from "lucide-react";
import ControlPad from "@/components/controller/ControlPad";
import BluetoothDeviceSheet from "@/components/controller/BluetoothDeviceSheet";
import ButtonConfigSheet from "@/components/controller/ButtonConfigSheet";
import GlobalConfigSheet from "@/components/controller/GlobalConfigSheet";
import BluetoothClassic from "@/lib/bluetooth-classic";
import BluetoothLE from "@/lib/bluetooth-le";
import ApplicationControl from "@/lib/application-control";
import { DEFAULT_BUTTONS, getButtonConflicts, loadButtons, STORAGE_KEY } from "@/lib/controller-config";
import { DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY, loadControllerLayout } from "@/lib/controller-layout";
import { toast } from "@/components/ui/use-toast";

const DEVICE_STORAGE_KEY = "ble_controller_last_device";
const BLE_CONFIG_STORAGE_KEY = "ble_controller_gatt_config";
const ACK_INTERVAL_MS = 2000;
const ACK_TIMEOUT_MS = 1500;

function mergeDevice(devices, device) {
  const transport = device.transport || "classic";
  const key = `${transport}:${device.address}`;
  const next = new Map(devices.map((item) => [`${item.transport || "classic"}:${item.address}`, item]));
  const existing = next.get(key);
  next.set(key, {
    ...existing,
    ...device,
    transport,
    type: device.type || (transport === "ble" ? "Bluetooth LE" : "Bluetooth clásico · SPP"),
    bonded: Boolean(existing?.bonded || device.bonded),
  });
  return [...next.values()].sort(
    (first, second) => Number(second.bonded) - Number(first.bonded)
      || (first.name || "").localeCompare(second.name || "")
  );
}

export default function Home() {
  const [buttons, setButtons] = useState(loadButtons);
  const [configOpen, setConfigOpen] = useState(false);
  const [configId, setConfigId] = useState(null);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [controlLayout, setControlLayout] = useState(loadControllerLayout);
  const [log, setLog] = useState([]);
  const [deviceSheetOpen, setDeviceSheetOpen] = useState(false);
  const [devices, setDevices] = useState([]);
  const [lastDevice, setLastDevice] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(DEVICE_STORAGE_KEY) || "null");
      return typeof stored === "string" ? { address: stored, transport: "classic" } : stored || {};
    } catch (error) {
      console.error("No se pudo cargar el último dispositivo Bluetooth.", error);
      return {};
    }
  });
  const [bleConfigurations, setBleConfigurations] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(BLE_CONFIG_STORAGE_KEY) || "{}");
      return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    } catch (error) {
      console.error("No se pudo cargar la configuración local GATT.", error);
      return {};
    }
  });
  const [selectedAddress, setSelectedAddress] = useState(lastDevice.address || "");
  const [selectedTransport, setSelectedTransport] = useState(lastDevice.transport || "classic");
  const [bleServices, setBleServices] = useState([]);
  const [bleConfigured, setBleConfigured] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [connection, setConnection] = useState({
    connected: false,
    connecting: false,
    name: "",
    address: "",
    transport: "",
  });
  const [latency, setLatency] = useState(null);
  const [ackEnabled, setAckEnabled] = useState(false);
  const logRef = useRef(null);
  const pendingPingsRef = useRef(new Map());
  const pingSequenceRef = useRef(0);
  const bleRxBufferRef = useRef("");
  const classicScanningRef = useRef(false);
  const bleScanningRef = useRef(false);

  const conflicts = getButtonConflicts(buttons);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buttons));
    } catch (error) {
      console.error("No se pudo guardar la configuración local de botones.", error);
      toast({ title: "No se guardó la configuración", description: error.message });
    }
  }, [buttons]);

  useEffect(() => {
    if (!lastDevice.address) return;
    try {
      localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(lastDevice));
    } catch (error) {
      console.error("No se pudo guardar el último dispositivo Bluetooth.", error);
      toast({ title: "No se guardó el dispositivo", description: error.message });
    }
  }, [lastDevice]);

  useEffect(() => {
    try {
      localStorage.setItem(BLE_CONFIG_STORAGE_KEY, JSON.stringify(bleConfigurations));
    } catch (error) {
      console.error("No se pudo guardar la configuración GATT local.", error);
      toast({ title: "No se guardó la configuración BLE", description: error.message });
    }
  }, [bleConfigurations]);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(controlLayout));
    } catch (error) {
      console.error("No se pudo guardar la distribución de controles.", error);
      toast({ title: "No se guardó la distribución", description: error.message });
    }
  }, [controlLayout]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return undefined;

    let mounted = true;
    const listenerHandles = [];
    const addListener = async (plugin, eventName, callback) => {
      const handle = await plugin.addListener(eventName, callback);
      if (mounted) listenerHandles.push(handle);
      else handle.remove();
    };
    const subscribe = async () => {
      await addListener(BluetoothClassic, "connectionState", (state) => {
        if (!mounted) return;
        setConnection({
          connected: Boolean(state.connected),
          connecting: Boolean(state.connecting),
          name: state.name || "",
          address: state.address || "",
          transport: state.transport || "classic",
        });
        if (!state.connected) {
          setLatency(null);
          setBleConfigured(false);
          setBleServices([]);
        }
        if (state.error && !state.connecting) {
          toast({ title: "Conexión Bluetooth perdida", description: state.error });
        }
      });
      await addListener(BluetoothClassic, "deviceFound", (device) => {
        if (mounted) setDevices((current) => mergeDevice(current, { ...device, transport: "classic" }));
      });
      await addListener(BluetoothClassic, "discoveryFinished", () => {
        classicScanningRef.current = false;
        if (mounted) setScanning(bleScanningRef.current);
      });
      await addListener(BluetoothClassic, "dataReceived", ({ line }) => {
        receiveAckLine(line || "");
      });
      await addListener(BluetoothLE, "bleConnectionState", (state) => {
        if (!mounted) return;
        setConnection({
          connected: Boolean(state.connected),
          connecting: Boolean(state.connecting),
          name: state.name || "",
          address: state.address || "",
          transport: "ble",
        });
        setBleConfigured(false);
        if (!state.connected) {
          setLatency(null);
          setBleConfigured(false);
          setBleServices([]);
        }
        if (state.error && !state.connecting) {
          toast({ title: "Conexión BLE perdida", description: state.error });
        }
      });
      await addListener(BluetoothLE, "bleDeviceFound", (device) => {
        if (mounted) setDevices((current) => mergeDevice(current, device));
      });
      await addListener(BluetoothLE, "bleScanFinished", (event) => {
        bleScanningRef.current = false;
        if (mounted && event.error) {
          setScanning(classicScanningRef.current);
          toast({ title: "Falló la búsqueda BLE", description: event.error });
        } else if (mounted) {
          setScanning(classicScanningRef.current);
        }
      });
      await addListener(BluetoothLE, "bleServices", (event) => {
        if (!mounted) return;
        setBleServices(event.services || []);
        setConnection({
          connected: true,
          connecting: false,
          name: event.name || "",
          address: event.address || "",
          transport: "ble",
        });
      });
      await addListener(BluetoothLE, "bleDataReceived", ({ data }) => {
        bleRxBufferRef.current += data || "";
        if (bleRxBufferRef.current.length > 4096 && !bleRxBufferRef.current.includes("\n")) {
          bleRxBufferRef.current = "";
          console.warn("Se descartó un bloque RX BLE mayor de 4 KB sin delimitador LF.");
          return;
        }
        const lines = bleRxBufferRef.current.split(/\r?\n/);
        bleRxBufferRef.current = lines.pop() || "";
        lines.forEach(receiveAckLine);
      });
      if (!mounted) {
        return;
      }

      const state = await BluetoothClassic.getConnectionState();
      if (mounted && state.connected) {
        setConnection({
          connected: true,
          connecting: false,
          name: state.name || "",
          address: state.address || "",
          transport: "classic",
        });
      }
      try {
        const bleState = await BluetoothLE.getConnectionState();
        if (mounted && bleState.connected && !state.connected) {
          setConnection({
            connected: true,
            connecting: Boolean(bleState.connecting),
            name: bleState.name || "",
            address: bleState.address || "",
            transport: "ble",
          });
        }
      } catch (error) {
        console.warn("No se pudo restaurar el estado BLE al iniciar; los listeners siguen activos.", error);
      }
    };

    subscribe().catch((error) => {
      listenerHandles.forEach((handle) => handle.remove());
      listenerHandles.length = 0;
      if (mounted) toast({ title: "Error de Bluetooth", description: error.message });
    });

    return () => {
      mounted = false;
      listenerHandles.forEach((handle) => handle.remove());
      pendingPingsRef.current.forEach(({ timeout }) => clearTimeout(timeout));
      pendingPingsRef.current.clear();
    };
  }, []);

  const receiveAckLine = (line) => {
    const match = /^~ACK:([A-Za-z0-9_-]+)$/.exec(line.trim());
    if (!match) return;
    const pending = pendingPingsRef.current.get(match[1]);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingPingsRef.current.delete(match[1]);
    setLatency(performance.now() - pending.sentAt);
  };

  useEffect(() => {
    if (!connection.connected || !ackEnabled || (connection.transport === "ble" && !bleConfigured)) {
      setLatency(null);
      return undefined;
    }

    const sendPing = async () => {
      if (pendingPingsRef.current.size > 0) return;
      const sequence = `${Date.now().toString(36)}-${++pingSequenceRef.current}`;
      const sentAt = performance.now();
      const timeout = setTimeout(() => {
        pendingPingsRef.current.delete(sequence);
        setLatency(null);
      }, ACK_TIMEOUT_MS);
      pendingPingsRef.current.set(sequence, { sentAt, timeout });
      try {
        const transport = connection.transport === "ble" ? BluetoothLE : BluetoothClassic;
        await transport.send({ data: `~PING:${sequence}\n` });
      } catch (error) {
        clearTimeout(timeout);
        pendingPingsRef.current.delete(sequence);
        setLatency(null);
        toast({ title: "Falló el sondeo de latencia", description: error.message });
      }
    };

    sendPing();
    const interval = setInterval(sendPing, ACK_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      pendingPingsRef.current.forEach(({ timeout }) => clearTimeout(timeout));
      pendingPingsRef.current.clear();
    };
  }, [ackEnabled, bleConfigured, connection.connected, connection.transport]);

  const addLog = (entry) => setLog((previous) => [...previous.slice(-30), entry]);

  const openConfig = (id) => {
    setConfigId(id);
    setConfigOpen(true);
  };

  const sendCommand = async (id, value = buttons[id]?.char, kind = "TX", requireConnection = true) => {
    const data = typeof value === "string" ? value : "";
    if (!data.trim()) {
      if (kind === "TX") {
        openConfig(id);
        toast({
          title: "Control sin carácter",
          description: "Configura un carácter para este control antes de enviarlo.",
        });
      }
      return false;
    }
    if (connection.transport === "ble" && connection.connected && !bleConfigured) {
      setDeviceSheetOpen(true);
      toast({
        title: "Selecciona la característica TX",
        description: "El dispositivo BLE está conectado; elige una característica GATT de escritura.",
      });
      return false;
    }
    if (!connection.connected || !Capacitor.isNativePlatform()) {
      if (requireConnection) {
        toast({ title: "Bluetooth desconectado", description: "Conecta un dispositivo SPP antes de enviar comandos." });
      }
      return false;
    }

    try {
      const transport = connection.transport === "ble" ? BluetoothLE : BluetoothClassic;
      await transport.send({ data });
      addLog({ dir: kind, char: data, time: new Date().toLocaleTimeString() });
      return true;
    } catch (error) {
      toast({ title: "No se pudo enviar el comando", description: error.message });
      return false;
    }
  };

  const handlePress = (id) => {
    sendCommand(id);
  };

  const handleRelease = (id) => {
    const releaseChar = buttons[id]?.releaseChar || "";
    if (releaseChar) sendCommand(id, releaseChar, "REL", false);
  };

  const handleSave = (id, char, releaseChar = "") => {
    setButtons((previous) => ({
      ...previous,
      [id]: { ...previous[id], char, releaseChar },
    }));
  };

  const startScans = async () => {
    classicScanningRef.current = true;
    bleScanningRef.current = true;
    setScanning(true);
    const results = await Promise.allSettled([
      BluetoothClassic.startDiscovery(),
      BluetoothLE.startScan(),
    ]);
    classicScanningRef.current = results[0].status === "fulfilled" && Boolean(results[0].value.scanning);
    bleScanningRef.current = results[1].status === "fulfilled" && Boolean(results[1].value.scanning);
    setScanning(classicScanningRef.current || bleScanningRef.current);
    const failures = results.filter((result) => result.status === "rejected");
    failures.forEach((result) => {
      toast({ title: "No se pudo iniciar una búsqueda Bluetooth", description: result.reason.message });
    });
    if (failures.length === results.length) throw failures[0].reason;
  };

  const openBluetoothPicker = async () => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
      toast({
        title: "Bluetooth solo en Android",
        description: "Instala la aplicación Android para buscar dispositivos Bluetooth clásico SPP o BLE.",
      });
      return;
    }

    try {
      const permissions = await BluetoothClassic.requestBluetoothPermissions();
      if (!permissions.granted) {
        toast({ title: "Permiso Bluetooth denegado", description: "Autoriza Bluetooth y búsqueda de dispositivos en Android." });
        return;
      }
      const enabled = await BluetoothClassic.requestEnable();
      if (!enabled.enabled) {
        toast({ title: "Bluetooth desactivado", description: "Activa Bluetooth para buscar el módulo." });
        return;
      }
      const result = await BluetoothClassic.getBondedDevices();
      const bondedDevices = (result.devices || []).map((device) => ({
        ...device,
        transport: device.transport || "classic",
        type: device.type || "Bluetooth clásico · SPP/RFCOMM",
      }));
      setDevices(bondedDevices);
      setBleServices([]);
      setBleConfigured(false);
      const savedDevice = lastDevice.address
        ? { address: lastDevice.address, transport: lastDevice.transport || "classic" }
        : null;
      setSelectedAddress(savedDevice?.address || connection.address || bondedDevices[0]?.address || "");
      setSelectedTransport(savedDevice?.transport || connection.transport || "classic");
      setDeviceSheetOpen(true);
      await startScans();
    } catch (error) {
      setScanning(false);
      toast({ title: "No se pudo iniciar Bluetooth", description: error.message });
    }
  };

  const connectSelectedDevice = async (address = selectedAddress, transportType = selectedTransport) => {
    if (!address) return;
    setScanning(false);
    try {
      await Promise.all([BluetoothClassic.stopDiscovery(), BluetoothLE.stopScan()]);
      classicScanningRef.current = false;
      bleScanningRef.current = false;
      if (connection.connected) {
        if (connection.transport === "ble") await BluetoothLE.disconnect();
        else await BluetoothClassic.disconnect();
      }
      setBleConfigured(false);
      setConnection((previous) => ({
        ...previous,
        connected: false,
        connecting: true,
        transport: transportType,
      }));
      if (transportType === "ble") {
        const connected = await BluetoothLE.connect({ address });
        setBleServices(connected.services || []);
        const savedConfiguration = bleConfigurations[address];
        if (savedConfiguration) {
          try {
            await BluetoothLE.selectCharacteristics(savedConfiguration);
            setBleConfigured(true);
            setDeviceSheetOpen(false);
          } catch (configurationError) {
            setBleConfigured(false);
            toast({
              title: "Revisa las características GATT",
              description: configurationError.message,
            });
          }
        }
      } else {
        await BluetoothClassic.connect({ address });
        setDeviceSheetOpen(false);
      }
      const device = devices.find((item) =>
        item.address === address && item.transport === transportType
      );
      const selected = {
        address,
        transport: transportType,
        name: device?.name || (address === lastDevice.address ? lastDevice.name : "") || "",
      };
      setLastDevice(selected);
      if (transportType === "classic") {
        setConnection((previous) => ({
          ...previous,
          transport: "classic",
          name: selected.name || previous.name,
          address,
        }));
      }
      try {
        localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(selected));
      } catch (storageError) {
        console.error("No se pudo guardar el último dispositivo Bluetooth.", storageError);
        toast({ title: "No se guardó el dispositivo", description: storageError.message });
      }
    } catch (error) {
      setConnection({ connected: false, connecting: false, name: "", address: "", transport: "" });
      toast({ title: "No se pudo conectar", description: error.message });
    }
  };

  const configureBleCharacteristics = async (configuration) => {
    try {
      await BluetoothLE.selectCharacteristics(configuration);
      setBleConfigured(true);
      const nextConfigurations = { ...bleConfigurations, [connection.address]: configuration };
      setBleConfigurations(nextConfigurations);
      try {
        localStorage.setItem(BLE_CONFIG_STORAGE_KEY, JSON.stringify(nextConfigurations));
      } catch (storageError) {
        console.error("No se pudo guardar la configuración GATT local.", storageError);
        toast({ title: "No se guardó la configuración BLE", description: storageError.message });
      }
      setDeviceSheetOpen(false);
    } catch (error) {
      toast({ title: "No se pudo configurar BLE", description: error.message });
    }
  };

  const reconnectLastDevice = async () => {
    if (!lastDevice.address) return;
    setSelectedAddress(lastDevice.address);
    setSelectedTransport(lastDevice.transport || "classic");
    if (!devices.some((device) =>
      device.address === lastDevice.address && device.transport === (lastDevice.transport || "classic")
    )) {
      setDevices((current) => mergeDevice(current, {
        ...lastDevice,
        bonded: false,
        transport: lastDevice.transport || "classic",
        type: lastDevice.transport === "ble" ? "Bluetooth LE" : "Bluetooth clásico · SPP",
      }));
    }
    await connectSelectedDevice(lastDevice.address, lastDevice.transport || "classic");
  };

  const disconnect = async () => {
    try {
      if (connection.transport === "ble") await BluetoothLE.disconnect();
      else await BluetoothClassic.disconnect();
      setConnection({ connected: false, connecting: false, name: "", address: "", transport: "" });
    } catch (error) {
      toast({ title: "No se pudo desconectar", description: error.message });
    }
  };

  const handleConnectionButton = () => {
    if (connection.connected) {
      disconnect();
    } else if (!connection.connecting) {
      openBluetoothPicker();
    }
  };

  const handleExitApplication = async () => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
      toast({
        title: "Cerrar aplicación",
        description: "Esta opción está disponible en la aplicación Android.",
      });
      return;
    }
    try {
      await ApplicationControl.exitApp();
    } catch (error) {
      console.error("No se pudo cerrar la aplicación.", error);
      toast({ title: "No se pudo cerrar la aplicación", description: error.message });
    }
  };

  const handleScan = async () => {
    try {
      const result = await BluetoothClassic.getBondedDevices();
      setDevices((result.devices || []).map((device) => ({
        ...device,
        transport: device.transport || "classic",
        type: device.type || "Bluetooth clásico · SPP/RFCOMM",
      })));
      setScanning(true);
      await startScans();
    } catch (error) {
      setScanning(false);
      toast({ title: "No se pudo buscar dispositivos", description: error.message });
    }
  };

  const closeDeviceSheet = () => {
    setDeviceSheetOpen(false);
    setScanning(false);
    classicScanningRef.current = false;
    bleScanningRef.current = false;
    Promise.all([BluetoothClassic.stopDiscovery(), BluetoothLE.stopScan()]).catch((error) => {
      console.error("No se pudo detener la búsqueda Bluetooth.", error);
    });
  };

  const resetButtons = () => setButtons(DEFAULT_BUTTONS);
  const selectDevice = (address, transport) => {
    setSelectedAddress(address);
    setSelectedTransport(transport || "classic");
  };
  const selectTransport = (transport) => {
    setSelectedTransport(transport);
    const saved = lastDevice.transport === transport ? lastDevice.address : "";
    const available = devices.find((device) => device.transport === transport)?.address || "";
    setSelectedAddress(saved || available);
  };
  const restoreDefaultLayout = () => setControlLayout(DEFAULT_LAYOUT);

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-slate-950 p-0">
      <div className="h-full w-full min-w-0">
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-b from-slate-800 to-slate-900 px-0 py-2 sm:py-3">
          <div className="relative mb-1 flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 pt-4">
            <span className="absolute left-1/2 top-0 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <Radio className="h-3 w-3" /> {(connection.connected ? connection.transport : selectedTransport) === "ble" ? "Bluetooth LE · GATT" : "Bluetooth clásico · SPP"}
            </span>
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-700 shadow-md">
                <Bluetooth className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="font-bold leading-tight text-white">BT Control</h1>
                <p className="text-[11px] text-slate-400">CUN · Gamepad</p>
              </div>
            </div>
            <div className="relative flex items-center gap-2">
              <button
                onClick={() => setSettingsMenuOpen((open) => !open)}
                aria-label="Configuración de controles"
                aria-expanded={settingsMenuOpen}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-white shadow-sm hover:bg-slate-600"
              >
                <Settings2 className="h-4 w-4" />
              </button>
              {settingsMenuOpen && (
                <div className="absolute right-0 top-11 z-30 w-52 rounded-xl border border-slate-700 bg-slate-800 p-1.5 shadow-xl">
                  <button
                    onClick={() => {
                      setSettingsMenuOpen(false);
                      setGlobalOpen(true);
                    }}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-700"
                  >
                    Configurar todos los botones
                  </button>
                  <button
                    onClick={() => {
                      setSettingsMenuOpen(false);
                      setLayoutEditing(true);
                    }}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-700"
                  >
                    Personalizar controles
                  </button>
                  <button
                    onClick={() => {
                      setSettingsMenuOpen(false);
                      handleExitApplication();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700"
                  >
                    <LogOut className="h-4 w-4" />
                    Cerrar aplicación
                  </button>
                  <button
                    onClick={() => {
                      setSettingsMenuOpen(false);
                      resetButtons();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700"
                  >
                    <Trash2 className="h-4 w-4" />
                    Restablecer
                  </button>
                </div>
              )}
              <button
                onClick={handleConnectionButton}
                disabled={connection.connecting}
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium shadow-sm transition-colors ${
                  connection.connected
                    ? "bg-emerald-500 text-white"
                    : "bg-slate-700 text-white hover:bg-slate-600"
                } disabled:opacity-60`}
              >
                <Power className="h-4 w-4" />
                {connection.connecting ? "Conectando..." : connection.connected ? "Desconectar" : "Conectar"}
              </button>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            {layoutEditing && (
              <div className="pointer-events-none absolute left-1/2 top-1 z-30 flex w-max max-w-[calc(100%-16px)] -translate-x-1/2 items-center justify-between gap-2 rounded-xl border border-primary/30 bg-slate-900/90 px-2 py-1 shadow-lg">
                <span className="text-[10px] font-medium text-slate-300">Personalizar controles · arrastra para mover</span>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={restoreDefaultLayout}
                    className="pointer-events-auto rounded-lg border border-slate-600 px-2 py-1.5 text-[10px] font-medium text-slate-200"
                  >
                    Restaurar original
                  </button>
                  <button
                    onClick={() => setLayoutEditing(false)}
                    className="pointer-events-auto rounded-lg bg-primary px-2 py-1.5 text-[10px] font-medium text-primary-foreground"
                  >
                    Guardar
                  </button>
                </div>
              </div>
            )}
          <ControlPad
            buttons={buttons}
            onPress={handlePress}
            onRelease={handleRelease}
            onConfig={openConfig}
            layout={controlLayout}
            editing={layoutEditing}
            onLayoutChange={(id, position) => setControlLayout((previous) => ({
              ...previous,
              [id]: position,
            }))}
            statusPanel={
              <div className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        connection.connected ? "bg-emerald-400 animate-pulse" : "bg-slate-600"
                      }`}
                    ></span>
                    <span className="truncate text-[10px] font-mono text-slate-400">
                      {connection.connected ? `LINK · ${connection.name || connection.address}` : "SIN ENLACE"}
                    </span>
                  </div>
                  <span className="ml-2 shrink-0 text-[10px] font-mono text-slate-500">
                    {connection.connecting ? "CONECTANDO" : connection.connected ? "ONLINE" : "OFFLINE"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-slate-900 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1 text-slate-500">
                        <Activity className="h-3 w-3" />
                        <span className="text-[9px] uppercase tracking-wide">Latencia</span>
                      </div>
                      <button
                        type="button"
                        aria-pressed={ackEnabled}
                        title="Medir solo con firmware que responda ~ACK:<id> a ~PING:<id>"
                        onClick={() => setAckEnabled((enabled) => !enabled)}
                        className={`rounded px-1 text-[8px] font-semibold ${
                          ackEnabled ? "bg-emerald-500/20 text-emerald-300" : "text-slate-500"
                        }`}
                      >
                        {ackEnabled ? "ACK ON" : "ACK"}
                      </button>
                    </div>
                    <div className="text-base font-mono font-bold leading-tight text-emerald-400">
                      {latency === null ? "N/D" : latency.toFixed(0)}
                      {latency !== null && <span className="ml-0.5 text-[9px] text-slate-500">ms</span>}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-900 px-2 py-1.5">
                    <div className="flex items-center gap-1 text-slate-500">
                      <Ruler className="h-3 w-3" />
                      <span className="text-[9px] uppercase tracking-wide">Distancia</span>
                    </div>
                    <div className="text-base font-mono font-bold leading-tight text-cyan-400">N/D</div>
                  </div>
                </div>
              </div>
            }
            outputPanel={
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-2">
                <div className="mb-1 flex items-center gap-1.5 px-0.5">
                  <Terminal className="h-3 w-3 text-slate-500" />
                  <span className="text-[9px] uppercase tracking-wide text-slate-500">Salida TX</span>
                </div>
                <div ref={logRef} className="h-16 overflow-y-auto space-y-0.5 font-mono text-[10px] leading-tight">
                  {log.length === 0 ? (
                    <p className="text-slate-600">Esperando comandos…</p>
                  ) : (
                    log.map((entry, index) => (
                      <div key={`${entry.time}-${index}`} className="text-emerald-400">
                        <span className="text-slate-500">{entry.time}</span>{" "}
                        <span className="text-cyan-400">[{entry.dir}]</span>{" "}
                        <span className="break-all text-white">{JSON.stringify(entry.char)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            }
          />
          </div>

          <p className="pointer-events-none absolute bottom-1 left-1/2 z-20 -translate-x-1/2 text-center text-[9px] leading-tight text-slate-500">
            Desarrollado por: Miguel Maldonado
          </p>
        </div>
      </div>

      <BluetoothDeviceSheet
        open={deviceSheetOpen}
        devices={devices}
        scanning={scanning}
        connecting={connection.connecting}
        selectedAddress={selectedAddress}
        selectedTransport={selectedTransport}
        connection={connection}
        services={bleServices}
        lastDevice={lastDevice}
        onSelect={selectDevice}
        onTransportSelect={selectTransport}
        onScan={handleScan}
        onConnect={connectSelectedDevice}
        onConfigureBle={configureBleCharacteristics}
        onDisconnect={disconnect}
        onReconnect={reconnectLastDevice}
        onClose={closeDeviceSheet}
      />
      <ButtonConfigSheet
        open={configOpen}
        buttonId={configId}
        current={configId ? buttons[configId] : null}
        conflicts={conflicts}
        onSave={handleSave}
        onClose={() => setConfigOpen(false)}
      />
      <GlobalConfigSheet
        open={globalOpen}
        buttons={buttons}
        onSave={handleSave}
        onClose={() => setGlobalOpen(false)}
      />
    </div>
  );
}
