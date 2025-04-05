import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

// Define state schema for the workflow
export const AgentState = Annotation.Root({
  // Planner related state
  input: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  plan: Annotation<{ description: string; substeps: string[] }[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  pastSteps: Annotation<Record<string, any>[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  response: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  sources: Annotation<string[]>({
    reducer: (x, y) => y ?? x ?? [],
    default: () => [],
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  next: Annotation<string>({
    reducer: (x, y) => y ?? x ?? "END",
    default: () => "END",
  }),
  instruction: Annotation<string>({
    reducer: (x, y) => y ?? x ?? "",
    default: () => "",
  })
});
