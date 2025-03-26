import React from "react";
import { notFound } from "next/navigation";
import { api } from "@/trpc/server";
import { HydrateClient } from "@/trpc/server";
import { MessageList } from "@/app/_components/chat/message-list";
import ChatInputContainer from "@/app/_components/chat/chat-input-container";

interface ChatPageProps {
  params: {
    threadId: string;
  };
}

export default async function ChatPage({ params }: ChatPageProps) {
  const { threadId } = params;
  
  // Fetch the thread details
  const thread = await api.chat.getThread({ threadId });
  
  if (!thread) {
    notFound();
  }
  
  // Prefetch messages for faster initial render
  await api.chat.getMessages.prefetch({ threadId });
  
  return (
    <HydrateClient>
      <div className="flex flex-col h-[calc(100vh-64px)]">
        <div className="px-4 py-2 border-b">
          <h1 className="text-xl font-semibold">{thread.title}</h1>
          <p className="text-sm text-gray-500">
            Created {new Date(thread.createdAt).toLocaleDateString()}
          </p>
        </div>
        
        <div className="flex-1 overflow-auto p-4">
          <MessageList threadId={threadId} />
        </div>
        
        <div className="p-4 border-t">
          <ChatInputContainer threadId={threadId} />
        </div>
      </div>
    </HydrateClient>
  );
} 