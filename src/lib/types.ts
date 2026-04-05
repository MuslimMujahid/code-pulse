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
