"use client";

import { signOut } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { Camera, CheckCircle2, Clock, AlertCircle, RefreshCw, LogOut, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

interface UserPhoto { id: string; filename: string; is_selfie: boolean; }
interface UserProfile {
  id: string; name: string; email: string; age: number | null; gender: string | null;
  analysis_status: "pending" | "processing" | "complete" | null;
  hard_filters: { wants_children?: boolean | null; max_age_diff?: number; seeking_gender?: string[]; };
  reinterview_due?: boolean;
  reinterview_due_at?: string | null;
}

const hardFiltersSchema = z.object({
  wants_children: z.enum(["yes", "no", "open"]),
  max_age_diff:   z.number().int().min(1).max(30),
  seeking_gender: z.string(),
});
type HardFiltersForm = z.infer<typeof hardFiltersSchema>;

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
};

export function ProfileForm({
  accessToken, initialProfile, initialPhotos,
}: {
  accessToken: string; initialProfile: UserProfile; initialPhotos: UserPhoto[];
}) {
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.get<UserProfile>("/api/v1/profile", accessToken),
    initialData: initialProfile,
  });

  const { data: photos } = useQuery({
    queryKey: ["photos"],
    queryFn: () => api.get<UserPhoto[]>("/api/v1/photos", accessToken),
    initialData: initialPhotos,
  });

  const selfie       = photos?.find((p) => p.is_selfie);
  const galleryPhotos = photos?.filter((p) => !p.is_selfie) ?? [];

  const updateMutation = useMutation({
    mutationFn: (data: Partial<UserProfile["hard_filters"]>) =>
      api.patch("/api/v1/profile", { hard_filters: data }, accessToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });

  const reinterviewMutation = useMutation({
    mutationFn: () => api.post("/api/v1/interview/reset", {}, accessToken),
  });

  const { register, handleSubmit } = useForm<HardFiltersForm>({
    resolver: zodResolver(hardFiltersSchema),
    defaultValues: { wants_children: "open", max_age_diff: 10, seeking_gender: "any" },
  });

  const initials = profile.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  const statusMap = {
    complete:   { icon: CheckCircle2, label: "Profile ready", color: "var(--secondary)", bg: "rgba(45,93,161,0.08)"  },
    processing: { icon: Clock,        label: "Processing",    color: "#60a5fa",          bg: "rgba(96,165,250,0.08)" },
    pending:    { icon: AlertCircle,  label: "Not started",   color: "var(--muted)",     bg: "var(--muted-bg)"       },
  } as const;
  const st       = statusMap[(profile.analysis_status as keyof typeof statusMap) ?? "pending"] ?? statusMap.pending;
  const StatusIcon = st.icon;

  return (
    <div className="max-w-lg mx-auto space-y-5 pb-10">

      {/* Identity card */}
      <div
        className="p-6 bg-white border-2 border-[#2d2d2d]"
        style={{ borderRadius: "var(--radius-wobbly-alt)", boxShadow: "var(--shadow-hard)" }}
      >
        <div className="flex items-center gap-4">
          {selfie ? (
            <img
              src={`/api/photos/${selfie.filename}`}
              alt="Selfie"
              className="w-14 h-14 flex-shrink-0 object-cover border-2 border-[#2d2d2d]"
              style={{ borderRadius: "var(--radius-wobbly-sm)" }}
            />
          ) : (
            <div
              className="w-14 h-14 flex items-center justify-center flex-shrink-0 border-2 border-[#2d2d2d]"
              style={{ background: "var(--postit)", borderRadius: "var(--radius-wobbly-sm)" }}
            >
              <span className="font-heading text-xl font-bold" style={{ color: "var(--ink)" }}>
                {initials}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-heading text-2xl font-bold leading-tight" style={{ color: "var(--ink)" }}>
              {profile.name}
            </h1>
            <p className="text-sm mt-0.5 truncate" style={{ color: "var(--muted)" }}>
              {profile.email}{profile.age ? ` · ${profile.age} yrs` : ""}
            </p>
          </div>
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border-2 flex-shrink-0 text-sm font-medium"
            style={{
              borderColor: st.color,
              background: st.bg,
              color: st.color,
              borderRadius: "var(--radius-wobbly-sm)",
            }}
          >
            <StatusIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
            {st.label}
          </div>
        </div>
      </div>

      {/* Photos card */}
      <div
        className="bg-white border-2 border-[#2d2d2d] overflow-hidden"
        style={{ borderRadius: "var(--radius-wobbly)", boxShadow: "var(--shadow-hard)" }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b-2 border-dashed border-[#e5e0d8]">
          <span className="font-heading text-lg font-bold" style={{ color: "var(--ink)" }}>Photos</span>
          <Link href="/onboarding">
            <button
              className="flex items-center gap-1.5 text-sm font-medium transition-colors"
              style={{ color: "var(--muted)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#2d5da1")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
            >
              <Camera className="h-3.5 w-3.5" strokeWidth={2.5} />
              Update
            </button>
          </Link>
        </div>
        <div className="p-5">
          {photos && photos.length > 0 ? (
            <div className="grid grid-cols-4 gap-2">
              {galleryPhotos.map((photo) => (
                <div
                  key={photo.id}
                  className="aspect-square overflow-hidden border-2 border-[#2d2d2d]"
                  style={{ borderRadius: "var(--radius-wobbly-sm)", background: "var(--muted-bg)" }}
                >
                  <img src={`/api/photos/${photo.filename}`} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          ) : (
            <div
              className="flex flex-col items-center py-8 gap-3 border-2 border-dashed border-[#2d2d2d]"
              style={{ borderRadius: "var(--radius-wobbly-sm)" }}
            >
              <Camera className="h-7 w-7" style={{ color: "var(--muted)" }} strokeWidth={2.5} />
              <p className="text-base" style={{ color: "var(--muted)" }}>No photos uploaded yet</p>
              <Link href="/onboarding">
                <Button size="sm" variant="secondary">Upload Photos</Button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Match preferences */}
      <div
        className="bg-white border-2 border-[#2d2d2d] overflow-hidden"
        style={{ borderRadius: "var(--radius-wobbly-alt)", boxShadow: "var(--shadow-hard)" }}
      >
        <div className="px-6 py-4 border-b-2 border-dashed border-[#e5e0d8]">
          <span className="font-heading text-lg font-bold" style={{ color: "var(--ink)" }}>Match Preferences</span>
        </div>
        <div className="p-5">
          <form
            onSubmit={handleSubmit((data) =>
              updateMutation.mutate({
                wants_children: data.wants_children === "yes" ? true : data.wants_children === "no" ? false : null,
                max_age_diff:   data.max_age_diff,
                seeking_gender: data.seeking_gender === "any" ? [] : [data.seeking_gender],
              })
            )}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Wants children</label>
                <select style={wobblySelect} {...register("wants_children")}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="open">Open to it</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Seeking</label>
                <select style={wobblySelect} {...register("seeking_gender")}>
                  <option value="any">Anyone</option>
                  <option value="man">Men</option>
                  <option value="woman">Women</option>
                  <option value="non-binary">Non-binary</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Max age difference</label>
              <div className="flex items-center gap-3">
                <Input type="number" className="w-24" {...register("max_age_diff", { valueAsNumber: true })} />
                <span className="text-base" style={{ color: "var(--muted)" }}>years</span>
              </div>
            </div>
            <Button type="submit" size="sm" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save Preferences"}
            </Button>
          </form>
        </div>
      </div>

      {/* Profile refresh nudge */}
      {profile.reinterview_due && (
        <div
          className="flex items-center gap-3 px-5 py-4 border-2 border-[#ff4d4d]"
          style={{ borderRadius: "var(--radius-wobbly-sm)", background: "rgba(255,77,77,0.05)" }}
        >
          <AlertCircle className="h-5 w-5 flex-shrink-0" style={{ color: "var(--accent)" }} strokeWidth={2.5} />
          <div className="flex-1">
            <p className="text-base font-medium" style={{ color: "var(--accent)" }}>Profile refresh recommended</p>
            <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>
              Your profile is over 9 months old. Retake the interview to keep your matches accurate.
            </p>
          </div>
        </div>
      )}

      {/* Retake interview */}
      <Link href="/onboarding?retake=true">
        <button
          onClick={() => reinterviewMutation.mutate()}
          className="w-full flex items-center gap-4 px-5 py-4 border-2 border-[#2d2d2d] bg-white text-left transition-all duration-75 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
          style={{ borderRadius: "var(--radius-wobbly-alt)", boxShadow: "var(--shadow-hard-sm)" }}
        >
          <div
            className="w-10 h-10 flex items-center justify-center flex-shrink-0 border-2 border-[#2d2d2d]"
            style={{ background: "var(--postit)", borderRadius: "var(--radius-wobbly-sm)" }}
          >
            <RefreshCw className="h-4 w-4" style={{ color: "var(--ink)" }} strokeWidth={2.5} />
          </div>
          <div className="flex-1">
            <p className="text-base font-medium" style={{ color: "var(--ink)" }}>Retake Interview</p>
            <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>Refresh your psychometric profile</p>
          </div>
          <ChevronRight className="h-4 w-4 flex-shrink-0" style={{ color: "var(--muted)" }} strokeWidth={2.5} />
        </button>
      </Link>

      {/* Sign out */}
      <button
        onClick={() => signOut({ callbackUrl: "/" })}
        className="flex items-center gap-2 text-base transition-colors px-1"
        style={{ color: "var(--muted)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
      >
        <LogOut className="h-4 w-4" strokeWidth={2.5} />
        Sign out
      </button>
    </div>
  );
}
