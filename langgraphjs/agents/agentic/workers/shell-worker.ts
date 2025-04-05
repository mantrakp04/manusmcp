import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { type RunnableConfig } from "@langchain/core/runnables";
import { AgentState } from "../state";
import { model } from "../model";
import { sessionManager } from "../tools";

// Shell Worker Agent
const shellWorkerNode = async (
  state: typeof AgentState.State,
  config?: RunnableConfig
): Promise<Partial<typeof AgentState.State>> => {
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
      new AIMessage({
        content: `[ShellWorker] ${lastMessage?.content ?? ""}`,
      })
    ]
  };
};

export default shellWorkerNode;
