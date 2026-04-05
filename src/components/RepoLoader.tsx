"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppStore } from "@/store/app-store";

/**
 * RepoLoader — landing page form component.
 *
 * Reads the ?repo= query param on mount to pre-fill the input.
 * On submit, calls loadRepo() from the AppStore and pushes ?repo=<path>
 * to the URL so the analysis can be bookmarked/shared.
 *
 * Once graphData is loaded the parent page transitions to the dashboard.
 */
export function RepoLoader() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { loadRepo, isLoading, error, graphData } = useAppStore();

  const [path, setPath] = useState("");
  const [, startTransition] = useTransition();
  const hasRedirected = useRef(false);

  // Pre-fill the input from ?repo= on first render
  useEffect(() => {
    const repoParam = searchParams.get("repo");
    if (repoParam) {
      setPath(repoParam);
    }
  }, [searchParams]);

  // Once data is ready, transition to the dashboard route
  useEffect(() => {
    if (graphData && !isLoading && !hasRedirected.current) {
      hasRedirected.current = true;
      startTransition(() => {
        router.push(`/dashboard?repo=${encodeURIComponent(path)}`);
      });
    }
  }, [graphData, isLoading, path, router, startTransition]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = path.trim();
    if (!trimmed) return;

    // Persist to URL
    router.replace(`/?repo=${encodeURIComponent(trimmed)}`, { scroll: false });
    loadRepo(trimmed);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: "#0d0d1a" }}>
      {/* Subtle dot-grid backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(59,130,246,0.07) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Content */}
      <div className="relative z-10 w-full max-w-xl">
        {/* Logotype */}
        <div className="mb-12">
          <h1
            className="text-4xl font-bold tracking-tight"
            style={{
              color: "#e2e8f0",
              letterSpacing: "-0.03em",
            }}
          >
            Code
            <span
              style={{
                color: "#3b82f6",
              }}
            >
              Pulse
            </span>
          </h1>
          <p
            className="mt-2 text-sm"
            style={{ color: "#475569", letterSpacing: "0.02em" }}
          >
            git history &rarr; interactive force graph
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          <label
            htmlFor="repo-path"
            className="block text-xs font-medium mb-2"
            style={{ color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase" }}
          >
            Repository path
          </label>

          <div className="relative">
            {/* Input glow ring when focused */}
            <input
              id="repo-path"
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              disabled={isLoading}
              placeholder="/home/user/my-project"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="w-full rounded-none border-b-2 bg-transparent py-3 pr-4 text-sm outline-none transition-colors duration-200 placeholder:text-slate-700 disabled:opacity-40"
              style={{
                color: "#e2e8f0",
                borderColor: error ? "#ef4444" : isLoading ? "#3b82f6" : "#1e293b",
                caretColor: "#3b82f6",
              }}
              onFocus={(e) => {
                if (!error && !isLoading) e.currentTarget.style.borderColor = "#3b82f6";
              }}
              onBlur={(e) => {
                if (!error && !isLoading) e.currentTarget.style.borderColor = "#1e293b";
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <p
              className="mt-3 text-xs leading-relaxed"
              style={{ color: "#f87171" }}
              role="alert"
            >
              {error}
            </p>
          )}

          {/* Submit */}
          <div className="mt-6">
            <button
              type="submit"
              disabled={isLoading || !path.trim()}
              className="group relative inline-flex items-center gap-3 rounded-none px-6 py-3 text-sm font-medium transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "#3b82f6",
                color: "#ffffff",
              }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled)
                  e.currentTarget.style.background = "#2563eb";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#3b82f6";
              }}
            >
              {isLoading ? (
                <>
                  <Spinner />
                  Analysing&hellip;
                </>
              ) : (
                "Analyze Repository"
              )}
            </button>
          </div>
        </form>

        {/* Footer hint */}
        <p
          className="mt-16 text-xs"
          style={{ color: "#1e293b" }}
        >
          Reads your local filesystem — no data leaves your machine.
        </p>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="7"
        cy="7"
        r="5.5"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
