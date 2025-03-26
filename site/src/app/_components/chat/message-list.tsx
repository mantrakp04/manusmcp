"use client";

import { api } from "@/trpc/react";
import { ChatMessage } from "./message";
import { useEffect, useRef } from "react";

interface MessageListProps {
  threadId: string;
}

// Define the message type to match what we expect from the API
interface Message {
  id: string;
  threadId: string;
  content: string;
  role: string;
  createdAt: Date | string | number;
}

export function MessageList({ threadId }: MessageListProps) {
  const { data: messages = [] } = api.chat.getMessages.useQuery({ threadId });
  const messageEndRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  
  return (
    <div className="space-y-4">
      {messages.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No messages yet. Start the conversation below.
        </div>
      ) : (
        messages.map((message: Message) => (
          <ChatMessage 
            key={message.id} 
            message={{
              id: message.id,
              content: message.content,
              // Ensure role is always one of the valid values
              role: message.role === "assistant" ? "assistant" : "user",
              createdAt: new Date(message.createdAt)
            }} 
          />
        ))
      )}
      <div ref={messageEndRef} />
    </div>
  );
} 