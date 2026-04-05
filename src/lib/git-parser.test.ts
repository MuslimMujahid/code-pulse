/**
 * Tests for the GitParser module.
 *
 * Tests create a fixture git repository programmatically using simple-git,
 * make known commits, and assert on the returned RepoData structure.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import simpleGit from "simple-git";
import { parseRepo, coChangeKey } from "./git-parser";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface FixtureRepo {
  path: string;
  commits: Array<{
    hash: string;
    files: string[];
    message: string;
    author: string;
  }>;
}

/**
 * Create a temporary directory with an initialised git repo and a series of
 * predetermined commits.
 *
 * Commit sequence (oldest → newest):
 *   1. author=Alice  files=[src/a.ts, src/b.ts]  message="first commit"
 *   2. author=Bob    files=[src/b.ts, src/c.ts]  message="second commit"
 *   3. author=Alice  files=[src/a.ts, src/c.ts]  message="third commit"
 *   4. author=Carol  files=[src/d.ts]             message="fourth commit"
 */
async function createFixtureRepo(): Promise<FixtureRepo> {
  const dir = await mkdtemp(join(tmpdir(), "codepulse-test-"));
  const git = simpleGit(dir);

  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test User");

  // Helper to write a file and commit it under a specific author
  const commit = async (
    files: string[],
    message: string,
    author: string
  ): Promise<string> => {
    for (const file of files) {
      const fullPath = join(dir, file);
      await mkdir(join(dir, file.split("/").slice(0, -1).join("/")), {
        recursive: true,
      });
      await writeFile(
        fullPath,
        `// ${file} - ${message}\nconsole.log("${file}");\n`
      );
      await git.add(fullPath);
    }
    await git.commit(message, { "--author": `${author} <${author.toLowerCase().replace(" ", ".")}@example.com>` });
    const log = await git.log(["--max-count=1"]);
    return log.latest!.hash;
  };

  const c1Hash = await commit(["src/a.ts", "src/b.ts"], "first commit", "Alice");
  const c2Hash = await commit(["src/b.ts", "src/c.ts"], "second commit", "Bob");
  const c3Hash = await commit(["src/a.ts", "src/c.ts"], "third commit", "Alice");
  const c4Hash = await commit(["src/d.ts"], "fourth commit", "Carol");

  return {
    path: dir,
    commits: [
      { hash: c1Hash, files: ["src/a.ts", "src/b.ts"], message: "first commit", author: "Alice" },
      { hash: c2Hash, files: ["src/b.ts", "src/c.ts"], message: "second commit", author: "Bob" },
      { hash: c3Hash, files: ["src/a.ts", "src/c.ts"], message: "third commit", author: "Alice" },
      { hash: c4Hash, files: ["src/d.ts"], message: "fourth commit", author: "Carol" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("GitParser", () => {
  let fixture: FixtureRepo;

  beforeAll(async () => {
    fixture = await createFixtureRepo();
  });

  afterAll(async () => {
    if (fixture?.path) {
      await rm(fixture.path, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // parseRepo — basic shape
  // -------------------------------------------------------------------------

  it("returns ok:true with a RepoData object for a valid repo", async () => {
    const result = await parseRepo(fixture.path);
    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow type
    expect(result.data).toBeDefined();
  });

  it("returns commits ordered oldest to newest", async () => {
    const result = await parseRepo(fixture.path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { commits } = result.data;
    expect(commits).toHaveLength(4);
    // Dates should be non-decreasing
    for (let i = 1; i < commits.length; i++) {
      expect(new Date(commits[i].date).getTime()).toBeGreaterThanOrEqual(
        new Date(commits[i - 1].date).getTime()
      );
    }
  });

  it("each commit has hash, message, author, date, files, insertions, deletions", async () => {
    const result = await parseRepo(fixture.path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const commit of result.data.commits) {
      expect(commit.hash).toBeTruthy();
      expect(commit.message).toBeTruthy();
      expect(commit.author).toBeTruthy();
      expect(commit.date).toBeTruthy();
      expect(Array.isArray(commit.files)).toBe(true);
      expect(typeof commit.insertions).toBe("number");
      expect(typeof commit.deletions).toBe("number");
    }
  });

  it("commit messages match expected values", async () => {
    const result = await parseRepo(fixture.path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const messages = result.data.commits.map((c) => c.message);
    expect(messages).toContain("first commit");
    expect(messages).toContain("second commit");
    expect(messages).toContain("third commit");
    expect(messages).toContain("fourth commit");
  });

  // -------------------------------------------------------------------------
  // fileToCommits map
  // -------------------------------------------------------------------------

  it("fileToCommits maps each file to the commits that touched it", async () => {
    const result = await parseRepo(fixture.path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { fileToCommits } = result.data;

    // src/a.ts appears in commit 1 and commit 3
    expect(fileToCommits["src/a.ts"]).toHaveLength(2);
    // src/b.ts appears in commit 1 and commit 2
    expect(fileToCommits["src/b.ts"]).toHaveLength(2);
    // src/c.ts appears in commit 2 and commit 3
    expect(fileToCommits["src/c.ts"]).toHaveLength(2);
    // src/d.ts appears only in commit 4
    expect(fileToCommits["src/d.ts"]).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // fileToContributors map
  // -------------------------------------------------------------------------

  it("fileToContributors maps each file to author frequencies", async () => {
    const result = await parseRepo(fixture.path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { fileToContributors } = result.data;

    // src/a.ts was touched by Alice twice
    expect(fileToContributors["src/a.ts"]["Alice"]).toBe(2);

    // src/b.ts was touched by Alice once and Bob once
    expect(fileToContributors["src/b.ts"]["Alice"]).toBe(1);
    expect(fileToContributors["src/b.ts"]["Bob"]).toBe(1);

    // src/d.ts was touched only by Carol
    expect(fileToContributors["src/d.ts"]["Carol"]).toBe(1);
    expect(Object.keys(fileToContributors["src/d.ts"])).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // coChangeMap
  // -------------------------------------------------------------------------

  it("coChangeMap counts file pairs co-changed in the same commit", async () => {
    const result = await parseRepo(fixture.path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { coChangeMap } = result.data;

    // src/a.ts + src/b.ts: co-changed in commit 1 only → count = 1
    expect(coChangeMap[coChangeKey("src/a.ts", "src/b.ts")]).toBe(1);

    // src/b.ts + src/c.ts: co-changed in commit 2 only → count = 1
    expect(coChangeMap[coChangeKey("src/b.ts", "src/c.ts")]).toBe(1);

    // src/a.ts + src/c.ts: co-changed in commit 3 only → count = 1
    expect(coChangeMap[coChangeKey("src/a.ts", "src/c.ts")]).toBe(1);

    // src/d.ts was alone in commit 4, so no pairs with it
    expect(coChangeMap[coChangeKey("src/a.ts", "src/d.ts")]).toBeUndefined();
  });

  it("coChangeKey produces a deterministic key regardless of argument order", () => {
    expect(coChangeKey("src/a.ts", "src/b.ts")).toBe(
      coChangeKey("src/b.ts", "src/a.ts")
    );
    expect(coChangeKey("src/a.ts", "src/b.ts")).toBe("src/a.ts|src/b.ts");
  });

  // -------------------------------------------------------------------------
  // commitLimit
  // -------------------------------------------------------------------------

  it("commitLimit caps the number of commits returned", async () => {
    // With a limit of 2 we should only get the 2 most recent commits
    const result = await parseRepo(fixture.path, { commitLimit: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.commits).toHaveLength(2);
  });

  it("commitLimit = 1 returns exactly 1 commit", async () => {
    const result = await parseRepo(fixture.path, { commitLimit: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.commits).toHaveLength(1);
  });

  it("commitLimit larger than actual commit count returns all commits", async () => {
    const result = await parseRepo(fixture.path, { commitLimit: 9999 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.commits).toHaveLength(4);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it("returns ok:false with error string for a non-existent path", async () => {
    const result = await parseRepo("/this/path/does/not/exist/at/all");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(typeof result.error).toBe("string");
    expect(result.error.length).toBeGreaterThan(0);
  });

  it("returns ok:false with error string for a non-git directory", async () => {
    // Create a temp directory that is NOT a git repo
    const nonGitDir = await mkdtemp(join(tmpdir(), "codepulse-nongit-"));
    try {
      const result = await parseRepo(nonGitDir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });

  it("does not throw an unhandled exception for any error path", async () => {
    // This should resolve (not reject) even with a bad path
    await expect(
      parseRepo("/nonexistent/path")
    ).resolves.toMatchObject({ ok: false });
  });
});
