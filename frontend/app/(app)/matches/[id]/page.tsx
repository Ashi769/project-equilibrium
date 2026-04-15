"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface DimensionScore {
  label: string;
  score: number;
  description: string;
}

interface MatchDetail {
  id: string;
  name: string;
  age: number;
  compatibility_score: number;
  dimension_scores: DimensionScore[];
  attachment_style: string;
  shared_values: string[];
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const pct = Math.round(score * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-zinc-600">{label}</span>
        <span className="font-medium text-violet-700">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-violet-500 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function MatchDetailPage() {
  const { data: session } = useSession();
  const { id } = useParams<{ id: string }>();

  const { data: match, isLoading } = useQuery({
    queryKey: ["match", id],
    queryFn: () => api.get<MatchDetail>(`/api/v1/matches/${id}`, session?.accessToken),
    enabled: !!session?.accessToken && !!id,
  });

  if (isLoading) {
    return <div className="h-64 rounded-xl bg-zinc-100 animate-pulse" />;
  }

  if (!match) {
    return (
      <div className="text-center py-20 text-zinc-500">
        Match not found.{" "}
        <Link href="/matches" className="text-violet-600 hover:underline">
          Back to matches
        </Link>
      </div>
    );
  }

  const pct = Math.round(match.compatibility_score * 100);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Link href="/matches">
        <Button variant="ghost" size="sm" className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Back to matches
        </Button>
      </Link>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-200 to-indigo-300 flex items-center justify-center text-2xl font-bold text-violet-700">
              {match.name.charAt(0)}
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-zinc-900">{match.name}</h1>
              <p className="text-zinc-500 text-sm">{match.age} years old</p>
            </div>
            <div className="text-right">
              <div className="text-4xl font-bold text-violet-600">{pct}%</div>
              <div className="text-xs text-zinc-400">compatibility</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compatibility Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {match.dimension_scores.map((d) => (
            <div key={d.label} className="space-y-1">
              <ScoreBar score={d.score} label={d.label} />
              {d.description && (
                <p className="text-xs text-zinc-400 pl-0.5">{d.description}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {match.shared_values.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Shared Values</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {match.shared_values.map((v) => (
                <Badge key={v} variant="success">{v}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Attachment Style</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant="secondary" className="text-sm px-3 py-1">
            {match.attachment_style}
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}
