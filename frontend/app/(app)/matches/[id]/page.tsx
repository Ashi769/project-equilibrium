import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface DimensionScore { label: string; score: number; description: string; }
interface MatchDetail {
  id: string; name: string; age: number; compatibility_score: number;
  dimension_scores: DimensionScore[]; attachment_style: string; shared_values: string[];
}

function ScoreBar({ score, label, description }: { score: number; label: string; description?: string }) {
  const pct = Math.round(score * 100);
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-baseline">
        <span className="text-base" style={{ color: "var(--ink)" }}>{label}</span>
        <span className="font-heading text-xl font-bold" style={{ color: "var(--accent)" }}>{pct}%</span>
      </div>
      {/* Hand-drawn progress bar */}
      <div
        className="h-4 border-2 border-[#2d2d2d] overflow-hidden"
        style={{ borderRadius: "var(--radius-wobbly-sm)", background: "var(--muted-bg)" }}
      >
        <div
          className="h-full transition-all duration-700"
          style={{ width: `${pct}%`, background: "var(--accent)" }}
        />
      </div>
      {description && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>{description}</p>
      )}
    </div>
  );
}

export default async function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.accessToken) redirect("/login");

  const { id } = await params;
  const res = await fetch(`${API_URL}/api/v1/matches/${id}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });

  if (res.status === 404) notFound();
  if (!res.ok) redirect("/matches");

  const match: MatchDetail = await res.json();
  const pct      = Math.round(match.compatibility_score * 100);
  const initials = match.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="max-w-xl mx-auto space-y-5 pb-10">
      <Link
        href="/matches"
        className="inline-flex items-center gap-1.5 text-base font-medium transition-colors"
        style={{ color: "var(--muted)" }}
        onMouseEnter={undefined}
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
        Back to Matches
      </Link>

      {/* Hero card */}
      <div
        className="p-6 bg-white border-2 border-[#2d2d2d] rotate-[0.5deg]"
        style={{ borderRadius: "var(--radius-wobbly-alt)", boxShadow: "var(--shadow-hard)" }}
      >
        <div className="flex items-center gap-5">
          <div
            className="w-16 h-16 flex items-center justify-center flex-shrink-0 border-2 border-[#2d2d2d]"
            style={{ background: "var(--postit)", borderRadius: "var(--radius-wobbly-sm)" }}
          >
            <span className="font-heading text-2xl font-bold" style={{ color: "var(--ink)" }}>
              {initials}
            </span>
          </div>
          <div className="flex-1">
            <h1 className="font-heading text-3xl font-bold leading-tight" style={{ color: "var(--ink)" }}>
              {match.name}
            </h1>
            <p className="text-base mt-0.5" style={{ color: "var(--muted)" }}>{match.age} years old</p>
          </div>
          {/* Score badge */}
          <div
            className="flex-shrink-0 w-20 h-20 flex flex-col items-center justify-center border-2 border-[#2d2d2d]"
            style={{ background: "var(--accent)", borderRadius: "50%", boxShadow: "var(--shadow-hard)" }}
          >
            <span className="font-heading text-3xl font-bold text-white leading-none">{pct}</span>
            <span className="text-xs text-white/80 font-medium">match</span>
          </div>
        </div>
      </div>

      {/* Compatibility breakdown */}
      {match.dimension_scores.length > 0 && (
        <div
          className="p-6 bg-white border-2 border-[#2d2d2d] -rotate-[0.5deg]"
          style={{ borderRadius: "var(--radius-wobbly)", boxShadow: "var(--shadow-hard)" }}
        >
          <p className="font-heading text-lg font-bold mb-5" style={{ color: "var(--ink)" }}>
            Compatibility Breakdown
          </p>
          <div className="space-y-5">
            {match.dimension_scores.map((d) => (
              <ScoreBar key={d.label} score={d.score} label={d.label} description={d.description} />
            ))}
          </div>
        </div>
      )}

      {/* Shared values */}
      {match.shared_values.length > 0 && (
        <div
          className="p-6 bg-white border-2 border-[#2d2d2d] rotate-[0.3deg]"
          style={{ borderRadius: "var(--radius-wobbly-alt)", boxShadow: "var(--shadow-hard)" }}
        >
          <p className="font-heading text-lg font-bold mb-4" style={{ color: "var(--ink)" }}>Shared Values</p>
          <div className="flex flex-wrap gap-2">
            {match.shared_values.map((v) => (
              <span
                key={v}
                className="px-3 py-1.5 text-base border-2 border-[#2d2d2d]"
                style={{
                  borderRadius: "var(--radius-wobbly-sm)",
                  background: "var(--postit)",
                  color: "var(--ink)",
                  boxShadow: "var(--shadow-hard-sm)",
                }}
              >
                {v}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Attachment style */}
      <div
        className="p-6 bg-white border-2 border-[#2d2d2d] -rotate-[0.3deg]"
        style={{ borderRadius: "var(--radius-wobbly-sm)", boxShadow: "var(--shadow-hard)" }}
      >
        <p className="font-heading text-lg font-bold mb-4" style={{ color: "var(--ink)" }}>Attachment Style</p>
        <span
          className="inline-flex px-4 py-2 text-base font-medium border-2 border-[#2d5da1]"
          style={{
            borderRadius: "var(--radius-wobbly-sm)",
            background: "rgba(45,93,161,0.08)",
            color: "var(--secondary)",
            boxShadow: "2px 2px 0px 0px #2d5da1",
          }}
        >
          {match.attachment_style}
        </span>
      </div>
    </div>
  );
}
