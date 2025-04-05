import { StateGraph, Command, START, END } from "@langchain/langgraph";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { type RunnableConfig } from "@langchain/core/runnables";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { AgentState } from "../state";
import { model, embeddings } from "../model";
import { relevancePrompt, rewriteQueryPrompt, generateAnswerPrompt } from "../prompts";
import path from "path";
import fs from "fs";

// Vector store path
const VECTOR_STORE_PATH = process.env.VECTOR_STORE_PATH || "kb_data";

// Function to get thread-specific vector store path
const getVectorStorePath = (threadId?: string): string => {
  if (!threadId) return VECTOR_STORE_PATH;
  return path.join(VECTOR_STORE_PATH, threadId);
};

// Initialize or load the vector store
const getVectorStore = async (config?: RunnableConfig): Promise<FaissStore> => {
  const threadId = config?.configurable?.thread_id as string | undefined;
  const storePath = getVectorStorePath(threadId);
  
  // Ensure directory exists
  const storeDir = path.dirname(storePath);
  if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true });
  }
  
  if (!fs.existsSync(storePath)) {
    const vectorStore = new FaissStore(embeddings, {});
    await vectorStore.save(storePath);
    return vectorStore;
  } else {
    return await FaissStore.load(storePath, embeddings);
  }
};

// Create retriever from vector store
const createRetriever = async (config?: RunnableConfig) => {
  const vectorStore = await getVectorStore(config);
  return vectorStore.asRetriever({
    k: 5, // Number of documents to retrieve
    filter: undefined, // Optional filter
    searchType: "similarity", // Can be "similarity", "mmr", etc.
  });
};

// Custom type to represent our state including relevance and sources
type KBWorkerState = typeof AgentState.State & {
  relevance?: string;
  rewrittenQuery?: string;
};

// Function to call the retrieval model
const retrieveInformation = async (
  state: KBWorkerState,
  config?: RunnableConfig
): Promise<Partial<KBWorkerState>> => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];
  
  // Extract the query from either the original message or the rewritten query
  const query = state.rewrittenQuery || 
               (typeof lastMessage?.content === 'string' ? lastMessage.content : lastMessage?.content.toString());
  
  // Create retriever with thread-specific config
  const retriever = await createRetriever(config);
  
  // Retrieve documents
  const docs = await retriever.getRelevantDocuments(query || "");
  const docsContent = docs.map(doc => doc.pageContent).join("\n\n");
  
  // Extract source information from metadata
  const sources = docs.map(doc => {
    // Get source from metadata or generate a placeholder
    return doc.metadata?.source || 
           doc.metadata?.title || 
           doc.metadata?.filename || 
           "Unknown source";
  }).filter((value, index, self) => {
    // Remove duplicates
    return self.indexOf(value) === index;
  });
  
  // Return documents as a tool message and store sources
  return {
    messages: [
      new ToolMessage({
        content: docsContent,
        tool_call_id: "retrieve_information",
        name: "retrieve_information"
      })
    ],
    sources // Store sources in state
  };
};

// Function to grade document relevance
const gradeDocuments = async (
  state: KBWorkerState,
  config?: RunnableConfig
): Promise<Partial<KBWorkerState>> => {
  const { messages } = state;
  
  // Find the original query (first human message)
  const originalQuery = messages.find(msg => msg._getType() === "human")?.content;
  
  // Find the retrieved documents (last tool message)
  const retrievedDocs = messages.filter(msg => msg._getType() === "tool").pop()?.content;
  
  if (!originalQuery || !retrievedDocs) {
    return { relevance: "no" };
  }
  
  // Get the relevance assessment
  const relevanceResponse = await relevancePrompt.pipe(model).invoke({
    query: originalQuery,
    documents: retrievedDocs
  }, config);
  
  const relevance = relevanceResponse.content.toString().toLowerCase().includes("yes") ? "yes" : "no";
  
  return { relevance };
};

// Function to rewrite the query
const rewriteQuery = async (
  state: KBWorkerState,
  config?: RunnableConfig
): Promise<Partial<KBWorkerState>> => {
  const { messages } = state;
  
  // Find the original query
  const originalQuery = messages.find(msg => msg._getType() === "human")?.content;
  
  if (!originalQuery) {
    return {};
  }
  
  // Get the rewritten query
  const rewriteResponse = await rewriteQueryPrompt.pipe(model).invoke({
    query: originalQuery
  }, config);
  
  const rewrittenQuery = rewriteResponse.content.toString();
  
  return { 
    rewrittenQuery,
    messages: [
      new AIMessage(`I'll try to improve the search with a more specific query: "${rewrittenQuery}"`)
    ]
  };
};

// Function to generate the final answer
const generateAnswer = async (
  state: KBWorkerState,
  config?: RunnableConfig
): Promise<Partial<KBWorkerState> | Command> => {
  const { messages, sources = [] } = state;
  
  // Find the original query
  const originalQuery = messages.find(msg => msg._getType() === "human")?.content;
  
  // Find the retrieved documents
  const retrievedDocs = messages.filter(msg => msg._getType() === "tool").pop()?.content;
  
  if (!originalQuery || !retrievedDocs) {
    return new Command({
      update: {
        messages: [new AIMessage("I couldn't find relevant information to answer your question.")]
      },
      goto: "supervisor",
      graph: Command.PARENT
    });
  }
  
  // Format sources for inclusion in the prompt
  const sourcesText = sources.length > 0
    ? `Sources:\n${sources.map((src, idx) => `[${idx + 1}] ${src}`).join("\n")}`
    : "No specific sources available.";
  
  // Generate the answer with the sources context
  const answerResponse = await generateAnswerPrompt.pipe(model).invoke({
    query: originalQuery,
    documents: retrievedDocs,
    sourcesText
  }, config);
  
  // Return the answer and sources to the parent graph
  return new Command({
    update: {
      messages: [answerResponse],
      sources // Pass sources to parent graph for potential future use
    },
    goto: "supervisor",
    graph: Command.PARENT
  });
};

// Function to determine the next node
const determineNextNode = (state: KBWorkerState): string => {
  if (state.relevance === "yes") {
    return "generate";
  } else {
    return "rewrite";
  }
};

// Create the KB worker workflow
const kbWorkflow = new StateGraph(AgentState)
  .addNode("retrieve", retrieveInformation)
  .addNode("grade", gradeDocuments)
  .addNode("rewrite", rewriteQuery)
  .addNode("generate", generateAnswer)
  .addEdge(START, "retrieve")
  .addEdge("retrieve", "grade")
  .addConditionalEdges(
    "grade",
    determineNextNode,
    {
      "generate": "generate",
      "rewrite": "rewrite"
    }
  )
  .addEdge("rewrite", "retrieve")
  .addEdge("generate", END);

// Compile the workflow
const kbWorker = kbWorkflow.compile();

// Export addDocumentsToKB function
export async function addDocumentsToKB(
  documents: string[],
  metadatas?: Record<string, any>[],
  config?: RunnableConfig
): Promise<void> {
  const threadId = config?.configurable?.thread_id as string | undefined;
  const storePath = getVectorStorePath(threadId);
  
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  
  const docs = await textSplitter.createDocuments(documents, metadatas);
  const vectorStore = await getVectorStore(config);
  await vectorStore.addDocuments(docs);
  await vectorStore.save(storePath);
}

export default kbWorker;
