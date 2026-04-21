"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const HOURS     = [9, 10, 11, 13, 14, 15, 16, 18, 19, 20];
const DAYS_AHEAD = 10;

function generateSlots() {
  const slots: { date: Date; label: string; id: string }[] = [];
  const today = new Date();
  for (let d = 1; d <= DAYS_AHEAD; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    for (const h of HOURS) {
      const slot = new Date(date);
      slot.setHours(h, 0, 0, 0);
      const label =
        date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
        ` · ${h < 12 ? h + ":00 AM" : h === 12 ? "12:00 PM" : h - 12 + ":00 PM"}`;
      slots.push({ date: slot, label, id: `${d}-${h}` });
    }
  }
  return slots;
}

const ALL_SLOTS = generateSlots();

function groupByDay(slots: typeof ALL_SLOTS) {
  const map = new Map<string, typeof ALL_SLOTS>();
  for (const s of slots) {
    const key = s.date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return map;
}
const DAY_GROUPS = groupByDay(ALL_SLOTS);

interface MeetingResponse {
  id: string; proposer_id: string; match_id: string;
  slot_1: string; slot_2: string; slot_3: string;
  locked_slot: string | null; status: string;
}

function formatSlot(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

function ScheduleInner() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const { data: session } = useSession();
  const matchName = searchParams.get("name") ?? "Your Match";
  const matchId   = searchParams.get("match") ?? "unknown";
  const token     = session?.accessToken as string | undefined;

  const { data: existingMeetings } = useQuery({
    queryKey: ["meetings-for-match", matchId],
    queryFn: () => api.get<MeetingResponse[]>("/api/v1/schedule", token!),
    enabled: !!token,
  });

  const existingMeeting = existingMeetings?.find(
    (m) =>
      (m.match_id === matchId || m.proposer_id === matchId) &&
      (m.status === "proposed" || m.status === "confirmed"),
  );

  const [selected,      setSelected]      = useState<Set<string>>(new Set());
  const [submitted,     setSubmitted]      = useState(false);
  const [proposedSlots, setProposedSlots]  = useState<string[]>([]);
  const [error,         setError]          = useState<string | null>(null);

  function toggleSlot(id: string) {
    if (submitted) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 3) next.add(id);
      return next;
    });
  }

  async function handlePropose() {
    if (selected.size < 3 || !token) return;
    setError(null);
    const selectedSlots = ALL_SLOTS.filter((s) => selected.has(s.id));
    try {
      const res = await api.post<MeetingResponse>("/api/v1/schedule/propose", {
        match_id: matchId,
        slot_1:  selectedSlots[0].date.toISOString(),
        slot_2:  selectedSlots[1].date.toISOString(),
        slot_3:  selectedSlots[2].date.toISOString(),
      }, token);
      setProposedSlots([res.slot_1, res.slot_2, res.slot_3]);
      setSubmitted(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to propose meeting");
    }
  }

  /* ─── Existing confirmed meeting ─── */
  if (existingMeeting && !submitted && existingMeeting.status === "confirmed") {
    return (
      <SuccessState
        title="Meeting Confirmed ✓"
        body={<>Session with <strong>{matchName}</strong> set for:</>}
        extra={existingMeeting.locked_slot ? formatSlot(existingMeeting.locked_slot) : "Confirmed"}
        cta={<Button onClick={() => router.push(`/meet/${matchId}?meeting=${existingMeeting.id}`)}>Enter Video Room →</Button>}
      />
    );
  }

  if (existingMeeting && !submitted) {
    const slots = [existingMeeting.slot_1, existingMeeting.slot_2, existingMeeting.slot_3];
    return (
      <SuccessState
        title="Times Proposed"
        body={<><strong>{matchName}</strong> will choose one of your proposed times.</>}
        slots={slots}
        cta={<Button variant="secondary" onClick={() => router.push("/meetings")}>View Meetings →</Button>}
      />
    );
  }

  if (submitted) {
    return (
      <SuccessState
        title="Times Proposed ✓"
        body={<><strong>{matchName}</strong> will choose one of your proposed times.</>}
        slots={proposedSlots}
        cta={<Button variant="secondary" onClick={() => router.push("/meetings")}>View Meetings →</Button>}
      />
    );
  }

  /* ─── Slot picker ─── */
  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <div
          className="inline-flex items-center px-3 py-1.5 border-2 border-[#2d2d2d] text-sm font-medium mb-3"
          style={{ borderRadius: "var(--radius-wobbly-sm)", background: "var(--muted-bg)", color: "var(--ink)" }}
        >
          Scheduling Concierge
        </div>
        <h1 className="font-heading text-4xl font-bold" style={{ color: "var(--ink)" }}>
          Propose 3 Times
        </h1>
        <p className="text-base mt-2 leading-relaxed" style={{ color: "var(--muted)" }}>
          Select exactly 3 time slots for your 30-minute session with{" "}
          <strong style={{ color: "var(--ink)" }}>{matchName}</strong>. They'll pick the one that works.
        </p>
      </div>

      {error && <p className="text-base" style={{ color: "var(--accent)" }}>{error}</p>}

      {/* Slot counter */}
      <div
        className="flex items-center justify-between py-3 px-4 border-2 border-dashed border-[#2d2d2d]"
        style={{ borderRadius: "var(--radius-wobbly-sm)" }}
      >
        <span className="text-base font-medium" style={{ color: "var(--ink)" }}>
          Slots selected: <strong style={{ color: "#2d5da1" }}>{selected.size}</strong> / 3
        </span>
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-7 h-7 flex items-center justify-center border-2 border-[#2d2d2d]"
              style={{
                borderRadius: "var(--radius-wobbly-sm)",
                background: i < selected.size ? "#2d5da1" : "white",
              }}
            >
              {i < selected.size && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
            </div>
          ))}
        </div>
      </div>

      {/* Day groups */}
      <div className="space-y-6">
        {Array.from(DAY_GROUPS.entries()).slice(0, 7).map(([day, slots]) => (
          <div key={day}>
            <p className="font-heading text-lg font-bold mb-3" style={{ color: "var(--ink)" }}>{day}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {slots.map((slot) => {
                const isSelected = selected.has(slot.id);
                const isDisabled = !isSelected && selected.size >= 3;
                return (
                  <button
                    key={slot.id}
                    onClick={() => toggleSlot(slot.id)}
                    disabled={isDisabled}
                    className="py-2.5 text-sm border-2 border-[#2d2d2d] transition-all duration-75 flex flex-col items-center"
                    style={{
                      borderRadius: "var(--radius-wobbly-sm)",
                      background: isSelected ? "#2d5da1" : "white",
                      color:      isSelected ? "white" : "#2d2d2d",
                      boxShadow:  isSelected ? "none" : "var(--shadow-hard-sm)",
                      opacity:    isDisabled ? 0.3 : 1,
                      transform:  isSelected ? "translate(2px,2px)" : undefined,
                    }}
                  >
                    {slot.label.split("·")[1]?.trim() ?? slot.label}
                    {isSelected && <Check className="h-3 w-3 mt-0.5" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <Button className="w-full" size="lg" onClick={handlePropose} disabled={selected.size < 3}>
        Propose 3 Times →
      </Button>
    </div>
  );
}

function SuccessState({
  title, body, extra, slots, cta,
}: {
  title: string;
  body: React.ReactNode;
  extra?: string;
  slots?: string[];
  cta: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-md mx-auto py-24 text-center space-y-6"
    >
      <div
        className="w-16 h-16 mx-auto flex items-center justify-center border-2 border-[#2d2d2d]"
        style={{ background: "var(--postit)", borderRadius: "50%", boxShadow: "var(--shadow-hard)" }}
      >
        {slots ? (
          <Clock className="h-8 w-8" style={{ color: "var(--ink)" }} strokeWidth={2.5} />
        ) : (
          <Check className="h-8 w-8" style={{ color: "var(--ink)" }} strokeWidth={3} />
        )}
      </div>
      <div>
        <h2 className="font-heading text-3xl font-bold" style={{ color: "var(--ink)" }}>{title}</h2>
        <p className="text-base mt-3 leading-relaxed" style={{ color: "var(--muted)" }}>{body}</p>
        {extra && (
          <p className="text-lg mt-3 font-heading font-bold" style={{ color: "var(--ink)" }}>{extra}</p>
        )}
      </div>
      {slots && (
        <div className="space-y-2 text-left max-w-xs mx-auto">
          {slots.map((s) => (
            <div
              key={s}
              className="flex items-center gap-3 px-4 py-3 border-2 border-[#2d2d2d] bg-white"
              style={{ borderRadius: "var(--radius-wobbly-sm)", boxShadow: "var(--shadow-hard-sm)" }}
            >
              <Clock className="h-4 w-4 flex-shrink-0" style={{ color: "var(--muted)" }} strokeWidth={2.5} />
              <span className="text-base" style={{ color: "var(--ink)" }}>{formatSlot(s)}</span>
            </div>
          ))}
        </div>
      )}
      {cta}
    </motion.div>
  );
}

export default function SchedulePage() {
  return (
    <Suspense>
      <ScheduleInner />
    </Suspense>
  );
}
