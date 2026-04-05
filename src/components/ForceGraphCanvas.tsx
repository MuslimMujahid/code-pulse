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
 *  US-016:
 *  - When viewMode === 'heatmap': nodes colored cool blue → hot red by commitCount
 *  - Heatmap coloring uses filteredData max for normalization
 *  - HeatmapLegend overlay shown when viewMode === 'heatmap'
 *
 *  US-017:
 *  - When viewMode === 'contributor': nodes colored by primaryContributor
 *  - Contributor colors are deterministic (sorted by total commit count desc, palette in order)
 *  - ContributorLegend lists each contributor with color swatch
 *  - Clicking a legend entry calls setActiveContributor; non-matching nodes dim to 20%
 *  - Clicking the active contributor legend entry calls setActiveContributor(null)
 *
 * Design context (.impeccable.md):
 *  - Deep space dark background (#0d0d1a)
 *  - Nodes: electric blue → violet (#3b82f6 → #8b5cf6) based on commitCount rank
 *  - Active/recent edges: amber (#f59e0b)
 *  - Dormant edges: muted slate (#374151)
 */

import { useEffect, useRef } from "react";
import type { ViewMode } from "@/store/app-store";
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

/**
 * US-016: Map a normalized 0–1 value to a heatmap color.
 * Low (0) = cool blue (#1e40af), High (1) = hot red (#dc2626).
 * Mid range passes through teal and orange for a clear gradient.
 * Uses a 4-stop piecewise linear interpolation:
 *   0.0 → cool blue  #1e40af  rgb(30, 64, 175)
 *   0.4 → teal       #0d9488  rgb(13, 148, 136)
 *   0.7 → amber      #f59e0b  rgb(245, 158, 11)
 *   1.0 → hot red    #dc2626  rgb(220, 38, 38)
 */
function heatmapColor(t: number): string {
  // Clamp
  const v = Math.max(0, Math.min(1, t));

  // 4-stop piecewise
  const stops: [number, [number, number, number]][] = [
    [0.0, [30, 64, 175]],
    [0.4, [13, 148, 136]],
    [0.7, [245, 158, 11]],
    [1.0, [220, 38, 38]],
  ];

  // Find the two surrounding stops
  let i = stops.length - 2;
  for (let j = 0; j < stops.length - 1; j++) {
    if (v <= stops[j + 1][0]) {
      i = j;
      break;
    }
  }

  const [t0, [r0, g0, b0]] = stops[i];
  const [t1, [r1, g1, b1]] = stops[i + 1];
  const f = t1 === t0 ? 0 : (v - t0) / (t1 - t0);

  const r = Math.round(r0 + f * (r1 - r0));
  const g = Math.round(g0 + f * (g1 - g0));
  const b = Math.round(b0 + f * (b1 - b0));
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------------
// US-017: Contributor color palette (10 distinct colors + gray fallback)
// ---------------------------------------------------------------------------

/**
 * 10 perceptually distinct colors for contributor mode.
 * Chosen to be accessible on the dark background (#0d0d1a) and visually
 * distinct from each other at a glance.
 */
const CONTRIBUTOR_PALETTE: string[] = [
  "#f97316", // orange
  "#22d3ee", // cyan
  "#a3e635", // lime
  "#f43f5e", // rose
  "#818cf8", // indigo
  "#fb923c", // amber-orange
  "#34d399", // emerald
  "#e879f9", // fuchsia
  "#facc15", // yellow
  "#60a5fa", // sky blue
];
const CONTRIBUTOR_FALLBACK = "#64748b"; // slate gray for contributors > 10

/**
 * Build a deterministic contributor → color map.
 * Sort contributors by total commit count descending (ties broken
 * alphabetically so the result is always stable), then assign palette
 * colors in order.
 *
 * @param nodes  All nodes in the current graph (unfiltered for stability)
 */
function buildContributorColorMap(nodes: FGNode[]): Map<string, string> {
  // Aggregate total commit count per contributor across all nodes
  const totals = new Map<string, number>();
  for (const n of nodes) {
    for (const [author, count] of Object.entries(n.contributors)) {
      totals.set(author, (totals.get(author) ?? 0) + count);
    }
  }

  // Sort: highest total first, alphabetical for ties
  const sorted = [...totals.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  const colorMap = new Map<string, string>();
  sorted.forEach(([author], idx) => {
    colorMap.set(author, CONTRIBUTOR_PALETTE[idx] ?? CONTRIBUTOR_FALLBACK);
  });
  return colorMap;
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
  /**
   * Current filename search query (US-014).
   * When non-empty, matching nodes are highlighted at full opacity with an accent ring;
   * non-matching nodes and their edges dim to 20% opacity.
   */
  searchQuery?: string;
  /**
   * Current graph view/coloring mode (US-016 / US-017).
   * 'default'     → electric blue/violet by commit rank
   * 'heatmap'     → cool-blue → hot-red by commit frequency
   * 'contributor' → color by primary contributor (US-017)
   */
  viewMode?: ViewMode;
  /**
   * US-017: The currently isolated contributor name (or null for no isolation).
   * When non-null in contributor mode, nodes whose primaryContributor does not
   * match dim to 20% opacity.
   */
  activeContributor?: string | null;
  /**
   * US-017: Callback to set / clear the active contributor.
   * Called when the user clicks a contributor in the ContributorLegend.
   */
  onSetActiveContributor?: (name: string | null) => void;
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
  searchQuery = "",
  viewMode = "default",
  activeContributor = null,
  onSetActiveContributor,
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

  // Keep a ref to the latest searchQuery so node/link rendering callbacks
  // always have the current value without graph re-init on each keystroke.
  const searchQueryRef = useRef<string>(searchQuery);
  useEffect(() => {
    searchQueryRef.current = searchQuery;
    // Trigger a repaint when the search query changes so opacity updates
    // are reflected immediately without waiting for the next simulation tick.
    if (graphInstanceRef.current) {
      try {
        graphInstanceRef.current.refresh?.();
      } catch {
        // ignore if refresh not available
      }
    }
  }, [searchQuery]);

  // Keep a ref to the latest viewMode so node rendering callbacks always
  // have the current value without graph re-init on mode change.
  const viewModeRef = useRef<ViewMode>(viewMode);
  useEffect(() => {
    viewModeRef.current = viewMode;
    // Trigger a repaint when viewMode changes
    if (graphInstanceRef.current) {
      try {
        graphInstanceRef.current.refresh?.();
      } catch {
        // ignore if refresh not available
      }
    }
  }, [viewMode]);

  // Keep a ref to the latest activeContributor so node rendering callbacks
  // always have the current value without graph re-init on change.
  const activeContributorRef = useRef<string | null>(activeContributor);
  useEffect(() => {
    activeContributorRef.current = activeContributor;
    // Trigger a repaint when activeContributor changes
    if (graphInstanceRef.current) {
      try {
        graphInstanceRef.current.refresh?.();
      } catch {
        // ignore if refresh not available
      }
    }
  }, [activeContributor]);

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
          // US-017: contributor coloring
          if (viewModeRef.current === "contributor") {
            const cMap = buildContributorColorMap(
              (graph.graphData() as { nodes: FGNode[] }).nodes
            );
            return cMap.get(n.primaryContributor) ?? CONTRIBUTOR_FALLBACK;
          }
          // US-016: use heatmap coloring when in heatmap mode
          return viewModeRef.current === "heatmap"
            ? heatmapColor(t)
            : blueVioletColor(t);
        })
        .nodeCanvasObject((node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const n = node as FGNode;
          const r = nodeRadius(n.commitCount) / Math.sqrt(globalScale);
          const x = n.x ?? 0;
          const y = n.y ?? 0;

          // ── US-014: search-based opacity ─────────────────────────────────
          const query = searchQueryRef.current.toLowerCase().trim();
          const hasSearch = query.length > 0;
          const isMatch = hasSearch && n.id.toLowerCase().includes(query);

          // ── US-017: contributor isolation opacity ─────────────────────────
          const currentMode = viewModeRef.current;
          const activeC = activeContributorRef.current;
          const hasContributorFilter =
            currentMode === "contributor" && activeC !== null;
          const isContributorMatch = hasContributorFilter
            ? n.primaryContributor === activeC
            : true;

          // When there is an active search query: non-matching nodes dim to 20%.
          // When contributor isolation is active: non-matching contributor dims to 20%.
          // Future (non-filtered) nodes are always at 20%.
          const baseAlpha = !n.isFiltered
            ? 0.2
            : hasSearch && !isMatch
              ? 0.2
              : hasContributorFilter && !isContributorMatch
                ? 0.2
                : 1.0;

          ctx.save();
          ctx.globalAlpha = baseAlpha;

          // Node circle — color depends on current view mode
          const allNodes = (graph.graphData() as { nodes: FGNode[] }).nodes;
          const maxCount = Math.max(
            1,
            ...allNodes.filter((nd) => nd.isFiltered).map((nd) => nd.commitCount)
          );
          const t = maxCount > 1 ? Math.min(1, n.commitCount / maxCount) : 0;

          // US-017: contributor coloring
          let color: string;
          if (!n.isFiltered) {
            color = "#334155";
          } else if (currentMode === "contributor") {
            const cMap = buildContributorColorMap(allNodes);
            color = cMap.get(n.primaryContributor) ?? CONTRIBUTOR_FALLBACK;
          } else if (currentMode === "heatmap") {
            color = heatmapColor(t);
          } else {
            color = blueVioletColor(t);
          }

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
            ctx.globalAlpha = baseAlpha * 0.3;
            ctx.stroke();
          }

          // ── US-014: accent ring for matching search results ───────────────
          if (n.isFiltered && isMatch) {
            ctx.globalAlpha = 1.0;
            ctx.beginPath();
            ctx.arc(x, y, r + 3 / Math.sqrt(globalScale), 0, 2 * Math.PI);
            ctx.strokeStyle = "#22d3ee"; // cyan accent ring
            ctx.lineWidth = 1.5 / Math.sqrt(globalScale);
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
            ctx.globalAlpha = baseAlpha * Math.min(1, (screenDiameter - 8) / 8); // fade in gradually
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
            ctx.fillStyle = isMatch ? "#22d3ee" : color;
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
        // ── US-014: dim edges when both endpoints are non-matching ─────────
        .linkColor((link: unknown) => {
          const l = link as FGLink;

          // ── US-014: search-based edge dimming ──────────────────────────
          const query = searchQueryRef.current.toLowerCase().trim();
          if (query.length > 0) {
            const srcId = typeof l.source === "string" ? l.source : (l.source as FGNode).id;
            const tgtId = typeof l.target === "string" ? l.target : (l.target as FGNode).id;
            const srcMatch = srcId.toLowerCase().includes(query);
            const tgtMatch = tgtId.toLowerCase().includes(query);
            if (!srcMatch && !tgtMatch) {
              return "rgba(55,65,81,0.1)"; // both endpoints non-matching — deep dim
            }
          }

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
    <div className="absolute inset-0" style={{ background: "#0d0d1a" }}>
      {/* Canvas container */}
      <div
        ref={containerRef}
        className="absolute inset-0"
      />
      {/* US-016: Heatmap legend overlay */}
      {viewMode === "heatmap" && (
        <HeatmapLegend />
      )}
      {/* US-017: Contributor legend overlay */}
      {viewMode === "contributor" && (
        <ContributorLegend
          nodes={graphData.nodes as unknown as FGNode[]}
          activeContributor={activeContributor ?? null}
          onSetActiveContributor={onSetActiveContributor ?? (() => {})}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// US-016: HeatmapLegend — overlaid on the canvas when viewMode === 'heatmap'
// ---------------------------------------------------------------------------

/**
 * A compact color-scale legend showing the heatmap gradient from Low to High.
 * Positioned in the bottom-left of the graph canvas area.
 */
function HeatmapLegend() {
  // Generate 20 color stops for a smooth gradient swatch
  const stops = Array.from({ length: 20 }, (_, i) => heatmapColor(i / 19));
  const gradientStyle = `linear-gradient(to right, ${stops.join(", ")})`;

  return (
    <div
      aria-label="Heatmap color scale: Low commit frequency to High commit frequency"
      style={{
        position: "absolute",
        bottom: 20,
        left: 20,
        zIndex: 10,
        background: "rgba(13,13,26,0.88)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 4,
        padding: "8px 12px",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        minWidth: 140,
      }}
    >
      {/* Title */}
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.1em",
          color: "#475569",
          textTransform: "uppercase",
          fontFamily: "monospace",
        }}
      >
        Commit Frequency
      </div>

      {/* Gradient bar */}
      <div
        aria-hidden="true"
        style={{
          height: 6,
          borderRadius: 3,
          background: gradientStyle,
        }}
      />

      {/* Low / High labels */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          color: "#64748b",
          fontFamily: "monospace",
          letterSpacing: "0.05em",
        }}
      >
        <span style={{ color: "#1e40af" }}>Low</span>
        <span style={{ color: "#dc2626" }}>High</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// US-017: ContributorLegend — overlaid on the canvas when viewMode === 'contributor'
// ---------------------------------------------------------------------------

interface ContributorLegendProps {
  /** All graph nodes (unfiltered, for stable color assignment) */
  nodes: FGNode[];
  /** Currently isolated contributor, or null */
  activeContributor: string | null;
  /** Callback to set / clear the active contributor */
  onSetActiveContributor: (name: string | null) => void;
}

/**
 * A scrollable legend listing each contributor with their color swatch.
 * Clicking a row isolates that contributor (dims all other nodes).
 * Clicking the active contributor row de-isolates (restores all).
 */
function ContributorLegend({
  nodes,
  activeContributor,
  onSetActiveContributor,
}: ContributorLegendProps) {
  const colorMap = buildContributorColorMap(nodes);
  // Build entries in the same deterministic order used for color assignment
  const totals = new Map<string, number>();
  for (const n of nodes) {
    for (const [author, count] of Object.entries(n.contributors)) {
      totals.set(author, (totals.get(author) ?? 0) + count);
    }
  }
  const entries = [...totals.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  return (
    <div
      aria-label="Contributor color legend"
      style={{
        position: "absolute",
        bottom: 20,
        left: 20,
        zIndex: 10,
        background: "rgba(13,13,26,0.88)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 4,
        padding: "8px 0",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        minWidth: 160,
        maxHeight: 280,
        overflowY: "auto",
      }}
    >
      {/* Title */}
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.1em",
          color: "#475569",
          textTransform: "uppercase",
          fontFamily: "monospace",
          padding: "0 12px 6px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          marginBottom: 4,
        }}
      >
        Contributors
      </div>

      {entries.map(([author]) => {
        const color = colorMap.get(author) ?? CONTRIBUTOR_FALLBACK;
        const isActive = activeContributor === author;
        const hasActive = activeContributor !== null;

        return (
          <button
            key={author}
            onClick={() =>
              onSetActiveContributor(isActive ? null : author)
            }
            title={isActive ? `De-isolate ${author}` : `Isolate ${author}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 12px",
              background: isActive
                ? "rgba(255,255,255,0.06)"
                : "transparent",
              border: "none",
              cursor: "pointer",
              width: "100%",
              textAlign: "left",
              opacity: hasActive && !isActive ? 0.45 : 1,
              transition: "opacity 150ms, background 150ms",
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = "rgba(255,255,255,0.04)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = "transparent";
              }
            }}
          >
            {/* Color swatch */}
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
                boxShadow: isActive ? `0 0 6px ${color}` : "none",
              }}
            />
            {/* Author name */}
            <span
              style={{
                fontSize: 10,
                color: isActive ? "#e2e8f0" : "#94a3b8",
                fontFamily: "monospace",
                letterSpacing: "0.02em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 110,
              }}
            >
              {author}
            </span>
          </button>
        );
      })}
    </div>
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
