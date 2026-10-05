export const DEFAULT_BUTTONS = {
  up: { char: "U" },
  down: { char: "D" },
  left: { char: "L" },
  right: { char: "R" },
  a: { char: "A" },
  b: { char: "B" },
  x: { char: "X" },
  y: { char: "Y" },
  l2: { char: "LT" },
  r2: { char: "RT" },
  l_up: { char: "8" },
  l_down: { char: "2" },
  l_left: { char: "4" },
  l_right: { char: "6" },
  r_up: { char: "T" },
  r_down: { char: "G" },
  r_left: { char: "F" },
  r_right: { char: "H" },
};

export const BUTTON_LABELS = {
  up: "D-Pad arriba",
  down: "D-Pad abajo",
  left: "D-Pad izquierda",
  right: "D-Pad derecha",
  a: "Botón A",
  b: "Botón B",
  x: "Botón X",
  y: "Botón Y",
  l2: "Gatillo izquierdo L2",
  r2: "Gatillo derecho R2",
  l_up: "Joystick izquierdo arriba",
  l_down: "Joystick izquierdo abajo",
  l_left: "Joystick izquierdo izquierda",
  l_right: "Joystick izquierdo derecha",
  r_up: "Joystick derecho arriba",
  r_down: "Joystick derecho abajo",
  r_left: "Joystick derecho izquierda",
  r_right: "Joystick derecho derecha",
};

export const STORAGE_KEY = "ble_controller_buttons";

export function loadButtons() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_BUTTONS;

    const storedButtons = JSON.parse(saved);
    if (!storedButtons || typeof storedButtons !== "object" || Array.isArray(storedButtons)) {
      throw new Error("El formato guardado no es un objeto de controles.");
    }

    return Object.fromEntries(
      Object.entries(DEFAULT_BUTTONS).map(([id, defaults]) => {
        const savedButton = storedButtons[id];
        return [
          id,
          {
            ...defaults,
            ...(savedButton && typeof savedButton === "object" ? savedButton : {}),
          },
        ];
      })
    );
  } catch (error) {
    console.error("No se pudo cargar la configuración local de botones.", error);
    return DEFAULT_BUTTONS;
  }
}

export function getButtonConflicts(buttons) {
  const grouped = new Map();
  Object.entries(buttons).forEach(([id, setting]) => {
    const value = typeof setting?.char === "string" ? setting.char : "";
    if (!value.trim()) return;
    const ids = grouped.get(value) || [];
    ids.push(id);
    grouped.set(value, ids);
  });

  return [...grouped.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([char, ids]) => ({ char, ids }));
}
