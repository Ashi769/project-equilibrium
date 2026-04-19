"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Upload, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface UploadedPhoto { file: File; preview: string; }

export function PhotoUpload({ accessToken }: { accessToken: string }) {
  const router       = useRouter();
  const [photos,       setPhotos]       = useState<UploadedPhoto[]>([]);
  const [selfie,       setSelfie]       = useState<UploadedPhoto | null>(null);
  const [cameraOpen,   setCameraOpen]   = useState(false);
  const [uploading,    setUploading]    = useState(false);
  const [scanning,     setScanning]     = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef     = useRef<HTMLVideoElement>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const toAdd = Array.from(files).slice(0, 5 - photos.length);
    setPhotos((prev) => [...prev, ...toAdd.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))]);
  }

  function removePhoto(i: number) {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[i].preview);
      return prev.filter((_, j) => j !== i);
    });
  }

  async function openCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 50);
    } catch { setError("Camera access denied."); }
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], "selfie.jpg", { type: "image/jpeg" });
      setSelfie({ file, preview: URL.createObjectURL(blob) });
      closeCamera();
      setScanning(true); setScanComplete(false);
      setTimeout(() => { setScanning(false); setScanComplete(true); }, 3200);
    }, "image/jpeg", 0.92);
  }, []);

  async function handleSubmit() {
    if (photos.length < 3) { setError("Please upload at least 3 photos."); return; }
    if (!selfie)           { setError("Please take a selfie."); return; }
    setUploading(true); setError(null);
    const form = new FormData();
    photos.forEach((p) => form.append("photos", p.file));
    form.append("selfie", selfie.file);
    try {
      const res = await fetch(`${API_URL}/api/v1/photos/upload`, {
        method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: form,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? "Upload failed");
      router.push("/onboarding/interview");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setUploading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-10">
      {/* Header */}
      <div>
        <div
          className="inline-flex items-center px-3 py-1.5 border-2 border-[#2d2d2d] text-sm font-medium mb-3"
          style={{ borderRadius: "var(--radius-wobbly-sm)", background: "var(--muted-bg)", color: "var(--ink)" }}
        >
          Step 1 of 2
        </div>
        <h1 className="font-heading text-4xl font-bold" style={{ color: "var(--ink)" }}>
          Visual Audit
        </h1>
        <p className="text-base mt-2 leading-relaxed" style={{ color: "var(--muted)" }}>
          Upload 3–5 photos and take a live selfie. Photos are encrypted and never shown publicly.
        </p>
      </div>

      {/* Gallery photos */}
      <div
        className="p-6 bg-white border-2 border-[#2d2d2d]"
        style={{ borderRadius: "var(--radius-wobbly-alt)", boxShadow: "var(--shadow-hard)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="font-heading text-lg font-bold" style={{ color: "var(--ink)" }}>
            Gallery Photos
            <span className="font-normal text-base ml-2" style={{ color: "var(--muted)" }}>
              ({photos.length}/5, min 3)
            </span>
          </span>
          {photos.length > 0 && photos.length < 5 && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-sm font-medium transition-colors"
              style={{ color: "var(--ink)" }}
            >
              + Add more
            </button>
          )}
        </div>
        <input
          ref={fileInputRef} type="file"
          accept="image/jpeg,image/png,image/webp" multiple className="hidden"
          onChange={(e) => addPhotos(e.target.files)}
        />

        {photos.length === 0 ? (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-12 text-center border-2 border-dashed border-[#2d2d2d] transition-all duration-75 hover:border-[#2d5da1] hover:bg-[#fff9c4]"
            style={{ borderRadius: "var(--radius-wobbly-sm)" }}
          >
            <Upload className="h-7 w-7 mx-auto mb-3" style={{ color: "var(--muted)" }} strokeWidth={2.5} />
            <p className="text-base font-medium" style={{ color: "var(--ink)" }}>Click to upload</p>
            <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>JPEG, PNG, WebP · max 10 MB each</p>
          </button>
        ) : (
          <div className="grid grid-cols-5 gap-2">
            <AnimatePresence>
              {photos.map((p, i) => (
                <motion.div
                  key={p.preview}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="relative aspect-square overflow-hidden group border-2 border-[#2d2d2d]"
                  style={{ borderRadius: "var(--radius-wobbly-sm)" }}
                >
                  <img src={p.preview} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removePhoto(i)}
                    className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-white border border-[#2d2d2d]"
                    style={{ borderRadius: "50%" }}
                  >
                    <X className="h-3 w-3" style={{ color: "var(--ink)" }} />
                  </button>
                </motion.div>
              ))}
              {photos.length < 5 && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square flex items-center justify-center border-2 border-dashed border-[#2d2d2d] transition-all hover:border-[#2d5da1]"
                  style={{ borderRadius: "var(--radius-wobbly-sm)" }}
                >
                  <Upload className="h-4 w-4" style={{ color: "var(--muted)" }} />
                </button>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Selfie / camera */}
      <div
        className="p-6 bg-white border-2 border-[#2d2d2d]"
        style={{ borderRadius: "var(--radius-wobbly)", boxShadow: "var(--shadow-hard)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="font-heading text-lg font-bold" style={{ color: "var(--ink)" }}>
            Identity Verification
            {scanComplete && (
              <span className="ml-2 text-base font-normal" style={{ color: "var(--secondary)" }}>
                ✓ Calibrated
              </span>
            )}
          </span>
          {!cameraOpen && (
            <button
              onClick={openCamera}
              className="flex items-center gap-1.5 text-sm font-medium transition-colors"
              style={{ color: "var(--ink)" }}
            >
              <Camera className="h-4 w-4" strokeWidth={2.5} />
              {selfie ? "Retake" : "Open Camera"}
            </button>
          )}
        </div>

        {cameraOpen ? (
          <div
            className="relative overflow-hidden border-2 border-[#2d2d2d]"
            style={{ borderRadius: "var(--radius-wobbly-sm)", background: "#000" }}
          >
            <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-60 object-cover" />
            <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-3">
              <Button onClick={capturePhoto} size="sm">Capture</Button>
              <Button variant="secondary" size="sm" onClick={closeCamera}>Cancel</Button>
            </div>
          </div>
        ) : selfie ? (
          <div
            className="relative overflow-hidden border-2 border-[#2d2d2d]"
            style={{ borderRadius: "var(--radius-wobbly-sm)" }}
          >
            <img src={selfie.preview} alt="Selfie" className="w-full max-h-52 object-cover object-top" />

            {scanning && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                style={{ background: "rgba(253,251,247,0.85)" }}
              >
                <div
                  className="w-12 h-12 border-4 border-dashed border-[#2d2d2d] spin-slow"
                  style={{ borderRadius: "50%" }}
                />
                <p className="font-heading text-base font-bold" style={{ color: "var(--ink)" }}>
                  Calibrating Market Parity…
                </p>
              </div>
            )}

            {scanComplete && !scanning && (
              <div
                className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 border-2 border-[#2d5da1] text-sm font-medium"
                style={{ background: "white", borderRadius: "var(--radius-wobbly-sm)", color: "var(--secondary)" }}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                Calibrated
              </div>
            )}

            <button
              onClick={() => {
                if (selfie) URL.revokeObjectURL(selfie.preview);
                setSelfie(null); setScanComplete(false);
              }}
              className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center bg-white border-2 border-[#2d2d2d]"
              style={{ borderRadius: "50%" }}
            >
              <X className="h-3.5 w-3.5" style={{ color: "var(--ink)" }} />
            </button>
          </div>
        ) : (
          <div
            className="py-10 text-center border-2 border-dashed border-[#2d2d2d]"
            style={{ borderRadius: "var(--radius-wobbly-sm)" }}
          >
            <Camera className="h-7 w-7 mx-auto mb-3" style={{ color: "var(--muted)" }} strokeWidth={2.5} />
            <p className="text-base" style={{ color: "var(--muted)" }}>
              Live selfie required for identity verification
            </p>
          </div>
        )}
      </div>

      {error && (
        <div
          className="py-3 px-4 border-2 border-[#ff4d4d] text-sm text-center"
          style={{ borderRadius: "var(--radius-wobbly-sm)", background: "rgba(255,77,77,0.05)", color: "#ff4d4d" }}
        >
          {error}
        </div>
      )}

      <Button
        className="w-full"
        size="lg"
        onClick={handleSubmit}
        disabled={uploading || photos.length < 3 || !selfie || scanning}
      >
        {uploading ? "Uploading…" : scanning ? "Calibrating…" : "Proceed to Interview →"}
      </Button>
    </div>
  );
}
