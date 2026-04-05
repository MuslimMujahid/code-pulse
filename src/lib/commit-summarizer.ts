/**
 * CommitSummarizer — server-side module that generates plain-English narratives
 * for a file's commit history using the Gemini API.
 *
 * SERVER-SIDE ONLY — do not import from client components.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CommitEntry } from "./types";

/** Sentinel value returned when the Gemini API key is missing. */
export const AI_UNAVAILABLE = "AI_UNAVAILABLE" as const;
export type AiUnavailable = typeof AI_UNAVAILABLE;

/** Max number of commits to include in a single prompt chunk. */
const CHUNK_SIZE = 50;

/** Default model when GEMINI_MODEL env var is not set. */
const DEFAULT_MODEL = "gemini-1.5-flash";

/**
 * Cache key: `${filePath}::${lastCommitHash}`
 * Value: the generated summary string.
 */
const summaryCache = new Map<string, string>();

/**
 * Build a cache key from a file path and the last commit hash in the list.
 */
function cacheKey(filePath: string, commits: CommitEntry[]): string {
  const lastHash =
    commits.length > 0 ? commits[commits.length - 1].hash : "empty";
  return `${filePath}::${lastHash}`;
}

/**
 * Render a list of CommitEntry objects into a compact text representation
 * suitable for inclusion in a Gemini prompt.
 */
function formatCommitsForPrompt(commits: CommitEntry[]): string {
  return commits
    .map(
      (c) =>
        `- [${c.hash.slice(0, 7)}] ${c.date} by ${c.author}: "${c.message}" (+${c.insertions}/-${c.deletions})`
    )
    .join("\n");
}

/**
 * Build a prompt for a single chunk.
 */
function buildPrompt(
  filePath: string,
  chunk: CommitEntry[],
  chunkIndex: number,
  totalChunks: number
): string {
  const chunkNote =
    totalChunks > 1
      ? ` (chunk ${chunkIndex + 1} of ${totalChunks})`
      : "";
  return (
    `You are a senior developer writing a concise code history narrative.\n` +
    `Summarise the following commits for the file "${filePath}"${chunkNote} ` +
    `in 2-4 plain-English sentences. Focus on what changed and why, not who did it.\n\n` +
    formatCommitsForPrompt(chunk)
  );
}

/**
 * Generate a plain-English summary of a file's commit history.
 *
 * @param filePath  - Full path of the file being summarised.
 * @param commits   - Ordered list of CommitEntry objects that touched this file.
 * @returns A narrative string, or the AI_UNAVAILABLE sentinel if no API key.
 * @throws  A descriptive Error when the Gemini API returns an error.
 */
export async function summarize(
  filePath: string,
  commits: CommitEntry[]
): Promise<string | AiUnavailable> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey.trim() === "") {
    return AI_UNAVAILABLE;
  }

  // Cache hit
  const key = cacheKey(filePath, commits);
  if (summaryCache.has(key)) {
    return summaryCache.get(key)!;
  }

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({ model });

  // Split into chunks to stay within the model's context window
  const chunks: CommitEntry[][] = [];
  for (let i = 0; i < Math.max(commits.length, 1); i += CHUNK_SIZE) {
    chunks.push(commits.slice(i, i + CHUNK_SIZE));
  }

  const chunkSummaries: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const prompt = buildPrompt(filePath, chunks[i], i, chunks.length);

    let result;
    try {
      result = await generativeModel.generateContent(prompt);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Gemini API error while summarising "${filePath}": ${message}`
      );
    }

    const text = result.response.text();
    chunkSummaries.push(text.trim());
  }

  // If multiple chunks, do a final consolidation pass
  let finalSummary: string;
  if (chunkSummaries.length === 1) {
    finalSummary = chunkSummaries[0];
  } else {
    const consolidationPrompt =
      `You are a senior developer. Combine the following partial summaries for ` +
      `"${filePath}" into a single coherent 3-5 sentence narrative:\n\n` +
      chunkSummaries.map((s, i) => `Part ${i + 1}:\n${s}`).join("\n\n");

    let consolidationResult;
    try {
      consolidationResult =
        await generativeModel.generateContent(consolidationPrompt);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Gemini API error during consolidation for "${filePath}": ${message}`
      );
    }
    finalSummary = consolidationResult.response.text().trim();
  }

  // Store in cache
  summaryCache.set(key, finalSummary);

  return finalSummary;
}

/**
 * Clears the in-memory summary cache.
 * Exposed for testing purposes only.
 */
export function clearSummaryCache(): void {
  summaryCache.clear();
}
