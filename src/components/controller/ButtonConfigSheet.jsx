import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import { BUTTON_LABELS } from "@/lib/controller-config";

export default function ButtonConfigSheet({ open, buttonId, current, conflicts, onSave, onClose }) {
  const [char, setChar] = useState("");
  const [releaseChar, setReleaseChar] = useState("");

  useEffect(() => {
    setChar(current?.char || "");
    setReleaseChar(current?.releaseChar || "");
  }, [current, open]);

  if (!open) return null;

  const labelMap = {
    up: "Botón ▲ (Arriba)",
    down: "Botón ▼ (Abajo)",
    left: "Botón ◀ (Izquierda)",
    right: "Botón ▶ (Derecha)",
    a: "Botón A",
    b: "Botón B",
    x: "Botón X",
    y: "Botón Y",
    l2: "Gatillo izquierdo L2",
    r2: "Gatillo derecho R2",
    l_up: "Joystick izquierdo · arriba",
    l_down: "Joystick izquierdo · abajo",
    l_left: "Joystick izquierdo · izquierda",
    l_right: "Joystick izquierdo · derecha",
    r_up: "Joystick derecho · arriba",
    r_down: "Joystick derecho · abajo",
    r_left: "Joystick derecho · izquierda",
    r_right: "Joystick derecho · derecha",
  };
  const conflictingIds = conflicts
    .filter((conflict) => conflict.ids.includes(buttonId))
    .flatMap((conflict) => conflict.ids.filter((id) => id !== buttonId));
  const inputClass = (isConflicting) =>
    `w-full rounded-lg border ${
      isConflicting ? "border-amber-500" : "border-slate-600"
    } bg-slate-900 px-3 py-2.5 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-ring`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full rounded-t-2xl border border-slate-700 bg-slate-800 p-5 shadow-xl sm:max-w-sm sm:rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-100">
            Configurar {labelMap[buttonId] || "botón"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="block text-sm font-medium text-slate-200 mb-1.5">
          Carácter(es) al presionar
        </label>
        <p className="text-xs text-slate-400 mb-3">
          Se envían directamente por Bluetooth SPP, sin terminador añadido.
        </p>
        <input
          type="text"
          value={char}
          onChange={(e) => setChar(e.target.value)}
          placeholder="ej. A, 1, FWD (vacío = desactivado)"
          className={inputClass(conflictingIds.length > 0)}
          autoFocus
        />

        {conflictingIds.length > 0 && (
          <p className="mt-2 text-xs text-amber-300">
            Este carácter también está asignado a: {conflictingIds.map((id) => BUTTON_LABELS[id] || id).join(", ")}. Edita los controles en conflicto para usar una asignación única.
          </p>
        )}
        {!char.trim() && (
          <p className="mt-2 text-xs text-amber-300">
            Este control no enviará nada hasta que configures un carácter.
          </p>
        )}

        <label className="mt-4 block text-sm font-medium text-slate-200 mb-1.5">
          Carácter opcional al soltar
        </label>
        <input
          type="text"
          value={releaseChar}
          onChange={(e) => setReleaseChar(e.target.value)}
          placeholder="Vacío = sin comando de liberación"
          className={inputClass(false)}
        />
        <p className="mt-1.5 text-xs text-slate-400">
          Solo se transmite al soltar si defines este carácter.
        </p>

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              onSave(buttonId, char, releaseChar);
              onClose();
            }}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}