import { Bluetooth, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const EMPTY_SERVICES = [];

export default function BluetoothDeviceSheet({
  open,
  devices = [],
  scanning,
  connecting,
  selectedAddress,
  selectedTransport,
  connection,
  services = EMPTY_SERVICES,
  onSelect,
  onTransportSelect,
  onScan,
  onConnect,
  onConfigureBle,
  onDisconnect,
  lastDevice,
  onReconnect,
  onClose,
}) {
  const characteristics = useMemo(
    () => services.flatMap((service) => (service.characteristics || []).map((characteristic) => ({
      ...characteristic,
      serviceUuid: service.uuid,
      key: `${service.uuid}|${characteristic.uuid}`,
    }))),
    [services]
  );
  const [txKey, setTxKey] = useState("");
  const [rxKey, setRxKey] = useState("");

  useEffect(() => {
    setTxKey(characteristics.find((characteristic) => characteristic.write)?.key || "");
    setRxKey(characteristics.find((characteristic) => characteristic.notify)?.key || "");
  }, [characteristics]);

  if (!open) return null;
  const selectedTx = characteristics.find((characteristic) => characteristic.key === txKey);
  const selectedRx = characteristics.find((characteristic) => characteristic.key === rxKey);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-800 p-5 shadow-xl sm:max-w-md sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-slate-100">Dispositivos Bluetooth</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {connection.connected && (
          <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
            <span className="min-w-0 truncate text-xs text-emerald-300">
              Conectado · {connection.name || connection.address} · {connection.transport === "ble" ? "BLE GATT" : "SPP/RFCOMM"}
            </span>
            <button
              onClick={onDisconnect}
              className="shrink-0 rounded-lg border border-slate-600 px-2.5 py-1.5 text-[11px] font-medium text-slate-100"
            >
              Desconectar
            </button>
          </div>
        )}

        <p className="mb-4 text-xs text-slate-400">
          Busca módulos clásicos SPP y periféricos BLE. BLE requiere seleccionar sus características GATT de escritura y, opcionalmente, recepción.
        </p>

        <div className="mb-4 flex gap-2">
          {[
            ["classic", "Clásico · SPP"],
            ["ble", "Bluetooth LE"],
          ].map(([transport, label]) => (
            <button
              key={transport}
              onClick={() => onTransportSelect(transport)}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${
                selectedTransport === transport
                  ? "border-blue-400 bg-blue-500/20 text-blue-200"
                  : "border-slate-600 text-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            Dispositivos {selectedTransport === "ble" ? "BLE" : "clásicos"}
          </span>
          <button
            onClick={onScan}
            disabled={scanning || connecting}
            className="flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-2 text-xs font-medium text-slate-100 disabled:opacity-50"
          >
            {scanning ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {scanning ? "Buscando..." : "Buscar"}
          </button>
        </div>

        {devices.filter((device) => device.transport === selectedTransport).length === 0 ? (
          <p className="rounded-xl bg-slate-900 p-4 text-center text-sm text-slate-400">
            {scanning ? "Buscando dispositivos cercanos..." : "No hay dispositivos. Pulsa Buscar para volver a escanear."}
          </p>
        ) : (
          <div className="mb-4 max-h-64 space-y-2 overflow-y-auto">
            {devices.filter((device) => device.transport === selectedTransport).map((device) => (
              <button
                key={`${device.transport}:${device.address}`}
                onClick={() => onSelect(device.address, device.transport)}
                disabled={connecting}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${
                  selectedAddress === device.address
                    ? "border-blue-400 bg-blue-500/20"
                    : "border-slate-700 bg-slate-900"
                }`}
              >
                <Bluetooth className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-100">
                    {device.name || "Dispositivo sin nombre"}
                  </span>
                  <span className="block font-mono text-[10px] text-slate-400">{device.address}</span>
                  <span className="block text-[10px] text-slate-400">{device.type}</span>
                </span>
                <span className="text-[10px] text-slate-400">
                  {device.address === connection.address && connection.connected
                    ? "Conectado"
                    : connecting && device.address === selectedAddress
                    ? "Conectando"
                    : !connection.connected && device.address === selectedAddress
                    ? "Desconectado"
                    : device.bonded
                    ? "Emparejado"
                    : "Disponible"}
                </span>
              </button>
            ))}
          </div>
        )}

        {lastDevice?.address && !connection.connected && (
          <button
            onClick={onReconnect}
            disabled={connecting}
            className="mb-3 w-full rounded-lg border border-slate-600 px-3 py-2 text-xs font-medium text-slate-100 disabled:opacity-50"
          >
            Reconectar último dispositivo: {lastDevice.name || lastDevice.address}
          </button>
        )}

        {selectedTransport === "ble" && connection.connected && connection.transport === "ble" && (
          <section className="mb-4 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
            <h4 className="mb-2 text-sm font-semibold text-slate-100">
              GATT · {connection.name || connection.address}
            </h4>
            {services.length === 0 ? (
              <p className="text-xs text-slate-400">Descubriendo servicios y características...</p>
            ) : (
              <>
                <label className="mb-1 block text-xs text-slate-300">Característica TX (escritura)</label>
                <select
                  value={txKey}
                  onChange={(event) => setTxKey(event.target.value)}
                  className="mb-3 w-full rounded-lg border border-slate-600 bg-slate-800 px-2 py-2 text-xs font-mono text-slate-100"
                >
                  <option value="">Selecciona una característica de escritura</option>
                  {characteristics.filter((characteristic) => characteristic.write).map((characteristic) => (
                    <option key={characteristic.key} value={characteristic.key}>
                      {characteristic.serviceUuid} · {characteristic.uuid}
                    </option>
                  ))}
                </select>
                <label className="mb-1 block text-xs text-slate-300">Característica RX (notificación/indicación, opcional)</label>
                <select
                  value={rxKey}
                  onChange={(event) => setRxKey(event.target.value)}
                  className="mb-3 w-full rounded-lg border border-slate-600 bg-slate-800 px-2 py-2 text-xs font-mono text-slate-100"
                >
                  <option value="">Sin recepción BLE</option>
                  {characteristics.filter((characteristic) => characteristic.notify).map((characteristic) => (
                    <option key={characteristic.key} value={characteristic.key}>
                      {characteristic.serviceUuid} · {characteristic.uuid}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => selectedTx && onConfigureBle({
                    serviceUuid: selectedTx.serviceUuid,
                    txUuid: selectedTx.uuid,
                    rxServiceUuid: selectedRx?.serviceUuid || "",
                    rxUuid: selectedRx?.uuid || "",
                  })}
                  disabled={!selectedTx || connecting}
                  className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  Usar características seleccionadas
                </button>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-slate-400">Ver todos los servicios y características</summary>
                  <div className="mt-2 max-h-32 space-y-2 overflow-y-auto text-[10px] font-mono text-slate-400">
                    {services.map((service) => (
                      <div key={service.uuid}>
                        <div>{service.uuid}</div>
                        {(service.characteristics || []).map((characteristic) => (
                          <div key={characteristic.uuid} className="pl-2">
                            {characteristic.uuid} · {characteristic.write ? "WRITE " : ""}
                            {characteristic.notify ? "NOTIFY/INDICATE" : ""}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </details>
              </>
            )}
          </section>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-100"
          >
            Cancelar
          </button>
          <button
            onClick={onConnect}
            disabled={!selectedAddress || connecting || (selectedTransport === "ble" && connection.connected)}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {connecting ? "Conectando..." : selectedTransport === "ble" && connection.connected ? "BLE conectado" : "Conectar"}
          </button>
        </div>
      </div>
    </div>
  );
}
