"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function Home() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/selection");
    }
  }, [status, router]);

  if (status === "loading") {
    return null;
  }

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "var(--paper)" }}>
      {/* Nav */}
      <header className="px-8 h-16 flex items-center justify-between border-b-2 border-[#2d2d2d] bg-[#fdfbf7]">
        <div className="flex items-center gap-2">
          <span className="font-heading text-2xl font-bold" style={{ color: "var(--ink)" }}>⚖</span>
          <span className="font-heading text-xl font-bold tracking-wide" style={{ color: "var(--ink)" }}>
            Equilibrium
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center relative overflow-hidden">
        <div className="relative max-w-3xl mx-auto space-y-10">
          {/* Post-it tag */}
          <div className="flex justify-center">
            <div
              className="inline-flex items-center gap-2 px-4 py-2 border-2 border-[#2d2d2d] text-sm font-medium -rotate-1"
              style={{
                borderRadius: "var(--radius-wobbly-sm)",
                background: "var(--postit)",
                boxShadow: "var(--shadow-hard-sm)",
              }}
            >
              ✏️ Psychometric Matching
            </div>
          </div>

          {/* Headline */}
          <div className="space-y-5">
            <h1
              className="font-heading font-bold leading-[1.08]"
              style={{ fontSize: "clamp(2.8rem, 7vw, 5.5rem)", color: "var(--ink)" }}
            >
              Find someone who{" "}
              <span className="relative inline-block">
                <em className="not-italic" style={{ color: "var(--accent)" }}>actually fits</em>
                {/* Hand-drawn wavy underline */}
                <svg
                  className="absolute -bottom-2 left-0 w-full overflow-visible"
                  viewBox="0 0 200 10"
                  preserveAspectRatio="none"
                  style={{ height: "10px" }}
                >
                  <path
                    d="M0,5 Q25,0 50,5 Q75,10 100,5 Q125,0 150,5 Q175,10 200,5"
                    stroke="#ff4d4d"
                    strokeWidth="3"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </h1>
            <p className="text-lg md:text-xl max-w-xl mx-auto leading-relaxed" style={{ color: "var(--muted)" }}>
              No swiping. No photo-first matching.
              An AI interview builds your psychometric profile—so we match you beyond just looks.
            </p>
          </div>

          {/* CTAs */}
          <div className="relative flex items-center justify-center gap-4 flex-wrap">
            <Link href="/register">
              <Button size="lg">Begin Application</Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="secondary">Sign In</Button>
            </Link>
          </div>

          {/* Dashed divider */}
          <div className="flex items-center gap-5">
            <div className="flex-1 border-t-2 border-dashed border-[#e5e0d8]" />
            <span
              className="text-sm font-medium px-3 py-1 border-2 border-dashed border-[#e5e0d8]"
              style={{ borderRadius: "var(--radius-wobbly-sm)", color: "var(--dim)", background: "var(--paper)" }}
            >
              The Process
            </span>
            <div className="flex-1 border-t-2 border-dashed border-[#e5e0d8]" />
          </div>

          {/* Steps */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
            {[
              {
                n: "01",
                title: "Visual Audit",
                desc: "Photos assessed for presentation quality and peer-bracket calibration.",
                rotate: "rotate-1",
                bg: "var(--postit)",
              },
              {
                n: "02",
                title: "Interview",
                desc: "AI interview extracts OCEAN scores, attachment style, and values profile.",
                rotate: "-rotate-1",
                bg: "var(--surface)",
              },
              {
                n: "03",
                title: "Selection",
                desc: "Top 5 peer-bracketed matches presented. 30-minute monitored video session.",
                rotate: "rotate-1",
                bg: "var(--surface)",
              },
            ].map((s) => (
              <div
                key={s.n}
                className={`p-6 border-2 border-[#2d2d2d] ${s.rotate}`}
                style={{
                  borderRadius: "var(--radius-wobbly-alt)",
                  boxShadow: "var(--shadow-hard)",
                  background: s.bg,
                }}
              >
                <p
                  className="font-heading text-4xl font-bold mb-3"
                  style={{ color: "var(--accent)" }}
                >
                  {s.n}
                </p>
                <p className="font-heading text-lg font-bold mb-2" style={{ color: "var(--ink)" }}>
                  {s.title}
                </p>
                <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
