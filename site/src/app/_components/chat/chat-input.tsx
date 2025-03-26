"use client";

import * as React from "react";
import { useState } from "react";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { api } from "@/trpc/react";

interface ChatInputProps {
  threadId: string;
  onMessageSent?: () => void;
}

export function ChatInput({ threadId, onMessageSent }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const sendMessageMutation = api.chat.sendMessage.useMutation({
    onSuccess: () => {
      setMessage("");
      setIsSubmitting(false);
      onMessageSent?.();
    },
    onError: () => {
      setIsSubmitting(false);
    }
  });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    sendMessageMutation.mutate({
      threadId,
      content: message,
      role: "user"
    });
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };
  
  return (
    <form onSubmit={handleSubmit} className="relative">
      <Textarea
        placeholder="Type your message..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        className="min-h-[60px] resize-none py-3 pr-12"
        disabled={isSubmitting}
      />
      <Button 
        type="submit" 
        disabled={!message.trim() || isSubmitting}
        className="absolute bottom-3 right-3 h-8 w-8 rounded-full p-0"
      >
        Send
      </Button>
    </form>
  );
} 