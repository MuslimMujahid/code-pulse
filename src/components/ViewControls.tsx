"use client";

/**
 * ViewControls — three mutually exclusive view mode toggle buttons.
 *
 * Modes:
 *  - Default    : electric blue/violet coloring by commit rank
 *  - Heatmap    : cool-blue → hot-red gradient by commit frequency
 *  - Contributor: color nodes by primary contributor, with legend
 *
 * Reads viewMode from AppStore and calls setViewMode on click.
 * Only one button is visually active at a time.
 */

import { useAppStore } from "@/store/app-store";
import type { ViewMode } from "@/store/app-store";

interface ModeButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function ModeButton({ label, active, onClick }: ModeButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="text-xs transition-all duration-150 select-none"
      style={{
        padding: "5px 10px",
        // Active: bright blue tint, visible border
        // Inactive: near-invisible ghost style
        color: active ? "#93c5fd" : "#334155",
        background: active ? "rgba(59,130,246,0.12)" : "transparent",
        border: `1px solid ${active ? "rgba(59,130,246,0.35)" : "transparent"}`,
        cursor: "pointer",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "0.01em",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.color = "#64748b";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)";
          e.currentTarget.style.background = "rgba(255,255,255,0.03)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.color = "#334155";
          e.currentTarget.style.borderColor = "transparent";
          e.currentTarget.style.background = "transparent";
        }
      }}
    >
      {label}
    </button>
  );
}

export function ViewControls() {
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);

  const modes: { label: string; mode: ViewMode }[] = [
    { label: "Default", mode: "default" },
    { label: "Heatmap", mode: "heatmap" },
    { label: "Contributor", mode: "contributor" },
  ];

  return (
    <div
      role="group"
      aria-label="Graph view mode"
      className="flex items-center"
      style={{
        background: "rgba(13,13,26,0.80)",
        border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        gap: 0,
      }}
    >
      {modes.map(({ label, mode }, idx) => (
        <div key={mode} className="flex items-center">
          {/* Thin divider between buttons (not before first) */}
          {idx > 0 && (
            <div
              aria-hidden="true"
              style={{
                width: 1,
                height: 14,
                background: "rgba(255,255,255,0.05)",
              }}
            />
          )}
          <ModeButton
            label={label}
            active={viewMode === mode}
            onClick={() => setViewMode(mode)}
          />
        </div>
      ))}
    </div>
  );
}
