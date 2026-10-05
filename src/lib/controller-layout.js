export const LAYOUT_STORAGE_KEY = "ble_controller_layout";

export const DEFAULT_LAYOUT = {
  stickLeft: { x: 8, y: 68 },
  up: { x: 18, y: 16 },
  left: { x: 11, y: 32 },
  right: { x: 25, y: 32 },
  down: { x: 18, y: 48 },
  l2: { x: 8, y: 12 },
  r2: { x: 92, y: 12 },
  y: { x: 79, y: 14 },
  x: { x: 71, y: 32 },
  b: { x: 87, y: 32 },
  a: { x: 79, y: 50 },
  stickRight: { x: 88, y: 70 },
  statusPanel: { x: 49, y: 20 },
  outputPanel: { x: 49, y: 78, scale: 1 },
};

const PREVIOUS_DEFAULT_LAYOUT = {
  stickLeft: { x: 8, y: 74 },
  up: { x: 18, y: 16 },
  left: { x: 13, y: 32 },
  right: { x: 24, y: 32 },
  down: { x: 18, y: 48 },
  y: { x: 79, y: 13 },
  x: { x: 73, y: 32 },
  b: { x: 85, y: 32 },
  a: { x: 79, y: 51 },
  stickRight: { x: 88, y: 78 },
  statusPanel: { x: 49, y: 20 },
  outputPanel: { x: 49, y: 78 },
};

export function loadControllerLayout() {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!saved) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("El formato guardado de distribución no es válido.");
    }
    const isPreviousDefault = Object.entries(PREVIOUS_DEFAULT_LAYOUT).every(([id, position]) =>
      Number(parsed[id]?.x) === position.x && Number(parsed[id]?.y) === position.y
    );
    if (isPreviousDefault) return DEFAULT_LAYOUT;
    return Object.fromEntries(
      Object.entries(DEFAULT_LAYOUT).map(([id, position]) => {
        const candidate = parsed[id];
        const x = Number(candidate?.x);
        const y = Number(candidate?.y);
        return [
          id,
          {
            x: Number.isFinite(x) ? Math.min(96, Math.max(4, x)) : position.x,
            y: Number.isFinite(y) ? Math.min(88, Math.max(12, y)) : position.y,
            ...(["stickLeft", "stickRight", "outputPanel"].includes(id)
              ? {
                  scale: Number.isFinite(Number(candidate?.scale))
                    ? Math.min(
                        id === "stickLeft" || id === "stickRight" ? 1.35 : 1.5,
                        Math.max(0.75, Number(candidate.scale))
                      )
                    : 1,
                }
              : {}),
          },
        ];
      })
    );
  } catch (error) {
    console.error("No se pudo cargar la distribución local de controles.", error);
    return DEFAULT_LAYOUT;
  }
}
