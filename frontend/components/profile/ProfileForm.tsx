"use client";

import { signOut } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRef, useState } from "react";
import Link from "next/link";
import { Camera, CheckCircle2, Clock, AlertCircle, RefreshCw, LogOut, ChevronRight, X, Upload, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface UserPhoto { id: string; filename: string; is_selfie: boolean; url?: string | null; }
interface UserProfile {
  id: string; name: string; email: string; age: number | null; gender: string | null;
  height: number | null;
  drinking: string | null;
  smoking: string | null;
  religion: string | null;
  food_preference: string | null;
  analysis_status: "pending" | "processing" | "complete" | null;
  hard_filters: { 
    wants_children?: boolean | null; max_age_diff?: number; seeking_gender?: string[];
    seeking_drinking?: string; seeking_smoking?: string;
    seeking_religion?: string; seeking_food?: string;
  };
  reinterview_due?: boolean;
  reinterview_due_at?: string | null;
}

const RELIGIONS = ["Hindu", "Muslim", "Christian", "Sikh", "Buddhist", "Jain", "Atheist", "Other"];
const LIFESTYLE_OPTS = ["never", "sometimes", "often", "doesn't matter"];
const FOOD_OPTS = ["veg", "non-veg", "vegan", "egg", "doesn't matter"];

const hardFiltersSchema = z.object({
  wants_children: z.enum(["yes", "no", "open"]),
  max_age_diff:   z.number().int().min(1).max(30),
  seeking_gender: z.string(),
  seeking_drinking: z.string(),
  seeking_smoking: z.string(),
  seeking_religion: z.string(),
  seeking_food: z.string(),
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

  const updateAttrMutation = useMutation({
    mutationFn: (data: { height?: number; drinking?: string; smoking?: string; religion?: string; language?: string; food_preference?: string }) =>
      api.patch("/api/v1/profile", { attributes: data }, accessToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });

  const reinterviewMutation = useMutation({
    mutationFn: () => api.post("/api/v1/interview/reset", {}, accessToken),
  });

  // ── Photo editing state ──────────────────────────────────────────────────
  const [editingPhotos, setEditingPhotos] = useState(false);
  const [editingAbout, setEditingAbout] = useState(false);
  const [editingPrefs, setEditingPrefs] = useState(false);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [newSelfie, setNewSelfie] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const selfieInputRef  = useRef<HTMLInputElement>(null);

  // Camera state for selfie
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  async function openSelfieCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 50);
    } catch { setPhotoError("Camera access denied."); }
  }

  function closeSelfieCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }

  function captureSelfie() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], "selfie.jpg", { type: "image/jpeg" });
      setNewSelfie(file);
      closeSelfieCamera();
    }, "image/jpeg", 0.92);
  }

  const deleteMutation = useMutation({
    mutationFn: (photoId: string) =>
      fetch(`${API_URL}/api/v1/photos/${photoId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then((r) => { if (!r.ok && r.status !== 204) throw new Error("Delete failed"); }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["photos"] }),
  });

  async function savePhotoChanges() {
    if (!newFiles.length && !newSelfie) { setEditingPhotos(false); return; }
    setPhotoSaving(true); setPhotoError(null);
    try {
      const form = new FormData();
      newFiles.forEach((f) => form.append("photos", f));
      if (newSelfie) form.append("selfie", newSelfie);
      const res = await fetch(`${API_URL}/api/v1/photos/add`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? "Upload failed");
      setNewFiles([]); setNewSelfie(null);
      queryClient.invalidateQueries({ queryKey: ["photos"] });
      setEditingPhotos(false);
    } catch (e: unknown) {
      setPhotoError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setPhotoSaving(false);
    }
  }

  const currentGalleryCount = (galleryPhotos?.length ?? 0) + newFiles.length;

  const { register, handleSubmit } = useForm<HardFiltersForm>({
    resolver: zodResolver(hardFiltersSchema),
    defaultValues: { 
      wants_children: "open", max_age_diff: 10, seeking_gender: "any",
      seeking_drinking: "doesn't matter", seeking_smoking: "doesn't matter",
      seeking_religion: "doesn't matter", seeking_food: "doesn't matter",
    },
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
              src={selfie.url ?? `/api/photos/${selfie.filename}`}
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

      {/* Lifestyle card */}
      <div
        className="bg-white border-2 border-[#2d2d2d] overflow-hidden"
        style={{ borderRadius: "var(--radius-wobbly-alt)", boxShadow: "var(--shadow-hard)" }}
      >
        <div className="px-6 py-4 border-b-2 border-dashed border-[#e5e0d8] flex items-center justify-between">
          <span className="font-heading text-lg font-bold" style={{ color: "var(--ink)" }}>About You</span>
          {!editingAbout && (
            <button
              onClick={() => setEditingAbout(true)}
              className="text-sm font-medium"
              style={{ color: "var(--secondary)" }}
            >
              Edit
            </button>
          )}
        </div>
        <div className="p-5 space-y-4">
          {editingAbout ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Height (cm)</label>
                  <Input 
                    type="number" 
                    placeholder="165" 
                    className="w-full"
                    defaultValue={profile.height ?? undefined}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Drinking</label>
                  <select style={wobblySelect} defaultValue={profile.drinking ?? ""}>
                    <option value="">Select</option>
                    <option value="never">Never</option>
                    <option value="sometimes">Sometimes</option>
                    <option value="often">Often</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Smoking</label>
                  <select style={wobblySelect} defaultValue={profile.smoking ?? ""}>
                    <option value="">Select</option>
                    <option value="never">Never</option>
                    <option value="sometimes">Sometimes</option>
                    <option value="often">Often</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Religion</label>
                  <select style={wobblySelect} defaultValue={profile.religion ?? ""}>
                    <option value="">Select</option>
                    {RELIGIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Food preference</label>
                  <select style={wobblySelect} defaultValue={profile.food_preference ?? ""}>
                    <option value="">Select</option>
                    <option value="veg">Vegetarian</option>
                    <option value="non-veg">Non-vegetarian</option>
                    <option value="vegan">Vegan</option>
                    <option value="egg">Egg</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={() => {
                    const h = parseInt((document.querySelector('[placeholder="165"]') as HTMLInputElement)?.value) || undefined;
                    const d = (document.querySelector('select:nth-of-type(4)') as HTMLSelectElement)?.value || undefined;
                    const s = (document.querySelector('select:nth-of-type(5)') as HTMLSelectElement)?.value || undefined;
                    const r = (document.querySelector('select:nth-of-type(6)') as HTMLSelectElement)?.value || undefined;
                    const f = (document.querySelector('select:nth-of-type(7)') as HTMLSelectElement)?.value || undefined;
                    updateAttrMutation.mutate({ 
                      height: h, drinking: d, smoking: s, religion: r, food_preference: f 
                    });
                    setEditingAbout(false);
                  }}
                  size="sm"
                  disabled={updateAttrMutation.isPending}
                >
                  {updateAttrMutation.isPending ? "Saving…" : "Save"}
                </Button>
                <Button 
                  onClick={() => setEditingAbout(false)}
                  size="sm"
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>Height</p>
                <p className="text-base font-medium" style={{ color: "var(--ink)" }}>{profile.height ? `${profile.height} cm` : "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>Drinking</p>
                <p className="text-base font-medium capitalize" style={{ color: "var(--ink)" }}>{profile.drinking || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>Smoking</p>
                <p className="text-base font-medium capitalize" style={{ color: "var(--ink)" }}>{profile.smoking || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>Religion</p>
                <p className="text-base font-medium" style={{ color: "var(--ink)" }}>{profile.religion || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>Food preference</p>
                <p className="text-base font-medium capitalize" style={{ color: "var(--ink)" }}>{profile.food_preference === "non-veg" ? "Non-veg" : profile.food_preference || "—"}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Photos card */}
      <div
        className="bg-white border-2 border-[#2d2d2d] overflow-hidden"
        style={{ borderRadius: "var(--radius-wobbly)", boxShadow: "var(--shadow-hard)" }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b-2 border-dashed border-[#e5e0d8]">
          <span className="font-heading text-lg font-bold" style={{ color: "var(--ink)" }}>
            Photos
            {editingPhotos && (
              <span className="ml-2 text-sm font-normal" style={{ color: "var(--muted)" }}>
                ({currentGalleryCount}/5 gallery)
              </span>
            )}
          </span>
          {editingPhotos ? (
            <div className="flex items-center gap-3">
              <button
                className="text-sm font-medium"
                style={{ color: "var(--muted)" }}
                onClick={() => { setEditingPhotos(false); setNewFiles([]); setNewSelfie(null); setPhotoError(null); }}
              >
                Cancel
              </button>
              <Button size="sm" onClick={savePhotoChanges} disabled={photoSaving}>
                {photoSaving ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setEditingPhotos(true)}
              className="text-sm font-medium"
              style={{ color: "var(--secondary)" }}
            >
              Edit
            </button>
          )}
        </div>
        <div className="p-5 space-y-4">
          {/* Gallery photos */}
          {editingPhotos ? (
            <>
              <input
                ref={galleryInputRef} type="file"
                accept="image/jpeg,image/png,image/webp" multiple className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  const slots = 5 - currentGalleryCount;
                  setNewFiles((prev) => [...prev, ...files.slice(0, slots)]);
                  e.target.value = "";
                }}
              />
              <input
                ref={selfieInputRef} type="file"
                accept="image/jpeg,image/png,image/webp" className="hidden"
                capture="user"
                onChange={(e) => { if (e.target.files?.[0]) setNewSelfie(e.target.files[0]); e.target.value = ""; }}
              />
              <div>
                <p className="text-sm font-medium mb-2" style={{ color: "var(--ink)" }}>Gallery</p>
                <div className="grid grid-cols-5 gap-2">
                  {galleryPhotos.map((photo) => (
                    <div key={photo.id} className="relative aspect-square group">
                      <img
                        src={photo.url ?? ""}
                        alt=""
                        className="w-full h-full object-cover border-2 border-[#2d2d2d]"
                        style={{ borderRadius: "var(--radius-wobbly-sm)" }}
                      />
                      <button
                        onClick={() => deleteMutation.mutate(photo.id)}
                        disabled={deleteMutation.isPending}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-white border-2 border-[#2d2d2d] opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ borderRadius: "50%" }}
                      >
                        <X className="h-2.5 w-2.5" style={{ color: "var(--ink)" }} />
                      </button>
                    </div>
                  ))}
                  {newFiles.map((f, i) => (
                    <div key={i} className="relative aspect-square group">
                      <img
                        src={URL.createObjectURL(f)}
                        alt=""
                        className="w-full h-full object-cover border-2 border-[#2d5da1]"
                        style={{ borderRadius: "var(--radius-wobbly-sm)" }}
                      />
                      <button
                        onClick={() => setNewFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-white border-2 border-[#2d2d2d] opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ borderRadius: "50%" }}
                      >
                        <X className="h-2.5 w-2.5" style={{ color: "var(--ink)" }} />
                      </button>
                    </div>
                  ))}
                  {currentGalleryCount < 5 && (
                    <button
                      onClick={() => galleryInputRef.current?.click()}
                      className="aspect-square flex items-center justify-center border-2 border-dashed border-[#2d2d2d] transition-all hover:border-[#2d5da1] hover:bg-[#fff9c4]"
                      style={{ borderRadius: "var(--radius-wobbly-sm)" }}
                    >
                      <Plus className="h-4 w-4" style={{ color: "var(--muted)" }} />
                    </button>
                  )}
                </div>
              </div>
              {/* Selfie row / camera */}
              <div>
                <p className="text-sm font-medium mb-2" style={{ color: "var(--ink)" }}>Selfie</p>
                {cameraOpen ? (
                  <div className="relative overflow-hidden border-2 border-[#2d2d2d]" style={{ borderRadius: "var(--radius-wobbly-sm)", background: "#000" }}>
                    <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-40 object-cover" />
                    <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2">
                      <Button size="sm" onClick={captureSelfie}>Capture</Button>
                      <Button size="sm" variant="secondary" onClick={closeSelfieCamera}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    {(newSelfie || selfie) && (
                      <img
                        src={newSelfie ? URL.createObjectURL(newSelfie) : (selfie!.url ?? "")}
                        alt="selfie"
                        className="w-14 h-14 object-cover border-2 flex-shrink-0"
                        style={{
                          borderRadius: "var(--radius-wobbly-sm)",
                          borderColor: newSelfie ? "#2d5da1" : "#2d2d2d",
                        }}
                      />
                    )}
                    <button
                      onClick={openSelfieCamera}
                      className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 border-2 border-[#2d2d2d] transition-all hover:bg-[#fff9c4]"
                      style={{ borderRadius: "var(--radius-wobbly-sm)", color: "var(--ink)" }}
                    >
                      <Camera className="h-3.5 w-3.5" strokeWidth={2.5} />
                      {selfie || newSelfie ? "Retake" : "Take selfie"}
                    </button>
                  </div>
                )}
              </div>
              {photoError && (
                <p className="text-sm" style={{ color: "var(--accent)" }}>{photoError}</p>
              )}
            </>
          ) : photos && photos.length > 0 ? (
            <div className="grid grid-cols-4 gap-2">
              {galleryPhotos.map((photo) => (
                <div
                  key={photo.id}
                  className="aspect-square overflow-hidden border-2 border-[#2d2d2d]"
                  style={{ borderRadius: "var(--radius-wobbly-sm)", background: "var(--muted-bg)" }}
                >
                  <img src={photo.url ?? ""} alt="" className="w-full h-full object-cover" />
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
              <Button size="sm" variant="secondary" onClick={() => setEditingPhotos(true)}>
                Upload Photos
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Match preferences */}
      <div
        className="bg-white border-2 border-[#2d2d2d] overflow-hidden"
        style={{ borderRadius: "var(--radius-wobbly-alt)", boxShadow: "var(--shadow-hard)" }}
      >
        <div className="px-6 py-4 border-b-2 border-dashed border-[#e5e0d8] flex items-center justify-between">
          <span className="font-heading text-lg font-bold" style={{ color: "var(--ink)" }}>Match Preferences</span>
          {!editingPrefs && (
            <button
              onClick={() => setEditingPrefs(true)}
              className="text-sm font-medium"
              style={{ color: "var(--secondary)" }}
            >
              Edit
            </button>
          )}
        </div>
        <div className="p-5">
          {editingPrefs ? (
            <form
              onSubmit={handleSubmit((data) =>
                updateMutation.mutate({
                  wants_children: data.wants_children === "yes" ? true : data.wants_children === "no" ? false : null,
                  max_age_diff:   data.max_age_diff,
                  seeking_gender: data.seeking_gender === "any" ? [] : [data.seeking_gender],
                  seeking_drinking: data.seeking_drinking === "doesn't matter" ? undefined : data.seeking_drinking,
                  seeking_smoking: data.seeking_smoking === "doesn't matter" ? undefined : data.seeking_smoking,
                  seeking_religion: data.seeking_religion === "doesn't matter" ? undefined : data.seeking_religion,
                  seeking_food: data.seeking_food === "doesn't matter" ? undefined : data.seeking_food,
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Drinking</label>
                <select style={wobblySelect} {...register("seeking_drinking")}>
                  {LIFESTYLE_OPTS.map(o => <option key={o} value={o}>{o === "doesn't matter" ? "Doesn't matter" : o}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Smoking</label>
                <select style={wobblySelect} {...register("seeking_smoking")}>
                  {LIFESTYLE_OPTS.map(o => <option key={o} value={o}>{o === "doesn't matter" ? "Doesn't matter" : o}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Religion</label>
                <select style={wobblySelect} {...register("seeking_religion")}>
                  <option value="doesn't matter">Doesn't matter</option>
                  {RELIGIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Food preference</label>
                <select style={wobblySelect} {...register("seeking_food")}>
                  {FOOD_OPTS.map(o => <option key={o} value={o}>{o === "doesn't matter" ? "Doesn't matter" : o}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving…" : "Save"}
              </Button>
              <Button 
                type="button"
                onClick={() => setEditingPrefs(false)}
                size="sm"
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          </form>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>Wants children</p>
                <p className="text-base font-medium capitalize" style={{ color: "var(--ink)" }}>
                  {profile.hard_filters?.wants_children === true ? "Yes" : profile.hard_filters?.wants_children === false ? "No" : "Open to it"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>Seeking</p>
                <p className="text-base font-medium" style={{ color: "var(--ink)" }}>
                  {profile.hard_filters?.seeking_gender?.length ? profile.hard_filters.seeking_gender[0] : "Anyone"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>Max age diff</p>
                <p className="text-base font-medium" style={{ color: "var(--ink)" }}>{profile.hard_filters?.max_age_diff || 10} years</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>Drinking</p>
                <p className="text-base font-medium" style={{ color: "var(--ink)" }}>{profile.hard_filters?.seeking_drinking || "Doesn't matter"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>Smoking</p>
                <p className="text-base font-medium" style={{ color: "var(--ink)" }}>{profile.hard_filters?.seeking_smoking || "Doesn't matter"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>Religion</p>
                <p className="text-base font-medium" style={{ color: "var(--ink)" }}>{profile.hard_filters?.seeking_religion || "Doesn't matter"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>Food</p>
                <p className="text-base font-medium" style={{ color: "var(--ink)" }}>{profile.hard_filters?.seeking_food || "Doesn't matter"}</p>
              </div>
            </div>
          )}
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
