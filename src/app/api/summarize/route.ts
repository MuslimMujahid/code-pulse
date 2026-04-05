/**
 * POST /api/summarize
 *
 * Accepts a file path and its commit list, generates a plain-English AI
 * summary via the CommitSummarizer module, and streams the result back
 * to the client.
 *
 * Request body:  { filePath: string; commits: CommitEntry[] }
 * Success:       HTTP 200 — streamed plain-text body
 * Unavailable:   HTTP 503 — { error: 'AI_UNAVAILABLE' }
 * Bad request:   HTTP 400 — { error: string }
 *
 * SERVER-SIDE ONLY — this route imports CommitSummarizer which uses
 * the Gemini SDK and must never be bundled for the client.
 */

import { NextRequest, NextResponse } from "next/server";
import { summarize, AI_UNAVAILABLE } from "@/lib/commit-summarizer";
import type { CommitEntry } from "@/lib/types";

export async function POST(request: NextRequest) {
  // Parse and validate the request body
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

  const { filePath, commits } = body as Record<string, unknown>;

  if (!filePath || typeof filePath !== "string" || filePath.trim() === "") {
    return NextResponse.json(
      { error: "filePath is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  if (!Array.isArray(commits)) {
    return NextResponse.json(
      { error: "commits must be an array" },
      { status: 400 }
    );
  }

  // Delegate to CommitSummarizer
  let result: string | typeof AI_UNAVAILABLE;
  try {
    result = await summarize(filePath.trim(), commits as CommitEntry[]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // API key was missing — return 503
  if (result === AI_UNAVAILABLE) {
    return NextResponse.json({ error: AI_UNAVAILABLE }, { status: 503 });
  }

  // Stream the summary text back to the client
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(result as string));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}
