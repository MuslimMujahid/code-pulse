"use client";

/**
 * TimelineScrubber — full-width slider in the dashboard's bottom bar.
 *
 * - Slider index maps 1:1 to commits (oldest = 0, newest = N-1).
 * - Dragging the slider calls setScrubberDate with the commit date at that index.
 * - Debounced at ~16ms (~60fps) so we don't spam the TimelineFilter on every
 *   pixel of drag.
 * - "Jump to latest" button resets to the most recent commit.
 * - Play/Pause auto-advances the scrubber at the selected speed.
 * - Speed selector: Slow (500ms/step), Normal (200ms/step), Fast (50ms/step).
 * - Auto-play stops at the last commit; Play → Replay button.
 * - Clicking Replay resets to oldest commit and starts playing again.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CommitEntry } from "@/lib/types";

interface TimelineScrubberProps {
  commits: CommitEntry[];
  scrubberDate: string | null;
  setScrubberDate: (date: string) => void;
}

type SpeedOption = "slow" | "normal" | "fast";
const SPEED_MS: Record<SpeedOption, number> = {
  slow: 500,
  normal: 200,
  fast: 50,
};
const SPEED_LABELS: Record<SpeedOption, string> = {
  slow: "Slow",
  normal: "Normal",
  fast: "Fast",
};

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

  // Play state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [speed, setSpeed] = useState<SpeedOption>("normal");

  // Use a ref to hold the interval ID to avoid stale closures
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref to track current index inside interval callback (avoids stale closure)
  const sliderIndexRef = useRef(sliderIndex);

  // Keep sliderIndexRef in sync
  useEffect(() => {
    sliderIndexRef.current = sliderIndex;
  }, [sliderIndex]);

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
    sliderIndexRef.current = idx;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (commits[idx]) {
        setScrubberDate(commits[idx].date);
      }
    }, 16);

    // Manual drag: stop playback, reset finished state
    if (isPlaying) {
      stopPlay();
    }
    if (idx < total - 1) {
      setIsFinished(false);
    }
  };

  const stopPlay = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const startPlay = useCallback(
    (fromIndex?: number) => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      const startIdx = fromIndex ?? sliderIndexRef.current;
      sliderIndexRef.current = startIdx;
      setSliderIndex(startIdx);
      if (commits[startIdx]) {
        setScrubberDate(commits[startIdx].date);
      }

      setIsPlaying(true);
      setIsFinished(false);

      intervalRef.current = setInterval(() => {
        const currentIdx = sliderIndexRef.current;
        const nextIdx = currentIdx + 1;

        if (nextIdx >= total) {
          // Reached the end
          clearInterval(intervalRef.current!);
          intervalRef.current = null;
          setIsPlaying(false);
          setIsFinished(true);
          return;
        }

        sliderIndexRef.current = nextIdx;
        setSliderIndex(nextIdx);
        if (commits[nextIdx]) {
          setScrubberDate(commits[nextIdx].date);
        }
      }, SPEED_MS[speed]);
    },
    [total, speed, commits, setScrubberDate]
  );

  const handlePlay = () => {
    // If at the end and not finished, just play from current
    startPlay(sliderIndexRef.current);
  };

  const handlePause = () => {
    stopPlay();
  };

  const handleReplay = () => {
    // Reset to oldest commit and start playing
    setIsFinished(false);
    startPlay(0);
  };

  const handleSpeedChange = (newSpeed: SpeedOption) => {
    setSpeed(newSpeed);
    // If currently playing, restart interval with new speed
    if (isPlaying) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      intervalRef.current = setInterval(() => {
        const currentIdx = sliderIndexRef.current;
        const nextIdx = currentIdx + 1;

        if (nextIdx >= total) {
          clearInterval(intervalRef.current!);
          intervalRef.current = null;
          setIsPlaying(false);
          setIsFinished(true);
          return;
        }

        sliderIndexRef.current = nextIdx;
        setSliderIndex(nextIdx);
        if (commits[nextIdx]) {
          setScrubberDate(commits[nextIdx].date);
        }
      }, SPEED_MS[newSpeed]);
    }
  };

  const handleJumpToLatest = () => {
    if (total === 0) return;
    stopPlay();
    const idx = total - 1;
    setSliderIndex(idx);
    sliderIndexRef.current = idx;
    setScrubberDate(commits[idx].date);
    setIsFinished(false);
  };

  // Clear interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
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
    ? currentCommit.message.length > 40
      ? currentCommit.message.slice(0, 39) + "…"
      : currentCommit.message
    : "";

  const isAtLatest = sliderIndex === total - 1;

  return (
    <div className="flex-1 flex items-center gap-2 min-w-0">
      {/* Left label */}
      <span
        className="text-xs shrink-0"
        style={{ color: "#334155", letterSpacing: "0.06em" }}
      >
        TIMELINE
      </span>

      {/* Play / Pause / Replay button */}
      <PlayButton
        isPlaying={isPlaying}
        isFinished={isFinished}
        onPlay={handlePlay}
        onPause={handlePause}
        onReplay={handleReplay}
      />

      {/* Speed selector */}
      <SpeedSelector speed={speed} onChange={handleSpeedChange} />

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
          <path d="M1 2l5 4-5 4V2z" fill="currentColor" />
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface PlayButtonProps {
  isPlaying: boolean;
  isFinished: boolean;
  onPlay: () => void;
  onPause: () => void;
  onReplay: () => void;
}

function PlayButton({ isPlaying, isFinished, onPlay, onPause, onReplay }: PlayButtonProps) {
  const buttonStyle: React.CSSProperties = {
    padding: "5px 8px",
    border: "1px solid rgba(59,130,246,0.25)",
    background: "rgba(59,130,246,0.06)",
    color: "#3b82f6",
    cursor: "pointer",
    borderRadius: 3,
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    transition: "background 150ms ease-out, border-color 150ms ease-out",
    minWidth: 60,
    justifyContent: "center",
  };

  if (isPlaying) {
    return (
      <button
        onClick={onPause}
        title="Pause playback"
        aria-label="Pause playback"
        style={buttonStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(59,130,246,0.12)";
          e.currentTarget.style.borderColor = "rgba(59,130,246,0.4)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(59,130,246,0.06)";
          e.currentTarget.style.borderColor = "rgba(59,130,246,0.25)";
        }}
      >
        {/* Pause icon */}
        <svg width="10" height="11" viewBox="0 0 10 11" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="3" height="9" rx="0.5" fill="currentColor" />
          <rect x="6" y="1" width="3" height="9" rx="0.5" fill="currentColor" />
        </svg>
        Pause
      </button>
    );
  }

  if (isFinished) {
    return (
      <button
        onClick={onReplay}
        title="Replay from beginning"
        aria-label="Replay from beginning"
        style={{ ...buttonStyle, color: "#a78bfa", borderColor: "rgba(167,139,250,0.3)", background: "rgba(167,139,250,0.06)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(167,139,250,0.12)";
          e.currentTarget.style.borderColor = "rgba(167,139,250,0.5)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(167,139,250,0.06)";
          e.currentTarget.style.borderColor = "rgba(167,139,250,0.3)";
        }}
      >
        {/* Replay icon */}
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
          <path
            d="M5.5 1.5A4 4 0 1 1 2 5.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
          <path d="M1 2.5l1 3-3 0z" fill="currentColor" />
        </svg>
        Replay
      </button>
    );
  }

  return (
    <button
      onClick={onPlay}
      title="Play timeline"
      aria-label="Play timeline"
      style={buttonStyle}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(59,130,246,0.12)";
        e.currentTarget.style.borderColor = "rgba(59,130,246,0.4)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(59,130,246,0.06)";
        e.currentTarget.style.borderColor = "rgba(59,130,246,0.25)";
      }}
    >
      {/* Play icon */}
      <svg width="9" height="11" viewBox="0 0 9 11" fill="none" aria-hidden="true">
        <path d="M1 1l7 4.5L1 10V1z" fill="currentColor" />
      </svg>
      Play
    </button>
  );
}

interface SpeedSelectorProps {
  speed: SpeedOption;
  onChange: (speed: SpeedOption) => void;
}

function SpeedSelector({ speed, onChange }: SpeedSelectorProps) {
  return (
    <div
      className="shrink-0 flex items-center"
      style={{
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      {(["slow", "normal", "fast"] as SpeedOption[]).map((opt, i) => {
        const isActive = speed === opt;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            title={`${SPEED_LABELS[opt]} speed`}
            aria-pressed={isActive}
            style={{
              padding: "4px 7px",
              fontSize: 10,
              letterSpacing: "0.04em",
              background: isActive ? "rgba(59,130,246,0.15)" : "transparent",
              color: isActive ? "#60a5fa" : "#334155",
              border: "none",
              borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.06)" : "none",
              cursor: "pointer",
              transition: "background 150ms ease-out, color 150ms ease-out",
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                e.currentTarget.style.color = "#64748b";
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "#334155";
              }
            }}
          >
            {SPEED_LABELS[opt]}
          </button>
        );
      })}
    </div>
  );
}
