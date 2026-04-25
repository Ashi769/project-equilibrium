import { redirect } from "next/navigation";
import Link from "next/link";
import { InviteAcceptButton } from "./InviteAcceptButton";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface InviteInfo {
  token: string;
  inviter_name: string;
  expires_at: string;
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  let invite: InviteInfo | null = null;
  let errorMessage: string | null = null;

  try {
    const res = await fetch(
      `${API_URL}/api/v1/invitations/join/${code.toUpperCase()}`,
      { cache: "no-store" },
    );
    if (res.ok) {
      invite = await res.json();
    } else {
      const body = await res.json().catch(() => ({}));
      errorMessage = body.detail ?? "This invitation is no longer valid.";
    }
  } catch {
    errorMessage = "Could not reach the server. Please try again.";
  }

  return (
    <div className="w-full max-w-sm mx-auto px-4 space-y-6 md:space-y-8">
      <div className="text-center space-y-3">
        <div
          className="inline-flex items-center justify-center w-14 h-14 border-2 border-[#2d2d2d] mx-auto"
          style={{ borderRadius: "50%", background: "var(--postit)", boxShadow: "var(--shadow-hard-sm)" }}
        >
          <span className="font-heading text-2xl font-bold">⚖</span>
        </div>
        <div>
          <h1 className="font-heading text-4xl font-bold" style={{ color: "var(--ink)" }}>
            You&apos;re invited
          </h1>
          {invite && (
            <p className="text-base mt-1" style={{ color: "var(--muted)" }}>
              <strong style={{ color: "var(--ink)" }}>{invite.inviter_name}</strong> invited you to join Equilibrium
            </p>
          )}
        </div>
      </div>

      <div
        className="p-5 md:p-7 space-y-5 bg-white border-2 border-[#2d2d2d] rotate-[0.5deg]"
        style={{ borderRadius: "var(--radius-wobbly)", boxShadow: "var(--shadow-hard)" }}
      >
        {invite ? (
          <>
            <p className="text-sm text-center" style={{ color: "var(--muted)" }}>
              Invitation expires {new Date(invite.expires_at).toLocaleDateString("en-US", {
                month: "long", day: "numeric", year: "numeric",
              })}
            </p>

            {/* Stores code in sessionStorage, redirects to /register */}
            <InviteAcceptButton code={invite.token} />

            <div className="text-center">
              <span className="text-sm" style={{ color: "var(--dim)" }}>Already have an account?{" "}</span>
              <Link
                href={`/login?invite=${invite.token}`}
                className="text-sm font-medium underline"
                style={{ color: "#2d5da1" }}
              >
                Sign in instead
              </Link>
            </div>
          </>
        ) : (
          <div className="text-center space-y-3">
            <p className="text-sm" style={{ color: "#ff4d4d" }}>{errorMessage}</p>
            <p className="text-sm" style={{ color: "var(--dim)" }}>
              Ask the person who invited you to send a new link.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
