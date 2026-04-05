/**
 * GraphBuilder module — transforms RepoData into a GraphData structure of
 * nodes and edges for use by the force graph renderer.
 *
 * Pure function — no I/O. Node positioning is delegated to the force
 * simulation at render time. firstCommitDate and lastCoChangeDate are
 * preserved for use by TimelineFilter.
 */

import path from "path";
import type { RepoData, GraphData, GraphNode, GraphEdge } from "./types";

/**
 * Build a GraphData structure from RepoData.
 *
 * - Each unique file becomes a GraphNode.
 * - Each unique co-changed file pair becomes a GraphEdge.
 * - Node properties (commitCount, contributors, primaryContributor,
 *   firstCommitDate) are derived from the commits list.
 * - Edge properties (coChangeCount, lastCoChangeDate) are derived from the
 *   co-change map and the commits list.
 *
 * @param repoData - The structured repository data from GitParser
 * @returns GraphData containing nodes and edges arrays
 */
export function buildGraph(repoData: RepoData): GraphData {
  const { commits, fileToCommits, fileToContributors, coChangeMap } = repoData;

  // Build a map from commit hash → commit date for O(1) lookups when computing
  // lastCoChangeDate without rescanning all commits on every edge.
  const commitDateMap = new Map<string, string>();
  for (const commit of commits) {
    commitDateMap.set(commit.hash, commit.date);
  }

  // Build a map from file path → firstCommitDate.
  // fileToCommits values are arrays of commit hashes in the order they were
  // added (which mirrors the order of repoData.commits, oldest-first).
  // The first element is therefore the oldest commit that touched the file.
  const firstCommitDateByFile = new Map<string, string>();
  for (const [filePath, hashes] of Object.entries(fileToCommits)) {
    if (hashes.length === 0) continue;
    const firstHash = hashes[0];
    const date = commitDateMap.get(firstHash);
    if (date !== undefined) {
      firstCommitDateByFile.set(filePath, date);
    }
  }

  // Build nodes
  const nodes: GraphNode[] = [];
  for (const [filePath, hashes] of Object.entries(fileToCommits)) {
    const contributors = fileToContributors[filePath] ?? {};

    // primaryContributor = author with the highest commit count for this file
    let primaryContributor = "";
    let maxCount = 0;
    for (const [author, count] of Object.entries(contributors)) {
      if (count > maxCount || (count === maxCount && author < primaryContributor)) {
        primaryContributor = author;
        maxCount = count;
      }
    }

    const firstCommitDate = firstCommitDateByFile.get(filePath) ?? "";

    nodes.push({
      id: filePath,
      label: path.basename(filePath),
      commitCount: hashes.length,
      primaryContributor,
      contributors,
      firstCommitDate,
    });
  }

  // Build edges from the co-change map.
  // For each pair key "fileA|fileB" we need to find the most recent commit
  // date in which both files were co-changed.
  //
  // Approach: scan commits once and build a map from pair key → latest date.
  // This is O(n * k²) where n = commits and k = avg files per commit, which
  // is the same complexity as building the coChangeMap itself in GitParser.
  const lastCoChangeDateMap = new Map<string, string>();

  for (const commit of commits) {
    const files = commit.files;
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = coChangeKey(files[i], files[j]);
        // commits are ordered oldest-first, so later iterations overwrite
        // earlier ones, leaving us with the most recent date for each pair.
        lastCoChangeDateMap.set(key, commit.date);
      }
    }
  }

  const edges: GraphEdge[] = [];
  for (const [pairKey, count] of Object.entries(coChangeMap)) {
    const [source, target] = pairKey.split("|");
    if (!source || !target) continue;

    const lastCoChangeDate = lastCoChangeDateMap.get(pairKey) ?? "";

    edges.push({
      source,
      target,
      coChangeCount: count,
      lastCoChangeDate,
    });
  }

  return { nodes, edges };
}

/**
 * Builds a deterministic co-change pair key — mirrors the one in git-parser.ts.
 * Kept local here so GraphBuilder has no dependency on GitParser internals.
 */
function coChangeKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}
