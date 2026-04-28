"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";

const TOTAL_SECONDS = 30 * 60;
const FIRST_PROMPT_MS = 3 * 60 * 1000;   // first prompt at 3 min
const PROMPT_INTERVAL_MS = 4.5 * 60 * 1000; // then every 4.5 min → 6 prompts across 30 min
const MAX_PROMPTS = 6;

const WS_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/^http/, "ws") ?? "ws://localhost:8000";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// One focused prompt per OCEAN dimension — topic only, no scores exposed
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
  "Discuss your ideal living arrangement in the next few years.",
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
      // 1. Get media — try combined first, then each track separately
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

      // 2. Create peer connection
      pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        iceTransportPolicy: "all",
        iceCandidatePoolSize: 10,
      });

      pcRef.current = pc;

      // Single remote MediaStream that accumulates all incoming tracks.
      // Set srcObject once here so the <video> element is always wired to it.
      const remoteStream = new MediaStream();
      remoteStreamRef.current = remoteStream;
      const remoteEl = remoteVideoRef.current;
      if (remoteEl) {
        remoteEl.srcObject = remoteStream;
      }

      // ── NOTE: we do NOT add any transceivers here. ──────────────────────────
      // Transceivers must be added at the right moment for each role:
      //
      //  • OFFERER  – adds transceivers right before createOffer() so its tracks
      //               appear in the SDP it sends.
      //
      //  • ANSWERER – calls setRemoteDescription(offer) first (the browser then
      //               creates recvonly transceivers for each m-line), and only
      //               AFTER that calls addTrack() to upgrade those transceivers
      //               to sendrecv and include its own tracks in the answer.
      //
      // Pre-creating transceivers on BOTH sides before knowing the role is the
      // root cause of the bugs: when the answerer already has sendrecv
      // transceivers and then calls setRemoteDescription(offer), browsers may
      // create ADDITIONAL recvonly transceivers for the offer's m-lines. The
      // answer then goes out as recvonly — the offerer receives nothing back,
      // ontrack never fires on their side, and they see/hear nothing.
      // ────────────────────────────────────────────────────────────────────────

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

      // 3. Open signaling WebSocket
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

      // Helper: add local tracks to the PC. Safe to call multiple times (ICE
      // restart re-enters the offer/answer handlers) — addTrack throws if the
      // track is already registered, so we guard with getSenders().
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
        // Ensure recvonly m-lines exist even when a track is missing (mic/cam
        // unavailable). This keeps both m-lines in every offer/answer so the
        // SDP structure never changes mid-call.
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
              // OFFERER: add tracks first so the offer SDP includes our streams.
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
            // ANSWERER step 1: process the remote offer. The browser creates
            // recvonly transceivers for each m-line in the offer.
            await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
            hasRemoteDesc.current = true;

            // ANSWERER step 2: add our tracks NOW. addTrack() finds the recvonly
            // transceivers that setRemoteDescription just created and upgrades
            // them to sendrecv, so our tracks appear in the answer. Doing this
            // before setRemoteDescription would leave pre-existing sendrecv
            // transceivers that the browser might not match with the offer's
            // m-lines, producing a recvonly answer instead.
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
  const feedRef = useRef<HTMLDivElement>(null);

  // Personalised prompts built from the match's top OCEAN dimensions
  const promptsRef = useRef<string[]>(FALLBACK_PROMPTS.slice(0, MAX_PROMPTS));
  const promptIdxRef = useRef(0);

  const { localVideoRef, remoteVideoRef, connected, micMuted, toggleMic, dispose } = useWebRTC(meetingId, token, callActive);

  // Fetch match dimensions once token is ready — before call starts
  useEffect(() => {
    if (!token || !meetingId) return;
    async function load() {
      try {
        // 1. Find the other user's ID from the meeting list
        const meetings = await fetch(`${API_URL}/api/v1/schedule`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.ok ? r.json() : []);
        const meeting = meetings.find((m: { id: string }) => m.id === meetingId);
        if (!meeting) return;
        const userId = session?.userId as string | undefined;
        const otherUserId = meeting.proposer_id === userId ? meeting.match_id : meeting.proposer_id;

        // 2. Get match detail → dimension_scores (ordered by score desc)
        const detail = await fetch(`${API_URL}/api/v1/matches/${otherUserId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.ok ? r.json() : null);

        if (!detail?.dimension_scores?.length) return;

        // 3. Build ordered prompt list from top dimensions, fill with fallbacks
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

  // Timer
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

  // Prompt scheduler: first at 3 min, then every 4.5 min — max 6 total
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

  if (verdict === "commit") {
    return <VerdictScreen headline="Committed" sub="Equilibrium will coordinate next steps with both parties." accent="var(--accent)" onContinue={() => router.push("/selection")} ctaLabel="Return to Selection" />;
  }
  if (verdict === "pool") {
    return <VerdictScreen headline="Returned to Pool" sub="Your profile remains active. A new selection will be presented within 48 hours." accent="var(--muted)" onContinue={() => router.push("/selection")} ctaLabel="Return to Selection" />;
  }

  if (callEnded) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-10 text-center px-8" style={{ background: "#0a0a0a" }}>
        <div>
          <p className="text-xs tracking-[0.25em] uppercase mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>Session Complete</p>
          <h2 className="serif font-normal" style={{ fontSize: "3rem", color: "#ffffff", lineHeight: 1.1 }}>Deliver Your Verdict</h2>
          <p className="text-sm mt-4 max-w-sm mx-auto" style={{ color: "rgba(255,255,255,0.55)", lineHeight: 1.7 }}>
            Based on your 30-minute session, do you wish to pursue a deeper connection or return to the candidate pool?
          </p>
        </div>
        <div className="flex gap-4">
          <button onClick={() => submitVerdict("commit")} disabled={submitting} className="px-10 py-4 text-sm tracking-[0.15em] uppercase font-medium transition-all" style={{ background: "var(--accent)", color: "#121212", opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "Submitting..." : "Commit"}
          </button>
          <button onClick={() => submitVerdict("pool")} disabled={submitting} className="px-10 py-4 text-sm tracking-[0.15em] uppercase font-medium transition-all" style={{ border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)", background: "transparent", opacity: submitting ? 0.6 : 1 }}>
            Return to Pool
          </button>
        </div>
      </motion.div>
    );
  }

  if (!callActive) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 text-center" style={{ background: "#0a0a0a" }}>
        <div className="w-16 h-16 flex items-center justify-center serif text-2xl" style={{ border: "1px solid rgba(255,77,77,0.5)", color: "#ffffff", background: "rgba(255,77,77,0.12)" }}>⚖</div>
        <div>
          <h2 className="serif text-3xl font-normal" style={{ color: "#ffffff" }}>30-Minute Session</h2>
          <p className="text-sm mt-2 max-w-xs" style={{ color: "rgba(255,255,255,0.55)" }}>
            Your camera and microphone will be requested. The session terminates automatically at 30:00.
          </p>
        </div>
        <button onClick={() => {
          // Resume an AudioContext during this user gesture so the browser
          // grants audio autoplay permission for the rest of the session.
          try {
            const ctx = new AudioContext();
            ctx.resume().then(() => ctx.close()).catch(() => {});
          } catch (_) {}
          setCallActive(true);
        }} className="px-10 py-4 text-sm tracking-[0.15em] uppercase font-medium" style={{ background: "var(--accent)", color: "#121212" }}>
          Begin Session
        </button>
      </motion.div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "#0a0a0a" }}>
      <div className="absolute top-0 left-0 right-0 h-0.5 transition-all duration-1000 z-10" style={{ width: `${pctLeft * 100}%`, background: isUrgent ? "#ef4444" : "rgba(255,255,255,0.4)" }} />

      {/* Timer — top center */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-5 py-2 flex items-center gap-3" style={{ border: `1px solid ${isUrgent ? "#ef4444" : "rgba(255,255,255,0.15)"}`, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)", borderRadius: "999px" }}>
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: isUrgent ? "#ef4444" : "rgba(255,255,255,0.5)" }} />
        <span className="font-mono text-lg tracking-widest" style={{ color: isUrgent ? "#ef4444" : "#ffffff", fontVariantNumeric: "tabular-nums" }}>
          {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
        </span>
      </div>


      {/* Bottom controls */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {/* Mic toggle */}
        <button
          onClick={toggleMic}
          title={micMuted ? "Unmute mic" : "Mute mic"}
          className="w-11 h-11 flex items-center justify-center transition-colors"
          style={{
            border: `1px solid ${micMuted ? "#ef4444" : "rgba(255,255,255,0.2)"}`,
            background: micMuted ? "rgba(239,68,68,0.15)" : "rgba(10,10,10,0.85)",
            backdropFilter: "blur(8px)",
            color: micMuted ? "#ef4444" : "rgba(255,255,255,0.7)",
          }}
        >
          {micMuted ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="1" y1="1" x2="23" y2="23"/>
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          )}
        </button>

        {/* End Session */}
        <button
          onClick={() => { setCallEnded(true); dispose(); }}
          className="px-6 py-3 text-xs tracking-[0.1em] uppercase font-medium transition-colors"
          style={{ border: "1px solid #ef4444", color: "#ef4444", background: "rgba(239,68,68,0.15)", backdropFilter: "blur(8px)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#ef4444"; e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.15)"; e.currentTarget.style.color = "#ef4444"; }}
        >
          End Session
        </button>
      </div>

      <div className="flex-1 relative" style={{ flex: 1, minHeight: 0, height: "calc(100vh - 50px)" }}>
        {/* Remote video — full screen */}
        <video 
          ref={remoteVideoRef} 
          autoPlay 
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{ width: "100%", height: "100%" }}
        />
        {!connected && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: "#0f0e0c" }}>
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center">
                <div className="w-full h-full animate-spin" style={{ border: "1px solid rgba(255,255,255,0.1)", borderTopColor: "rgba(255,255,255,0.6)", borderRadius: "50%" }} />
              </div>
              <p className="text-xs tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.4)" }}>Waiting for match to join...</p>
            </div>
          </div>
        )}

        {/* Local video — PIP top-right (below timer, doesn't overlap guide) */}
        <div className="absolute top-16 right-4 z-10 overflow-hidden" style={{ width: 120, height: 90, border: "1px solid rgba(255,255,255,0.2)", background: "#000", borderRadius: 8 }}>
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
        </div>

        {/* Conversation Guide — bottom-right */}
        <div className="absolute bottom-20 right-4 w-72 z-10" style={{ border: "1px solid rgba(255,255,255,0.12)", background: "rgba(10,10,10,0.92)", backdropFilter: "blur(8px)", borderRadius: 8 }}>
          <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>Conversation guide</span>
            </div>
            {feed.length > 0 && (
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>{feed.length} / {MAX_PROMPTS}</span>
            )}
          </div>

          <AnimatePresence mode="wait">
            {feed.length === 0 ? (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-4 py-4">
                <p className="text-xs italic leading-relaxed" style={{ color: "rgba(255,255,255,0.35)" }}>
                  A conversation prompt will appear at 3 minutes.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key={feed.length}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.4 }}
                className="px-4 py-4"
              >
                <p className="text-sm leading-relaxed" style={{ color: "#ffffff", lineHeight: 1.6 }}>
                  {feed[feed.length - 1].text}
                </p>
                {feed.length > 1 && (
                  <div className="mt-3 pt-3 space-y-1" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                    {feed.slice(0, -1).map((item, i) => (
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
      </div>
    </div>
  );
}

function VerdictScreen({ headline, sub, accent, onContinue, ctaLabel }: {
  headline: string; sub: string; accent: string; onContinue: () => void; ctaLabel: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 text-center px-8" style={{ background: "#0a0a0a" }}>
      <h2 className="serif font-normal" style={{ fontSize: "4rem", color: accent === "var(--accent)" ? "var(--accent)" : "#ffffff", lineHeight: 1 }}>{headline}</h2>
      <p className="text-sm max-w-sm" style={{ color: "rgba(255,255,255,0.55)", lineHeight: 1.8 }}>{sub}</p>
      <button onClick={onContinue} className="px-8 py-3 text-xs tracking-[0.2em] uppercase transition-all" style={{ border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)" }}>
        {ctaLabel}
      </button>
    </motion.div>
  );
}
