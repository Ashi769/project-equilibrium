"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface DimensionScore {
  label: string;
  score: number;
}

export interface MatchSummary {
  id: string;
  name: string;
  age: number;
  compatibility_score: number;
  top_dimensions: DimensionScore[];
}

export function MatchCard({ match, index }: { match: MatchSummary; index: number }) {
  const pct = Math.round(match.compatibility_score * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Link href={`/matches/${match.id}`}>
        <Card className="hover:shadow-md transition-shadow cursor-pointer group">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-200 to-indigo-300 flex items-center justify-center text-lg font-semibold text-violet-700 flex-shrink-0">
                  {match.name.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold text-zinc-900 group-hover:text-violet-700 transition-colors">
                    {match.name}
                  </p>
                  <p className="text-sm text-zinc-400">{match.age} years old</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-2xl font-bold text-violet-600">{pct}%</div>
                <div className="text-xs text-zinc-400">compatibility</div>
              </div>
            </div>

            {match.top_dimensions.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {match.top_dimensions.map((d) => (
                  <Badge key={d.label} variant="default">
                    {d.label} {Math.round(d.score * 100)}%
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}
