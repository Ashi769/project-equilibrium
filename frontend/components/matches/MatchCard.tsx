"use client";

import Link from "next/link";
import { motion } from "framer-motion";

interface DimensionScore { label: string; score: number; }
export interface MatchSummary {
  id: string; name: string; age: number;
  compatibility_score: number; top_dimensions: DimensionScore[];
}

const rotations = ["rotate-1", "-rotate-1", "rotate-[0.5deg]", "-rotate-[0.5deg]", "rotate-1"];

export function MatchCard({ match, index }: { match: MatchSummary; index: number }) {
  const pct      = Math.round(match.compatibility_score * 100);
  const initials = match.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const rot      = rotations[index % rotations.length];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.22 }}
    >
      <Link href={`/matches/${match.id}`}>
        <div
          className={`group flex items-center gap-4 px-5 py-4 bg-white border-2 border-[#2d2d2d] cursor-pointer transition-all duration-75 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#2d2d2d] ${rot}`}
          style={{ borderRadius: "var(--radius-wobbly-alt)", boxShadow: "var(--shadow-hard)" }}
        >
          {/* Initials avatar */}
          <div
            className="w-12 h-12 flex items-center justify-center flex-shrink-0 border-2 border-[#2d2d2d]"
            style={{ background: "var(--postit)", borderRadius: "var(--radius-wobbly-sm)" }}
          >
            <span className="font-heading text-lg font-bold" style={{ color: "var(--ink)" }}>
              {initials}
            </span>
          </div>

          {/* Name + dimensions */}
          <div className="flex-1 min-w-0">
            <p className="font-heading text-lg font-bold leading-tight" style={{ color: "var(--ink)" }}>
              {match.name}
            </p>
            <p className="text-sm" style={{ color: "var(--muted)" }}>{match.age} years old</p>
            {match.top_dimensions.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {match.top_dimensions.map((d) => (
                  <span
                    key={d.label}
                    className="border-2 border-[#2d2d2d] px-2 py-0.5 text-xs"
                    style={{ borderRadius: "var(--radius-wobbly-sm)", background: "var(--muted-bg)", color: "var(--ink)" }}
                  >
                    {d.label}{" "}
                    <strong style={{ color: "#2d5da1" }}>{Math.round(d.score * 100)}%</strong>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Score circle */}
          <div
            className="flex-shrink-0 w-14 h-14 flex flex-col items-center justify-center border-2 border-[#2d2d2d]"
            style={{ background: "#2d2d2d", borderRadius: "50%", boxShadow: "var(--shadow-hard-sm)" }}
          >
            <span className="font-heading text-xl font-bold text-white leading-none">{pct}</span>
            <span className="text-xs text-white/70">%</span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
