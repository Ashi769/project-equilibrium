"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { MatchCard, type MatchSummary } from "@/components/matches/MatchCard";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface ProfileStatus {
  analysis_status: "pending" | "processing" | "complete" | null;
}

export function MatchesClient({
  accessToken,
  initialStatus,
}: {
  accessToken: string;
  initialStatus: ProfileStatus;
}) {
  const searchParams = useSearchParams();
  const isProcessingParam = searchParams.get("processing") === "true";

  const { data: profile } = useQuery({
    queryKey: ["profile-status"],
    queryFn: () => api.get<ProfileStatus>("/api/v1/profile/analysis-status", accessToken),
    initialData: initialStatus,
    refetchInterval: (query) =>
      query.state.data?.analysis_status === "processing" ? 4000 : false,
  });

  const analysisStatus      = profile?.analysis_status ?? null;
  const isProcessing        = isProcessingParam || analysisStatus === "processing";
  const hasCompletedInterview = analysisStatus === "complete";

  const { data: matches, isLoading, error } = useQuery({
    queryKey: ["matches"],
    queryFn: () => api.get<MatchSummary[]>("/api/v1/matches", accessToken),
    enabled: hasCompletedInterview,
  });

  if (isProcessing) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-8 text-center">
        <div
          className="w-20 h-20 border-4 border-dashed border-[#2d2d2d] spin-slow"
          style={{ borderRadius: "50%" }}
        />
        <div>
          <h2 className="font-heading text-3xl font-bold" style={{ color: "var(--ink)" }}>
            Building your profile…
          </h2>
          <p className="text-base mt-2 max-w-xs" style={{ color: "var(--muted)" }}>
            Analyzing your interview and finding matches. Usually 1–2 minutes.
          </p>
        </div>
      </div>
    );
  }

  if (!hasCompletedInterview) {
    return (
      <div className="flex flex-col items-center justify-center py-28 gap-8 text-center">
        <div
          className="w-20 h-20 flex items-center justify-center border-2 border-[#2d2d2d] bounce-gentle"
          style={{ background: "var(--postit)", borderRadius: "var(--radius-wobbly)", boxShadow: "var(--shadow-hard)" }}
        >
          <span className="font-heading text-3xl">⚖</span>
        </div>
        <div>
          <h2 className="font-heading text-3xl font-bold" style={{ color: "var(--ink)" }}>
            Begin your interview
          </h2>
          <p className="text-base mt-2 max-w-xs" style={{ color: "var(--muted)" }}>
            A short AI conversation builds your psychometric profile and unlocks your matches.
          </p>
        </div>
        <Link href="/onboarding">
          <Button>Start Interview</Button>
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-20 border-2 border-[#e5e0d8] animate-pulse"
            style={{ borderRadius: "var(--radius-wobbly-alt)", background: "var(--surface)" }}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <p className="font-heading text-xl" style={{ color: "var(--muted)" }}>Failed to load matches.</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!matches || matches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="font-heading text-xl" style={{ color: "var(--muted)" }}>
          Your profile is ready ✓ Check back as more people join!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-4xl font-bold" style={{ color: "var(--ink)" }}>
          Your Matches
        </h1>
        <p className="text-base mt-1" style={{ color: "var(--muted)" }}>
          {matches.length} compatible {matches.length === 1 ? "person" : "people"} found ✨
        </p>
      </div>
      <div className="space-y-3">
        {matches.map((match, i) => (
          <MatchCard key={match.id} match={match} index={i} />
        ))}
      </div>
    </div>
  );
}
