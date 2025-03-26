"use client";

import { useState } from "react";
import { api } from "@/trpc/react";
import { ChatInput } from "./chat-input";

interface ChatInputContainerProps {
  threadId: string;
}

export default function ChatInputContainer({ threadId }: ChatInputContainerProps) {
  const utils = api.useUtils();
  
  const handleMessageSent = () => {
    // Invalidate messages query to refetch data
    utils.chat.getMessages.invalidate({ threadId });
  };
  
  return <ChatInput threadId={threadId} onMessageSent={handleMessageSent} />;
} 