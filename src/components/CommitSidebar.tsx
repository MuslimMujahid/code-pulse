"use client";

/**
 * CommitSidebar — slide-in panel showing a selected file's full commit history.
 *
 * Acceptance criteria (US-020):
 *  - Renders as a slide-in panel from the right when selectedFile is non-null
 *  - Panel header shows the selected file's full path
 *  - Displays a chronological list of all commits that touched the file, each
 *    entry showing: abbreviated hash (7 chars), author, formatted date, message,
 *    lines added (+), lines removed (-)
 *  - Clicking a different node while open switches to that file's commits
 *  - Close button (×) calls setSelectedFile(null) to hide the panel
 *  - Does not disable the timeline scrubber (rendered as overlay)
 */

import type { CommitEntry } from "@/lib/types";

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
