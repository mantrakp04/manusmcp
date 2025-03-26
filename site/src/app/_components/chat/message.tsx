import * as React from "react";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  message: {
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: Date;
  };
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  
  return (
    <div className={cn(
      "flex w-full items-start gap-2 py-4",
      isUser ? "flex-row" : "flex-row"
    )}>
      <div className={cn(
        "flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-md border text-sm font-semibold",
        isUser ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-800"
      )}>
        {isUser ? "U" : "AI"}
      </div>
      <div className="flex-1 space-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed">{message.content}</p>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-gray-500">
            {new Date(message.createdAt).toLocaleTimeString()}
          </p>
        </div>
      </div>
    </div>
  );
} 