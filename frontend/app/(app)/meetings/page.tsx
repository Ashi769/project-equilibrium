"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Clock, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useState } from "react";

interface MeetingResponse {
  id: string;
  proposer_id: string; match_id: string;
  proposer_name: string | null; match_name: string | null;
  proposer_email: string | null; match_email: string | null;
  slot_1: string; slot_2: string; slot_3: string;
  locked_slot: string | null;
  status: "proposed" | "confirmed" | "completed" | "cancelled";
  proposer_verdict: string | null; match_verdict: string | null;
  created_at: string; is_mutual_match: boolean;
  partner_committed: boolean;
}

function formatSlot(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

export default function MeetingsPage() {
  const { data: session } = useSession();
  const token  = session?.accessToken as string | undefined;
  const userId = session?.userId      as string | undefined;
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: meetings, isLoading } = useQuery({
    queryKey: ["meetings"],
    queryFn: () => api.get<MeetingResponse[]>("/api/v1/schedule", token!),
    enabled: !!token,
    refetchInterval: 10000,
  });

  if (isLoading || !meetings) {
    return (
      <div className="max-w-2xl mx-auto py-16 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse border-2 border-[#e5e0d8]"
            style={{ borderRadius: "var(--radius-wobbly-alt)", background: "var(--surface)" }}
          />
        ))}
      </div>
    );
  }

  const incoming    = meetings.filter((m) => m.match_id === userId && m.status === "proposed");
  const confirmed   = meetings.filter((m) => m.status === "confirmed");
  const outgoing    = meetings.filter((m) => m.proposer_id === userId && m.status === "proposed");
  const connections = meetings.filter((m) => m.is_mutual_match);
  const past        = meetings.filter((m) => (m.status === "completed" && !m.is_mutual_match) || m.status === "cancelled");
  const declined   = meetings.filter((m) => {
    if (m.status !== "completed") return false;
    if (m.is_mutual_match) return false;
    const myVerdict   = m.proposer_id === userId ? m.proposer_verdict : m.match_verdict;
    const theirVerdict = m.proposer_id === userId ? m.match_verdict : m.proposer_verdict;
    return myVerdict === "commit" && theirVerdict === "pool";
  });

  if (meetings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-4 text-center">
        <p className="font-heading text-2xl font-bold" style={{ color: "var(--muted)" }}>No meetings yet.</p>
        <p className="text-base" style={{ color: "var(--dim)" }}>
          Request a meet from your selection to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-10">
      <div>
        <div
          className="inline-flex items-center px-3 py-1.5 border-2 border-[#2d2d2d] text-sm font-medium mb-3"
          style={{ borderRadius: "var(--radius-wobbly-sm)", background: "var(--muted-bg)", color: "var(--ink)" }}
        >
          Scheduling
        </div>
        <h1 className="font-heading text-4xl font-bold" style={{ color: "var(--ink)" }}>Your Meetings</h1>
      </div>

      {connections.length > 0 && (
        <Section title="Connections 🎉" count={connections.length}>
          {connections.map((m) => <ConnectionCard key={m.id} meeting={m} userId={userId!} />)}
        </Section>
      )}

      {incoming.length > 0 && (
        <Section title="Incoming Proposals" count={incoming.length}>
          {incoming.map((m) => (
            <IncomingCard key={m.id} meeting={m} token={token!} queryClient={queryClient} />
          ))}
        </Section>
      )}

      {confirmed.length > 0 && (
        <Section title="Confirmed" count={confirmed.length}>
          {confirmed.map((m) => <ConfirmedCard key={m.id} meeting={m} userId={userId!} router={router} />)}
        </Section>
      )}

      {outgoing.length > 0 && (
        <Section title="Awaiting Response" count={outgoing.length}>
          {outgoing.map((m) => <OutgoingCard key={m.id} meeting={m} />)}
        </Section>
      )}

      {past.length > 0 && (
        <Section title="Past" count={past.length}>
          {past.map((m) => <PastCard key={m.id} meeting={m} userId={userId!} />)}
        </Section>
      )}

      {declined.length > 0 && (
        <Section title="They Returned to Pool" count={declined.length}>
          {declined.map((m) => <DeclinedCard key={m.id} meeting={m} userId={userId!} />)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="font-heading text-xl font-bold" style={{ color: "var(--ink)" }}>{title}</h2>
        <span
          className="text-sm font-medium px-2.5 py-0.5 border-2 border-[#2d2d2d]"
          style={{ borderRadius: "var(--radius-wobbly-sm)", background: "var(--postit)", color: "var(--ink)" }}
        >
          {count}
        </span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function IncomingCard({ meeting, token, queryClient }: {
  meeting: MeetingResponse;
  token: string;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [locking, setLocking] = useState<string | null>(null);

  const lockMutation = useMutation({
    mutationFn: (slotIso: string) =>
      api.post<MeetingResponse>("/api/v1/schedule/lock", { meeting_id: meeting.id, locked_slot: slotIso }, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["meetings-nav"] });
    },
  });

  const slots = [
    { iso: meeting.slot_1, label: formatSlot(meeting.slot_1) },
    { iso: meeting.slot_2, label: formatSlot(meeting.slot_2) },
    { iso: meeting.slot_3, label: formatSlot(meeting.slot_3) },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-5 border-[3px] border-[#ff4d4d] bg-white"
      style={{ borderRadius: "var(--radius-wobbly-alt)", boxShadow: "4px 4px 0px 0px #ff4d4d" }}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="font-heading text-xl font-bold" style={{ color: "var(--ink)" }}>
            {meeting.proposer_name ?? "Someone"}
          </p>
          <p className="text-base" style={{ color: "var(--muted)" }}>wants to meet you — pick a time</p>
        </div>
        <span
          className="text-sm font-medium px-2.5 py-1 border-2 border-[#ff4d4d]"
          style={{ borderRadius: "var(--radius-wobbly-sm)", background: "rgba(255,77,77,0.08)", color: "var(--accent)" }}
        >
          New!
        </span>
      </div>
      <div className="space-y-2">
        {slots.map((slot) => (
          <button
            key={slot.iso}
            onClick={() => { setLocking(slot.iso); lockMutation.mutate(slot.iso); }}
            disabled={lockMutation.isPending}
            className="w-full text-left px-4 py-3 flex items-center justify-between border-2 border-[#2d2d2d] bg-white transition-all duration-75 hover:bg-[#2d5da1] hover:text-white hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
            style={{
              borderRadius: "var(--radius-wobbly-sm)",
              boxShadow: "var(--shadow-hard-sm)",
              opacity: lockMutation.isPending && locking !== slot.iso ? 0.4 : 1,
              background: locking === slot.iso && lockMutation.isPending ? "rgba(255,77,77,0.08)" : undefined,
            }}
          >
            <div>
              <p className="text-base font-medium">{slot.label}</p>
              <p className="text-sm" style={{ color: "inherit", opacity: 0.7 }}>30-minute session</p>
            </div>
            <span className="text-sm font-medium">
              {locking === slot.iso && lockMutation.isPending ? "Locking…" : "Select →"}
            </span>
          </button>
        ))}
      </div>
      {lockMutation.isError && (
        <p className="text-sm mt-3" style={{ color: "var(--accent)" }}>Failed to lock slot. Try again.</p>
      )}
    </motion.div>
  );
}

function ConfirmedCard({ meeting, userId, router }: {
  meeting: MeetingResponse;
  userId: string;
  router: ReturnType<typeof useRouter>;
}) {
  const otherName = meeting.proposer_id === userId ? meeting.match_name : meeting.proposer_name;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-5 flex items-center justify-between border-[3px] border-[#2d5da1] bg-white"
      style={{ borderRadius: "var(--radius-wobbly-alt)", boxShadow: "4px 4px 0px 0px #2d5da1" }}
    >
      <div>
        <p className="font-heading text-xl font-bold" style={{ color: "var(--ink)" }}>
          {otherName ?? "Match"}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <Check className="h-4 w-4" style={{ color: "var(--secondary)" }} strokeWidth={2.5} />
          <p className="text-base font-medium" style={{ color: "var(--secondary)" }}>
            {meeting.locked_slot ? formatSlot(meeting.locked_slot) : "Confirmed"}
          </p>
        </div>
      </div>
      <Button
        onClick={() =>
          router.push(
            `/meet/${meeting.proposer_id === userId ? meeting.match_id : meeting.proposer_id}?meeting=${meeting.id}`
          )
        }
        className="gap-2"
      >
        <Video className="h-4 w-4" strokeWidth={2.5} />
        Enter Room
      </Button>
    </motion.div>
  );
}

function OutgoingCard({ meeting }: { meeting: MeetingResponse }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-5 border-2 border-dashed border-[#2d2d2d] bg-white"
      style={{ borderRadius: "var(--radius-wobbly)", boxShadow: "var(--shadow-hard-sm)" }}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-heading text-xl font-bold" style={{ color: "var(--ink)" }}>
            {meeting.match_name ?? "Match"}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <Clock className="h-3.5 w-3.5" style={{ color: "var(--muted)" }} strokeWidth={2.5} />
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {meeting.partner_committed 
                ? "They committed — awaiting your response" 
                : "Waiting for them to pick a time"}
            </p>
          </div>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {[meeting.slot_1, meeting.slot_2, meeting.slot_3].map((s) => (
          <span
            key={s}
            className="text-sm px-3 py-1.5 border-2 border-[#2d2d2d]"
            style={{ borderRadius: "var(--radius-wobbly-sm)", color: "var(--muted)", background: "var(--muted-bg)" }}
          >
            {formatSlot(s)}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

function ConnectionCard({ meeting, userId }: { meeting: MeetingResponse; userId: string }) {
  const otherName  = meeting.proposer_id === userId ? meeting.match_name  : meeting.proposer_name;
  const otherEmail = meeting.proposer_id === userId ? meeting.match_email : meeting.proposer_email;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-5 border-[3px] border-[#2d2d2d]"
      style={{
        borderRadius: "var(--radius-wobbly-alt)",
        background: "var(--postit)",
        boxShadow: "var(--shadow-hard-lg)",
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="font-heading text-xl font-bold" style={{ color: "var(--ink)" }}>
              {otherName ?? "Match"}
            </p>
            <span
              className="text-xs font-bold px-2 py-0.5 border-2 border-[#2d2d2d] text-white"
              style={{ borderRadius: "var(--radius-wobbly-sm)", background: "var(--accent)" }}
            >
              Mutual ✓
            </span>
          </div>
          <p className="text-base" style={{ color: "var(--muted)" }}>
            You both committed — this is a match!
          </p>
          {otherEmail && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm" style={{ color: "var(--ink)" }}>Reach out:</span>
              <a
                href={`mailto:${otherEmail}`}
                className="text-base font-medium underline transition-colors"
                style={{ color: "var(--secondary)" }}
              >
                {otherEmail}
              </a>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function PastCard({ meeting, userId }: { meeting: MeetingResponse; userId: string }) {
  const otherName = meeting.proposer_id === userId ? meeting.match_name : meeting.proposer_name;
  const myVerdict = meeting.proposer_id === userId ? meeting.proposer_verdict : meeting.match_verdict;
  return (
    <div
      className="p-5 flex items-center justify-between border-2 border-[#e5e0d8] bg-white"
      style={{ borderRadius: "var(--radius-wobbly-alt)", opacity: 0.55 }}
    >
      <div>
        <p className="font-heading text-lg font-bold" style={{ color: "var(--ink)" }}>{otherName ?? "Match"}</p>
        <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>
          {meeting.status === "completed" ? `Verdict: ${myVerdict ?? "—"}` : "Cancelled"}
        </p>
      </div>
      <span
        className="text-xs font-medium uppercase tracking-wide px-2 py-1 border-2 border-[#e5e0d8]"
        style={{ borderRadius: "var(--radius-wobbly-sm)", color: "var(--dim)" }}
      >
        {meeting.status}
      </span>
    </div>
  );
}

function DeclinedCard({ meeting, userId }: { meeting: MeetingResponse; userId: string }) {
  const otherName = meeting.proposer_id === userId ? meeting.match_name : meeting.proposer_name;
  const theirVerdict = meeting.proposer_id === userId ? meeting.match_verdict : meeting.proposer_verdict;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-5 border-[3px] border-[#ff6b6b] bg-white"
      style={{ borderRadius: "var(--radius-wobbly-alt)", boxShadow: "4px 4px 0px 0px #ff6b6b" }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="font-heading text-xl font-bold" style={{ color: "var(--ink)" }}>
            {otherName ?? "Match"}
          </p>
          <p className="text-base mt-1" style={{ color: "var(--muted)" }}>
            They returned to pool after you committed
          </p>
        </div>
        <span
          className="text-xs font-bold px-2 py-1 border-2 border-[#ff6b6b] text-white"
          style={{ borderRadius: "var(--radius-wobbly-sm)", background: "#ff6b6b" }}
        >
          Returned to Pool
        </span>
      </div>
    </motion.div>
  );
}
