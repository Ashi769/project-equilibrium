"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface MatchSummary {
  id: string; name: string; age: number;
  compatibility_score: number;
  top_dimensions: { label: string; score: number }[];
}
interface ProfileStatus { analysis_status: "pending" | "processing" | "complete" | "failed" | null; }

const LOGIC_LABELS: Record<string, string[]> = {
  openness:          ["Shared High-Openness", "Aligned Intellectual Curiosity", "Mutual Appreciation for Novelty"],
  conscientiousness: ["Complementary Discipline Profiles", "Symmetric Goal Orientation", "Aligned Life Structure"],
  extraversion:      ["Compatible Social Energy", "Balanced Stimulus Thresholds", "Symmetric Social Rhythms"],
  agreeableness:     ["Shared Empathic Orientation", "Mutual Relational Warmth", "Aligned Conflict Resolution"],
  neuroticism:       ["Complementary Emotional Architectures", "Stabilizing Attachment Dynamic", "Grounded Relational Baseline"],
};

function matchLogic(dims: { label: string; score: number }[]): string[] {
  const lines: string[] = [];
  for (const d of dims.slice(0, 3)) {
    const key  = d.label.toLowerCase().replace(/\s+/g, "");
    const opts = LOGIC_LABELS[key] ?? [`Shared ${d.label}`];
    lines.push(opts[Math.floor(Math.random() * opts.length)]);
  }
  const extras = ["Complimentary Career Trajectories", "Symmetric Lifestyle Rhythms"];
  for (const e of extras) { if (lines.length < 3) lines.push(e); }
  return lines.slice(0, 3);
}

const colBgs = ["#ffffff", "#fdfbf7", "#fff9c4", "#fdfbf7", "#ffffff"];

export function SelectionClient({
  accessToken, initialStatus, initialMatches,
}: {
  accessToken: string;
  initialStatus: ProfileStatus;
  initialMatches: MatchSummary[];
}) {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const isProcessingParam = searchParams.get("processing") === "true";

  const { data: status } = useQuery({
    queryKey: ["profile-status"],
    queryFn: () => api.get<ProfileStatus>("/api/v1/profile/analysis-status", accessToken),
    initialData: initialStatus,
    refetchInterval: (q) => q.state.data?.analysis_status === "processing" ? 4000 : false,
  });

  const analysisStatus = status?.analysis_status ?? null;
  const isProcessing   = isProcessingParam || analysisStatus === "processing";
  const hasMatches     = initialMatches && initialMatches.length > 0;
  const isComplete     = analysisStatus === "complete" || (analysisStatus === "failed" && hasMatches);

  const { data: matches } = useQuery({
    queryKey: ["matches"],
    queryFn: () => api.get<MatchSummary[]>("/api/v1/matches", accessToken),
    initialData: initialMatches,
    enabled: isComplete,
  });

  /* ─── Loading states ─── */
  if (isProcessing) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-8 text-center">
        <div
          className="w-20 h-20 border-4 border-dashed border-[#2d2d2d] spin-slow"
          style={{ borderRadius: "50%" }}
        />
        <div>
          <h2 className="font-heading text-3xl font-bold" style={{ color: "var(--ink)" }}>
            Calibrating Your Selection
          </h2>
          <p className="text-base mt-2" style={{ color: "var(--muted)" }}>
            Synthesizing compatibility vectors · 1–2 minutes
          </p>
        </div>
      </div>
    );
  }

  if (analysisStatus === "failed") {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-8 text-center">
        <h2 className="font-heading text-3xl font-bold" style={{ color: "var(--ink)" }}>
          Analysis ran into an issue
        </h2>
        <p className="text-base max-w-xs" style={{ color: "var(--muted)" }}>
          Please retake the interview — this usually resolves it.
        </p>
        <Link href="/onboarding?retake=true"><Button>Retake Interview</Button></Link>
      </div>
    );
  }

  if (!isComplete) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-8 text-center">
        <div
          className="w-20 h-20 flex items-center justify-center border-2 border-[#2d2d2d] bounce-gentle"
          style={{ background: "var(--postit)", borderRadius: "var(--radius-wobbly)", boxShadow: "var(--shadow-hard)" }}
        >
          <span className="font-heading text-3xl">⚖</span>
        </div>
        <h2 className="font-heading text-3xl font-bold" style={{ color: "var(--ink)" }}>
          The interview awaits.
        </h2>
        <p className="text-base max-w-xs" style={{ color: "var(--muted)" }}>
          Complete your psychometric interview to unlock your curated selection.
        </p>
        <Link href="/onboarding"><Button>Begin Interview</Button></Link>
      </div>
    );
  }

  if (!matches || matches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-4 text-center">
        <p className="font-heading text-xl" style={{ color: "var(--muted)" }}>No selections yet.</p>
        <p className="text-base" style={{ color: "var(--dim)" }}>
          Your profile is live. Check back as more candidates join.
        </p>
      </div>
    );
  }

  const displayed = matches.slice(0, 5);

  /* ─── Main accordion view ─── */
  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-4xl font-bold" style={{ color: "var(--ink)" }}>
          Your Selection
        </h1>
        <p className="text-base mt-1" style={{ color: "var(--muted)" }}>
          {displayed.length} curated matches · hover to focus · request a meet to proceed
        </p>
      </div>

      <div className="flex gap-3 border-2 border-[#2d2d2d]" style={{ height: "520px", boxShadow: "var(--shadow-hard-lg)" }}>
        {displayed.map((match, i) => {
          const pct      = Math.round(match.compatibility_score * 100);
          const logic    = matchLogic(match.top_dimensions);
          const initials = match.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
          const isHovered = hoveredIdx === i;
          const isDimmed  = hoveredIdx !== null && !isHovered;

          return (
            <motion.div
              key={match.id}
              animate={{
                flex: isHovered ? 2.8 : isDimmed ? 0.5 : 1,
                opacity: isDimmed ? 0.4 : 1,
              }}
              transition={{ duration: 0.38, ease: [0.4, 0, 0.2, 1] }}
              className="relative flex-1 overflow-hidden cursor-pointer"
              style={{
                background: colBgs[i % colBgs.length],
                borderRight: i < displayed.length - 1 ? "2px solid #2d2d2d" : undefined,
                minWidth: 0,
              }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {/* Large watermark initials */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
                <span
                  className="font-heading font-bold"
                  style={{ fontSize: "8rem", color: "rgba(45,45,45,0.06)", lineHeight: 1 }}
                >
                  {initials}
                </span>
              </div>

              {/* Bottom content */}
              <div className="absolute inset-x-0 bottom-0 p-5">
                {/* Name + score — always visible */}
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <p className="font-heading text-lg font-bold leading-tight" style={{ color: "var(--ink)" }}>
                      {match.name}
                    </p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>{match.age} yrs</p>
                  </div>
                  <div
                    className="w-12 h-12 flex flex-col items-center justify-center border-2 border-[#2d2d2d] flex-shrink-0"
                    style={{ background: "#2d2d2d", borderRadius: "50%" }}
                  >
                    <span className="font-heading text-base font-bold text-white leading-none">{pct}</span>
                    <span className="text-[10px] text-white/80">%</span>
                  </div>
                </div>

                {/* Match logic + CTA — only on hover */}
                <motion.div
                  animate={{ opacity: isHovered ? 1 : 0, height: isHovered ? "auto" : 0 }}
                  transition={{ duration: 0.28, delay: isHovered ? 0.08 : 0 }}
                  className="overflow-hidden"
                >
                  <div className="mb-3 pt-3 border-t-2 border-dashed border-[#2d2d2d]">
                    <p className="text-xs font-medium uppercase tracking-widest mb-2" style={{ color: "var(--muted)" }}>
                      Match Logic
                    </p>
                    <ul className="space-y-1">
                      {logic.map((l) => (
                        <li key={l} className="text-sm flex items-start gap-2" style={{ color: "var(--ink)" }}>
                          <span style={{ color: "var(--muted)" }}>→</span>
                          {l}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Button
                    className="w-full"
                    size="sm"
                    onClick={() =>
                      router.push(`/schedule?match=${match.id}&name=${encodeURIComponent(match.name)}`)
                    }
                  >
                    Request Meet
                  </Button>
                </motion.div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
