import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { messages, threads } from "@/server/db/schema";
import { eq, desc } from "drizzle-orm";

export const chatRouter = createTRPCRouter({
  getThreads: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.query.threads.findMany({
      orderBy: (threads, { desc }) => [desc(threads.updatedAt)],
    });
  }),

  getThread: publicProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.threads.findFirst({
        where: (threads, { eq }) => eq(threads.id, input.threadId),
      });
    }),

  createThread: publicProcedure
    .input(z.object({ title: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [thread] = await ctx.db.insert(threads).values({
        title: input.title,
      }).returning();
      
      return thread;
    }),

  getMessages: publicProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.messages.findMany({
        where: (messages, { eq }) => eq(messages.threadId, input.threadId),
        orderBy: (messages, { asc }) => [asc(messages.createdAt)],
      });
    }),

  sendMessage: publicProcedure
    .input(z.object({ 
      threadId: z.string(),
      content: z.string().min(1),
      role: z.enum(["user", "assistant"])
    }))
    .mutation(async ({ ctx, input }) => {
      const [message] = await ctx.db.insert(messages).values({
        threadId: input.threadId,
        content: input.content,
        role: input.role,
      }).returning();

      // Update the thread's updatedAt timestamp
      await ctx.db.update(threads)
        .set({ updatedAt: new Date() })
        .where(eq(threads.id, input.threadId));
      
      return message;
    }),
});
