"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

interface ChatBubbleProps {
  role: "assistant" | "user";
  content: string;
  isStreaming?: boolean;
  useTypewriter?: boolean;
}

function useTypewriter(text: string, speed = 18, enabled = false) {
  const [output, setOutput] = useState(enabled ? "" : text);

  useEffect(() => {
    if (!enabled || !text) { setOutput(text); return; }
    setOutput("");
    let i = 0;
    const id = setInterval(() => {
      i++;
      setOutput(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, enabled, speed]);

  return output;
}

export function ChatBubble({ role, content, isStreaming, useTypewriter: tw = false }: ChatBubbleProps) {
  const isAssistant = role === "assistant";
  const displayed   = useTypewriter(content, 18, tw && isAssistant);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      className={cn("flex gap-3 items-end", isAssistant ? "justify-start" : "justify-end")}
    >
      {/* Assistant avatar */}
      {isAssistant && (
        <div
          className="w-7 h-7 flex items-center justify-center flex-shrink-0 border-2 border-[#2d2d2d] text-sm font-heading font-bold"
          style={{ background: "var(--postit)", borderRadius: "50%", boxShadow: "var(--shadow-hard-sm)" }}
        >
          ⚖
        </div>
      )}

      {/* Bubble */}
      <div
        className="max-w-[78%] px-4 py-3 text-base leading-relaxed whitespace-pre-wrap break-words border-2 border-[#2d2d2d]"
        style={
          isAssistant
            ? {
                background: "var(--surface)",
                color: "var(--ink)",
                borderRadius: "var(--radius-wobbly-sm)",
                boxShadow: "var(--shadow-hard-sm)",
              }
            : {
                background: "var(--accent)",
                color: "#ffffff",
                borderRadius: "var(--radius-wobbly-sm)",
                boxShadow: "var(--shadow-hard-sm)",
              }
        }
      >
        {isAssistant ? (
          <ReactMarkdown
            components={{
              p:      ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
              strong: ({ children }) => <strong className="font-bold">{children}</strong>,
            }}
          >
            {displayed}
          </ReactMarkdown>
        ) : (
          content
        )}
        {(isStreaming || (tw && displayed !== content)) && (
          <span
            className="cursor-blink inline-block w-0.5 h-4 ml-0.5 align-middle"
            style={{ background: isAssistant ? "var(--ink)" : "rgba(255,255,255,0.7)" }}
          />
        )}
      </div>
    </motion.div>
  );
}
