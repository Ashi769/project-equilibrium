"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { ChatBubble } from "./ChatBubble";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface Message { role: "assistant" | "user"; content: string; }
interface ResumeData { session_id: string; messages: Message[]; }

const PROGRESS_STAGES = [
  { pct: 0,  label: "Initializing Interview Protocol" },
  { pct: 12, label: "Establishing Baseline Psychology" },
  { pct: 28, label: "Calibrating Market Parity" },
  { pct: 44, label: "Analyzing Philosophical Alignment" },
  { pct: 60, label: "Mapping Attachment Patterns" },
  { pct: 76, label: "Synthesizing Compatibility Vectors" },
  { pct: 90, label: "Profile Calibration Complete" },
];

export function InterviewChat({ accessToken }: { accessToken: string }) {
  const router = useRouter();
  const [messages,    setMessages]    = useState<Message[]>([]);
  const [input,       setInput]       = useState("");
  const [sessionId,   setSessionId]   = useState<string | null>(null);
  const [isStreaming, setIsStreaming]  = useState(false);
  const [isEnded,     setIsEnded]     = useState(false);
  const [isStarting,  setIsStarting]  = useState(true);
  const [progress,    setProgress]    = useState(0);
  const [resumeData,  setResumeData]  = useState<ResumeData | null>(null);
  const [resumed,     setResumed]     = useState(false);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const userMsgCount = messages.filter((m) => m.role === "user").length;

  useEffect(() => {
    setProgress(Math.min(userMsgCount * 13, 88));
  }, [userMsgCount]);

  const currentStage = PROGRESS_STAGES.reduce(
    (acc, s) => (s.pct <= progress ? s : acc),
    PROGRESS_STAGES[0],
  );

  const startFresh = useCallback(() => {
    setResumeData(null);
    setIsStarting(true);
    api
      .post<{ session_id: string; opening_message: string }>("/api/v1/interview/start", {}, accessToken)
      .then(({ session_id, opening_message }) => {
        setSessionId(session_id);
        setMessages([{ role: "assistant", content: opening_message }]);
        setIsStarting(false);
      })
      .catch(() => setIsStarting(false));
  }, [accessToken]);

  const continueSession = useCallback((data: ResumeData) => {
    setSessionId(data.session_id);
    setMessages(data.messages);
    setResumed(true);
    setResumeData(null);
    setIsStarting(false);
  }, []);

  useEffect(() => {
    api
      .get<ResumeData | null>("/api/v1/interview/session", accessToken)
      .then((data) => {
        if (data?.session_id) {
          setResumeData(data);
          setIsStarting(false);
        } else {
          startFresh();
        }
      })
      .catch(() => startFresh());
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming || !sessionId) return;
    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch(api.streamUrl("/api/v1/interview/message"), {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body:    JSON.stringify({ session_id: sessionId, message: userMessage }),
      });
      if (!res.ok || !res.body) throw new Error("Stream failed");

      const reader   = res.body.getReader();
      const decoder  = new TextDecoder();
      let fullText   = "";
      let ended      = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let data: string;
          if (trimmed.startsWith("data: "))      data = trimmed.slice(6);
          else if (trimmed.startsWith("data:")) data = trimmed.slice(5);
          else continue;
          if (data === "[DONE]")           continue;
          if (data === "[END_INTERVIEW]") { ended = true; continue; }
          if (!ended) {
            fullText += data;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: "assistant", content: fullText };
              return updated;
            });
          }
        }
      }
      if (ended) setIsEnded(true);
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: "A transmission error occurred. Please continue.",
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, sessionId, accessToken]);

  async function endInterview() {
    if (!sessionId) return;
    setProgress(100);
    await api.post("/api/v1/interview/end", { session_id: sessionId }, accessToken);
    router.push("/selection?processing=true");
  }

  /* ─── Resume prompt ─── */
  if (resumeData) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-6 px-4">
        <div className="w-full max-w-sm p-6 border-2 border-[#2d2d2d] bg-white space-y-4"
          style={{ borderRadius: "var(--radius-wobbly)", boxShadow: "var(--shadow-hard)" }}>
          <div className="space-y-1">
            <p className="font-heading text-xl font-bold" style={{ color: "var(--ink)" }}>
              Unfinished interview
            </p>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              You started an interview earlier. Pick up where you left off?
            </p>
          </div>
          <div className="flex gap-3 pt-1">
            <Button className="flex-1" onClick={() => continueSession(resumeData)}>
              Continue
            </Button>
            <Button variant="outline" className="flex-1" onClick={startFresh}>
              Start fresh
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Loading state ─── */
  if (isStarting) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-5">
        <div
          className="w-14 h-14 border-4 border-dashed border-[#2d2d2d] spin-slow"
          style={{ borderRadius: "50%" }}
        />
        <p className="font-heading text-lg font-bold" style={{ color: "var(--ink)" }}>
          Initializing Protocol…
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 14rem)", maxHeight: "700px" }}>
      {/* Progress indicator */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium" style={{ color: "var(--muted)" }}>
            Compatibility Markers
          </span>
          <span className="text-sm font-heading font-bold" style={{ color: "var(--ink)" }}>
            {currentStage.label}
          </span>
        </div>
        <div
          className="h-4 border-2 border-[#2d2d2d] overflow-hidden"
          style={{ borderRadius: "var(--radius-wobbly-sm)", background: "var(--muted-bg)" }}
        >
          <div
            className="h-full transition-all duration-1000 ease-out"
            style={{
              width: `${progress}%`,
              background: "#2d5da1",
              borderRadius: "var(--radius-wobbly-sm)",
            }}
          />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 px-1 space-y-5">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <ChatBubble
              key={i}
              role={msg.role}
              content={msg.content}
              isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
              useTypewriter={!resumed && i === 0 && msg.role === "assistant"}
            />
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="pt-4 border-t-2 border-dashed border-[#e5e0d8]">
        {isEnded ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-4 py-2"
          >
            <div>
              <p className="font-heading text-lg font-bold" style={{ color: "var(--ink)" }}>
                Interview Protocol Complete ✓
              </p>
              <p className="text-base mt-1" style={{ color: "var(--muted)" }}>
                Generating your compatibility profile…
              </p>
            </div>
            <Button onClick={endInterview} className="gap-2">
              View Selection
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </Button>
          </motion.div>
        ) : (
          <div className="space-y-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              }}
              placeholder="Respond and press Enter to submit…"
              disabled={isStreaming}
              rows={1}
              className="w-full resize-none px-4 py-3 text-base border-2 border-[#2d2d2d] bg-white focus:outline-none transition-colors"
              style={{
                fontFamily: "'Patrick Hand', system-ui, sans-serif",
                borderRadius: "var(--radius-wobbly-sm)",
                boxShadow: "var(--shadow-hard-sm)",
                color: "var(--ink)",
                borderColor: isStreaming ? "#e5e0d8" : undefined,
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#2d5da1")}
              onBlur={(e)  => (e.currentTarget.style.borderColor = "#2d2d2d")}
            />
            <div className="flex justify-between items-center">
              <span className="text-sm" style={{ color: "var(--dim)" }}>
                Enter to respond · Shift+Enter for new line
              </span>
              {messages.length >= 6 && (
                <button
                  onClick={() => setIsEnded(true)}
                  className="text-sm font-medium transition-colors"
                  style={{ color: "var(--muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#2d5da1")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
                >
                  Conclude Interview →
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
