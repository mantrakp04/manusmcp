import React from "react";
import { api } from "@/trpc/server";
import { ThreadList } from "@/app/_components/chat/thread-list";
import { HydrateClient } from "@/trpc/server";

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Prefetch threads for the sidebar
  await api.chat.getThreads.prefetch();
  
  return (
    <div className="flex h-screen">
      <HydrateClient>
        {/* Sidebar */}
        <aside className="w-64 border-r hidden md:block">
          <ThreadList />
        </aside>
        
        {/* Mobile sidebar (simplified for this example) */}
        <div className="md:hidden fixed bottom-4 right-4 z-10">
          {/* Mobile thread button would go here */}
        </div>
        
        {/* Main content */}
        <main className="flex-1 flex flex-col">
          {children}
        </main>
      </HydrateClient>
    </div>
  );
} 