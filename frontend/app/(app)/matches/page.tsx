"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { MatchCard, type MatchSummary } from "@/components/matches/MatchCard";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export default function MatchesPage() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const isProcessing = searchParams.get("processing") === "true";

  const { data: matches, isLoading, error } = useQuery({
    queryKey: ["matches"],
    queryFn: () => api.get<MatchSummary[]>("/api/v1/matches", session?.accessToken),
    enabled: !!session?.accessToken && !isProcessing,
    refetchInterval: isProcessing ? 5000 : false,
  });

  if (isProcessing) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
        <div className="w-10 h-10 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">Building your profile…</h2>
          <p className="text-sm text-zinc-500 mt-1">
            We're analyzing your interview and finding your matches. This takes 1-2 minutes.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-32 rounded-xl bg-zinc-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20 text-zinc-500">
        <p>Failed to load matches. Please try again.</p>
      </div>
    );
  }

  if (!matches || matches.length === 0) {
    return (
      <div className="text-center py-20 space-y-4">
        <div className="text-4xl">⚖️</div>
        <h2 className="text-xl font-semibold text-zinc-900">No matches yet</h2>
        <p className="text-sm text-zinc-500">
          Complete your interview to get matched, or check back as more people join.
        </p>
        <Link href="/onboarding">
          <Button>Start Interview</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Your Matches</h1>
        <p className="text-sm text-zinc-500 mt-1">{matches.length} compatible people found</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {matches.map((match, i) => (
          <MatchCard key={match.id} match={match} index={i} />
        ))}
      </div>
    </div>
  );
}
