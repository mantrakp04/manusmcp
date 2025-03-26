"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/trpc/react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface Thread {
  id: string;
  title: string;
  createdAt: Date | string | number;
  updatedAt?: Date | string | number | null;
}

export function ThreadList() {
  const router = useRouter();
  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  
  // Get the list of threads
  const { data: threads = [], refetch } = api.chat.getThreads.useQuery();
  
  // Create a new thread
  const createThreadMutation = api.chat.createThread.useMutation({
    onSuccess: (newThread) => {
      if (newThread?.id) {
        setNewThreadTitle("");
        setIsCreating(false);
        refetch();
        router.push(`/chat/${newThread.id}`);
      }
    },
    onError: () => {
      setIsCreating(false);
    }
  });
  
  const handleCreateThread = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newThreadTitle.trim() || isCreating) return;
    
    setIsCreating(true);
    createThreadMutation.mutate({
      title: newThreadTitle
    });
  };

  // Format date safely
  const formatDate = (date: Date | string | number | null | undefined) => {
    if (!date) return "";
    try {
      return new Date(date).toLocaleDateString();
    } catch (e) {
      return "";
    }
  };
  
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b">
        <h2 className="text-lg font-semibold">Chat Threads</h2>
      </div>
      
      <div className="flex-1 overflow-auto py-2">
        {threads?.map((thread: Thread) => (
          <Link href={`/chat/${thread.id}`} key={thread.id} passHref>
            <div className="flex items-center px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md cursor-pointer">
              <div className="flex-1 truncate">
                <span className="font-medium">{thread.title}</span>
                <p className="text-xs text-gray-500">
                  {formatDate(thread.updatedAt) || formatDate(thread.createdAt)}
                </p>
              </div>
            </div>
          </Link>
        ))}
        
        {(!threads || threads.length === 0) && (
          <div className="px-4 py-6 text-center text-gray-500">
            No threads yet. Create one below.
          </div>
        )}
      </div>
      
      <div className="p-4 border-t">
        <form onSubmit={handleCreateThread} className="flex gap-2">
          <Input
            placeholder="New thread title..."
            value={newThreadTitle}
            onChange={(e) => setNewThreadTitle(e.target.value)}
            disabled={isCreating}
            className="flex-1"
          />
          <Button 
            type="submit"
            disabled={!newThreadTitle.trim() || isCreating}
          >
            Create
          </Button>
        </form>
      </div>
    </div>
  );
} 