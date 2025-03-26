import "dotenv/config";
import { StateGraph, MessagesAnnotation, Command, START, END } from "@langchain/langgraph";
import { createReactAgent, ToolNode } from "@langchain/langgraph/prebuilt";
import { SystemMessage, ToolMessage } from "@langchain/core/messages";
import { type RunnableConfig } from "@langchain/core/runnables";

import { model } from "./model";
import { sessionManager } from "./tools";

// File tool node will be initialized per call based on thread_id
const getFileToolNode = (config?: RunnableConfig) => {
  const threadId = config?.configurable?.thread_id as string || "default";
  const services = sessionManager.getSessionServices(threadId);
  return new ToolNode(services.file.fileTools);
};

// Create a function to get thread-specific file tools and bind them to model
const getModelWithTools = (config?: RunnableConfig) => {
  const threadId = config?.configurable?.thread_id as string || "default";
  const services = sessionManager.getSessionServices(threadId);
  return model.bindTools(services.file.fileTools);
};

const shouldContinue = (state: typeof MessagesAnnotation.State) => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];
  if (lastMessage && "tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls?.length) {
    return "tools";
  }
  return END;
}

const callModel = async (state: typeof MessagesAnnotation.State, config?: RunnableConfig) => {
  const { messages } = state;
  const modelWithTools = getModelWithTools(config);
  const response = await modelWithTools.invoke(messages, config);
  return { messages: response };
}

const callFileToolNode = async (state: typeof MessagesAnnotation.State, config?: RunnableConfig) => {
  const { messages } = state;
  const fileToolNode = getFileToolNode(config);
  const threadId = config?.configurable?.thread_id as string || "default";
  const services = sessionManager.getSessionServices(threadId);
  const fileTools = services.file.fileTools;
  
  const response = await fileToolNode.invoke({ messages: [messages[messages.length - 1]] }, config);
  const toolMessages = response.messages as ToolMessage[];
  for (const toolMessage of toolMessages && toolMessages.length > 0 ? toolMessages : []) {
    if (["file_read", "file_read_image"].includes(toolMessage.name ?? "")) {
      return new Command({
        update: {
          messages: [toolMessage]
        },
        goto: "supervisor",
        graph: Command.PARENT
      })
    } else if (toolMessage.name === "file_write" && toolMessage.content === "") {
      return new Command({
        update: {
          messages: [toolMessage]
        },
        goto: "write_file_content"
      })
    } else if (fileTools.map((tool) => tool.name).includes(toolMessage.name ?? "")) {
      return new Command({
        update: {
          messages: [toolMessage]
        },
        goto: "agent",
      })
    } else {
      return new Command({
        update: {
          messages: [toolMessage]
        },
        goto: "supervisor",
      })
    }
  }
}

const writeFileContent = async (state: typeof MessagesAnnotation.State, config?: RunnableConfig) => {
  const threadId = config?.configurable?.thread_id as string || "default";
  const services = sessionManager.getSessionServices(threadId);
  const fileWriteTools = services.file.fileTools.filter((tool) => tool.name === "file_write");
  
  const writeFileAgent = createReactAgent({
    llm: model,
    tools: fileWriteTools,
    stateModifier: new SystemMessage(
      "You are an expert at synthesizing content according to the provided instructions and conversation history." +
      "{instruction}" +
      "When receiving a content creation instruction, assess whether adequate research has been done. If not, recommend returning to research phase first." +
      "File write strategy: Overwrite contents"
    )
  })

  const input = {
    messages: state.messages,
    instruction: state.messages[0] // first message is the instruction
  }

  const result = await writeFileAgent.invoke(input, config);
  const lastMessage = result.messages[result.messages.length - 1];
  
  return new Command({
    update: {
      messages: [lastMessage]
    },
    goto: "supervisor",
    graph: Command.PARENT
  })
}

const workflow = new StateGraph(MessagesAnnotation)
  // Define the two nodes we will cycle between
  .addNode("agent", callModel)
  .addNode("tools", callFileToolNode, { ends: ["agent", "write_file_content"] })
  .addNode("write_file_content", writeFileContent)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue, ["tools", END])
  .addEdge("tools", "agent")

const app = workflow.compile()

export default app;