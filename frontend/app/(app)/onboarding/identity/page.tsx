"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

const INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h — discard stale sessionStorage entries

const schema = z.object({
  age: z.number().int().min(18, "Must be 18 or older").max(100),
  gender: z.enum(["man", "woman", "non-binary", "other"]).refine(Boolean, "Please select your gender"),
  invitation_token: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

const wobblySelect: React.CSSProperties = {
  height: "3rem",
  width: "100%",
  border: "2px solid #2d2d2d",
  background: "#ffffff",
  color: "#2d2d2d",
  padding: "0 0.75rem",
  fontSize: "1rem",
  outline: "none",
  fontFamily: "'Patrick Hand', system-ui, sans-serif",
  borderRadius: "var(--radius-wobbly-sm)",
  boxShadow: "2px 2px 0px 0px #2d2d2d",
  appearance: "auto",
};

export default function IdentityPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const selectedGender = watch("gender");

  // Read invite code from sessionStorage on mount
  useEffect(() => {
    const code = sessionStorage.getItem("pending_invite");
    const ts = Number(sessionStorage.getItem("pending_invite_ts") ?? "0");
    if (code && Date.now() - ts < INVITE_TTL_MS) {
      setPendingInvite(code);
      setValue("invitation_token", code);
      setValue("gender", "man");
    }
  }, [setValue]);

  async function onSubmit(data: FormData) {
    if (status !== "authenticated" || !session?.accessToken) {
      router.replace("/login");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await api.patch(
        "/api/v1/profile",
        {
          attributes: { age: data.age, gender: data.gender },
          ...(data.invitation_token ? { invitation_token: data.invitation_token } : {}),
        },
        session.accessToken,
      );

      // Clear the invite from sessionStorage — it's been consumed
      sessionStorage.removeItem("pending_invite");
      sessionStorage.removeItem("pending_invite_ts");

      // Update the NextAuth JWT so middleware sees the new gender immediately
      await update({ gender: data.gender });

      router.push("/onboarding");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="max-w-sm mx-auto px-4 py-12 text-center" style={{ color: "var(--muted)" }}>
        Loading…
      </div>
    );
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
            About you
          </h1>
          <p className="text-base mt-1" style={{ color: "var(--muted)" }}>
            Two quick things before we get started
          </p>
        </div>
      </div>

      <div
        className="p-5 md:p-7 space-y-4 md:space-y-5 bg-white border-2 border-[#2d2d2d] rotate-[0.5deg]"
        style={{ borderRadius: "var(--radius-wobbly)", boxShadow: "var(--shadow-hard)" }}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Age</label>
              <Input type="number" placeholder="25" {...register("age", { valueAsNumber: true })} />
              {errors.age && <p className="text-sm" style={{ color: "var(--accent)" }}>{errors.age.message}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Gender</label>
              <select style={wobblySelect} {...register("gender")}>
                <option value="">Select…</option>
                <option value="man">Man</option>
                <option value="woman">Woman</option>
                <option value="non-binary">Non-binary</option>
                <option value="other">Other</option>
              </select>
              {errors.gender && <p className="text-sm" style={{ color: "var(--accent)" }}>{errors.gender.message}</p>}
            </div>
          </div>

          {selectedGender === "man" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>
                Invitation code
                {pendingInvite && (
                  <span
                    className="ml-2 text-xs px-1.5 py-0.5 border font-medium"
                    style={{ borderRadius: "var(--radius-wobbly-sm)", borderColor: "green", color: "green" }}
                  >
                    Found
                  </span>
                )}
              </label>
              <Input
                placeholder="e.g. K7X2MQ4N"
                style={{ fontFamily: "monospace", letterSpacing: "0.1em" }}
                {...register("invitation_token")}
              />
              {!pendingInvite && (
                <p className="text-xs" style={{ color: "var(--dim)" }}>
                  Ask the woman who invited you to share their invitation link.
                </p>
              )}
            </div>
          )}

          {error && (
            <div
              className="py-3 px-4 border-2 border-[#ff4d4d] text-sm text-center"
              style={{ borderRadius: "var(--radius-wobbly-sm)", background: "rgba(255,77,77,0.05)", color: "#ff4d4d" }}
            >
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isLoading || status !== "authenticated"}>
            {isLoading ? "Saving…" : "Continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}
