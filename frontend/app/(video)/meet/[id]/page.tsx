"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";

const TOTAL_SECONDS = 30 * 60;
const FIRST_PROMPT_MS = 3 * 60 * 1000;
const PROMPT_INTERVAL_MS = 4.5 * 60 * 1000;
const MAX_PROMPTS = 6;

const WS_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/^http/, "ws") ?? "ws://localhost:8000";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const DIMENSION_PROMPTS: Record<string, string> = {
  openness:          "What's a belief you've each changed significantly in the last few years?",
  conscientiousness: "How do you approach long-term goals — and what would you want from a partner in that?",
  extraversion:      "How do you each recharge, and what does that mean for time together vs. apart?",
  agreeableness:     "Walk me through how you each handle conflict when you feel strongly you're right.",
  neuroticism:       "What does emotional support look like for you — giving and receiving?",
};

const FALLBACK_PROMPTS = [
  "What does a fulfilling relationship look like to you in five years?",
  "How do you navigate the tension between independence and togetherness?",
  "What's something you'd need a partner to understand about you early on?",
  "How do you each think about financial partnership?",
  "What role does shared ambition play in a relationship for you?",
  "Describe your ideal living arrangement in the next few years.",
];

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:443?transport=udp", username: "openrelayproject", credential: "openrelayprojectsecret" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayprojectsecret" },
  { urls: "turn:openrelay.metered.ca:80?transport=tcp", username: "openrelayproject", credential: "openrelayprojectsecret" },
];

interface FeedItem { text: string; ts: string; }

function useWebRTC(meetingId: string | null, token: string | undefined, active: boolean) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [connected, setConnected] = useState(false);
  const [micMuted, setMicMuted] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const iceCandidateBuffer = useRef<RTCIceCandidateInit[]>([]);
  const preWsCandidates = useRef<RTCIceCandidateInit[]>([]);
  const hasRemoteDesc = useRef(false);
  const roleRef = useRef<"offerer" | "answerer" | null>(null);
  const msgQueue = useRef<Promise<void>>(Promise.resolve());
  const disposed = useRef(false);

  useEffect(() => {
    if (!active || !meetingId || !token) return;
    disposed.current = false;

    let pc: RTCPeerConnection;
    let ws: WebSocket;

    async function init() {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (e) {
        console.warn("webrtc: combined getUserMedia failed, trying separately", e);
        const tracks: MediaStreamTrack[] = [];
        try {
          const vs = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          tracks.push(...vs.getTracks());
        } catch (ve) { console.warn("webrtc: video unavailable", ve); }
        try {
          const as = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
          tracks.push(...as.getTracks());
        } catch (ae) { console.warn("webrtc: audio unavailable", ae); }
        if (tracks.length > 0) stream = new MediaStream(tracks);
      }
      if (disposed.current) { stream?.getTracks().forEach(t => t.stop()); return; }

      streamRef.current = stream;
      if (stream && localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        iceTransportPolicy: "all",
        iceCandidatePoolSize: 10,
      });

      pcRef.current = pc;

      const remoteStream = new MediaStream();
      remoteStreamRef.current = remoteStream;
      const remoteEl = remoteVideoRef.current;
      if (remoteEl) {
        remoteEl.srcObject = remoteStream;
      }

      pc.ontrack = (e) => {
        if (!remoteStream.getTracks().includes(e.track)) {
          remoteStream.addTrack(e.track);
        }
        const el = remoteVideoRef.current;
        if (el) {
          if (el.srcObject !== remoteStream) {
            el.srcObject = remoteStream;
          }
          el.play().catch(() => {});
        }
        setConnected(true);
      };

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        console.log("webrtc: ICE state →", state);

        if (state === "connected" || state === "completed") {
          setConnected(true);
          const el = remoteVideoRef.current;
          if (el && el.paused) {
            el.play().catch(() => {});
          }
        }

        if (state === "disconnected") {
          setConnected(false);
        }

        if (state === "failed") {
          setConnected(false);
          if (roleRef.current === "offerer") {
            pc.createOffer({ iceRestart: true }).then(async offer => {
              await pc.setLocalDescription(offer);
              ws.send(JSON.stringify({ type: "offer", data: pc.localDescription!.toJSON() }));
            }).catch(e => console.error("webrtc: ICE restart failed:", e));
          }
        }
      };

      ws = new WebSocket(`${WS_URL}/api/v1/signal/${meetingId}?token=${token}`);
      wsRef.current = ws;

      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ice-candidate", data: e.candidate.toJSON() }));
        } else {
          preWsCandidates.current.push(e.candidate.toJSON());
        }
      };

      function handleMessage(handler: () => Promise<void>) {
        msgQueue.current = msgQueue.current.then(handler).catch((err) => {
          console.error("webrtc: message handler error", err);
        });
      }

      function addLocalTracks() {
        const existingTracks = new Set(pc.getSenders().map(s => s.track));
        const audioTrack = stream?.getAudioTracks()[0] ?? null;
        const videoTrack = stream?.getVideoTracks()[0] ?? null;
        if (audioTrack && !existingTracks.has(audioTrack)) {
          stream ? pc.addTrack(audioTrack, stream) : pc.addTrack(audioTrack);
        }
        if (videoTrack && !existingTracks.has(videoTrack)) {
          stream ? pc.addTrack(videoTrack, stream) : pc.addTrack(videoTrack);
        }
        const kinds: RTCRtpCodecParameters["mimeType"][] = [];
        if (!audioTrack) kinds.push("audio" as RTCRtpCodecParameters["mimeType"]);
        if (!videoTrack) kinds.push("video" as RTCRtpCodecParameters["mimeType"]);
        const existingKinds = new Set(pc.getTransceivers().map(t => t.receiver.track.kind));
        for (const kind of kinds) {
          if (!existingKinds.has(kind)) {
            pc.addTransceiver(kind as "audio" | "video", { direction: "recvonly" });
          }
        }
      }

      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);

        if (msg.type === "peer-joined") {
          roleRef.current = msg.role;
          if (msg.role === "offerer") {
            handleMessage(async () => {
              addLocalTracks();
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              ws.send(JSON.stringify({ type: "offer", data: pc.localDescription!.toJSON() }));
            });
          }
          return;
        }

        if (msg.type === "peer-left") {
          setConnected(false);
          return;
        }

        if (msg.type === "offer") {
          handleMessage(async () => {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
            hasRemoteDesc.current = true;
            addLocalTracks();
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: "answer", data: pc.localDescription!.toJSON() }));
            await drainIceBuffer(pc);
          });
          return;
        }

        if (msg.type === "answer") {
          handleMessage(async () => {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
            hasRemoteDesc.current = true;
            await drainIceBuffer(pc);
          });
          return;
        }

        if (msg.type === "ice-candidate" && msg.data) {
          handleMessage(async () => {
            if (!hasRemoteDesc.current) {
              iceCandidateBuffer.current.push(msg.data);
            } else {
              await pc.addIceCandidate(new RTCIceCandidate(msg.data));
            }
          });
        }
      };

      ws.onopen = () => {
        console.log("webrtc: signaling connected, waiting for peer...");
        for (const c of preWsCandidates.current.splice(0)) {
          ws.send(JSON.stringify({ type: "ice-candidate", data: c }));
        }
      };
      ws.onerror = (e) => console.error("webrtc: signaling error", e);
      ws.onclose = (e) => console.log("webrtc: signaling closed", e.code, e.reason);
    }

    async function drainIceBuffer(pc: RTCPeerConnection) {
      const buffered = iceCandidateBuffer.current.splice(0);
      for (const c of buffered) {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      }
    }

    init();

    return () => {
      disposed.current = true;
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      if (remoteStreamRef.current) { remoteStreamRef.current = null; }
      if (remoteVideoRef.current) { remoteVideoRef.current.srcObject = null; }
      hasRemoteDesc.current = false;
      roleRef.current = null;
      iceCandidateBuffer.current = [];
      preWsCandidates.current = [];
      msgQueue.current = Promise.resolve();
    };
  }, [active, meetingId, token]);

  const dispose = useCallback(() => {
    disposed.current = true;
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (remoteStreamRef.current) { remoteStreamRef.current = null; }
    if (remoteVideoRef.current) { remoteVideoRef.current.srcObject = null; }
  }, [remoteVideoRef]);

  const toggleMic = useCallback(() => {
    if (!streamRef.current) return;
    streamRef.current.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setMicMuted(m => !m);
  }, []);

  return { localVideoRef, remoteVideoRef, connected, micMuted, toggleMic, dispose };
}

export default function MeetPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const token = session?.accessToken as string | undefined;
  const meetingId = searchParams.get("meeting");

  const [seconds, setSeconds] = useState(TOTAL_SECONDS);
  const [callActive, setCallActive] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [verdict, setVerdict] = useState<"commit" | "pool" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);

  const promptsRef = useRef<string[]>(FALLBACK_PROMPTS.slice(0, MAX_PROMPTS));
  const promptIdxRef = useRef(0);

  const { localVideoRef, remoteVideoRef, connected, micMuted, toggleMic, dispose } = useWebRTC(meetingId, token, callActive);

  useEffect(() => {
    if (!token || !meetingId) return;
    async function load() {
      try {
        const meetings = await fetch(`${API_URL}/api/v1/schedule`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.ok ? r.json() : []);
        const meeting = meetings.find((m: { id: string }) => m.id === meetingId);
        if (!meeting) return;
        const userId = session?.userId as string | undefined;
        const otherUserId = meeting.proposer_id === userId ? meeting.match_id : meeting.proposer_id;

        const detail = await fetch(`${API_URL}/api/v1/matches/${otherUserId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.ok ? r.json() : null);

        if (!detail?.dimension_scores?.length) return;

        const ordered: string[] = [];
        for (const dim of detail.dimension_scores as { label: string }[]) {
          const prompt = DIMENSION_PROMPTS[dim.label.toLowerCase()];
          if (prompt && !ordered.includes(prompt)) ordered.push(prompt);
          if (ordered.length >= MAX_PROMPTS) break;
        }
        for (const fb of FALLBACK_PROMPTS) {
          if (ordered.length >= MAX_PROMPTS) break;
          if (!ordered.includes(fb)) ordered.push(fb);
        }
        promptsRef.current = ordered;
      } catch { /* keep fallbacks */ }
    }
    load();
  }, [token, meetingId, session?.userId]);

  useEffect(() => {
    if (!callActive || callEnded) return;
    const id = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          setCallEnded(true);
          dispose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [callActive, callEnded, dispose]);

  useEffect(() => {
    if (!callActive || callEnded) return;
    promptIdxRef.current = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function fireNext(delay: number) {
      const t = setTimeout(() => {
        const idx = promptIdxRef.current;
        if (idx >= promptsRef.current.length) return;
        const now = new Date();
        const ts = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
        setFeed(prev => [...prev, { text: promptsRef.current[idx], ts }]);
        promptIdxRef.current = idx + 1;
        if (promptIdxRef.current < promptsRef.current.length) {
          fireNext(PROMPT_INTERVAL_MS);
        }
      }, delay);
      timers.push(t);
    }

    fireNext(FIRST_PROMPT_MS);
    return () => timers.forEach(clearTimeout);
  }, [callActive, callEnded]);

  async function submitVerdict(choice: "commit" | "pool") {
    setSubmitting(true);
    if (meetingId && token) {
      try {
        await api.post("/api/v1/schedule/verdict", { meeting_id: meetingId, verdict: choice }, token);
      } catch { /* still show locally */ }
    }
    setVerdict(choice);
    setSubmitting(false);
  }

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const isUrgent = seconds <= 60;
  const pctLeft = seconds / TOTAL_SECONDS;

  // Verdict screens
  if (verdict === "commit") {
    return <VerdictScreen headline="It's a match" sub="Equilibrium will coordinate next steps with both of you." cta="Back to home" onContinue={() => router.push("/selection")} positive />;
  }
  if (verdict === "pool") {
    return <VerdictScreen headline="Back to the pool" sub="Your profile stays active. A new match will be presented within 48 hours." cta="Back to home" onContinue={() => router.push("/selection")} positive={false} />;
  }

  // Post-call verdict prompt
  if (callEnded) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 flex flex-col items-center justify-center px-6 text-center"
        style={{ background: "#0a0a0a" }}
      >
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-3">
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>Session complete — 30 minutes</p>
            <h2 className="font-heading text-3xl font-bold" style={{ color: "#ffffff" }}>How did it go?</h2>
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
              Would you like to pursue this connection, or return to the candidate pool?
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => submitVerdict("commit")}
              disabled={submitting}
              className="w-full py-4 text-base font-semibold rounded-2xl transition-all active:scale-95"
              style={{
                background: submitting ? "rgba(255,255,255,0.1)" : "#ff4d4d",
                color: "#ffffff",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? "Submitting…" : "I want to connect"}
            </button>
            <button
              onClick={() => submitVerdict("pool")}
              disabled={submitting}
              className="w-full py-4 text-base font-medium rounded-2xl transition-all active:scale-95"
              style={{
                background: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.7)",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              Return to pool
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  // Pre-call screen
  if (!callActive) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 flex flex-col items-center justify-center px-6 text-center"
        style={{ background: "#0a0a0a" }}
      >
        <div className="w-full max-w-xs space-y-8">
          <div
            className="w-16 h-16 mx-auto flex items-center justify-center text-2xl rounded-2xl"
            style={{ background: "rgba(255,77,77,0.15)", border: "1px solid rgba(255,77,77,0.3)" }}
          >
            ⚖
          </div>
          <div className="space-y-3">
            <h2 className="font-heading text-2xl font-bold" style={{ color: "#ffffff" }}>30-Minute Session</h2>
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
              Camera and mic will be requested. The session ends automatically at 30:00 — conversation prompts appear along the way.
            </p>
          </div>
          <button
            onClick={() => {
              try {
                const ctx = new AudioContext();
                ctx.resume().then(() => ctx.close()).catch(() => {});
              } catch (_) {}
              setCallActive(true);
            }}
            className="w-full py-4 text-base font-semibold rounded-2xl transition-all active:scale-95"
            style={{ background: "#ff4d4d", color: "#ffffff" }}
          >
            Begin session
          </button>
        </div>
      </motion.div>
    );
  }

  // Active call
  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "#000" }}>
      {/* Progress bar */}
      <div
        className="absolute top-0 left-0 h-0.5 transition-all duration-1000 z-30"
        style={{
          width: `${pctLeft * 100}%`,
          background: isUrgent ? "#ef4444" : "rgba(255,255,255,0.4)",
        }}
      />

      {/* Remote video — full screen */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Waiting overlay */}
      {!connected && (
        <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: "#111" }}>
          <div className="text-center space-y-4">
            <div
              className="w-10 h-10 mx-auto rounded-full animate-spin"
              style={{ border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "rgba(255,255,255,0.6)" }}
            />
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>Waiting for your match…</p>
          </div>
        </div>
      )}

      {/* Timer — top center */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20">
        <div
          className="px-4 py-2 rounded-full flex items-center gap-2"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(12px)" }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: isUrgent ? "#ef4444" : "rgba(255,255,255,0.5)" }}
          />
          <span
            className="font-mono text-base tabular-nums"
            style={{ color: isUrgent ? "#ef4444" : "#ffffff" }}
          >
            {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
          </span>
        </div>
      </div>

      {/* Local video PIP — top right */}
      <div
        className="absolute top-4 right-4 z-20 overflow-hidden rounded-xl"
        style={{
          width: 100,
          height: 75,
          border: "1.5px solid rgba(255,255,255,0.2)",
          background: "#000",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}
      >
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />
      </div>

      {/* Bottom panel: prompt + controls */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col" style={{ paddingBottom: "env(safe-area-inset-bottom, 16px)" }}>
        {/* Conversation prompt */}
        <div
          className="mx-3 mb-3 rounded-2xl overflow-hidden"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <AnimatePresence mode="wait">
            {feed.length === 0 ? (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="px-4 py-3 flex items-center gap-2"
              >
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.25)" }} />
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
                  First prompt at 3 min
                </p>
              </motion.div>
            ) : (
              <motion.div
                key={feed.length}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.35 }}
                className="px-4 py-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                    Prompt {feed.length} of {MAX_PROMPTS}
                  </span>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: "#ffffff" }}>
                  {feed[feed.length - 1].text}
                </p>
                {feed.length > 1 && (
                  <div className="pt-2 space-y-1" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                    {feed.slice(0, -1).reverse().slice(0, 2).map((item, i) => (
                      <p key={i} className="text-xs leading-snug" style={{ color: "rgba(255,255,255,0.3)" }}>
                        {item.text}
                      </p>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Controls row */}
        <div className="px-3 pb-4 flex items-center justify-center gap-3">
          {/* Mic toggle */}
          <button
            onClick={toggleMic}
            className="w-14 h-14 flex items-center justify-center rounded-full transition-all active:scale-90"
            style={{
              background: micMuted ? "rgba(239,68,68,0.25)" : "rgba(255,255,255,0.12)",
              border: `1.5px solid ${micMuted ? "rgba(239,68,68,0.6)" : "rgba(255,255,255,0.2)"}`,
              backdropFilter: "blur(8px)",
              color: micMuted ? "#ef4444" : "#ffffff",
            }}
            title={micMuted ? "Unmute" : "Mute"}
          >
            {micMuted ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23"/>
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            )}
          </button>

          {/* End session */}
          <button
            onClick={() => { setCallEnded(true); dispose(); }}
            className="h-14 px-6 flex items-center gap-2 rounded-full text-sm font-semibold transition-all active:scale-90"
            style={{
              background: "rgba(239,68,68,0.2)",
              border: "1.5px solid rgba(239,68,68,0.5)",
              backdropFilter: "blur(8px)",
              color: "#ef4444",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 3.07 8.63 19.79 19.79 0 0 1 0 0a2 2 0 0 1 2-2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L6.18 5.71"/>
              <line x1="23" y1="1" x2="1" y2="23"/>
            </svg>
            End
          </button>
        </div>
      </div>
    </div>
  );
}

function VerdictScreen({ headline, sub, cta, onContinue, positive }: {
  headline: string;
  sub: string;
  cta: string;
  onContinue: () => void;
  positive: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="fixed inset-0 flex flex-col items-center justify-center px-6 text-center"
      style={{ background: "#0a0a0a" }}
    >
      <div className="w-full max-w-xs space-y-6">
        <div
          className="w-16 h-16 mx-auto flex items-center justify-center text-2xl rounded-2xl"
          style={{
            background: positive ? "rgba(255,77,77,0.15)" : "rgba(255,255,255,0.06)",
            border: `1px solid ${positive ? "rgba(255,77,77,0.3)" : "rgba(255,255,255,0.12)"}`,
          }}
        >
          {positive ? "✓" : "↩"}
        </div>
        <div className="space-y-2">
          <h2 className="font-heading text-2xl font-bold" style={{ color: "#ffffff" }}>{headline}</h2>
          <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>{sub}</p>
        </div>
        <button
          onClick={onContinue}
          className="w-full py-4 text-base font-medium rounded-2xl transition-all active:scale-95"
          style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}
        >
          {cta}
        </button>
      </div>
    </motion.div>
  );
}
