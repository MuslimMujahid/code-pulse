"use client";

/**
 * ForceGraphCanvas — uses the `force-graph` canvas library directly (imperative
 * pattern via useEffect) to render the repository as a force-directed graph.
 *
 * We intentionally avoid importing `react-force-graph` here because that
 * package's .mjs entry transitively imports `3d-force-graph-vr` → `aframe-*`,
 * which calls `AFRAME.registerComponent(...)` at module initialisation time.
 * Since AFRAME is not globally defined in a Next.js context, this throws a
 * client-side exception that unmounts the entire DashboardShell.
 *
 * `force-graph` is the underlying 2D-only canvas library used by
 * react-force-graph, and it has no AFRAME dependency.
 *
 * Acceptance criteria:
 *  US-011:
 *  - Renders all nodes from filteredData; node size = log(commitCount)
 *  - Renders all edges from filteredData; edge width scales with coChangeCount
 *  - Nodes present in graphData but absent from filteredData render at 20%
 *    opacity in gray (future nodes)
 *  - Clicking a node calls setSelectedFile(node.id)
 *  - Clicking the background calls setSelectedFile(null)
 *  - Force simulation runs on mount and reaches a stable layout
 *
 *  US-012:
 *  - Node labels render when screen diameter > 8px
 *  - Hovering a node shows a tooltip: full path, commit count, top contributor
 *  - Edges within 90 days of scrubberDate are amber (#f59e0b)
 *  - Edges older than 90 days before scrubberDate are muted gray (#374151)
 *  - Node color: electric blue → violet (#3b82f6 → #8b5cf6) by commitCount rank
 *
 * Design context (.impeccable.md):
 *  - Deep space dark background (#0d0d1a)
 *  - Nodes: electric blue → violet (#3b82f6 → #8b5cf6) based on commitCount rank
 *  - Active/recent edges: amber (#f59e0b)
 *  - Dormant edges: muted slate (#374151)
 */

import { useEffect, useRef } from "react";
import type { GraphData, GraphNode, GraphEdge } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Node object extended with runtime force-simulation coordinates */
interface FGNode {
  id: string;
  label: string;
  commitCount: number;
  primaryContributor: string;
  contributors: Record<string, number>;
  firstCommitDate: string;
  /** Is this node in the current filteredData? (vs a future/greyed node) */
  isFiltered: boolean;
  /** Mutable force-simulation fields (set by force-graph at runtime) */
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  /** When set, the node is pinned at this position */
  fx?: number | null;
  fy?: number | null;
}

/** Link object extended for rendering */
interface FGLink {
  source: string | FGNode;
  target: string | FGNode;
  coChangeCount: number;
  lastCoChangeDate: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Logarithmic node radius — base 4px for 1 commit, grows slowly */
function nodeRadius(commitCount: number): number {
  return Math.max(3, 3 + Math.log1p(commitCount) * 2.2);
}

/** Node area (val) = π·r² so force-graph scales radius correctly */
function nodeVal(node: FGNode): number {
  const r = nodeRadius(node.commitCount);
  return r * r * Math.PI;
}

/**
 * Map a normalized 0–1 value to a hex color interpolating between
 * electric blue (#3b82f6) and violet (#8b5cf6).
 */
function blueVioletColor(t: number): string {
  // #3b82f6 = rgb(59, 130, 246)
  // #8b5cf6 = rgb(139, 92, 246)
  const r = Math.round(59 + t * (139 - 59));
  const g = Math.round(130 + t * (92 - 130));
  const b = 246;
  return `rgb(${r},${g},${b})`;
}

/** Returns true if the edge's lastCoChangeDate is within 90 days of the cutoff date */
function isRecentEdge(lastCoChangeDate: string, cutoffDate: string): boolean {
  const edgeMs = Date.parse(lastCoChangeDate);
  const cutoffMs = Date.parse(cutoffDate);
  if (isNaN(edgeMs) || isNaN(cutoffMs)) return false;
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  return cutoffMs - edgeMs <= ninetyDaysMs;
}

/** Build an HTML tooltip string for the force-graph nodeLabel prop */
function buildTooltipHTML(node: FGNode): string {
  return `
    <div style="
      font-family: monospace;
      font-size: 11px;
      line-height: 1.6;
      color: #e2e8f0;
      background: rgba(13,13,26,0.96);
      border: 1px solid rgba(59,130,246,0.25);
      border-radius: 4px;
      padding: 8px 10px;
      max-width: 280px;
      word-break: break-all;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    ">
      <div style="color:#94a3b8;margin-bottom:4px;font-size:10px;letter-spacing:0.08em;">FILE</div>
      <div style="color:#e2e8f0;font-weight:600;margin-bottom:6px;">${escapeHtml(node.id)}</div>
      <div style="display:flex;gap:12px;color:#64748b;font-size:10px;">
        <span><span style="color:#3b82f6;">${node.commitCount}</span> commits</span>
        <span>by <span style="color:#8b5cf6;">${escapeHtml(node.primaryContributor)}</span></span>
      </div>
    </div>
  `.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ForceGraphCanvasProps {
  /** Full unfiltered graph (provides the complete node universe) */
  graphData: GraphData;
  /** Timeline-filtered subset of graphData shown at full opacity */
  filteredData: GraphData;
  /** Current scrubber date cutoff (ISO string) — used for edge recency coloring */
  scrubberDate: string | null;
  /** Callback fired when a node is clicked */
  onNodeClick: (fileId: string) => void;
  /** Callback fired when the canvas background is clicked */
  onBackgroundClick: () => void;
  /**
   * When called, clears all pinned positions and restarts the force simulation.
   * We expose a ref-based imperative handle via this callback so DashboardShell
   * can trigger the reset without managing internal graph state.
   */
  onRegisterReset?: (resetFn: () => void) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ForceGraphCanvas({
  graphData,
  filteredData,
  scrubberDate,
  onNodeClick,
  onBackgroundClick,
  onRegisterReset,
}: ForceGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphInstanceRef = useRef<any>(null);

  // Keep a ref to the latest scrubberDate so the linkColor callback always
  // has the current value without requiring a full graph re-init on change.
  const scrubberDateRef = useRef<string | null>(scrubberDate);
  useEffect(() => {
    scrubberDateRef.current = scrubberDate;
  }, [scrubberDate]);

  // Keep a ref to onRegisterReset so we can call it after mount
  const onRegisterResetRef = useRef(onRegisterReset);
  useEffect(() => {
    onRegisterResetRef.current = onRegisterReset;
  }, [onRegisterReset]);

  // ── Mount: initialise force-graph instance ────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    if (typeof window === "undefined") return; // SSR guard

    let isMounted = true;

    // Dynamically import force-graph to avoid any top-level side effects
    import("force-graph").then(({ default: ForceGraph }) => {
      if (!isMounted || !containerRef.current) return;

      const el = containerRef.current;
      const { width, height } = el.getBoundingClientRect();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const graph = new (ForceGraph as any)(el);
      graphInstanceRef.current = graph;

      graph
        .width(width || 800)
        .height(height || 600)
        .backgroundColor("#0d0d1a")
        .nodeId("id")
        .linkSource("source")
        .linkTarget("target")
        // ── US-012: rich HTML tooltip via nodeLabel ────────────────────────
        .nodeLabel((node: unknown) => buildTooltipHTML(node as FGNode))
        .nodeVal((node: unknown) => nodeVal(node as FGNode))
        .nodeColor((node: unknown) => {
          const n = node as FGNode;
          if (!n.isFiltered) return "#1e293b";
          const maxCount = Math.max(
            1,
            ...((graph.graphData() as { nodes: FGNode[] }).nodes
              .filter((nd) => nd.isFiltered)
              .map((nd) => nd.commitCount))
          );
          const t = maxCount > 1 ? Math.min(1, n.commitCount / maxCount) : 0;
          return blueVioletColor(t);
        })
        .nodeCanvasObject((node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const n = node as FGNode;
          const r = nodeRadius(n.commitCount) / Math.sqrt(globalScale);
          const x = n.x ?? 0;
          const y = n.y ?? 0;

          ctx.save();

          if (!n.isFiltered) {
            ctx.globalAlpha = 0.2;
          }

          // Node circle
          const maxCount = Math.max(
            1,
            ...((graph.graphData() as { nodes: FGNode[] }).nodes
              .filter((nd) => nd.isFiltered)
              .map((nd) => nd.commitCount))
          );
          const t =
            maxCount > 1 ? Math.min(1, n.commitCount / maxCount) : 0;
          const color = n.isFiltered ? blueVioletColor(t) : "#334155";

          ctx.beginPath();
          ctx.arc(x, y, r, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();

          // Subtle glow ring for filtered nodes
          if (n.isFiltered) {
            ctx.beginPath();
            ctx.arc(x, y, r + 0.8, 0, 2 * Math.PI);
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.4;
            ctx.globalAlpha = 0.3;
            ctx.stroke();
          }

          // ── US-013: pinned node indicator — amber ring when fx/fy are set ─
          if (n.fx != null && n.fy != null) {
            ctx.globalAlpha = n.isFiltered ? 0.9 : 0.3;
            ctx.beginPath();
            ctx.arc(x, y, r + 2.5 / Math.sqrt(globalScale), 0, 2 * Math.PI);
            ctx.strokeStyle = "#f59e0b"; // amber
            ctx.lineWidth = 1.2 / Math.sqrt(globalScale);
            ctx.stroke();
          }

          // ── US-012: node label when rendered diameter > 8px ───────────────
          // Screen diameter = 2 * r * globalScale (r is already divided by sqrt(globalScale)
          // above, but in world coordinates, the actual radius is nodeRadius(commitCount))
          const screenDiameter = 2 * nodeRadius(n.commitCount) * Math.sqrt(globalScale);
          if (n.isFiltered && screenDiameter > 8) {
            ctx.globalAlpha = Math.min(1, (screenDiameter - 8) / 8); // fade in gradually
            const fontSize = Math.max(8, Math.min(12, 10 / Math.sqrt(globalScale)));
            ctx.font = `${fontSize}px monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";

            const label = n.label; // basename from GraphNode
            const textY = y + r + 2 / globalScale;

            // Background pill for readability
            const textWidth = ctx.measureText(label).width;
            const pad = 2 / globalScale;
            ctx.fillStyle = "rgba(13,13,26,0.75)";
            ctx.fillRect(x - textWidth / 2 - pad, textY - pad, textWidth + pad * 2, fontSize + pad * 2);

            // Label text
            ctx.fillStyle = color;
            ctx.fillText(label, x, textY);
          }

          ctx.restore();
        })
        .nodeCanvasObjectMode(() => "replace")
        .nodePointerAreaPaint((node: unknown, paintColor: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const n = node as FGNode;
          const r = nodeRadius(n.commitCount) / Math.sqrt(globalScale);
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI);
          ctx.fillStyle = paintColor;
          ctx.fill();
        })
        .linkWidth((link: unknown) => {
          const l = link as FGLink;
          return Math.max(0.5, Math.min(4, l.coChangeCount * 0.3));
        })
        // ── US-012: amber for recent edges, muted gray for older ──────────
        .linkColor((link: unknown) => {
          const l = link as FGLink;
          const cutoff = scrubberDateRef.current;
          if (cutoff && isRecentEdge(l.lastCoChangeDate, cutoff)) {
            return "rgba(245,158,11,0.7)"; // amber #f59e0b at 70% opacity
          }
          return "rgba(55,65,81,0.5)"; // muted slate #374151 at 50% opacity
        })
        .onNodeClick((node: unknown) => {
          onNodeClick((node as FGNode).id);
        })
        .onBackgroundClick(() => {
          onBackgroundClick();
        })
        // ── US-013: drag-to-pin ───────────────────────────────────────────
        .onNodeDragEnd((node: unknown) => {
          const n = node as FGNode;
          // Pin the node at its current position by setting fx/fy
          n.fx = n.x;
          n.fy = n.y;
        })
        // ── US-013: double-click to unpin ─────────────────────────────────
        .onNodeDblClick((node: unknown) => {
          const n = node as FGNode;
          // Clear fx/fy to return the node to free simulation
          n.fx = null;
          n.fy = null;
        })
        // Force simulation settings: warm up to reach stable layout quickly
        .warmupTicks(80)
        .cooldownTime(3000)
        .d3AlphaDecay(0.02)
        .d3VelocityDecay(0.3)
        .enableNodeDrag(true);

      // Load initial data
      graph.graphData(buildFGData(graphData, filteredData));

      // ── US-013: register reset function with parent ───────────────────────
      const resetLayout = () => {
        if (!graphInstanceRef.current) return;
        // Clear all pinned positions on live node objects
        const currentData = graphInstanceRef.current.graphData() as {
          nodes: FGNode[];
          links: FGLink[];
        };
        for (const n of currentData.nodes) {
          n.fx = null;
          n.fy = null;
        }
        // Reheat the simulation so nodes move freely again
        graphInstanceRef.current.d3ReheatSimulation();
      };
      onRegisterResetRef.current?.(resetLayout);
    });

    // Resize observer
    const observer = new ResizeObserver(() => {
      if (!containerRef.current || !graphInstanceRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      if (width > 0 && height > 0) {
        graphInstanceRef.current.width(width).height(height);
      }
    });
    observer.observe(containerRef.current);

    return () => {
      isMounted = false;
      observer.disconnect();
      // Clean up the force-graph instance
      if (graphInstanceRef.current) {
        try {
          graphInstanceRef.current._destructor?.();
        } catch {
          // ignore cleanup errors
        }
        graphInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Mount once

  // ── Update data when filteredData changes ─────────────────────────────────
  useEffect(() => {
    if (!graphInstanceRef.current) return;
    graphInstanceRef.current.graphData(buildFGData(graphData, filteredData));
  }, [graphData, filteredData]);

  // ── Update callbacks when they change ─────────────────────────────────────
  useEffect(() => {
    if (!graphInstanceRef.current) return;
    graphInstanceRef.current
      .onNodeClick((node: FGNode) => onNodeClick(node.id))
      .onBackgroundClick(() => onBackgroundClick());
  }, [onNodeClick, onBackgroundClick]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ background: "#0d0d1a" }}
    />
  );
}

// ---------------------------------------------------------------------------
// Data builder
// ---------------------------------------------------------------------------

function buildFGData(
  graphData: GraphData,
  filteredData: GraphData
): { nodes: FGNode[]; links: FGLink[] } {
  const filteredNodeIds = new Set(filteredData.nodes.map((n) => n.id));

  const filteredEdges = filteredData.edges;

  // Build node list: all nodes from graphData, tagged isFiltered
  const nodes: FGNode[] = graphData.nodes.map((n: GraphNode) => ({
    id: n.id,
    label: n.label,
    commitCount: n.commitCount,
    primaryContributor: n.primaryContributor,
    contributors: n.contributors,
    firstCommitDate: n.firstCommitDate,
    isFiltered: filteredNodeIds.has(n.id),
  }));

  // Build link list: only filtered edges (future edges are simply absent)
  const links: FGLink[] = filteredEdges.map((e: GraphEdge) => {
    const src =
      typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
    const tgt =
      typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
    return {
      source: src,
      target: tgt,
      coChangeCount: e.coChangeCount,
      lastCoChangeDate: e.lastCoChangeDate,
    };
  });

  return { nodes, links };
}
