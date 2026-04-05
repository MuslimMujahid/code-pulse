/**
 * Unit tests for the GraphBuilder module.
 *
 * All tests use hand-crafted RepoData fixtures so there is no I/O or real
 * git repository required.
 */

import { describe, it, expect } from "vitest";
import { buildGraph } from "./graph-builder";
import type { RepoData } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal RepoData with two commits:
 *
 * Commit A (2024-01-01): fileA.ts, fileB.ts  (author: Alice, co-change: A|B)
 * Commit B (2024-01-02): fileB.ts, fileC.ts  (author: Bob,   co-change: B|C)
 */
function makeSimpleRepoData(): RepoData {
  return {
    commits: [
      {
        hash: "aaaa",
        message: "first commit",
        author: "Alice",
        date: "2024-01-01T00:00:00.000Z",
        files: ["fileA.ts", "fileB.ts"],
        insertions: 10,
        deletions: 0,
      },
      {
        hash: "bbbb",
        message: "second commit",
        author: "Bob",
        date: "2024-01-02T00:00:00.000Z",
        files: ["fileB.ts", "fileC.ts"],
        insertions: 5,
        deletions: 2,
      },
    ],
    fileToCommits: {
      "fileA.ts": ["aaaa"],
      "fileB.ts": ["aaaa", "bbbb"],
      "fileC.ts": ["bbbb"],
    },
    fileToContributors: {
      "fileA.ts": { Alice: 1 },
      "fileB.ts": { Alice: 1, Bob: 1 },
      "fileC.ts": { Bob: 1 },
    },
    coChangeMap: {
      "fileA.ts|fileB.ts": 1,
      "fileB.ts|fileC.ts": 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Node count and correctness
// ---------------------------------------------------------------------------

describe("buildGraph — nodes", () => {
  it("returns a GraphData with nodes and edges arrays", () => {
    const result = buildGraph(makeSimpleRepoData());
    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("edges");
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.edges)).toBe(true);
  });

  it("node count equals the number of unique files across all commits", () => {
    const result = buildGraph(makeSimpleRepoData());
    // fileA.ts, fileB.ts, fileC.ts → 3 unique files
    expect(result.nodes).toHaveLength(3);
  });

  it("each node has the required shape", () => {
    const result = buildGraph(makeSimpleRepoData());
    for (const node of result.nodes) {
      expect(typeof node.id).toBe("string");
      expect(typeof node.label).toBe("string");
      expect(typeof node.commitCount).toBe("number");
      expect(typeof node.primaryContributor).toBe("string");
      expect(typeof node.contributors).toBe("object");
      expect(typeof node.firstCommitDate).toBe("string");
    }
  });

  it("node id is the full file path", () => {
    const result = buildGraph(makeSimpleRepoData());
    const ids = result.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["fileA.ts", "fileB.ts", "fileC.ts"]);
  });

  it("node label is the basename of the file path", () => {
    const repoData: RepoData = {
      commits: [
        {
          hash: "aaaa",
          message: "init",
          author: "Alice",
          date: "2024-01-01T00:00:00.000Z",
          files: ["src/components/Button.tsx"],
          insertions: 1,
          deletions: 0,
        },
      ],
      fileToCommits: { "src/components/Button.tsx": ["aaaa"] },
      fileToContributors: { "src/components/Button.tsx": { Alice: 1 } },
      coChangeMap: {},
    };
    const result = buildGraph(repoData);
    expect(result.nodes[0].label).toBe("Button.tsx");
  });

  it("commitCount reflects how many commits touched each file", () => {
    const result = buildGraph(makeSimpleRepoData());
    const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
    expect(byId["fileA.ts"].commitCount).toBe(1);
    expect(byId["fileB.ts"].commitCount).toBe(2);
    expect(byId["fileC.ts"].commitCount).toBe(1);
  });

  it("a file appearing in 10 commits has higher commitCount than one appearing in 1", () => {
    const commits = Array.from({ length: 10 }, (_, i) => ({
      hash: `hash${i}`,
      message: `commit ${i}`,
      author: "Alice",
      date: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      files: ["hot.ts", ...(i === 0 ? ["cold.ts"] : [])],
      insertions: 1,
      deletions: 0,
    }));

    const repoData: RepoData = {
      commits,
      fileToCommits: {
        "hot.ts": commits.map((c) => c.hash),
        "cold.ts": ["hash0"],
      },
      fileToContributors: {
        "hot.ts": { Alice: 10 },
        "cold.ts": { Alice: 1 },
      },
      coChangeMap: {
        "cold.ts|hot.ts": 1,
      },
    };

    const result = buildGraph(repoData);
    const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
    expect(byId["hot.ts"].commitCount).toBeGreaterThan(byId["cold.ts"].commitCount);
    expect(byId["hot.ts"].commitCount).toBe(10);
    expect(byId["cold.ts"].commitCount).toBe(1);
  });

  it("primaryContributor is the author with the highest frequency", () => {
    const repoData: RepoData = {
      commits: [
        {
          hash: "h1",
          message: "c1",
          author: "Alice",
          date: "2024-01-01T00:00:00.000Z",
          files: ["file.ts"],
          insertions: 1,
          deletions: 0,
        },
        {
          hash: "h2",
          message: "c2",
          author: "Bob",
          date: "2024-01-02T00:00:00.000Z",
          files: ["file.ts"],
          insertions: 1,
          deletions: 0,
        },
        {
          hash: "h3",
          message: "c3",
          author: "Alice",
          date: "2024-01-03T00:00:00.000Z",
          files: ["file.ts"],
          insertions: 1,
          deletions: 0,
        },
      ],
      fileToCommits: { "file.ts": ["h1", "h2", "h3"] },
      fileToContributors: { "file.ts": { Alice: 2, Bob: 1 } },
      coChangeMap: {},
    };
    const result = buildGraph(repoData);
    expect(result.nodes[0].primaryContributor).toBe("Alice");
  });

  it("contributors map has correct author-to-count entries", () => {
    const result = buildGraph(makeSimpleRepoData());
    const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
    expect(byId["fileB.ts"].contributors).toEqual({ Alice: 1, Bob: 1 });
    expect(byId["fileA.ts"].contributors).toEqual({ Alice: 1 });
  });

  it("firstCommitDate matches the date of the earliest commit for each file", () => {
    const result = buildGraph(makeSimpleRepoData());
    const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
    // fileB.ts first appears in commit aaaa (2024-01-01)
    expect(byId["fileB.ts"].firstCommitDate).toBe("2024-01-01T00:00:00.000Z");
    // fileC.ts first appears in commit bbbb (2024-01-02)
    expect(byId["fileC.ts"].firstCommitDate).toBe("2024-01-02T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Edge count and correctness
// ---------------------------------------------------------------------------

describe("buildGraph — edges", () => {
  it("edge count equals the number of unique co-changed file pairs", () => {
    const result = buildGraph(makeSimpleRepoData());
    // co-change map has 2 entries: A|B and B|C
    expect(result.edges).toHaveLength(2);
  });

  it("each edge has the required shape", () => {
    const result = buildGraph(makeSimpleRepoData());
    for (const edge of result.edges) {
      expect(typeof edge.source).toBe("string");
      expect(typeof edge.target).toBe("string");
      expect(typeof edge.coChangeCount).toBe("number");
      expect(typeof edge.lastCoChangeDate).toBe("string");
    }
  });

  it("edge coChangeCount matches the count from the co-change map", () => {
    // Two commits co-change fileA.ts and fileB.ts
    const repoData: RepoData = {
      commits: [
        {
          hash: "h1",
          message: "c1",
          author: "Alice",
          date: "2024-01-01T00:00:00.000Z",
          files: ["fileA.ts", "fileB.ts"],
          insertions: 1,
          deletions: 0,
        },
        {
          hash: "h2",
          message: "c2",
          author: "Alice",
          date: "2024-01-02T00:00:00.000Z",
          files: ["fileA.ts", "fileB.ts"],
          insertions: 1,
          deletions: 0,
        },
      ],
      fileToCommits: {
        "fileA.ts": ["h1", "h2"],
        "fileB.ts": ["h1", "h2"],
      },
      fileToContributors: {
        "fileA.ts": { Alice: 2 },
        "fileB.ts": { Alice: 2 },
      },
      coChangeMap: { "fileA.ts|fileB.ts": 2 },
    };
    const result = buildGraph(repoData);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].coChangeCount).toBe(2);
  });

  it("lastCoChangeDate is the most recent commit date when both files were changed together", () => {
    const repoData: RepoData = {
      commits: [
        {
          hash: "h1",
          message: "c1",
          author: "Alice",
          date: "2024-01-01T00:00:00.000Z",
          files: ["fileA.ts", "fileB.ts"],
          insertions: 1,
          deletions: 0,
        },
        {
          hash: "h2",
          message: "c2",
          author: "Alice",
          date: "2024-03-15T12:00:00.000Z",
          files: ["fileA.ts", "fileB.ts"],
          insertions: 1,
          deletions: 0,
        },
      ],
      fileToCommits: {
        "fileA.ts": ["h1", "h2"],
        "fileB.ts": ["h1", "h2"],
      },
      fileToContributors: {
        "fileA.ts": { Alice: 2 },
        "fileB.ts": { Alice: 2 },
      },
      coChangeMap: { "fileA.ts|fileB.ts": 2 },
    };
    const result = buildGraph(repoData);
    // Most recent co-change is h2 → 2024-03-15
    expect(result.edges[0].lastCoChangeDate).toBe("2024-03-15T12:00:00.000Z");
  });

  it("edge source and target match the two file paths in the pair key", () => {
    const result = buildGraph(makeSimpleRepoData());
    const edgeSet = new Set(result.edges.map((e) => [e.source, e.target].sort().join("|")));
    expect(edgeSet.has("fileA.ts|fileB.ts")).toBe(true);
    expect(edgeSet.has("fileB.ts|fileC.ts")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Empty inputs
// ---------------------------------------------------------------------------

describe("buildGraph — edge cases", () => {
  it("returns empty nodes and edges for an empty RepoData", () => {
    const repoData: RepoData = {
      commits: [],
      fileToCommits: {},
      fileToContributors: {},
      coChangeMap: {},
    };
    const result = buildGraph(repoData);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it("handles commits where a file appears in only one commit (no edges)", () => {
    const repoData: RepoData = {
      commits: [
        {
          hash: "h1",
          message: "solo",
          author: "Alice",
          date: "2024-01-01T00:00:00.000Z",
          files: ["solo.ts"],
          insertions: 5,
          deletions: 0,
        },
      ],
      fileToCommits: { "solo.ts": ["h1"] },
      fileToContributors: { "solo.ts": { Alice: 1 } },
      coChangeMap: {},
    };
    const result = buildGraph(repoData);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
    expect(result.nodes[0].id).toBe("solo.ts");
    expect(result.nodes[0].commitCount).toBe(1);
  });

  it("is a pure function — calling twice with the same input yields equal output", () => {
    const data = makeSimpleRepoData();
    const r1 = buildGraph(data);
    const r2 = buildGraph(data);
    expect(r1.nodes.length).toBe(r2.nodes.length);
    expect(r1.edges.length).toBe(r2.edges.length);
  });
});
