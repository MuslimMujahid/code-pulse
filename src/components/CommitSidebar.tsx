"use client";

/**
 * CommitSidebar — slide-in panel showing a selected file's full commit history
 * and an AI-generated summary of that file's changes.
 *
 * Acceptance criteria (US-020 + US-021):
 *  - Renders as a slide-in panel from the right when selectedFile is non-null
 *  - Panel header shows the selected file's full path
 *  - Displays a chronological list of all commits that touched the file, each
 *    entry showing: abbreviated hash (7 chars), author, formatted date, message,
 *    lines added (+), lines removed (-)
 *  - Clicking a different node while open switches to that file's commits
 *  - Close button (×) calls setSelectedFile(null) to hide the panel
 *  - Does not disable the timeline scrubber (rendered as overlay)
 *  - US-021: When sidebar opens, fetches from POST /api/summarize and streams
 *    the AI narrative progressively into the summary section
 *  - US-021: Skeleton loader while fetch is in progress
 *  - US-021: Error state with Retry button on failure
 *  - US-021: AI_UNAVAILABLE sentinel shows info note, no error/retry
 *  - US-021: Per-file cache so revisiting the same file skips the fetch
 */

import { useState, useEffect, useRef } from "react";
import type { CommitEntry } from "@/lib/types";

// Sentinel value returned by /api/summarize when GEMINI_API_KEY is missing
const AI_UNAVAILABLE = "AI_UNAVAILABLE";

type SummaryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "streaming"; text: string }
  | { status: "done"; text: string }
  | { status: "unavailable" }
  | { status: "error"; message: string };

interface CommitSidebarProps {
  /** File path of the currently selected node, or null if none */
  selectedFile: string | null;
  /** All commits for the repository, ordered oldest-first */
  commits: CommitEntry[];
  /** Map from file path → ordered list of commit hashes that touched it */
  fileToCommits: Record<string, string[]>;
  /** Callback to close the sidebar */
  onClose: () => void;
}

/** Format a date string into a compact, readable format */
function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return isoDate;
  }
}

/** Build a hash → CommitEntry lookup for fast access */
function buildCommitLookup(commits: CommitEntry[]): Map<string, CommitEntry> {
  const map = new Map<string, CommitEntry>();
  for (const c of commits) {
    map.set(c.hash, c);
  }
  return map;
}

export function CommitSidebar({
  selectedFile,
  commits,
  fileToCommits,
  onClose,
}: CommitSidebarProps) {
  // ── Per-file summary cache ────────────────────────────────────────────────
  // Key: filePath — value: final summary text (or sentinel) once resolved.
  // This survives re-renders and file switches without clearing.
  const summaryCache = useRef<Map<string, string>>(new Map());

  // ── Summary fetch state ───────────────────────────────────────────────────
  const [summaryState, setSummaryState] = useState<SummaryState>({
    status: "idle",
  });

  // Track in-flight abort controller so we can cancel on file change / unmount
  const abortRef = useRef<AbortController | null>(null);

  // Derive the ordered commit list for the selected file (newest first)
  const fileCommits: CommitEntry[] = (() => {
    if (!selectedFile) return [];
    const hashes = fileToCommits[selectedFile] ?? [];
    const lookup = buildCommitLookup(commits);
    // fileToCommits hashes are oldest-first; reverse for newest-first display
    const result: CommitEntry[] = [];
    for (let i = hashes.length - 1; i >= 0; i--) {
      const c = lookup.get(hashes[i]);
      if (c) result.push(c);
    }
    return result;
  })();

  // Derive basename from file path for compact display
  const basename = selectedFile
    ? selectedFile.replace(/\\/g, "/").split("/").pop() ?? selectedFile
    : "";

  // ── Fetch / stream summary ────────────────────────────────────────────────
  const fetchSummary = (filePath: string, fileCommitList: CommitEntry[]) => {
    // Cancel any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSummaryState({ status: "loading" });

    (async () => {
      try {
        const response = await fetch("/api/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filePath,
            commits: fileCommitList,
          }),
          signal: controller.signal,
        });

        // AI key not configured
        if (response.status === 503) {
          const body = (await response.json()) as { error: string };
          if (body.error === AI_UNAVAILABLE) {
            summaryCache.current.set(filePath, AI_UNAVAILABLE);
            setSummaryState({ status: "unavailable" });
            return;
          }
        }

        if (!response.ok) {
          let errMsg = `Server error (${response.status})`;
          try {
            const body = (await response.json()) as { error?: string };
            if (body.error) errMsg = body.error;
          } catch {
            // ignore parse failure
          }
          setSummaryState({ status: "error", message: errMsg });
          return;
        }

        // Stream the response body progressively
        if (!response.body) {
          setSummaryState({ status: "error", message: "Empty response body" });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        setSummaryState({ status: "streaming", text: "" });

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setSummaryState({ status: "streaming", text: accumulated });
        }

        // Flush any remaining bytes
        accumulated += decoder.decode();

        summaryCache.current.set(filePath, accumulated);
        setSummaryState({ status: "done", text: accumulated });
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          // Request was cancelled — don't update state
          return;
        }
        const message =
          err instanceof Error ? err.message : "Failed to fetch summary";
        setSummaryState({ status: "error", message });
      }
    })();
  };

  // ── Trigger fetch when selectedFile changes ───────────────────────────────
  useEffect(() => {
    if (!selectedFile) {
      setSummaryState({ status: "idle" });
      return;
    }

    // Check the cache first
    const cached = summaryCache.current.get(selectedFile);
    if (cached !== undefined) {
      if (cached === AI_UNAVAILABLE) {
        setSummaryState({ status: "unavailable" });
      } else {
        setSummaryState({ status: "done", text: cached });
      }
      return;
    }

    // fileCommits is derived in the render function above; we need the same
    // data here. Re-derive it from props to avoid stale closure.
    const hashes = fileToCommits[selectedFile] ?? [];
    const lookup = buildCommitLookup(commits);
    const orderedCommits: CommitEntry[] = [];
    for (let i = hashes.length - 1; i >= 0; i--) {
      const c = lookup.get(hashes[i]);
      if (c) orderedCommits.push(c);
    }

    fetchSummary(selectedFile, orderedCommits);

    // Cleanup: abort on unmount or file change
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile]);

  const handleRetry = () => {
    if (!selectedFile) return;
    // Clear any cached error for this file (don't cache errors)
    summaryCache.current.delete(selectedFile);
    const hashes = fileToCommits[selectedFile] ?? [];
    const lookup = buildCommitLookup(commits);
    const orderedCommits: CommitEntry[] = [];
    for (let i = hashes.length - 1; i >= 0; i--) {
      const c = lookup.get(hashes[i]);
      if (c) orderedCommits.push(c);
    }
    fetchSummary(selectedFile, orderedCommits);
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{
          height: 40,
          padding: "0 16px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div className="flex flex-col min-w-0">
          <span
            className="text-xs font-semibold truncate"
            style={{ color: "#e2e8f0", letterSpacing: "-0.01em" }}
            title={selectedFile ?? undefined}
          >
            {basename || "FILE DETAIL"}
          </span>
          {selectedFile && selectedFile !== basename && (
            <span
              className="text-xs truncate font-mono"
              style={{
                color: "#334155",
                fontSize: 10,
                marginTop: 1,
              }}
              title={selectedFile}
            >
              {selectedFile}
            </span>
          )}
        </div>

        <button
          onClick={onClose}
          className="flex items-center justify-center shrink-0 transition-colors duration-150"
          style={{
            width: 24,
            height: 24,
            color: "#334155",
            marginLeft: 8,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#94a3b8")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#334155")}
          aria-label="Close sidebar"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M1 1l10 10M11 1L1 11"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* ── AI Summary section ───────────────────────────────────────────────── */}
      {selectedFile && (
        <div
          className="shrink-0"
          style={{
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            padding: "12px 16px",
          }}
        >
          {/* Section label */}
          <div
            className="flex items-center gap-1.5 mb-2"
            style={{ marginBottom: 8 }}
          >
            {/* Sparkle / AI icon */}
            <svg
              width="11"
              height="11"
              viewBox="0 0 11 11"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M5.5 1L6.5 4.5L10 5.5L6.5 6.5L5.5 10L4.5 6.5L1 5.5L4.5 4.5L5.5 1Z"
                fill="#6366f1"
                fillOpacity="0.8"
              />
            </svg>
            <span
              className="text-xs font-semibold"
              style={{ color: "#475569", letterSpacing: "0.06em" }}
            >
              AI SUMMARY
            </span>
          </div>

          {/* ── States ────────────────────────────────────────────────────── */}

          {/* Loading skeleton */}
          {summaryState.status === "loading" && (
            <div
              aria-label="Loading AI summary"
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              {[100, 90, 75, 85, 60].map((w, i) => (
                <div
                  key={i}
                  style={{
                    height: 8,
                    width: `${w}%`,
                    borderRadius: 4,
                    background:
                      "linear-gradient(90deg, rgba(99,102,241,0.08) 0%, rgba(99,102,241,0.18) 50%, rgba(99,102,241,0.08) 100%)",
                    backgroundSize: "200% 100%",
                    animation: `skeletonShimmer 1.5s ease-in-out infinite`,
                    animationDelay: `${i * 0.12}s`,
                  }}
                />
              ))}
              <style>{`
                @keyframes skeletonShimmer {
                  0%   { background-position: 200% 0; }
                  100% { background-position: -200% 0; }
                }
              `}</style>
            </div>
          )}

          {/* Streaming or done — show accumulated text */}
          {(summaryState.status === "streaming" ||
            summaryState.status === "done") && (
            <div
              className="overflow-y-auto"
              style={{
                maxHeight: 180,
                overscrollBehavior: "contain",
              }}
            >
              <p
                className="text-xs leading-relaxed"
                style={{ color: "#94a3b8", whiteSpace: "pre-wrap" }}
              >
                {summaryState.text}
                {summaryState.status === "streaming" && (
                  <span
                    aria-hidden="true"
                    style={{
                      display: "inline-block",
                      width: 6,
                      height: 10,
                      background: "#6366f1",
                      opacity: 0.7,
                      marginLeft: 2,
                      verticalAlign: "text-bottom",
                      borderRadius: 1,
                      animation: "cursorBlink 0.8s step-end infinite",
                    }}
                  />
                )}
                <style>{`
                  @keyframes cursorBlink {
                    0%, 100% { opacity: 0.7; }
                    50%       { opacity: 0; }
                  }
                `}</style>
              </p>
            </div>
          )}

          {/* AI unavailable */}
          {summaryState.status === "unavailable" && (
            <p
              className="text-xs"
              style={{
                color: "#475569",
                lineHeight: 1.6,
                fontStyle: "italic",
              }}
            >
              AI summaries unavailable — set{" "}
              <code
                className="font-mono"
                style={{
                  color: "#6366f1",
                  background: "rgba(99,102,241,0.08)",
                  padding: "0 3px",
                  borderRadius: 3,
                }}
              >
                GEMINI_API_KEY
              </code>{" "}
              to enable.
            </p>
          )}

          {/* Error state */}
          {summaryState.status === "error" && (
            <div
              className="flex flex-col gap-2"
              style={{ alignItems: "flex-start" }}
            >
              <p
                className="text-xs"
                style={{ color: "#ef4444", lineHeight: 1.5 }}
              >
                {summaryState.message}
              </p>
              <button
                onClick={handleRetry}
                className="text-xs transition-colors duration-150"
                style={{
                  color: "#6366f1",
                  padding: "3px 8px",
                  border: "1px solid rgba(99,102,241,0.3)",
                  background: "rgba(99,102,241,0.06)",
                  borderRadius: 3,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(99,102,241,0.12)";
                  e.currentTarget.style.borderColor = "rgba(99,102,241,0.5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(99,102,241,0.06)";
                  e.currentTarget.style.borderColor = "rgba(99,102,241,0.3)";
                }}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Commit count summary bar ─────────────────────────────────────────── */}
      {selectedFile && (
        <div
          className="flex items-center gap-2 shrink-0"
          style={{
            padding: "6px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            background: "rgba(255,255,255,0.015)",
          }}
        >
          <span
            className="text-xs tabular-nums"
            style={{ color: "#475569" }}
          >
            <span style={{ color: "#64748b" }}>{fileCommits.length}</span>
            {" "}commit{fileCommits.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* ── Commit list ──────────────────────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ overscrollBehavior: "contain" }}
      >
        {fileCommits.length === 0 && selectedFile ? (
          <div
            className="flex items-center justify-center h-full"
            style={{ pointerEvents: "none" }}
          >
            <span
              className="text-xs"
              style={{ color: "#1e293b", letterSpacing: "0.08em" }}
            >
              NO COMMITS FOUND
            </span>
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {fileCommits.map((commit, idx) => (
              <CommitItem
                key={commit.hash}
                commit={commit}
                isFirst={idx === 0}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CommitItem — renders a single commit row
// ─────────────────────────────────────────────────────────────────────────────

interface CommitItemProps {
  commit: CommitEntry;
  isFirst: boolean;
}

function CommitItem({ commit, isFirst }: CommitItemProps) {
  const abbrevHash = commit.hash.slice(0, 7);
  const hasChanges = commit.insertions > 0 || commit.deletions > 0;

  return (
    <li
      style={{
        padding: "10px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        background: isFirst ? "rgba(59,130,246,0.03)" : "transparent",
      }}
    >
      {/* Row 1: hash + date */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="font-mono text-xs shrink-0"
          style={{ color: "#3b82f6", letterSpacing: "0.02em" }}
        >
          {abbrevHash}
        </span>
        <span
          className="text-xs shrink-0 tabular-nums"
          style={{ color: "#334155" }}
        >
          {formatDate(commit.date)}
        </span>
      </div>

      {/* Row 2: commit message */}
      <p
        className="text-xs mt-1"
        style={{
          color: "#94a3b8",
          lineHeight: 1.5,
          margin: "4px 0 0",
          wordBreak: "break-word",
        }}
      >
        {commit.message}
      </p>

      {/* Row 3: author + line change stats */}
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <span
          className="text-xs truncate"
          style={{ color: "#475569", fontSize: 10 }}
        >
          {commit.author}
        </span>
        {hasChanges && (
          <div className="flex items-center gap-2 shrink-0">
            {commit.insertions > 0 && (
              <span
                className="text-xs tabular-nums font-mono"
                style={{ color: "#22c55e", fontSize: 10 }}
              >
                +{commit.insertions}
              </span>
            )}
            {commit.deletions > 0 && (
              <span
                className="text-xs tabular-nums font-mono"
                style={{ color: "#ef4444", fontSize: 10 }}
              >
                -{commit.deletions}
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
