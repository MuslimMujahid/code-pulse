/**
 * AppStore — Zustand store managing all application state for CodePulse.
 *
 * graphData holds the full unfiltered graph returned by /api/analyze.
 * filteredData is the derived view produced by TimelineFilter.
 *
 * TimelineFilter is run client-side on every setScrubberDate call to avoid
 * a network round-trip on each scrubber tick.
 */

"use client";

import { create } from "zustand";
import type { GraphData } from "@/lib/types";
import { filterByDate } from "@/lib/timeline-filter";

export type ViewMode = "default" | "heatmap" | "contributor";

export interface AppState {
  // ── Data ────────────────────────────────────────────────────────────────────
  /** The path to the repository entered by the user */
  repoPath: string;
  /** Full unfiltered graph returned by /api/analyze */
  graphData: GraphData | null;
  /** Timeline-filtered view of graphData (shown in the force graph) */
  filteredData: GraphData | null;
  /** ISO date string representing the current scrubber cutoff */
  scrubberDate: string | null;
  /** File path of the currently selected node, or null */
  selectedFile: string | null;
  /** Current view/coloring mode for the force graph */
  viewMode: ViewMode;
  /** Name of the contributor currently isolated in contributor mode, or null */
  activeContributor: string | null;
  /** Current filename search query */
  searchQuery: string;
  /** Whether an API request is in flight */
  isLoading: boolean;
  /** Error message from the most recent failed operation, or null */
  error: string | null;
  /** Whether the commit history was capped at the commitLimit */
  commitsCapped: boolean;

  // ── Actions ─────────────────────────────────────────────────────────────────
  /**
   * Trigger repository analysis via POST /api/analyze.
   * Sets graphData + filteredData on success, error on failure, and manages
   * isLoading throughout.
   */
  loadRepo: (path: string) => Promise<void>;

  /**
   * Update the scrubber cutoff date and run TimelineFilter client-side to
   * produce a new filteredData without a network round-trip.
   */
  setScrubberDate: (date: string) => void;

  /** Select (or deselect) a node by file path */
  setSelectedFile: (file: string | null) => void;

  /**
   * Switch the graph coloring mode.
   * Switching away from 'contributor' automatically clears activeContributor.
   */
  setViewMode: (mode: ViewMode) => void;

  /** Isolate (or de-isolate) a contributor in contributor mode */
  setActiveContributor: (name: string | null) => void;

  /** Update the filename search query */
  setSearchQuery: (query: string) => void;
}

export const useAppStore = create<AppState>()((set, get) => ({
  // ── Initial state ────────────────────────────────────────────────────────
  repoPath: "",
  graphData: null,
  filteredData: null,
  scrubberDate: null,
  selectedFile: null,
  viewMode: "default",
  activeContributor: null,
  searchQuery: "",
  isLoading: false,
  error: null,
  commitsCapped: false,

  // ── loadRepo ─────────────────────────────────────────────────────────────
  loadRepo: async (path: string) => {
    set({ isLoading: true, error: null, repoPath: path });

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath: path }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        set({
          isLoading: false,
          error: body.error ?? `Request failed with status ${response.status}`,
        });
        return;
      }

      const body = (await response.json()) as {
        graphData: GraphData;
        commitsCapped: boolean;
      };

      const { graphData, commitsCapped } = body;

      // Initialise the scrubber to the latest commit date so the full graph is
      // shown by default. The latest date is the date of the last commit in
      // nodes (the maximum firstCommitDate is not what we want here — we want
      // the actual latest commit date across all edges and nodes).
      // We use a far-future date so all nodes/edges are visible by default.
      const latestDate = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();

      set({
        graphData,
        filteredData: graphData,
        scrubberDate: latestDate,
        commitsCapped,
        isLoading: false,
        error: null,
        // Reset interaction state when loading a new repo
        selectedFile: null,
        viewMode: "default",
        activeContributor: null,
        searchQuery: "",
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "An unexpected error occurred",
      });
    }
  },

  // ── setScrubberDate ───────────────────────────────────────────────────────
  setScrubberDate: (date: string) => {
    const { graphData } = get();
    if (!graphData) {
      set({ scrubberDate: date });
      return;
    }

    const filteredData = filterByDate(graphData, date);
    set({ scrubberDate: date, filteredData });
  },

  // ── setSelectedFile ───────────────────────────────────────────────────────
  setSelectedFile: (file: string | null) => {
    set({ selectedFile: file });
  },

  // ── setViewMode ───────────────────────────────────────────────────────────
  setViewMode: (mode: ViewMode) => {
    const update: Partial<AppState> = { viewMode: mode };
    // Switching away from contributor mode clears the active contributor
    if (mode !== "contributor") {
      update.activeContributor = null;
    }
    set(update);
  },

  // ── setActiveContributor ──────────────────────────────────────────────────
  setActiveContributor: (name: string | null) => {
    set({ activeContributor: name });
  },

  // ── setSearchQuery ────────────────────────────────────────────────────────
  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },
}));
