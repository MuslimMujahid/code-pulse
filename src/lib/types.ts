/**
 * Shared TypeScript types for CodePulse modules.
 */

/** A single commit entry */
export interface CommitEntry {
  hash: string;
  message: string;
  author: string;
  date: string; // ISO date string
  files: string[]; // file paths changed in this commit
  insertions: number;
  deletions: number;
}

/** Main data structure returned by GitParser */
export interface RepoData {
  /** Commits ordered from oldest to newest */
  commits: CommitEntry[];
  /** Map from file path → array of commit hashes that touched it */
  fileToCommits: Record<string, string[]>;
  /** Map from file path → author name → number of commits */
  fileToContributors: Record<string, Record<string, number>>;
  /**
   * Co-change frequency map.
   * Key: deterministic pair string produced by sorting two file paths and joining with '|'
   * Value: number of commits in which both files were changed together
   */
  coChangeMap: Record<string, number>;
}

/** Success result from parseRepo */
export interface ParseRepoSuccess {
  ok: true;
  data: RepoData;
}

/** Error result from parseRepo */
export interface ParseRepoError {
  ok: false;
  error: string;
}

export type ParseRepoResult = ParseRepoSuccess | ParseRepoError;

// ---------------------------------------------------------------------------
// GraphBuilder types
// ---------------------------------------------------------------------------

/** A single node in the force graph, representing one file in the repository */
export interface GraphNode {
  /** Unique identifier — the full file path */
  id: string;
  /** Basename of the file path (for display labels) */
  label: string;
  /** Total number of commits that touched this file */
  commitCount: number;
  /** Author name with the most commits to this file */
  primaryContributor: string;
  /** Map from author name → number of commits to this file */
  contributors: Record<string, number>;
  /** ISO date string of the earliest commit that touched this file */
  firstCommitDate: string;
}

/** A single edge in the force graph, representing files co-changed together */
export interface GraphEdge {
  /** File path of the source node */
  source: string;
  /** File path of the target node */
  target: string;
  /** Number of commits in which both files were changed together */
  coChangeCount: number;
  /** ISO date string of the most recent commit in which both files were co-changed */
  lastCoChangeDate: string;
}

/** Full graph data produced by GraphBuilder */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
