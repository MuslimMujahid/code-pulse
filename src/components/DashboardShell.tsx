"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppStore } from "@/store/app-store";

/**
 * DashboardShell — the root layout for the CodePulse dashboard.
 *
 * Layout regions:
 *  ┌──────────────────────────────────────────────────────────────────┐
 *  │  HEADER  (fixed top, 40px)                                       │
 *  ├──────────────────────────────────────────────────────────────────┤
 *  │  [CAPS BANNER — optional, fixed below header]                    │
 *  ├──────────────────────────────────────────────────────────────────┤
 *  │                                               │ SIDEBAR (right)  │
 *  │  GRAPH CANVAS AREA (main, fills remaining)   │  collapsible     │
 *  │                                               │  320px wide      │
 *  ├──────────────────────────────────────────────────────────────────┤
 *  │  SCRUBBER BAR  (fixed bottom, 56px)                              │
 *  └──────────────────────────────────────────────────────────────────┘
 *
 * ViewControls sits in the top-right corner overlaid on the graph canvas.
 *
 * US-011 onward will inject real components into the named slot areas.
 * The sidebar open/close state is managed here; selectedFile drives it
 * once the graph is implemented (US-020).
 */

const HEADER_H = 40; // px
const SCRUBBER_H = 56; // px
const SIDEBAR_W = 320; // px — when open

export function DashboardShell() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { repoPath, commitsCapped, graphData } = useAppStore();

  // Sidebar open state — will be driven by selectedFile in later stories;
  // for now it can be toggled manually to verify layout correctness.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Derive display path: prefer store value, fall back to URL param
  const displayPath = repoPath || searchParams.get("repo") || "";

  // Shorten long paths for the header: show last 2 segments
  const shortPath = (() => {
    if (!displayPath) return "—";
    const parts = displayPath.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length <= 2) return displayPath;
    return "…/" + parts.slice(-2).join("/");
  })();

  const handleChangeRepo = () => {
    // Navigate back to the loader; URL param is carried via ?repo= if user
    // wants to pre-fill the input for a quick re-analysis.
    router.push(`/?repo=${encodeURIComponent(displayPath)}`);
  };

  // Compute the caps warning env limit (shown in the banner)
  const commitLimit =
    typeof process !== "undefined"
      ? (process.env.NEXT_PUBLIC_CODEPULSE_MAX_COMMITS ?? "500")
      : "500";

  return (
    <div
      className="relative"
      style={{ background: "#0d0d1a", height: "100dvh", overflow: "hidden" }}
    >
      {/* ─── Header ──────────────────────────────────────────────────────────── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between"
        style={{
          height: HEADER_H,
          background: "rgba(13,13,26,0.96)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          padding: "0 16px",
        }}
      >
        {/* Left: logotype + repo path */}
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="text-sm font-semibold shrink-0"
            style={{ color: "#e2e8f0", letterSpacing: "-0.01em" }}
          >
            Code<span style={{ color: "#3b82f6" }}>Pulse</span>
          </span>

          {displayPath && (
            <>
              <span
                aria-hidden="true"
                className="shrink-0 select-none"
                style={{ color: "#1e293b", fontSize: 16 }}
              >
                /
              </span>
              <span
                className="text-xs truncate font-mono min-w-0"
                style={{ color: "#64748b" }}
                title={displayPath}
              >
                {shortPath}
              </span>
            </>
          )}
        </div>

        {/* Right: node/edge stats + Change Repo */}
        <div className="flex items-center gap-4 shrink-0">
          {graphData && (
            <span
              className="text-xs tabular-nums"
              style={{ color: "#334155" }}
            >
              {graphData.nodes.length} nodes · {graphData.edges.length} edges
            </span>
          )}

          <button
            onClick={handleChangeRepo}
            className="text-xs transition-colors duration-150"
            style={{ color: "#475569" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#94a3b8")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#475569")}
          >
            Change repo
          </button>
        </div>
      </header>

      {/* ─── Commits-capped warning banner ───────────────────────────────────── */}
      {commitsCapped && (
        <div
          className="fixed left-0 right-0 z-40 flex items-center justify-center gap-2"
          style={{
            top: HEADER_H,
            height: 28,
            background: "rgba(245,158,11,0.08)",
            borderBottom: "1px solid rgba(245,158,11,0.15)",
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 1L11 10H1L6 1Z"
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="M6 5v2.5M6 8.5v.5"
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-xs" style={{ color: "#d97706" }}>
            History capped at {commitLimit} commits — earlier commits are not shown.
          </span>
        </div>
      )}

      {/* ─── Content area: graph canvas + sidebar ───────────────────────────── */}
      <div
        className="absolute flex"
        style={{
          top: HEADER_H + (commitsCapped ? 28 : 0),
          left: 0,
          right: 0,
          bottom: SCRUBBER_H,
          transition: "top 200ms ease-out",
        }}
      >
        {/* Graph canvas ─────────────────────────────────────────────────────── */}
        <main
          className="relative flex-1 min-w-0"
          style={{
            transition: "margin-right 200ms ease-out",
            marginRight: sidebarOpen ? SIDEBAR_W : 0,
          }}
        >
          {/* Placeholder graph area */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center"
            style={{ pointerEvents: "none" }}
          >
            {/* Subtle grid overlay to hint at canvas space */}
            <svg
              aria-hidden="true"
              className="absolute inset-0 w-full h-full"
              style={{ opacity: 0.035 }}
            >
              <defs>
                <pattern
                  id="grid"
                  width="40"
                  height="40"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 40 0 L 0 0 0 40"
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth="0.5"
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>

            {/* Placeholder label */}
            <div className="relative z-10 flex flex-col items-center gap-2">
              <div
                className="w-1 h-1 rounded-full"
                style={{ background: "#1e293b" }}
              />
              <span
                className="text-xs"
                style={{ color: "#1e293b", letterSpacing: "0.1em" }}
              >
                GRAPH CANVAS
              </span>
            </div>
          </div>

          {/* ViewControls slot ─ top-right corner of the graph canvas */}
          <div
            className="absolute top-4 right-4 z-20 flex items-center gap-2"
            id="view-controls-slot"
          >
            {/* Sidebar toggle (temporary helper so the layout can be verified) */}
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="flex items-center gap-2 text-xs transition-all duration-150"
              style={{
                color: sidebarOpen ? "#3b82f6" : "#334155",
                padding: "6px 10px",
                border: `1px solid ${sidebarOpen ? "rgba(59,130,246,0.3)" : "rgba(255,255,255,0.06)"}`,
                background: sidebarOpen
                  ? "rgba(59,130,246,0.08)"
                  : "rgba(255,255,255,0.03)",
              }}
              title="Toggle sidebar panel"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="1"
                  y="1"
                  width="12"
                  height="12"
                  rx="1"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <line
                  x1="9"
                  y1="1"
                  x2="9"
                  y2="13"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
              Sidebar
            </button>

            {/* ViewControls placeholder — replaced by US-015 */}
            <div
              id="view-controls-placeholder"
              className="flex items-center gap-1"
              style={{
                padding: "6px 10px",
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <span className="text-xs" style={{ color: "#1e293b" }}>
                VIEW CONTROLS
              </span>
            </div>
          </div>
        </main>

        {/* Sidebar panel ────────────────────────────────────────────────────── */}
        <aside
          className="absolute top-0 right-0 h-full flex flex-col"
          style={{
            width: SIDEBAR_W,
            transform: sidebarOpen
              ? "translateX(0)"
              : `translateX(${SIDEBAR_W}px)`,
            transition: "transform 200ms ease-out",
            background: "rgba(13,13,26,0.98)",
            borderLeft: "1px solid rgba(255,255,255,0.06)",
          }}
          aria-hidden={!sidebarOpen}
        >
          {/* Sidebar header */}
          <div
            className="flex items-center justify-between shrink-0"
            style={{
              height: 40,
              padding: "0 16px",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <span className="text-xs font-medium" style={{ color: "#475569" }}>
              FILE DETAIL
            </span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="flex items-center justify-center transition-colors duration-150"
              style={{
                width: 24,
                height: 24,
                color: "#334155",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#94a3b8")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#334155")}
              aria-label="Close sidebar"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M1 1l10 10M11 1L1 11"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          {/* Sidebar body — placeholder until CommitSidebar (US-020) */}
          <div
            className="flex-1 flex items-center justify-center"
          >
            <span
              className="text-xs"
              style={{ color: "#1e293b", letterSpacing: "0.08em" }}
            >
              SELECT A NODE
            </span>
          </div>
        </aside>
      </div>

      {/* ─── Bottom scrubber bar ─────────────────────────────────────────────── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex items-center"
        style={{
          height: SCRUBBER_H,
          background: "rgba(13,13,26,0.97)",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          padding: "0 20px",
        }}
      >
        {/* Scrubber placeholder — replaced by US-018 */}
        <div
          className="flex-1 flex items-center gap-4"
        >
          <span
            className="text-xs shrink-0"
            style={{ color: "#1e293b", letterSpacing: "0.08em" }}
          >
            TIMELINE
          </span>

          {/* Track placeholder */}
          <div
            className="flex-1 relative"
            style={{ height: 2 }}
          >
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(90deg, rgba(59,130,246,0.3) 0%, rgba(139,92,246,0.3) 100%)",
                borderRadius: 1,
              }}
            />
          </div>

          <span
            className="text-xs shrink-0 font-mono tabular-nums"
            style={{ color: "#1e293b" }}
          >
            —
          </span>
        </div>
      </div>
    </div>
  );
}
