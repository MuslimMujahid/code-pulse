/**
 * Tests for the TimelineFilter module.
 *
 * All tests use hand-crafted GraphData fixtures — no I/O or async required.
 * Each fixture is minimal to keep assertions clear.
 */

import { describe, it, expect } from "vitest";
import { filterByDate } from "./timeline-filter";
import type { GraphData, GraphNode, GraphEdge } from "./types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  firstCommitDate: string,
  overrides: Partial<GraphNode> = {},
): GraphNode {
  return {
    id,
    label: id.split("/").pop() ?? id,
    commitCount: 1,
    primaryContributor: "Alice",
    contributors: { Alice: 1 },
    firstCommitDate,
    ...overrides,
  };
}

function makeEdge(
  source: string,
  target: string,
  lastCoChangeDate: string,
  overrides: Partial<GraphEdge> = {},
): GraphEdge {
  return {
    source,
    target,
    coChangeCount: 1,
    lastCoChangeDate,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Node inclusion / exclusion
// ---------------------------------------------------------------------------

describe("filterByDate — node inclusion", () => {
  it("includes a node whose firstCommitDate equals the cutoff date", () => {
    const graphData: GraphData = {
      nodes: [makeNode("a.ts", "2024-01-15")],
      edges: [],
    };
    const result = filterByDate(graphData, "2024-01-15");
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe("a.ts");
  });

  it("includes a node whose firstCommitDate is before the cutoff date", () => {
    const graphData: GraphData = {
      nodes: [makeNode("a.ts", "2024-01-01")],
      edges: [],
    };
    const result = filterByDate(graphData, "2024-06-01");
    expect(result.nodes).toHaveLength(1);
  });

  it("excludes a node whose firstCommitDate is after the cutoff date", () => {
    const graphData: GraphData = {
      nodes: [makeNode("a.ts", "2024-06-01")],
      edges: [],
    };
    const result = filterByDate(graphData, "2024-01-01");
    expect(result.nodes).toHaveLength(0);
  });

  it("correctly separates past and future nodes", () => {
    const graphData: GraphData = {
      nodes: [
        makeNode("old.ts", "2023-01-01"),
        makeNode("current.ts", "2024-06-01"),
        makeNode("future.ts", "2025-01-01"),
      ],
      edges: [],
    };
    const result = filterByDate(graphData, "2024-06-01");
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain("old.ts");
    expect(ids).toContain("current.ts");
    expect(ids).not.toContain("future.ts");
  });

  it("returns an empty nodes array when all nodes are after the cutoff", () => {
    const graphData: GraphData = {
      nodes: [
        makeNode("a.ts", "2025-01-01"),
        makeNode("b.ts", "2025-06-01"),
      ],
      edges: [],
    };
    const result = filterByDate(graphData, "2024-01-01");
    expect(result.nodes).toHaveLength(0);
  });

  it("returns all nodes when all nodes are before the cutoff", () => {
    const graphData: GraphData = {
      nodes: [
        makeNode("a.ts", "2020-01-01"),
        makeNode("b.ts", "2021-01-01"),
        makeNode("c.ts", "2022-01-01"),
      ],
      edges: [],
    };
    const result = filterByDate(graphData, "2099-12-31");
    expect(result.nodes).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Edge inclusion / exclusion
// ---------------------------------------------------------------------------

describe("filterByDate — edge inclusion", () => {
  it("includes an edge when both nodes are included and lastCoChangeDate ≤ cutoff", () => {
    const graphData: GraphData = {
      nodes: [makeNode("a.ts", "2024-01-01"), makeNode("b.ts", "2024-01-01")],
      edges: [makeEdge("a.ts", "b.ts", "2024-03-01")],
    };
    const result = filterByDate(graphData, "2024-06-01");
    expect(result.edges).toHaveLength(1);
  });

  it("includes an edge when lastCoChangeDate exactly equals the cutoff", () => {
    const graphData: GraphData = {
      nodes: [makeNode("a.ts", "2024-01-01"), makeNode("b.ts", "2024-01-01")],
      edges: [makeEdge("a.ts", "b.ts", "2024-06-01")],
    };
    const result = filterByDate(graphData, "2024-06-01");
    expect(result.edges).toHaveLength(1);
  });

  it("excludes an edge when lastCoChangeDate is after the cutoff", () => {
    const graphData: GraphData = {
      nodes: [makeNode("a.ts", "2024-01-01"), makeNode("b.ts", "2024-01-01")],
      edges: [makeEdge("a.ts", "b.ts", "2025-01-01")],
    };
    const result = filterByDate(graphData, "2024-06-01");
    expect(result.edges).toHaveLength(0);
  });

  it("excludes an edge when the source node is not included", () => {
    const graphData: GraphData = {
      nodes: [
        makeNode("future.ts", "2025-01-01"), // excluded
        makeNode("b.ts", "2024-01-01"),
      ],
      edges: [makeEdge("future.ts", "b.ts", "2025-06-01")],
    };
    const result = filterByDate(graphData, "2024-06-01");
    expect(result.edges).toHaveLength(0);
  });

  it("excludes an edge when the target node is not included", () => {
    const graphData: GraphData = {
      nodes: [
        makeNode("a.ts", "2024-01-01"),
        makeNode("future.ts", "2025-01-01"), // excluded
      ],
      edges: [makeEdge("a.ts", "future.ts", "2025-06-01")],
    };
    const result = filterByDate(graphData, "2024-06-01");
    expect(result.edges).toHaveLength(0);
  });

  it("excludes an edge when both nodes are excluded", () => {
    const graphData: GraphData = {
      nodes: [
        makeNode("a.ts", "2025-01-01"),
        makeNode("b.ts", "2025-06-01"),
      ],
      edges: [makeEdge("a.ts", "b.ts", "2025-07-01")],
    };
    const result = filterByDate(graphData, "2024-01-01");
    expect(result.edges).toHaveLength(0);
  });

  it("returns an empty edges array when graphData has no edges", () => {
    const graphData: GraphData = {
      nodes: [makeNode("a.ts", "2024-01-01")],
      edges: [],
    };
    const result = filterByDate(graphData, "2024-06-01");
    expect(result.edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Series of cutoff dates — progressive reveal
// ---------------------------------------------------------------------------

describe("filterByDate — progressive timeline", () => {
  /*
   * Scenario:
   *   - a.ts: first commit 2024-01-01
   *   - b.ts: first commit 2024-04-01
   *   - c.ts: first commit 2024-07-01
   *   - edge a–b: lastCoChangeDate 2024-05-01
   *   - edge b–c: lastCoChangeDate 2024-08-01
   */
  const a = makeNode("a.ts", "2024-01-01", { commitCount: 5 });
  const b = makeNode("b.ts", "2024-04-01", { commitCount: 3 });
  const c = makeNode("c.ts", "2024-07-01", { commitCount: 1 });
  const edgeAB = makeEdge("a.ts", "b.ts", "2024-05-01", { coChangeCount: 2 });
  const edgeBC = makeEdge("b.ts", "c.ts", "2024-08-01", { coChangeCount: 1 });

  const graphData: GraphData = {
    nodes: [a, b, c],
    edges: [edgeAB, edgeBC],
  };

  it("at 2024-01-01: only a.ts visible, no edges", () => {
    const result = filterByDate(graphData, "2024-01-01");
    expect(result.nodes.map((n) => n.id)).toEqual(["a.ts"]);
    expect(result.edges).toHaveLength(0);
  });

  it("at 2024-04-01: a.ts and b.ts visible, no edges yet (a-b edge is 2024-05)", () => {
    const result = filterByDate(graphData, "2024-04-01");
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain("a.ts");
    expect(ids).toContain("b.ts");
    expect(ids).not.toContain("c.ts");
    expect(result.edges).toHaveLength(0);
  });

  it("at 2024-05-01: a.ts and b.ts visible, edge a-b visible", () => {
    const result = filterByDate(graphData, "2024-05-01");
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain("a.ts");
    expect(ids).toContain("b.ts");
    expect(ids).not.toContain("c.ts");
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe("a.ts");
    expect(result.edges[0].target).toBe("b.ts");
  });

  it("at 2024-07-01: all three nodes visible, only a-b edge (b-c edge is 2024-08)", () => {
    const result = filterByDate(graphData, "2024-07-01");
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe("a.ts");
  });

  it("at 2024-08-01: all three nodes and both edges visible", () => {
    const result = filterByDate(graphData, "2024-08-01");
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Purity — does not mutate the input
// ---------------------------------------------------------------------------

describe("filterByDate — purity", () => {
  it("does not mutate the original graphData object", () => {
    const original: GraphData = {
      nodes: [
        makeNode("a.ts", "2024-01-01"),
        makeNode("b.ts", "2025-01-01"),
      ],
      edges: [makeEdge("a.ts", "b.ts", "2024-06-01")],
    };

    const originalNodeCount = original.nodes.length;
    const originalEdgeCount = original.edges.length;

    filterByDate(original, "2024-06-01");

    // Originals unchanged
    expect(original.nodes).toHaveLength(originalNodeCount);
    expect(original.edges).toHaveLength(originalEdgeCount);
  });

  it("returns a new object (not the same reference) each time", () => {
    const graphData: GraphData = {
      nodes: [makeNode("a.ts", "2024-01-01")],
      edges: [],
    };

    const result1 = filterByDate(graphData, "2024-06-01");
    const result2 = filterByDate(graphData, "2024-06-01");

    expect(result1).not.toBe(result2);
    expect(result1.nodes).not.toBe(result2.nodes);
  });

  it("same inputs always produce the same output", () => {
    const graphData: GraphData = {
      nodes: [
        makeNode("a.ts", "2024-01-01"),
        makeNode("b.ts", "2024-04-01"),
        makeNode("c.ts", "2025-01-01"),
      ],
      edges: [
        makeEdge("a.ts", "b.ts", "2024-05-01"),
        makeEdge("b.ts", "c.ts", "2025-02-01"),
      ],
    };

    const cutoff = "2024-06-01";
    const result1 = filterByDate(graphData, cutoff);
    const result2 = filterByDate(graphData, cutoff);

    expect(result1.nodes.map((n) => n.id)).toEqual(result2.nodes.map((n) => n.id));
    expect(result1.edges.map((e) => `${e.source}|${e.target}`)).toEqual(
      result2.edges.map((e) => `${e.source}|${e.target}`),
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("filterByDate — edge cases", () => {
  it("handles an empty graphData (no nodes, no edges)", () => {
    const graphData: GraphData = { nodes: [], edges: [] };
    const result = filterByDate(graphData, "2024-01-01");
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it("handles a very early cutoff date — before all nodes", () => {
    const graphData: GraphData = {
      nodes: [makeNode("a.ts", "2024-01-01"), makeNode("b.ts", "2024-06-01")],
      edges: [makeEdge("a.ts", "b.ts", "2024-07-01")],
    };
    const result = filterByDate(graphData, "2000-01-01");
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it("handles a very late cutoff date — all nodes and edges included", () => {
    const graphData: GraphData = {
      nodes: [makeNode("a.ts", "2024-01-01"), makeNode("b.ts", "2024-06-01")],
      edges: [makeEdge("a.ts", "b.ts", "2024-07-01")],
    };
    const result = filterByDate(graphData, "2099-12-31");
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });
});
