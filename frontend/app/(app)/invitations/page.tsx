"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface Invitation {
  id: string;
  token: string;
  used_by: string | null;
  used_at: string | null;
  expires_at: string;
  is_expired: boolean;
  is_used: boolean;
  created_at: string;
}

interface InvitationListResponse {
  invitations: Invitation[];
  used_count: number;
  remaining: number;
  max_allowed: number;
}

function statusLabel(inv: Invitation) {
  if (inv.is_used) return { text: "Used", color: "green" };
  if (inv.is_expired) return { text: "Expired", color: "#999" };
  return { text: "Active", color: "#2d5da1" };
}

export default function InvitationsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<InvitationListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.accessToken) return;
    try {
      const res = await api.get<InvitationListResponse>("/api/v1/invitations", session.accessToken);
      setData(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        router.replace("/profile");
      } else {
        setError("Failed to load invitations.");
      }
    }
  }, [session?.accessToken, router]);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
    if (status === "authenticated") load();
  }, [status, load, router]);

  async function createInvitation() {
    if (!session?.accessToken) return;
    setCreating(true);
    setError(null);
    try {
      await api.post("/api/v1/invitations", {}, session.accessToken);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create invitation.");
    } finally {
      setCreating(false);
    }
  }

  async function revokeInvitation(id: string) {
    if (!session?.accessToken) return;
    setRevoking(id);
    try {
      await api.delete(`/api/v1/invitations/${id}`, session.accessToken);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to revoke invitation.");
    } finally {
      setRevoking(null);
    }
  }

  function inviteLink(token: string) {
    return `${window.location.origin}/join/${token}`;
  }

  async function copyLink(inv: Invitation) {
    await navigator.clipboard.writeText(inviteLink(inv.token));
    setCopiedId(inv.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  if (status === "loading" || !data) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center" style={{ color: "var(--muted)" }}>
        Loading…
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-10 space-y-8">
      <div className="space-y-1">
        <h1 className="font-heading text-3xl font-bold" style={{ color: "var(--ink)" }}>
          Your invitations
        </h1>
        <p className="text-base" style={{ color: "var(--muted)" }}>
          You can have up to <strong>{data.max_allowed}</strong> active invitations at a time.
          {data.remaining > 0
            ? ` You have ${data.remaining} slot${data.remaining !== 1 ? "s" : ""} available.`
            : " Revoke an unused one to create a new invite."}
        </p>
      </div>

      {error && (
        <div
          className="py-3 px-4 border-2 border-[#ff4d4d] text-sm"
          style={{ borderRadius: "var(--radius-wobbly-sm)", background: "rgba(255,77,77,0.05)", color: "#ff4d4d" }}
        >
          {error}
        </div>
      )}

      {data.remaining > 0 && (
        <Button onClick={createInvitation} disabled={creating}>
          {creating ? "Generating…" : "Generate invitation link"}
        </Button>
      )}

      {data.invitations.length > 0 ? (
        <div className="space-y-3">
          {data.invitations.map((inv) => {
            const { text: statusText, color: statusColor } = statusLabel(inv);
            const canRevoke = !inv.is_used && !inv.is_expired;
            return (
              <div
                key={inv.id}
                className="p-4 border-2 border-[#2d2d2d] bg-white space-y-2"
                style={{ borderRadius: "var(--radius-wobbly-sm)", boxShadow: "2px 2px 0 #2d2d2d" }}
              >
                <div className="flex items-center justify-between gap-3">
                  {/* Short code — big, monospaced, easy to read */}
                  <span
                    className="text-lg font-bold tracking-widest"
                    style={{ fontFamily: "monospace", color: "var(--ink)" }}
                  >
                    {inv.token}
                  </span>
                  <span
                    className="text-xs px-2 py-0.5 border font-medium shrink-0"
                    style={{ borderRadius: "var(--radius-wobbly-sm)", borderColor: statusColor, color: statusColor }}
                  >
                    {statusText}
                  </span>
                </div>

                <p className="text-xs" style={{ color: "var(--dim)" }}>
                  Created {new Date(inv.created_at).toLocaleDateString()}
                  {!inv.is_used && !inv.is_expired &&
                    ` · Expires ${new Date(inv.expires_at).toLocaleDateString()}`}
                  {inv.used_at &&
                    ` · Used ${new Date(inv.used_at).toLocaleDateString()}`}
                </p>

                {canRevoke && (
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={() => copyLink(inv)}
                      className="text-sm font-medium underline"
                      style={{ color: "#2d5da1" }}
                    >
                      {copiedId === inv.id ? "Copied!" : "Copy invite link"}
                    </button>
                    <span style={{ color: "var(--dim)" }}>·</span>
                    <button
                      onClick={() => revokeInvitation(inv.id)}
                      disabled={revoking === inv.id}
                      className="text-sm font-medium underline"
                      style={{ color: "#ff4d4d" }}
                    >
                      {revoking === inv.id ? "Revoking…" : "Revoke"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm" style={{ color: "var(--dim)" }}>
          No invitations yet. Generate one above to invite someone.
        </p>
      )}
    </div>
  );
}
