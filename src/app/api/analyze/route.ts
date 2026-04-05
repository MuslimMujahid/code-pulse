/**
 * POST /api/analyze
 *
 * Accepts a repo path and optional commitLimit, runs the GitParser and
 * GraphBuilder, and returns the resulting GraphData along with a
 * commitsCapped flag.
 *
 * Request body:  { repoPath: string; commitLimit?: number }
 * Success:       { graphData: GraphData; commitsCapped: boolean }
 * Error (400):   { error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { parseRepo } from "@/lib/git-parser";
import { buildGraph } from "@/lib/graph-builder";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 }
    );
  }

  const { repoPath, commitLimit } = body as Record<string, unknown>;

  if (!repoPath || typeof repoPath !== "string" || repoPath.trim() === "") {
    return NextResponse.json(
      { error: "repoPath is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  // Determine the effective commit limit
  const defaultLimit = process.env.CODEPULSE_MAX_COMMITS
    ? parseInt(process.env.CODEPULSE_MAX_COMMITS, 10)
    : 500;

  const effectiveLimit =
    typeof commitLimit === "number" &&
    Number.isFinite(commitLimit) &&
    commitLimit > 0
      ? Math.floor(commitLimit)
      : Number.isFinite(defaultLimit) && defaultLimit > 0
        ? defaultLimit
        : 500;

  // Run the git parser
  const parseResult = await parseRepo(repoPath.trim(), {
    commitLimit: effectiveLimit,
  });

  if (!parseResult.ok) {
    return NextResponse.json({ error: parseResult.error }, { status: 400 });
  }

  const repoData = parseResult.data;

  // Build the graph from the parsed repo data
  const graphData = buildGraph(repoData);

  // Determine if commits were capped
  const commitsCapped = repoData.commits.length === effectiveLimit;

  // Include the full commit list for the timeline scrubber.
  // Commits are already ordered oldest-first from parseRepo.
  const { commits } = repoData;

  return NextResponse.json({ graphData, commitsCapped, commits });
}
