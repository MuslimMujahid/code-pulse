"use client";

/**
 * TimelineScrubber — full-width slider in the dashboard's bottom bar.
 *
 * - Slider index maps 1:1 to commits (oldest = 0, newest = N-1).
 * - Dragging the slider calls setScrubberDate with the commit date at that index.
 * - Debounced at ~16ms (~60fps) so we don't spam the TimelineFilter on every
 *   pixel of drag.
 * - "Jump to latest" button resets to the most recent commit.
 */

import { useEffect, useRef, useState } from "react";
import type { CommitEntry } from "@/lib/types";

interface TimelineScrubberProps {
  commits: CommitEntry[];
  scrubberDate: string | null;
  setScrubberDate: (date: string) => void;
}

/** Format an ISO date string as a short human-readable label. */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function TimelineScrubber({
  commits,
  scrubberDate,
  setScrubberDate,
}: TimelineScrubberProps) {
  const total = commits.length;

  // Map scrubberDate → the current slider index.
  // We find the latest commit whose date is ≤ scrubberDate.
  const dateToIndex = (date: string | null): number => {
    if (!date || total === 0) return total > 0 ? total - 1 : 0;
    const cutMs = new Date(date).getTime();
    // commits are oldest-first; walk backwards to find the last commit ≤ cutoff
    for (let i = total - 1; i >= 0; i--) {
      if (new Date(commits[i].date).getTime() <= cutMs) return i;
    }
    return 0;
  };

  const [sliderIndex, setSliderIndex] = useState<number>(() =>
    dateToIndex(scrubberDate)
  );

  // Keep slider in sync when scrubberDate changes externally (e.g. initial load)
  useEffect(() => {
    setSliderIndex(dateToIndex(scrubberDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrubberDate, total]);

  // Debounce ref: cap setScrubberDate calls at ~60fps
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = parseInt(e.target.value, 10);
    setSliderIndex(idx);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (commits[idx]) {
        setScrubberDate(commits[idx].date);
      }
    }, 16);
  };

  const handleJumpToLatest = () => {
    if (total === 0) return;
    const idx = total - 1;
    setSliderIndex(idx);
    setScrubberDate(commits[idx].date);
  };

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (total === 0) {
    return (
      <div className="flex-1 flex items-center gap-4">
        <span
          className="text-xs shrink-0"
          style={{ color: "#1e293b", letterSpacing: "0.08em" }}
        >
          TIMELINE
        </span>
        <div
          className="flex-1 relative"
          style={{ height: 2, background: "rgba(255,255,255,0.04)", borderRadius: 1 }}
        />
        <span
          className="text-xs shrink-0 font-mono tabular-nums"
          style={{ color: "#1e293b" }}
        >
          —
        </span>
      </div>
    );
  }

  const currentCommit = commits[sliderIndex];
  const dateLabel = currentCommit ? formatDate(currentCommit.date) : "—";
  const commitMsg = currentCommit
    ? currentCommit.message.length > 48
      ? currentCommit.message.slice(0, 47) + "…"
      : currentCommit.message
    : "";

  const isAtLatest = sliderIndex === total - 1;

  return (
    <div className="flex-1 flex items-center gap-3 min-w-0">
      {/* Left label */}
      <span
        className="text-xs shrink-0"
        style={{ color: "#334155", letterSpacing: "0.06em" }}
      >
        TIMELINE
      </span>

      {/* Slider + date label wrapper */}
      <div className="flex-1 flex flex-col justify-center min-w-0" style={{ gap: 3 }}>
        {/* Date + commit message row */}
        <div className="flex items-baseline gap-2 min-w-0">
          <span
            className="text-xs font-mono tabular-nums shrink-0"
            style={{ color: "#94a3b8" }}
          >
            {dateLabel}
          </span>
          <span
            className="text-xs truncate min-w-0"
            style={{ color: "#334155" }}
            title={currentCommit?.message}
          >
            {commitMsg}
          </span>
          <span
            className="text-xs shrink-0 tabular-nums"
            style={{ color: "#1e293b" }}
          >
            {sliderIndex + 1}/{total}
          </span>
        </div>

        {/* Range slider */}
        <input
          type="range"
          min={0}
          max={total - 1}
          step={1}
          value={sliderIndex}
          onChange={handleChange}
          aria-label="Timeline scrubber"
          aria-valuemin={0}
          aria-valuemax={total - 1}
          aria-valuenow={sliderIndex}
          aria-valuetext={`Commit ${sliderIndex + 1} of ${total}: ${dateLabel}`}
          className="w-full"
          style={{
            // Custom range styling via CSS variables / inline overrides
            accentColor: "#3b82f6",
            cursor: "pointer",
            height: 4,
          }}
        />
      </div>

      {/* Jump-to-latest button */}
      <button
        onClick={handleJumpToLatest}
        disabled={isAtLatest}
        title="Jump to latest commit"
        aria-label="Jump to latest commit"
        className="shrink-0 flex items-center gap-1.5 text-xs transition-all duration-150"
        style={{
          padding: "5px 8px",
          border: `1px solid ${isAtLatest ? "rgba(255,255,255,0.04)" : "rgba(59,130,246,0.25)"}`,
          background: isAtLatest ? "transparent" : "rgba(59,130,246,0.06)",
          color: isAtLatest ? "#1e293b" : "#3b82f6",
          cursor: isAtLatest ? "default" : "pointer",
          borderRadius: 3,
        }}
        onMouseEnter={(e) => {
          if (!isAtLatest) {
            e.currentTarget.style.background = "rgba(59,130,246,0.12)";
            e.currentTarget.style.borderColor = "rgba(59,130,246,0.4)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isAtLatest) {
            e.currentTarget.style.background = "rgba(59,130,246,0.06)";
            e.currentTarget.style.borderColor = "rgba(59,130,246,0.25)";
          }
        }}
      >
        {/* Fast-forward icon */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M1 2l5 4-5 4V2z"
            fill="currentColor"
          />
          <line
            x1="10"
            y1="2"
            x2="10"
            y2="10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        Latest
      </button>
    </div>
  );
}
