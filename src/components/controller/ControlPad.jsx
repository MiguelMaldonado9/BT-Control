import { useRef } from "react";
import Joystick from "./Joystick";

function PadButton({ label, char, onPress, onRelease, onConfig, accent, size = "md", editing }) {
  const longPressTimer = useRef(null);
  const didLongPress = useRef(false);
  const sizeCls =
    size === "lg"
      ? "h-16 w-16 text-2xl"
      : size === "sm"
      ? "h-11 w-11 text-sm"
      : "h-14 w-14 text-lg";

  return (
    <button
      onPointerDown={(event) => {
        if (editing) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        didLongPress.current = false;
        onPress();
        if (char?.trim()) {
          longPressTimer.current = setTimeout(() => {
            didLongPress.current = true;
            onRelease();
            onConfig();
          }, 500);
        }
      }}
      onPointerUp={() => {
        clearTimeout(longPressTimer.current);
        if (!editing && !didLongPress.current) onRelease();
      }}
      onPointerCancel={() => {
        clearTimeout(longPressTimer.current);
        if (!editing && !didLongPress.current) onRelease();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        clearTimeout(longPressTimer.current);
        if (!editing && !didLongPress.current) {
          didLongPress.current = true;
          onRelease();
          onConfig();
        }
      }}
      className={`relative select-none touch-none active:scale-90 transition-transform rounded-2xl flex flex-col items-center justify-center font-bold shadow-md border-[3px] border-slate-800 ${sizeCls} ${
        accent === "dark"
          ? "bg-slate-900 text-white"
          : accent === "red"
          ? "bg-red-500 text-white"
          : accent === "blue"
          ? "bg-blue-500 text-white"
          : accent === "green"
          ? "bg-emerald-500 text-white"
          : accent === "amber"
          ? "bg-amber-500 text-white"
          : "bg-slate-100 text-slate-900"
      } ${editing ? "ring-2 ring-primary ring-offset-2 ring-offset-slate-900" : ""}`}
    >
      <span className="leading-none">{label}</span>
      {char && char.toUpperCase() !== label.toUpperCase() && (
        <span className="mt-0.5 font-mono text-[9px] leading-none opacity-70">{char}</span>
      )}
    </button>
  );
}

function LayoutItem({ id, layout, editing, stageRef, onLayoutChange, children }) {
  const moveRef = useRef(null);
  const position = layout[id];

  const handlePointerDown = (event) => {
    if (!editing) return;
    if (event.target.closest("[data-resize-control]")) return;
    event.preventDefault();
    const itemRect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    moveRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - (itemRect.left + itemRect.width / 2),
      offsetY: event.clientY - (itemRect.top + itemRect.height / 2),
    };
  };

  const handlePointerMove = (event) => {
    if (!editing || moveRef.current?.pointerId !== event.pointerId || !stageRef.current) return;
    const stage = stageRef.current;
    const rect = stage.getBoundingClientRect();
    const itemRect = event.currentTarget.getBoundingClientRect();
    const edgeX = (itemRect.width / 2 / rect.width) * 100;
    const edgeY = (itemRect.height / 2 / rect.height) * 100;
    const centerX = event.clientX - moveRef.current.offsetX;
    const centerY = event.clientY - moveRef.current.offsetY;
    const x = Math.min(100 - edgeX, Math.max(edgeX, ((centerX - rect.left) / rect.width) * 100));
    const y = Math.min(100 - edgeY, Math.max(edgeY, ((centerY - rect.top) / rect.height) * 100));
    onLayoutChange(id, { x, y });
  };

  return (
    <div
      data-layout-item={id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => { moveRef.current = null; }}
      onPointerCancel={() => { moveRef.current = null; }}
      className={`absolute z-10 ${editing ? "touch-none cursor-move" : ""}`}
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: `translate(-50%, -50%)${id === "outputPanel" ? ` scale(${position.scale || 1})` : ""}`,
        transformOrigin: "center",
      }}
    >
      {children}
    </div>
  );
}

export default function ControlPad({
  buttons,
  onPress,
  onRelease,
  onConfig,
  statusPanel,
  outputPanel,
  layout,
  editing,
  onLayoutChange,
}) {
  const stageRef = useRef(null);
  const resizeJoystick = (id, delta) => {
    const currentScale = layout[id].scale || 1;
    const maximumScale = id === "stickLeft" || id === "stickRight" ? 1.35 : 1.5;
    const nextScale = Math.min(maximumScale, Math.max(0.75, Math.round((currentScale + delta) * 100) / 100));
    if (nextScale !== currentScale) onLayoutChange(id, { ...layout[id], scale: nextScale });
  };

  const button = (id, label, accent, size = "md") => (
    <LayoutItem
      key={id}
      id={id}
      layout={layout}
      editing={editing}
      stageRef={stageRef}
      onLayoutChange={onLayoutChange}
    >
      <PadButton
        label={label}
        char={buttons[id]?.char || ""}
        accent={accent}
        size={size}
        editing={editing}
        onPress={() => onPress(id)}
        onRelease={() => onRelease(id)}
        onConfig={() => onConfig(id)}
      />
    </LayoutItem>
  );

  return (
    <div
      ref={stageRef}
      data-testid="controller-stage"
      className={`relative h-full min-h-0 w-full overflow-hidden rounded-2xl ${
        editing ? "border border-dashed border-primary/70 bg-primary/5" : ""
      }`}
    >
      {["l", "r"].map((prefix) => {
        const id = prefix === "l" ? "stickLeft" : "stickRight";
        return (
          <LayoutItem
            key={id}
            id={id}
            layout={layout}
            editing={editing}
            stageRef={stageRef}
            onLayoutChange={onLayoutChange}
          >
            <div>
              <Joystick
                label={prefix === "l" ? "Stick L" : "Stick R"}
                prefix={prefix}
                buttons={buttons}
                onDirection={onPress}
                onRelease={onRelease}
                onConfig={onConfig}
                editing={editing}
                scale={layout[id].scale || 1}
                onResize={(delta) => resizeJoystick(id, delta)}
              />
            </div>
          </LayoutItem>
        );
      })}

      {button("up", "▲", "dark", "sm")}
      {button("left", "◀", "dark", "sm")}
      {button("right", "▶", "dark", "sm")}
      {button("down", "▼", "dark", "sm")}
      {button("l2", "L2", "dark", "sm")}
      {button("r2", "R2", "dark", "sm")}
      {button("y", "Y", "amber")}
      {button("x", "X", "blue")}
      {button("b", "B", "red")}
      {button("a", "A", "green")}

      <LayoutItem
        id="statusPanel"
        layout={layout}
        editing={editing}
        stageRef={stageRef}
        onLayoutChange={onLayoutChange}
      >
        <div className="w-[min(32vw,360px)] min-w-[200px]">{statusPanel}</div>
      </LayoutItem>
      <LayoutItem
        id="outputPanel"
        layout={layout}
        editing={editing}
        stageRef={stageRef}
        onLayoutChange={onLayoutChange}
      >
        <div className="w-[min(32vw,360px)] min-w-[200px]">
          {outputPanel}
          {editing && (
            <div className="mt-2 flex items-center justify-center gap-2">
              <button
                type="button"
                data-resize-control
                aria-label="Reducir tamaño de la terminal"
                onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                onClick={() => resizeJoystick("outputPanel", -0.05)}
                disabled={(layout.outputPanel.scale || 1) <= 0.75}
                className="h-6 w-8 rounded border border-slate-600 bg-slate-800 text-sm text-white disabled:opacity-40"
              >
                −
              </button>
              <span className="min-w-9 text-center text-[9px] text-slate-300">
                {Math.round((layout.outputPanel.scale || 1) * 100)}%
              </span>
              <button
                type="button"
                data-resize-control
                aria-label="Aumentar tamaño de la terminal"
                onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                onClick={() => resizeJoystick("outputPanel", 0.05)}
                disabled={(layout.outputPanel.scale || 1) >= 1.5}
                className="h-6 w-8 rounded border border-slate-600 bg-slate-800 text-sm text-white disabled:opacity-40"
              >
                +
              </button>
            </div>
          )}
        </div>
      </LayoutItem>
    </div>
  );
}
