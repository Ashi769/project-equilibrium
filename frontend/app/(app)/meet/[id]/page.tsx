"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";

const TOTAL_SECONDS = 30 * 60;
const WS_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/^http/, "ws") ?? "ws://localhost:8000";
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

const AI_PROMPTS = [
  "Discuss your approaches to personal growth and reinvention.",
  "Share your views on career-life integration.",
  "Explore your thoughts on family planning timelines.",
  "Discuss your relationship with social connection and solitude.",
  "Share your approach to financial partnership.",
  "What does emotional availability mean to you?",
  "Discuss your ideal living arrangement in 5 years.",
  "How do you navigate disagreement in close relationships?",
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

      // Always add transceivers for both audio and video so the SDP always
      // has both m-lines. This lets either peer receive the other's media
      // even if one side's camera or mic is unavailable.
      // Passing the MediaStreamTrack directly as the first arg (not replaceTrack)
      // correctly sets the sender track AND the MSID in the SDP.
      const audioTrack = stream?.getAudioTracks()[0] ?? null;
      const videoTrack = stream?.getVideoTracks()[0] ?? null;
      const streams = stream ? [stream] : [];

      if (audioTrack) {
        pc.addTransceiver(audioTrack, { direction: "sendrecv", streams });
      } else {
        pc.addTransceiver("audio", { direction: "sendrecv" });
      }

      if (videoTrack) {
        pc.addTransceiver(videoTrack, { direction: "sendrecv", streams });
      } else {
        pc.addTransceiver("video", { direction: "sendrecv" });
      }

pc.ontrack = (e) => {
        const el = remoteVideoRef.current;
        if (!el) return;
        if (e.streams[0]) {
          // Normal path: sender associated a stream, use it directly.
          if (el.srcObject !== e.streams[0]) {
            el.srcObject = e.streams[0];
            el.play().catch(err => console.error("webrtc: play failed", err));
          }
        } else {
          // Fallback: no associated stream, accumulate tracks manually.
          const ms = el.srcObject instanceof MediaStream ? el.srcObject : new MediaStream();
          if (!ms.getTracks().includes(e.track)) ms.addTrack(e.track);
          if (el.srcObject !== ms) {
            el.srcObject = ms;
            el.play().catch(err => console.error("webrtc: play failed", err));
          }
        }
        setConnected(true);
      };

pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        console.log("webrtc: ICE state →", state);

        if (state === "connected" || state === "completed") {
          setConnected(true);
        }

        // "disconnected" is transient — the browser will attempt self-recovery.
        // Mark the UI as interrupted but do not restart ICE here; that would
        // race with the peer doing the same thing (glare).
        if (state === "disconnected") {
          setConnected(false);
        }

        // "failed" is terminal — recovery requires a new offer.
        // Only the offerer restarts to prevent both sides creating offers
        // simultaneously (glare). The answerer waits for the new offer.
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
          // WS not open yet — buffer and flush on open
          preWsCandidates.current.push(e.candidate.toJSON());
        }
      };

      // Serialize all message handling to avoid race conditions.
      // Each message handler awaits the previous one before running.
      function handleMessage(handler: () => Promise<void>) {
        msgQueue.current = msgQueue.current.then(handler).catch((err) => {
          console.error("webrtc: message handler error", err);
        });
      }

      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);

        if (msg.type === "peer-joined") {
          roleRef.current = msg.role;
          if (msg.role === "offerer") {
            handleMessage(async () => {
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
  }, []);

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
  const [promptIndex, setPromptIndex] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);

  const { localVideoRef, remoteVideoRef, connected, micMuted, toggleMic, dispose } = useWebRTC(meetingId, token, callActive);

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

  // AI prompts
  useEffect(() => {
    if (!callActive || callEnded) return;
    const id = setInterval(() => {
      const prompt = AI_PROMPTS[promptIndex % AI_PROMPTS.length];
      const now = new Date();
      const ts = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
      setFeed((prev) => [...prev, { text: prompt, ts }]);
      setPromptIndex((p) => p + 1);
    }, 18000);
    return () => clearInterval(id);
  }, [callActive, callEnded, promptIndex]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [feed]);

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
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 flex flex-col items-center justify-center gap-10 text-center px-8" style={{ background: "var(--bg)" }}>
        <div>
          <p className="text-xs tracking-[0.25em] uppercase mb-3" style={{ color: "var(--muted)" }}>Session Complete</p>
          <h2 className="serif font-normal" style={{ fontSize: "3rem", color: "var(--fg)", lineHeight: 1.1 }}>Deliver Your Verdict</h2>
          <p className="text-sm mt-4 max-w-sm mx-auto" style={{ color: "var(--muted)", lineHeight: 1.7 }}>
            Based on your 30-minute session, do you wish to pursue a deeper connection or return to the candidate pool?
          </p>
        </div>
        <div className="flex gap-4">
          <button onClick={() => submitVerdict("commit")} disabled={submitting} className="px-10 py-4 text-sm tracking-[0.15em] uppercase font-medium transition-all" style={{ background: "var(--accent)", color: "#121212", opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "Submitting..." : "Commit"}
          </button>
          <button onClick={() => submitVerdict("pool")} disabled={submitting} className="px-10 py-4 text-sm tracking-[0.15em] uppercase font-medium transition-all" style={{ border: "1px solid var(--border)", color: "var(--muted)", background: "transparent", opacity: submitting ? 0.6 : 1 }}>
            Return to Pool
          </button>
        </div>
      </motion.div>
    );
  }

  if (!callActive) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 flex flex-col items-center justify-center gap-8 text-center" style={{ background: "var(--bg)" }}>
        <div className="w-16 h-16 flex items-center justify-center serif text-2xl" style={{ border: "1px solid var(--accent)", color: "var(--accent)" }}>⚖</div>
        <div>
          <h2 className="serif text-3xl font-normal" style={{ color: "var(--fg)" }}>30-Minute Session</h2>
          <p className="text-sm mt-2 max-w-xs" style={{ color: "var(--muted)" }}>
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
    <div className="fixed inset-0 flex flex-col" style={{ background: "#0a0a0a" }}>
      <div className="absolute top-0 left-0 right-0 h-0.5 transition-all duration-1000 z-10" style={{ width: `${pctLeft * 100}%`, background: isUrgent ? "var(--red)" : "var(--accent)" }} />

      {/* Timer — top center */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-5 py-2 flex items-center gap-3" style={{ border: `1px solid ${isUrgent ? "var(--red)" : "var(--border)"}`, background: "rgba(10,10,10,0.9)" }}>
        <div className="w-1.5 h-1.5" style={{ background: isUrgent ? "var(--red)" : "var(--accent)" }} />
        <span className="font-mono text-lg tracking-widest" style={{ color: isUrgent ? "var(--red)" : "var(--fg)", fontVariantNumeric: "tabular-nums" }}>
          {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
        </span>
      </div>


      {/* Bottom controls */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3">
        {/* Mic toggle */}
        <button
          onClick={toggleMic}
          title={micMuted ? "Unmute mic" : "Mute mic"}
          className="w-11 h-11 flex items-center justify-center transition-colors"
          style={{
            border: `1px solid ${micMuted ? "#ef4444" : "var(--border)"}`,
            background: micMuted ? "rgba(239,68,68,0.15)" : "rgba(10,10,10,0.85)",
            backdropFilter: "blur(8px)",
            color: micMuted ? "#ef4444" : "var(--muted)",
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
                <div className="w-full h-full animate-spin" style={{ border: "1px solid var(--border)", borderTopColor: "var(--accent)" }} />
              </div>
              <p className="text-xs tracking-widest uppercase" style={{ color: "var(--dim)" }}>Waiting for match to join...</p>
            </div>
          </div>
        )}

        {/* Local video — PIP bottom-left */}
        <div className="absolute bottom-20 left-4 z-10 overflow-hidden" style={{ width: 180, height: 135, border: "1px solid var(--border)", background: "#000" }}>
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
          <div className="absolute bottom-1 right-2 text-xs" style={{ color: "var(--muted)", textShadow: "0 0 4px #000" }}>You</div>
        </div>

        {/* Matchmaker Feed — bottom-right */}
        <div className="absolute bottom-4 right-4 w-64 max-h-48 flex flex-col z-10" style={{ border: "1px solid var(--border)", background: "rgba(10,10,10,0.92)" }}>
          <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="w-1.5 h-1.5" style={{ background: "var(--accent)" }} />
            <span className="text-xs tracking-[0.15em] uppercase" style={{ color: "var(--accent)" }}>Matchmaker Feed</span>
          </div>
          <div ref={feedRef} className="flex-1 overflow-y-auto p-3 space-y-2">
            {feed.length === 0 ? (
              <p className="text-xs italic" style={{ color: "var(--dim)" }}>AI suggestions will appear here...</p>
            ) : (
              <AnimatePresence>
                {feed.map((item, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      <span style={{ color: "var(--dim)" }}>{item.ts} </span>
                      <span style={{ color: "var(--accent)" }}>AI → </span>
                      {item.text}
                    </p>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function VerdictScreen({ headline, sub, accent, onContinue, ctaLabel }: {
  headline: string; sub: string; accent: string; onContinue: () => void; ctaLabel: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="fixed inset-0 flex flex-col items-center justify-center gap-8 text-center px-8" style={{ background: "var(--bg)" }}>
      <h2 className="serif font-normal" style={{ fontSize: "4rem", color: accent, lineHeight: 1 }}>{headline}</h2>
      <p className="text-sm max-w-sm" style={{ color: "var(--muted)", lineHeight: 1.8 }}>{sub}</p>
      <button onClick={onContinue} className="px-8 py-3 text-xs tracking-[0.2em] uppercase transition-all" style={{ border: "1px solid var(--border)", color: "var(--muted)" }}>
        {ctaLabel}
      </button>
    </motion.div>
  );
}
