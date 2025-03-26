import { redirect } from "next/navigation";
import { api } from "@/trpc/server";

export default async function Home() {
  // Get threads or create a default thread
  const threads = await api.chat.getThreads();
  
  if (threads && threads.length > 0 && threads[0]?.id) {
    // Redirect to the first thread
    redirect(`/chat/${threads[0].id}`);
  } else {
    // Create a new default thread
    const newThread = await api.chat.createThread({
      title: "New Conversation"
    });
    
    if (newThread) {
      redirect(`/chat/${newThread.id}`);
    }
  }
  
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Initializing Chat...</h1>
        <p className="text-muted-foreground">Please wait while we set up your chat environment.</p>
      </div>
    </div>
  );
}
