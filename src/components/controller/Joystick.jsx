import React, { useRef, useState } from "react";

export default function Joystick({
  label,
  prefix,
  buttons,
  onDirection,
  onRelease,
  onConfig,
  editing = false,
  scale = 1,
  onResize,
}) {
  const baseRef = useRef(null);
  const activeDirectionRef = useRef(null);
  const missingDirectionRef = useRef(false);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const size = 80 * scale;
  const radius = size * 0.375;

  const getChar = (dir) => buttons[`${prefix}_${dir}`]?.char || "";

  const moveKnob = (e) => {
    if (!baseRef.current) return;
    const rect = baseRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > radius) {
      dx = (dx / dist) * radius;
      dy = (dy / dist) * radius;
    }
    setKnob({ x: dx, y: dy });
    const threshold = radius * 0.45;
    let dir = null;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > threshold) dir = "right";
      else if (dx < -threshold) dir = "left";
    } else {
      if (dy > threshold) dir = "down";
      else if (dy < -threshold) dir = "up";
    }
    if (dir !== activeDirectionRef.current) {
      if (activeDirectionRef.current) onRelease(`${prefix}_${activeDirectionRef.current}`);
      activeDirectionRef.current = dir;
      if (dir) {
        const id = `${prefix}_${dir}`;
        if (!getChar(dir).trim()) {
          if (!missingDirectionRef.current) onConfig(id);
          missingDirectionRef.current = true;
        } else {
          missingDirectionRef.current = false;
          onDirection(id);
        }
      } else {
        missingDirectionRef.current = false;
      }
    }
  };

  const handlePointerDown = (e) => {
    if (editing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setActive(true);
    moveKnob(e);
  };
  const handlePointerMove = (e) => !editing && active && moveKnob(e);
  const handlePointerUp = () => {
    if (activeDirectionRef.current) onRelease(`${prefix}_${activeDirectionRef.current}`);
    activeDirectionRef.current = null;
    missingDirectionRef.current = false;
    setActive(false);
    setKnob({ x: 0, y: 0 });
  };

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative">
        <div
          ref={baseRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="relative rounded-full border-[3px] border-slate-700 bg-slate-950 shadow-inner touch-none select-none"
          style={{ width: size, height: size }}
        >
          {/* crosshair */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="absolute h-px bg-slate-800" style={{ width: size * 0.6 }}></div>
            <div className="absolute w-px bg-slate-800" style={{ height: size * 0.6 }}></div>
          </div>
          {/* knob */}
          <div
            className={`absolute top-1/2 left-1/2 rounded-full shadow-lg transition-colors ${
              active ? "bg-slate-400" : "bg-slate-600"
            }`}
            style={{
              width: size * 0.45,
              height: size * 0.45,
              transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
            }}
          ></div>
        </div>
      </div>
      <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {editing && (
        <div className="flex items-center gap-2" aria-label={`Tamaño del ${label}`}>
          <button
            type="button"
            data-resize-control
            aria-label={`Reducir tamaño del ${label}`}
            onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
            onClick={() => onResize(-0.05)}
            disabled={scale <= 0.75}
            className="h-6 w-8 rounded border border-slate-600 bg-slate-800 text-sm text-white disabled:opacity-40"
          >
            −
          </button>
          <span className="min-w-9 text-center text-[9px] text-slate-300">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            data-resize-control
            aria-label={`Aumentar tamaño del ${label}`}
            onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
            onClick={() => onResize(0.05)}
            disabled={scale >= 1.35}
            className="h-6 w-8 rounded border border-slate-600 bg-slate-800 text-sm text-white disabled:opacity-40"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}