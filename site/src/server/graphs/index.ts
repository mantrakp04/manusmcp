import "dotenv/config";
import { StateGraph, Annotation, START, END, MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import zodToJsonSchema from "zod-to-json-schema";

import { model } from "./model";
import supervisor from "./supervisor";
import { type RunnableConfig } from "@langchain/core/runnables";

// Schemas
// Plan related schemas
const plan = z.object({
  steps: z.array(z.object({
    description: z.string().describe("A clear description of the step"),
    substeps: z.array(z.string()).describe("1-4 substeps that break down how to accomplish this step, depending on the complexity of the step."),
  })).describe("A list of high-level sequential steps with detailed expansions"),
});
const planTool = {
  type: "function",
  function: {
    name: "plan",
    description: "This tool is used to plan the steps to follow",
    parameters: zodToJsonSchema(plan)
  },
}
const response = z.object({
  response: z.string().describe("Response to user."),
});
const responseTool = {
  type: "function",
  function: {
    name: "response",
    description: "This tool is used to respond to the user",
    parameters: zodToJsonSchema(response)
  },
}


// State
const AgentState = Annotation.Root({
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
});


// Step 1: Plan
async function planStep(state: typeof AgentState.State, config?: RunnableConfig): Promise<Partial<typeof AgentState.State>> {
  const prompt = ChatPromptTemplate.fromTemplate(
    `
    You are a planner that breaks down a complex task into high-level steps and expands them into detailed hierarchical plans.
    For the following task:
    {input}

    Create a list of 1-7 high-level sequential steps to accomplish this task.
    Each step should be a clear, actionable item that leads towards the final goal.
    For each high-level step, create a detailed expansion with:
    1. A clear description of the step
    2. 1-4 substeps that break down how to accomplish this step, depending on the complexity of the step.
    `
  )
  const chain = prompt.pipe(model.withStructuredOutput(plan))
  const output = await chain.invoke({ input: state.input }, config)
  return { plan: output.steps };
}

// Step 2: Execute agent
async function agentExecutor(state: typeof AgentState.State, config?: RunnableConfig): Promise<Partial<typeof AgentState.State>> {
  const task = state.plan[0]
  const { messages } = await supervisor.invoke({
    messages: [new HumanMessage(
      "Based on this information, which worker should handle this task?" +
      "Respond with one of: file_worker, shell_worker, browser_worker, or END if complete." +
      "Provide detailed instructions for the selected worker." +
      "Task: " + task?.description +
      "Substeps:\n" + task?.substeps.join('\n')
    )]
  }, config)
  return {
    plan: state.plan.slice(1),
    pastSteps: [[task, messages[messages.length - 1]?.content.toString()]],
  }
}

// Step 3: Replan
async function replanStep(state: typeof AgentState.State, config?: RunnableConfig): Promise<Partial<typeof AgentState.State>> {
  const prompt = ChatPromptTemplate.fromTemplate(
    `
    For the given objective, come up with a simple step by step plan. 
    This plan should involve individual tasks, that if executed correctly will yield the correct answer. Do not add any superfluous steps.
    The result of the final step should be the final answer. Make sure that each step has all the information needed - do not skip steps.

    Your objective was this:
    {input}

    Your original plan was this:
    {plan}

    You have currently done the follow steps:
    {pastSteps}

    Update your plan accordingly. If no more steps are needed and you can return to the user, then respond with that and use the 'response' function.
    Otherwise, fill out the plan.  
    Only add steps to the plan that still NEED to be done. Do not return previously done steps as part of the plan.
    `
  )
  const chain = prompt.pipe(
    model.bindTools([planTool, responseTool])
  )
  const output = await chain.invoke({
    input: state.input,
    plan: state.plan.map((step, i) => 
      `${i+1}. ${step.description}\n` + 
      step.substeps.map((substep, j) => `   ${String.fromCharCode(97 + j)}. ${substep}`).join('\n')
    ).join('\n\n'),
    pastSteps: state.pastSteps.map(({step, result}) => `${step}: ${result}`).join('\n')
  }, config)
  const toolCall = output.tool_calls?.[0]
  if (toolCall?.name === "response") {
    return { response: toolCall.args?.response }
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

const workflow = new StateGraph(AgentState)
  .addNode("planner", planStep)
  .addNode("supervisor", agentExecutor)
  .addNode("replan", replanStep)
  .addEdge(START, "planner")
  .addEdge("planner", "supervisor")
  .addConditionalEdges("supervisor", continueOrRespond, {
    true: END,
    false: "replan"
  })

// export const memory = SqliteSaver.fromConnString(env.DATABASE_URL)
const app = workflow.compile();

export default app;

// Test
const test = async () => {
  for await (const event of app.streamEvents(
    { input: "Deepanalyze fish food companies" },
    { configurable: { thread_id: "123" }, version: "v2" }
  )) {
    console.log(`${event.event}: ${event.name}`);
  }
}
test();
