import "dotenv/config";
import { StateGraph, Annotation, START, END, interrupt } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { type RunnableConfig } from "@langchain/core/runnables";

// Import your model and tools definition from the main file
import { model } from "./model";
import { sessionManager } from "./tools";
import fileWorker from "./fileWorker";
import kbWorker from "./kbWorker";

// Define state schema for the supervisor subgraph
const SupervisorState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  next: Annotation<string>({
    reducer: (x, y) => y ?? x ?? END,
    default: () => END,
  }),
  instruction: Annotation<string>({
    reducer: (x, y) => y ?? x ?? "",
    default: () => "",
  })
});

// Shell Worker Agent
const shellWorkerNode = async (
  state: typeof SupervisorState.State,
  config?: RunnableConfig
): Promise<Partial<typeof SupervisorState.State>> => {
  // Get thread_id from config to use as session ID
  const threadId = config?.configurable?.thread_id as string || "default";
  
  // Get shell tools for this specific session
  const services = sessionManager.getSessionServices(threadId);
  const shellTools = services.shell.shellTools;
  
  const shellAgent = createReactAgent({
    llm: model,
    tools: shellTools,
    stateModifier: new SystemMessage(
      "You are a system operations specialist. You execute shell commands and scripts."
    )
  });

  const input = {
    messages: [
      new HumanMessage(state.instruction)
    ]
  };

  const result = await shellAgent.invoke(input, config);
  const lastMessage = result.messages[result.messages.length - 1];
  
  return {
    messages: [
      new HumanMessage({ 
        content: `[ShellWorker] ${lastMessage?.content ?? ""}`, 
      })
    ]
  };
};

// Browser Worker Agent
const browserWorkerNode = async (
  state: typeof SupervisorState.State,
  config?: RunnableConfig
): Promise<Partial<typeof SupervisorState.State>> => {
  // Get thread_id from config to use as session ID
  const threadId = config?.configurable?.thread_id as string || "default";
  
  // Get browser tools for this specific session
  const services = sessionManager.getSessionServices(threadId);
  const browserTools = services.browser.browserTools;
  
  const browserAgent = createReactAgent({
    llm: model,
    tools: browserTools,
    stateModifier: new SystemMessage(
      "You are a web research specialist. You browse the web, search for information, and extract data."
    )
  });

  const input = {
    messages: [
      new HumanMessage(state.instruction)
    ]
  };

  const result = await browserAgent.invoke(input, config);
  const lastMessage = result.messages[result.messages.length - 1];
  
  return {
    messages: [
      new HumanMessage({ 
        content: `[BrowserWorker] ${lastMessage?.content ?? ""}`, 
      })
    ]
  };
};

// Ask User node that interrupts for human input
const askUserNode = async (
  state: typeof SupervisorState.State
): Promise<Partial<typeof SupervisorState.State>> => {
  // Use interrupt to pause and wait for human input
  const userInput = interrupt({
    type: "ask_user",
    question: state.instruction,
    context: state.messages
  });
  
  // Return the user's input as a message
  return {
    messages: [
      new HumanMessage({ 
        content: `[User] ${userInput ?? ""}`, 
      })
    ]
  };
};

// Update User node that interrupts to show information to the user
const updateUserNode = async (
  state: typeof SupervisorState.State
): Promise<Partial<typeof SupervisorState.State>> => {
  // Use interrupt to pause and show information to the user
  interrupt({
    type: "update_user",
    message: state.instruction,
    context: state.messages
  });
  
  // Return an empty update since we're just showing information
  return {
    messages: [
      new AIMessage({ 
        content: `[System] Information shared with user`, 
      })
    ]
  };
};

// Define the members for the supervisor to route between
const members = ["file_worker", "shell_worker", "browser_worker", "kb_worker", "ask_user", "update_user"] as const;

// Create the router function that decides which worker should handle the current task
const supervisorNode = async (state: typeof SupervisorState.State, config?: RunnableConfig) => {
  // Create the routing prompt
  const systemPrompt = `
    You are a supervisor tasked with routing tasks to specialized workers.
    Available workers:
    - file_worker: Handles file operations, reading, writing, and file management
    - shell_worker: Executes shell commands and scripts
    - browser_worker: Handles web browsing, searching, and information retrieval
    - kb_worker: Retrieves information from the knowledge base using RAG (Retrieval-Augmented Generation)
    - ask_user: Requests input or information from the human user
    - update_user: Provides updates, status information, or results to the human user
    Given the task description and substeps, select the most appropriate worker.
    If the task is complete, respond with END.
`;

  const routingPrompt = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    new MessagesPlaceholder("messages"),
  ]);

  // Routing tool definition
  const routeTool = {
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
  };

  // Use the model to decide which worker to route to
  const chainResult = await routingPrompt
    .pipe(model.bindTools([routeTool], { tool_choice: "router" }))
    .invoke({ messages: state.messages }, config);

  // Extract the worker and instructions
  const toolCall = chainResult.tool_calls?.[0];
  if (!toolCall) {
    return { next: END };
  }

  return {
    next: toolCall.args.next,
    instruction: toolCall.args.instructions
  };
};

// Create the supervisor subgraph
const supervisorSubgraph = new StateGraph(SupervisorState)
  // Add the nodes
  .addNode("supervisor", supervisorNode)
  .addNode("file_worker", fileWorker)
  .addNode("shell_worker", shellWorkerNode)
  .addNode("browser_worker", browserWorkerNode)
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
  (state: typeof SupervisorState.State) => state.next,
  {
    file_worker: "file_worker",
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