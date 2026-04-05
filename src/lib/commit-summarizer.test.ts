/**
 * Tests for the CommitSummarizer module.
 *
 * @google/generative-ai is mocked — no real API calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CommitEntry } from "./types";

// ---------------------------------------------------------------------------
// Mock @google/generative-ai before importing the module under test
// ---------------------------------------------------------------------------

const mockGenerateContent = vi.fn();

vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: mockGenerateContent,
      }),
    })),
  };
});

// Import after mock is set up
import {
  summarize,
  clearSummaryCache,
  AI_UNAVAILABLE,
} from "./commit-summarizer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCommit(overrides: Partial<CommitEntry> = {}): CommitEntry {
  return {
    hash: "abc1234567890",
    message: "fix: some change",
    author: "Alice",
    date: "2024-01-01T00:00:00.000Z",
    files: ["src/foo.ts"],
    insertions: 5,
    deletions: 2,
    ...overrides,
  };
}

function makeCommits(count: number): CommitEntry[] {
  return Array.from({ length: count }, (_, i) =>
    makeCommit({
      hash: `hash${String(i).padStart(10, "0")}`,
      message: `feat: change ${i}`,
      date: new Date(2024, 0, i + 1).toISOString(),
    })
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  clearSummaryCache();
  vi.clearAllMocks();
  // Set a dummy API key for tests that should succeed
  process.env.GEMINI_API_KEY = "test-api-key";
  process.env.GEMINI_MODEL = "";
  // Default mock response
  mockGenerateContent.mockResolvedValue({
    response: { text: () => "This file was refactored for clarity." },
  });
});

afterEach(() => {
  // Restore env
  process.env = { ...ORIGINAL_ENV };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("summarize – API unavailable", () => {
  it("returns AI_UNAVAILABLE when GEMINI_API_KEY is not set", async () => {
    delete process.env.GEMINI_API_KEY;
    const commits = [makeCommit()];
    const result = await summarize("src/foo.ts", commits);
    expect(result).toBe(AI_UNAVAILABLE);
  });

  it("returns AI_UNAVAILABLE when GEMINI_API_KEY is an empty string", async () => {
    process.env.GEMINI_API_KEY = "";
    const commits = [makeCommit()];
    const result = await summarize("src/foo.ts", commits);
    expect(result).toBe(AI_UNAVAILABLE);
  });

  it("returns AI_UNAVAILABLE when GEMINI_API_KEY is only whitespace", async () => {
    process.env.GEMINI_API_KEY = "   ";
    const commits = [makeCommit()];
    const result = await summarize("src/foo.ts", commits);
    expect(result).toBe(AI_UNAVAILABLE);
  });

  it("does NOT call generateContent when API key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    await summarize("src/foo.ts", [makeCommit()]);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});

describe("summarize – basic prompting", () => {
  it("returns the generated summary string from Gemini", async () => {
    const expected = "This file was refactored for clarity.";
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => expected },
    });
    const result = await summarize("src/foo.ts", [makeCommit()]);
    expect(result).toBe(expected);
  });

  it("calls generateContent exactly once for a small commit list", async () => {
    await summarize("src/bar.ts", makeCommits(5));
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("passes the file path in the prompt", async () => {
    await summarize("src/special/file.ts", [makeCommit()]);
    const calledWith: string = mockGenerateContent.mock.calls[0][0] as string;
    expect(calledWith).toContain("src/special/file.ts");
  });

  it("passes commit message text in the prompt", async () => {
    const commits = [makeCommit({ message: "refactor: big cleanup" })];
    await summarize("src/foo.ts", commits);
    const calledWith: string = mockGenerateContent.mock.calls[0][0] as string;
    expect(calledWith).toContain("refactor: big cleanup");
  });

  it("passes line-change stats in the prompt", async () => {
    const commits = [makeCommit({ insertions: 42, deletions: 7 })];
    await summarize("src/foo.ts", commits);
    const calledWith: string = mockGenerateContent.mock.calls[0][0] as string;
    expect(calledWith).toContain("+42");
    expect(calledWith).toContain("-7");
  });

  it("does NOT include raw diff content (only message + stats)", async () => {
    const commits = [
      makeCommit({
        message: "fix: patch vulnerability",
        insertions: 3,
        deletions: 1,
      }),
    ];
    await summarize("src/foo.ts", commits);
    const calledWith: string = mockGenerateContent.mock.calls[0][0] as string;
    // Prompt should only contain the formatted summary fields, not a "diff" section
    expect(calledWith).not.toMatch(/^diff /m);
    expect(calledWith).not.toMatch(/^@@/m);
  });

  it("uses gemini-1.5-flash as default model when GEMINI_MODEL is not set", async () => {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const mockInstance = vi.mocked(GoogleGenerativeAI).mock.results[0]?.value as {
      getGenerativeModel: ReturnType<typeof vi.fn>;
    };
    await summarize("src/foo.ts", [makeCommit()]);
    // Look at the most recent call to getGenerativeModel
    const allInstances = vi.mocked(GoogleGenerativeAI).mock.results;
    const lastInstance = allInstances[allInstances.length - 1]?.value as {
      getGenerativeModel: ReturnType<typeof vi.fn>;
    };
    void mockInstance; // suppress unused warning
    const getModelCalls = lastInstance.getGenerativeModel.mock.calls;
    expect(getModelCalls[getModelCalls.length - 1][0]).toEqual({
      model: "gemini-1.5-flash",
    });
  });

  it("uses GEMINI_MODEL env var when set", async () => {
    process.env.GEMINI_MODEL = "gemini-pro";
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    await summarize("src/foo.ts", [makeCommit()]);
    const allInstances = vi.mocked(GoogleGenerativeAI).mock.results;
    const lastInstance = allInstances[allInstances.length - 1]?.value as {
      getGenerativeModel: ReturnType<typeof vi.fn>;
    };
    const getModelCalls = lastInstance.getGenerativeModel.mock.calls;
    expect(getModelCalls[getModelCalls.length - 1][0]).toEqual({
      model: "gemini-pro",
    });
  });
});

describe("summarize – caching", () => {
  it("returns cached result on second call with same file + lastCommitHash", async () => {
    const commits = makeCommits(3);
    await summarize("src/foo.ts", commits);
    await summarize("src/foo.ts", commits);
    // generateContent should only be called once (the second call hits cache)
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("makes a new API call when the commit list changes (different last hash)", async () => {
    const commits1 = makeCommits(3);
    const commits2 = makeCommits(4); // different last hash
    await summarize("src/foo.ts", commits1);
    await summarize("src/foo.ts", commits2);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("makes separate API calls for different file paths with same commits", async () => {
    const commits = makeCommits(3);
    await summarize("src/foo.ts", commits);
    await summarize("src/bar.ts", commits);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("clearSummaryCache causes the next call to hit the API again", async () => {
    const commits = makeCommits(2);
    await summarize("src/foo.ts", commits);
    clearSummaryCache();
    await summarize("src/foo.ts", commits);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });
});

describe("summarize – chunking", () => {
  it("makes multiple generateContent calls when commits exceed chunk size", async () => {
    // CHUNK_SIZE is 50, so 55 commits should result in 2 chunk calls + 1 consolidation = 3
    const commits = makeCommits(55);
    mockGenerateContent.mockResolvedValue({
      response: { text: () => "Partial summary." },
    });
    await summarize("src/large-file.ts", commits);
    // 2 chunks + 1 consolidation pass
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
  });

  it("makes exactly 1 generateContent call for exactly CHUNK_SIZE commits", async () => {
    const commits = makeCommits(50);
    await summarize("src/edge-file.ts", commits);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("passes chunk index and total to prompt when chunking", async () => {
    const commits = makeCommits(55);
    mockGenerateContent.mockResolvedValue({
      response: { text: () => "chunk summary" },
    });
    await summarize("src/chunk-test.ts", commits);
    const firstCall: string = mockGenerateContent.mock.calls[0][0] as string;
    const secondCall: string = mockGenerateContent.mock.calls[1][0] as string;
    expect(firstCall).toContain("chunk 1 of 2");
    expect(secondCall).toContain("chunk 2 of 2");
  });

  it("consolidation prompt contains partial summaries when chunking", async () => {
    const commits = makeCommits(55);
    mockGenerateContent
      .mockResolvedValueOnce({ response: { text: () => "Part one summary." } })
      .mockResolvedValueOnce({ response: { text: () => "Part two summary." } })
      .mockResolvedValueOnce({
        response: { text: () => "Final consolidated summary." },
      });
    const result = await summarize("src/chunk-test.ts", commits);
    // Third call is consolidation
    const consolidationCall: string = mockGenerateContent.mock
      .calls[2][0] as string;
    expect(consolidationCall).toContain("Part one summary.");
    expect(consolidationCall).toContain("Part two summary.");
    expect(result).toBe("Final consolidated summary.");
  });
});

describe("summarize – error handling", () => {
  it("throws a descriptive Error when generateContent rejects", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("Network timeout"));
    await expect(summarize("src/foo.ts", [makeCommit()])).rejects.toThrow(
      /Gemini API error.*src\/foo\.ts.*Network timeout/
    );
  });

  it("throws a descriptive Error when generateContent rejects with a non-Error value", async () => {
    mockGenerateContent.mockRejectedValueOnce("quota exceeded");
    await expect(summarize("src/foo.ts", [makeCommit()])).rejects.toThrow(
      /Gemini API error.*quota exceeded/
    );
  });

  it("throws on consolidation API error (multi-chunk)", async () => {
    const commits = makeCommits(55);
    mockGenerateContent
      .mockResolvedValueOnce({ response: { text: () => "chunk 1" } })
      .mockResolvedValueOnce({ response: { text: () => "chunk 2" } })
      .mockRejectedValueOnce(new Error("Consolidation failed"));
    await expect(summarize("src/large.ts", commits)).rejects.toThrow(
      /Gemini API error.*Consolidation failed/
    );
  });
});
