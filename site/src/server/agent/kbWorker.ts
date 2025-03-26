import "dotenv/config";
import { StateGraph, MessagesAnnotation, Command, START, END } from "@langchain/langgraph";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { type RunnableConfig } from "@langchain/core/runnables";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import path from "path";

import { model, embeddings } from "./model";
import { env } from "@/env";
import fs from "fs";

// Function to get thread-specific vector store path
const getVectorStorePath = (threadId?: string): string => {
  if (!threadId) return env.VECTOR_STORE_PATH;
  return path.join(env.VECTOR_STORE_PATH, threadId);
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
    vectorStore.save(storePath);
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
type KBWorkerState = typeof MessagesAnnotation.State & {
  relevance?: string;
  rewrittenQuery?: string;
  sources?: string[]; // Track document sources
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
  
  // Create a prompt for the model to grade relevance
  const relevancePrompt = ChatPromptTemplate.fromMessages([
    ["system", `You are a grader assessing the relevance of retrieved documents to a user question.
    
    Respond with ONLY "yes" if the documents contain information relevant to answering the question.
    Respond with ONLY "no" if the documents do not contain information relevant to the question.`],
    ["human", `User question: ${originalQuery}
    
    Retrieved documents:
    ${retrievedDocs}
    
    Are these documents relevant to the question? Answer with ONLY "yes" or "no".`]
  ]);
  
  // Get the relevance assessment
  const relevanceResponse = await relevancePrompt.pipe(model).invoke({}, config);
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
  
  // Create a prompt for query rewriting
  const rewritePrompt = ChatPromptTemplate.fromMessages([
    ["system", `You are an expert at improving search queries to get better results from a knowledge base.
    Rewrite the given query to be more specific, include relevant keywords, and make it more effective for retrieval.
    Return ONLY the rewritten query, nothing else.`],
    ["human", `Original query: ${originalQuery}
    
    Rewritten query:`]
  ]);
  
  // Get the rewritten query
  const rewriteResponse = await rewritePrompt.pipe(model).invoke({}, config);
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
  
  // Create a prompt for answer generation with sources
  const generatePrompt = ChatPromptTemplate.fromMessages([
    ["system", `You are a helpful assistant that generates accurate, informative answers based on retrieved information.
    When answering:
    1. Stick to the information provided in the retrieved documents
    2. If the documents don't contain the complete answer, acknowledge the limitations
    3. Format your response clearly with appropriate structure
    4. Be concise but comprehensive
    5. Cite sources using reference numbers [1], [2], etc. where appropriate
    6. Include a "Sources" section at the end of your answer if you reference any sources`],
    ["human", `User question: ${originalQuery}
    
    Retrieved information:
    ${retrievedDocs}
    
    ${sourcesText}
    
    Please provide a helpful answer based on this information, citing sources where appropriate:`]
  ]);
  
  // Generate the answer with the sources context
  const answerResponse = await generatePrompt.pipe(model).invoke({}, config);
  
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
const kbWorkflow = new StateGraph(MessagesAnnotation)
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
const app = kbWorkflow.compile();

// Modified version of the app that passes sources to parent graph
const originalInvoke = app.invoke.bind(app);
app.invoke = async (state: KBWorkerState, config?: RunnableConfig) => {
  const result = await originalInvoke(state, config);
  
  // If we have sources in state, pass them to the parent
  if ('sources' in state && state.sources && state.sources.length > 0) {
    return {
      ...result,
      sources: state.sources
    };
  }
  
  return result;
};

export default app;

// Export a function to add documents to the vector store
export const addDocumentsToKB = async (
  documents: string[],
  metadatas?: Record<string, any>[],
  config?: RunnableConfig
): Promise<void> => {
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
};