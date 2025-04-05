import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { type RunnableConfig } from "@langchain/core/runnables";
import { AgentState } from "../state";
import { model } from "../model";
import { sessionManager } from "../tools";

// Browser Worker Agent
const browserWorkerNode = async (
  state: typeof AgentState.State,
  config?: RunnableConfig
): Promise<Partial<typeof AgentState.State>> => {
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
      new AIMessage({
        content: `[BrowserWorker] ${lastMessage?.content ?? ""}`,
      })
    ]
  };
};

export default browserWorkerNode;
