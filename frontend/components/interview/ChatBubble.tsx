"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ChatBubbleProps {
  role: "assistant" | "user";
  content: string;
  isStreaming?: boolean;
}

export function ChatBubble({ role, content, isStreaming }: ChatBubbleProps) {
  const isAssistant = role === "assistant";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn("flex gap-3", isAssistant ? "justify-start" : "justify-end")}
    >
      {isAssistant && (
        <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center text-sm flex-shrink-0 mt-1">
          ⚖️
        </div>
      )}
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isAssistant
            ? "bg-white border border-zinc-200 text-zinc-800 rounded-tl-sm"
            : "bg-violet-600 text-white rounded-tr-sm",
        )}
      >
        {content}
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 ml-0.5 bg-current opacity-70 animate-pulse" />
        )}
      </div>
    </motion.div>
  );
}
