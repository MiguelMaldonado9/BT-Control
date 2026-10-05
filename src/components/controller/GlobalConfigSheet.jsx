import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import { BUTTON_LABELS, getButtonConflicts } from "@/lib/controller-config";

const GROUPS = [
  {
    title: "Joystick Izquierdo",
    ids: ["l_up", "l_down", "l_left", "l_right"],
    labels: { l_up: "Arriba", l_down: "Abajo", l_left: "Izquierda", l_right: "Derecha" },
  },
  {
    title: "D-Pad",
    ids: ["up", "down", "left", "right"],
    labels: { up: "Arriba", down: "Abajo", left: "Izquierda", right: "Derecha" },
  },
  {
    title: "Botones de Acción",
    ids: ["a", "b", "x", "y"],
    labels: { a: "Botón A", b: "Botón B", x: "Botón X", y: "Botón Y" },
  },
  {
    title: "Gatillos",
    ids: ["l2", "r2"],
    labels: { l2: "Gatillo izquierdo L2", r2: "Gatillo derecho R2" },
  },
  {
    title: "Joystick Derecho",
    ids: ["r_up", "r_down", "r_left", "r_right"],
    labels: { r_up: "Arriba", r_down: "Abajo", r_left: "Izquierda", r_right: "Derecha" },
  },
];

export default function GlobalConfigSheet({ open, buttons, onSave, onClose }) {
  const [draft, setDraft] = useState({});

  useEffect(() => {
    if (open) {
      const init = {};
      Object.keys(buttons).forEach((k) => {
        init[k] = {
          char: buttons[k]?.char || "",
          releaseChar: buttons[k]?.releaseChar || "",
        };
      });
      setDraft(init);
    }
  }, [open, buttons]);

  if (!open) return null;

  const handleChange = (id, key, value) =>
    setDraft((draftValues) => ({
      ...draftValues,
      [id]: { ...draftValues[id], [key]: value },
    }));

  const handleSave = () => {
    Object.entries(draft).forEach(([id, value]) => onSave(id, value.char, value.releaseChar));
    onClose();
  };

  const conflicts = getButtonConflicts(
    Object.fromEntries(Object.entries(draft).map(([id, value]) => [id, { char: value.char }]))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-800 p-5 shadow-xl sm:rounded-2xl">
        <div className="sticky top-0 mb-4 flex items-center justify-between bg-slate-800 pb-2">
          <h3 className="font-semibold text-slate-100">Configurar todos los botones</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-xs text-slate-400 mb-4">
          Define los caracteres que se envían por Bluetooth SPP y, si hace falta, los de liberación.
        </p>

        {conflicts.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-xs text-amber-300">
            Hay caracteres duplicados. Corrige las asignaciones marcadas para evitar comandos ambiguos:
            <ul className="mt-1 list-inside list-disc">
              {conflicts.map(({ char, ids }) => (
                <li key={char}>{JSON.stringify(char)}: {ids.map((id) => groupLabel(id)).join(" · ")}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-5">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
                {group.title}
              </h4>
              <div className="grid grid-cols-2 gap-2.5">
                {group.ids.map((id) => (
                  <div key={id}>
                    <label className="mb-1 block text-[11px] text-slate-300">
                      {group.labels[id]}
                    </label>
                    <input
                      type="text"
                      value={draft[id]?.char ?? ""}
                      onChange={(e) => handleChange(id, "char", e.target.value)}
                      placeholder="ej. F (vacío = desactivado)"
                      className={`w-full rounded-lg border ${
                        conflicts.some((conflict) => conflict.ids.includes(id))
                          ? "border-amber-500"
                          : "border-slate-600"
                      } bg-slate-900 px-2.5 py-2 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-ring`}
                    />
                    <label className="mt-2 block text-[10px] text-slate-400">
                      Carácter al soltar (opcional)
                    </label>
                    <input
                      type="text"
                      value={draft[id]?.releaseChar ?? ""}
                      onChange={(e) => handleChange(id, "releaseChar", e.target.value)}
                      placeholder="Sin liberación"
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-2 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="sticky bottom-0 mt-5 flex gap-2 bg-slate-800 pt-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            Guardar todo
          </button>
        </div>
      </div>
    </div>
  );
}

function groupLabel(id) {
  return BUTTON_LABELS[id] || id;
}