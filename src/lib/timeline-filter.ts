/**
 * TimelineFilter module — filters GraphData to show only nodes and edges that
 * are "active" as of a given cutoff date.
 *
 * Pure function — same inputs always produce the same outputs with no side
 * effects. This function is called on every scrubber tick so it is written to
 * be fast: lookups are O(1) via Sets, and the Date parsing is done once via
 * millisecond comparisons rather than repeated string comparisons.
 */

import type { GraphData, GraphNode, GraphEdge } from "./types";

/**
 * Filter a GraphData object to include only nodes and edges that were present
 * on or before `cutoffDate`.
 *
 * Inclusion rules:
 * - A node is included when its `firstCommitDate` is on or before `cutoffDate`.
 * - An edge is included when:
 *   1. Both its source and target nodes are included, AND
 *   2. Its `lastCoChangeDate` is on or before `cutoffDate`.
 *
 * @param graphData     - The full (unfiltered) graph produced by GraphBuilder.
 * @param cutoffDate    - ISO date string representing the upper bound (inclusive).
 * @returns A new GraphData containing only the nodes and edges that satisfy the
 *          inclusion rules. The original `graphData` is not mutated.
 */
export function filterByDate(
  graphData: GraphData,
  cutoffDate: string,
): GraphData {
  const cutoffMs = Date.parse(cutoffDate);

  // Filter nodes — include those whose firstCommitDate is on or before cutoff.
  const filteredNodes: GraphNode[] = [];
  const includedNodeIds = new Set<string>();

  for (const node of graphData.nodes) {
    const nodeMs = Date.parse(node.firstCommitDate);
    if (nodeMs <= cutoffMs) {
      filteredNodes.push(node);
      includedNodeIds.add(node.id);
    }
  }

  // Filter edges — both endpoints must be present AND lastCoChangeDate ≤ cutoff.
  const filteredEdges: GraphEdge[] = [];
  for (const edge of graphData.edges) {
    const sourceId = typeof edge.source === "string" ? edge.source : (edge.source as { id: string }).id;
    const targetId = typeof edge.target === "string" ? edge.target : (edge.target as { id: string }).id;

    if (!includedNodeIds.has(sourceId) || !includedNodeIds.has(targetId)) {
      continue;
    }

    const edgeMs = Date.parse(edge.lastCoChangeDate);
    if (edgeMs <= cutoffMs) {
      filteredEdges.push(edge);
    }
  }

  return { nodes: filteredNodes, edges: filteredEdges };
}
