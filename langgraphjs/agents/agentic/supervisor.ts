import { StateGraph, START, END, interrupt } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { type RunnableConfig } from "@langchain/core/runnables";

// Import model and prompts
import { model } from "./model";
import { supervisorPrompt } from "./prompts";
import { AgentState } from "./state";
import { members } from "./types";
import type { WorkerType } from "./types";

// Import workers
import { fsWorker, shellWorker, browserWorker, kbWorker } from "./workers";

// Ask User node that interrupts for human input
const askUserNode = async (
  state: typeof AgentState.State
): Promise<Partial<typeof AgentState.State>> => {
  // Use interrupt to pause and wait for human input
  const userInput = interrupt({
    type: "ask_user",
    question: state.instruction,
    context: state.messages
  });
  
  // Return the user's input as a message
  return {
    messages: [
      {
        content: `[User] ${userInput ?? ""}`,
        _getType: () => "human"
      } as BaseMessage
    ]
  };
};

// Update User node that interrupts to show information to the user
const updateUserNode = async (
  state: typeof AgentState.State
): Promise<Partial<typeof AgentState.State>> => {
  // Use interrupt to pause and show information to the user
  interrupt({
    type: "update_user",
    message: state.instruction,
    context: state.messages
  });
  
  // Return an empty update since we're just showing information
  return {
    messages: [
      {
        content: `[System] Information shared with user`,
        _getType: () => "ai"
      } as BaseMessage
    ]
  };
};

// Create the router function that decides which worker should handle the current task
const supervisorNode = async (state: typeof AgentState.State, config?: RunnableConfig) => {
  // Use the model to decide which worker to route to
  const chainResult = await supervisorPrompt
    .pipe(model.bindTools([
      {
        type: "function",
        function: {
          name: "router",
          description: "Selects the next worker to act",
          parameters: {
            type: "object",
            properties: {
              next: {
                type: "string",
                enum: [END, ...members],
                description: "The next worker to act"
              },
              instructions: {
                type: "string",
                description: "Instructions for the next worker"
              }
            },
            required: ["next", "instructions"]
          }
        }
      }
    ], { tool_choice: "router" }))
    .invoke({ messages: state.messages }, config);

  // Extract the worker and instructions
  const toolCall = chainResult.tool_calls?.[0];
  if (!toolCall) {
    return { next: END as WorkerType };
  }

  return {
    next: toolCall.args.next as WorkerType,
    instruction: toolCall.args.instructions
  };
};

// Create the supervisor subgraph
const supervisorSubgraph = new StateGraph(AgentState)
  // Add the nodes
  .addNode("supervisor", supervisorNode)
  .addNode("fs_worker", fsWorker)
  .addNode("shell_worker", shellWorker)
  .addNode("browser_worker", browserWorker)
  .addNode("kb_worker", kbWorker)
  .addNode("ask_user", askUserNode)
  .addNode("update_user", updateUserNode);

// Add edges from workers back to supervisor
members.forEach(member => {
  supervisorSubgraph.addEdge(member, "supervisor");
});

// Add conditional edges from router to workers
supervisorSubgraph.addConditionalEdges(
  "supervisor",
  (state: typeof AgentState.State) => state.next,
  {
    fs_worker: "fs_worker",
    shell_worker: "shell_worker",
    browser_worker: "browser_worker",
    kb_worker: "kb_worker",
    ask_user: "ask_user",
    update_user: "update_user",
    [END]: END
  }
);

// Add edge from start to supervisor
supervisorSubgraph.addEdge(START, "supervisor");

// Compile the supervisor subgraph
const app = supervisorSubgraph.compile();

export default app;
