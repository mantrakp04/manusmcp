import { z } from "zod";

// Plan related schemas
export const plan = z.object({
  steps: z.array(z.object({
    description: z.string().describe("A clear description of the step"),
    substeps: z.array(z.string()).describe("1-4 substeps that break down how to accomplish this step, depending on the complexity of the step."),
  })).describe("A list of high-level sequential steps with detailed expansions"),
});

export const response = z.object({
  response: z.string().describe("Response to user."),
});

// Session manager types
export interface SessionServices {
  shell: {
    shellTools: any[];
  };
  file: {
    fileTools: any[];
  };
  browser: {
    browserTools: any[];
  };
}

export interface SessionManager {
  getSessionServices: (sessionId: string) => SessionServices;
  clearSession: (sessionId: string) => Promise<void>;
}

// Member types for supervisor routing
export const members = ["fs_worker", "shell_worker", "browser_worker", "kb_worker", "ask_user", "update_user"] as const;
export type WorkerType = typeof members[number] | "END";
