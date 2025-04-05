import { StateGraph, START, END } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import zodToJsonSchema from "zod-to-json-schema";
import { LibSQLDatabase } from "drizzle-orm/libsql";
import { type RunnableConfig } from "@langchain/core/runnables";
import fs from "fs";
import path from "path";

import { model } from "@/server/agents/agentic/model";
import supervisor from "@/server/agents/agentic/supervisor";
import { sessionManager } from "@/server/agents/agentic/tools";
import { AgentState } from "@/server/agents/agentic/state";
import { plan, response } from "@/server/agents/agentic/types";
import { plannerPrompt, replannerPrompt } from "@/server/agents/agentic/prompts";
import { DrizzleSaver } from "@/server/agents/agentic/drizzleSaver";
import { db } from "@/server/db/index";

// Convert schemas to tools
const planTool = {
  type: "function",
  function: {
    name: "plan",
    description: "This tool is used to plan the steps to follow",
    parameters: zodToJsonSchema(plan)
  },
};

const responseTool = {
  type: "function",
  function: {
    name: "response",
    description: "This tool is used to respond to the user",
    parameters: zodToJsonSchema(response)
  },
};

// Step 1: Plan
async function planStep(state: typeof AgentState.State, config?: RunnableConfig): Promise<Partial<typeof AgentState.State>> {
  const chain = plannerPrompt.pipe(model.withStructuredOutput(plan));
  const output = await chain.invoke({ input: state.input }, config);
  return { plan: output.steps };
}

// Step 2: Execute agent
async function agentExecutor(state: typeof AgentState.State, config?: RunnableConfig): Promise<Partial<typeof AgentState.State>> {
  const task = state.plan[0];
  const { messages } = await supervisor.invoke({
    messages: [new HumanMessage(
      "Based on this information, which worker should handle this task?" +
      "Respond with one of: file_worker, shell_worker, browser_worker, kb_worker or END if complete." +
      "Provide detailed instructions for the selected worker." +
      "Task: " + task?.description +
      "Substeps:\n" + task?.substeps.join('\n')
    )]
  }, config);
  
  return {
    plan: state.plan.slice(1),
    pastSteps: [{
      step: task?.description,
      result: messages[messages.length - 1]?.content.toString()
    }],
  };
}

// Step 3: Replan
async function replanStep(state: typeof AgentState.State, config?: RunnableConfig): Promise<Partial<typeof AgentState.State>> {
  const chain = replannerPrompt.pipe(
    model.bindTools([planTool, responseTool])
  );
  
  const output = await chain.invoke({
    input: state.input,
    plan: state.plan.map((step, i) => 
      `${i+1}. ${step.description}\n` + 
      step.substeps.map((substep, j) => `   ${String.fromCharCode(97 + j)}. ${substep}`).join('\n')
    ).join('\n\n'),
    pastSteps: state.pastSteps.map(({step, result}) => `${step}: ${result}`).join('\n')
  }, config);
  
  const toolCall = output.tool_calls?.[0];
  if (toolCall?.name === "response") {
    return { response: toolCall.args?.response };
  }
  
  // Ensure that the plan steps have the required properties
  const steps = toolCall?.args?.steps || [];
  const validatedSteps = steps.map((step: typeof AgentState.State['plan'][number]) => ({
    description: step.description || "",
    substeps: step.substeps || []
  }));
  
  return { plan: validatedSteps };
}

// Step 4: Determine whether to continue or respond
function continueOrRespond(state: typeof AgentState.State): string {
  return state.response ? "true" : "false";
}

// Step 5: Clean up any session resources when done responding to user
async function cleanup(state: typeof AgentState.State, config?: RunnableConfig): Promise<Partial<typeof AgentState.State>> {
  // Get thread_id from config
  const threadId = config?.configurable?.thread_id as string;
  
  if (threadId) {
    try {
      // Clean up session resources
      await sessionManager.clearSession(threadId);
      console.log(`Cleaned up session resources for thread ID: ${threadId}`);
    } catch (error) {
      console.error(`Error cleaning up session resources for thread ID: ${threadId}`, error);
    }
  }
  
  // Return the state unchanged
  return {};
}

// Create the workflow
const workflow = new StateGraph(AgentState)
  .addNode("planner", planStep)
  .addNode("supervisor", agentExecutor)
  .addNode("replan", replanStep)
  .addNode("cleanup", cleanup)
  .addEdge(START, "planner")
  .addEdge("planner", "supervisor")
  .addConditionalEdges("supervisor", continueOrRespond, {
    true: "cleanup",
    false: "replan"
  })
  .addEdge("replan", "supervisor")
  .addEdge("cleanup", END);

// TODO: Implement a proper DrizzleSaver using the project's DB schema
// This should use the existing DB instance from src/server/db/index.ts
// instead of SqliteSaver that creates its own connection
const memory = new DrizzleSaver(db as unknown as LibSQLDatabase);

// Compile the workflow
const app = workflow.compile({ checkpointer: memory });

export default app;

export const example = async () => {
  try {
    // Create or clear the log file
    const logStream = fs.createWriteStream(path.resolve("logs.log"), { flags: "w" });
    
    for await (const event of app.streamEvents(
      { input: "Deep analyze tesla stock" },
      { version: "v2", configurable: { thread_id: "123" + Date.now().toString().slice(0, 2), recursionLimit: 100 } }
    )) {
      const kind = event.event;
      const logMessage = `${kind}: ${event.name}`;
      
      // Log to console
      console.log(logMessage);
      
      // Write to log file
      logStream.write(logMessage + "\n");
      
      if (event.name === "browser_view") {
        console.log(event.data);
        logStream.write(JSON.stringify(event.data, null, 2) + "\n");
      }
    }
    
    // Close the log stream
    logStream.end();
  } catch (error) {
    console.error("TEST EXECUTION ERROR:", error);
    // Also log errors to file
    fs.appendFileSync("logs.log", `TEST EXECUTION ERROR: ${error}\n`);
  }
}
