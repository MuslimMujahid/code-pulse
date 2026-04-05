/**
 * GitParser module — parses a local git repository into structured RepoData.
 *
 * All git interaction is encapsulated here behind a single testable interface.
 * Server-side only — not imported by client code.
 */

import simpleGit from "simple-git";
import type { ParseRepoResult, RepoData, CommitEntry } from "./types";

/** Options for parseRepo */
export interface ParseRepoOptions {
  /** Maximum number of commits to return. Defaults to CODEPULSE_MAX_COMMITS env var or 500. */
  commitLimit?: number;
}

/**
 * Builds a deterministic co-change pair key from two file paths.
 * Paths are sorted lexicographically so "a|b" and "b|a" always produce the same key.
 */
export function coChangeKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/**
 * Parse a local git repository into structured RepoData.
 *
 * @param repoPath - Absolute or relative path to the repository root
 * @param options  - Optional configuration
 * @returns ParseRepoResult — either { ok: true, data: RepoData } or { ok: false, error: string }
 */
export async function parseRepo(
  repoPath: string,
  options: ParseRepoOptions = {}
): Promise<ParseRepoResult> {
  const maxCommits =
    options.commitLimit ??
    (process.env.CODEPULSE_MAX_COMMITS
      ? parseInt(process.env.CODEPULSE_MAX_COMMITS, 10)
      : 500);

  // Validate maxCommits is a positive integer
  const commitLimit =
    Number.isFinite(maxCommits) && maxCommits > 0 ? maxCommits : 500;

  // simple-git throws synchronously when the baseDir doesn't exist, so we
  // wrap the instantiation and the checkIsRepo call in a single try/catch.
  let git: ReturnType<typeof simpleGit>;
  try {
    git = simpleGit(repoPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Failed to access repository at ${repoPath}: ${message}`,
    };
  }

  // Verify it's a git repository
  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return {
        ok: false,
        error: `Path is not a git repository: ${repoPath}`,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Failed to access repository at ${repoPath}: ${message}`,
    };
  }

  try {
    // Fetch log with --numstat to get per-file insertions/deletions.
    // We use git.raw() with a custom format to reliably parse the numstat output.
    const SPLITTER = "|||";
    const rawOutput = await git.raw([
      "log",
      `--max-count=${commitLimit}`,
      `--format=COMMIT_START%H${SPLITTER}%an${SPLITTER}%aI${SPLITTER}%s`,
      "--numstat",
    ]);

    const commits: CommitEntry[] = parseRawLog(rawOutput, SPLITTER);

    // Now build derived structures
    const fileToCommits: Record<string, string[]> = {};
    const fileToContributors: Record<string, Record<string, number>> = {};
    const coChangeMap: Record<string, number> = {};

    for (const commit of commits) {
      const files = commit.files;

      // Update fileToCommits and fileToContributors
      for (const file of files) {
        if (!fileToCommits[file]) {
          fileToCommits[file] = [];
        }
        fileToCommits[file].push(commit.hash);

        if (!fileToContributors[file]) {
          fileToContributors[file] = {};
        }
        fileToContributors[file][commit.author] =
          (fileToContributors[file][commit.author] ?? 0) + 1;
      }

      // Update co-change map for every unique pair in this commit
      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          const key = coChangeKey(files[i], files[j]);
          coChangeMap[key] = (coChangeMap[key] ?? 0) + 1;
        }
      }
    }

    const repoData: RepoData = {
      commits,
      fileToCommits,
      fileToContributors,
      coChangeMap,
    };

    return { ok: true, data: repoData };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Failed to parse repository: ${message}`,
    };
  }
}

/**
 * Parse the raw `git log --format=COMMIT_START... --numstat` output.
 *
 * Each commit block looks like:
 * ```
 * COMMIT_START<hash>|||<author>|||<date>|||<subject>
 * <insertions>\t<deletions>\t<filename>
 * <insertions>\t<deletions>\t<filename>
 * ...
 * (blank line)
 * ```
 */
function parseRawLog(raw: string, splitter: string): CommitEntry[] {
  const commits: CommitEntry[] = [];

  // Split by COMMIT_START marker (skip empty first element)
  const blocks = raw.split("COMMIT_START").filter((b) => b.trim() !== "");

  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length === 0) continue;

    // First line is the header
    const header = lines[0].trim();
    if (!header) continue;

    const parts = header.split(splitter);
    if (parts.length < 4) continue;

    const [hash, author, date, ...messageParts] = parts;
    const message = messageParts.join(splitter); // re-join in case message contains splitter

    let insertions = 0;
    let deletions = 0;
    const files: string[] = [];

    // Remaining lines are numstat entries: insertions\tdeletions\tfilename
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const tabParts = line.split("\t");
      if (tabParts.length < 3) continue;

      const [ins, del, ...fileParts] = tabParts;
      const filename = fileParts.join("\t");

      // Handle binary files (shown as '-')
      const parsedIns = ins === "-" ? 0 : parseInt(ins, 10);
      const parsedDel = del === "-" ? 0 : parseInt(del, 10);

      if (!Number.isNaN(parsedIns)) insertions += parsedIns;
      if (!Number.isNaN(parsedDel)) deletions += parsedDel;

      if (filename) {
        // Handle renames like "old/path => new/path" or "{old => new}/path
        const resolvedFilenames = resolveRenamedFile(filename);
        files.push(...resolvedFilenames);
      }
    }

    commits.push({
      hash: hash.trim(),
      author: author.trim(),
      date: date.trim(),
      message: message.trim(),
      files,
      insertions,
      deletions,
    });
  }

  // git log outputs newest-first; reverse to get oldest-first
  return commits.reverse();
}

/**
 * Resolve a potentially renamed file entry from numstat.
 *
 * git numstat represents renames like:
 *   - "old/path => new/path"  (simple rename)
 *   - "{old => new}/path"     (partial path rename)
 *
 * We return both old and new paths so they each count as touched.
 */
function resolveRenamedFile(filename: string): string[] {
  // Handle {old => new}/suffix or prefix/{old => new}
  const braceRenameMatch = filename.match(/^(.*?)\{(.+?) => (.+?)\}(.*)$/);
  if (braceRenameMatch) {
    const [, prefix, oldPart, newPart, suffix] = braceRenameMatch;
    const oldPath = `${prefix}${oldPart}${suffix}`;
    const newPath = `${prefix}${newPart}${suffix}`;
    return [oldPath, newPath].filter((p) => p.trim() !== "");
  }

  // Handle simple "old => new" rename
  const simpleRenameMatch = filename.match(/^(.+?) => (.+)$/);
  if (simpleRenameMatch) {
    return [simpleRenameMatch[1].trim(), simpleRenameMatch[2].trim()];
  }

  return [filename];
}
