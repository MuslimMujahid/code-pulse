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
 * Acceptance criteria (US-011):
 *  - Renders all nodes from filteredData; node size = log(commitCount)
 *  - Renders all edges from filteredData; edge width scales with coChangeCount
 *  - Nodes present in graphData but absent from filteredData render at 20%
 *    opacity in gray (future nodes)
 *  - Clicking a node calls setSelectedFile(node.id)
 *  - Clicking the background calls setSelectedFile(null)
 *  - Force simulation runs on mount and reaches a stable layout
 *
 * Design context (.impeccable.md):
 *  - Deep space dark background (#0d0d1a)
 *  - Nodes: electric blue → violet (#3b82f6 → #8b5cf6) based on commitCount rank
 *  - Active/recent edges: amber (#f59e0b) — will be used in US-012
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
  fx?: number;
  fy?: number;
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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ForceGraphCanvasProps {
  /** Full unfiltered graph (provides the complete node universe) */
  graphData: GraphData;
  /** Timeline-filtered subset of graphData shown at full opacity */
  filteredData: GraphData;
  /** Callback fired when a node is clicked */
  onNodeClick: (fileId: string) => void;
  /** Callback fired when the canvas background is clicked */
  onBackgroundClick: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ForceGraphCanvas({
  graphData,
  filteredData,
  onNodeClick,
  onBackgroundClick,
}: ForceGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphInstanceRef = useRef<any>(null);

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
        .nodeLabel("") // Disable default tooltip; US-012 adds a custom one
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
        .linkColor(() => "rgba(55,65,81,0.6)")
        .onNodeClick((node: unknown) => {
          onNodeClick((node as FGNode).id);
        })
        .onBackgroundClick(() => {
          onBackgroundClick();
        })
        // Force simulation settings: warm up to reach stable layout quickly
        .warmupTicks(80)
        .cooldownTime(3000)
        .d3AlphaDecay(0.02)
        .d3VelocityDecay(0.3)
        .enableNodeDrag(true);

      // Load initial data
      graph.graphData(buildFGData(graphData, filteredData));
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
