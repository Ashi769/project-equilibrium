"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Send } from "lucide-react";
import { ChatBubble } from "./ChatBubble";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

interface Message {
  role: "assistant" | "user";
  content: string;
}

export function InterviewChat() {
  const { data: session } = useSession();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const [isStarting, setIsStarting] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Start interview session
  useEffect(() => {
    if (!session?.accessToken) return;

    api
      .post<{ session_id: string; opening_message: string }>(
        "/api/v1/interview/start",
        {},
        session.accessToken,
      )
      .then(({ session_id, opening_message }) => {
        setSessionId(session_id);
        setMessages([{ role: "assistant", content: opening_message }]);
        setIsStarting(false);
      })
      .catch(() => setIsStarting(false));
  }, [session?.accessToken]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming || !sessionId || !session?.accessToken) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsStreaming(true);

    // Add empty assistant bubble to stream into
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch(
        api.streamUrl(`/api/v1/interview/message`),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.accessToken}`,
          },
          body: JSON.stringify({ session_id: sessionId, message: userMessage }),
        },
      );

      if (!res.ok || !res.body) throw new Error("Stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // SSE format: "data: <text>\n\n"
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") {
              // Check if interview should end
              break;
            }
            if (data === "[END_INTERVIEW]") {
              setIsEnded(true);
              break;
            }
            fullText += data;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: "assistant", content: fullText };
              return updated;
            });
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, sessionId, session?.accessToken]);

  async function endInterview() {
    if (!sessionId || !session?.accessToken) return;
    await api.post(`/api/v1/interview/end`, { session_id: sessionId }, session.accessToken);
    router.push("/matches?processing=true");
  }

  if (isStarting) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3 text-zinc-400">
        <div className="w-8 h-8 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
        <p className="text-sm">Preparing your interview…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)] max-h-[700px]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 py-4 pr-2">
        <AnimatePresence>
          {messages.map((msg, i) => (
            <ChatBubble
              key={i}
              role={msg.role}
              content={msg.content}
              isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
            />
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Input or end state */}
      {isEnded ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-t border-zinc-200 pt-4 text-center space-y-3"
        >
          <p className="text-sm text-zinc-500">
            Interview complete! We're now building your profile.
          </p>
          <Button onClick={endInterview}>See My Matches →</Button>
        </motion.div>
      ) : (
        <div className="border-t border-zinc-200 pt-4 flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder="Type your response…"
            disabled={isStreaming}
            className="flex-1"
          />
          <Button onClick={sendMessage} disabled={isStreaming || !input.trim()} size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
