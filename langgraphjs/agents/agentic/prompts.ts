import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";

// Planner prompt
export const plannerPrompt = ChatPromptTemplate.fromTemplate(`
You are a planner that breaks down a complex task into high-level steps and expands them into detailed hierarchical plans.
For the following task:
{input}

Create a list of 1-7 high-level sequential steps to accomplish this task.
Each step should be a clear, actionable item that leads towards the final goal.
For each high-level step, create a detailed expansion with:
1. A clear description of the step
2. 1-4 substeps that break down how to accomplish this step, depending on the complexity of the step.
`);

// Replanner prompt
export const replannerPrompt = ChatPromptTemplate.fromTemplate(`
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
`);

// Supervisor routing prompt
export const supervisorPrompt = ChatPromptTemplate.fromMessages([
  ["system", `
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
`],
  new MessagesPlaceholder("messages"),
]);

// KB Worker prompts
export const relevancePrompt = ChatPromptTemplate.fromMessages([
  ["system", `You are a grader assessing the relevance of retrieved documents to a user question.
  
  Respond with ONLY "yes" if the documents contain information relevant to answering the question.
  Respond with ONLY "no" if the documents do not contain information relevant to the question.`],
  ["human", `User question: {query}
  
  Retrieved documents:
  {documents}
  
  Are these documents relevant to the question? Answer with ONLY "yes" or "no".`]
]);

export const rewriteQueryPrompt = ChatPromptTemplate.fromMessages([
  ["system", `You are an expert at improving search queries to get better results from a knowledge base.
  Rewrite the given query to be more specific, include relevant keywords, and make it more effective for retrieval.
  Return ONLY the rewritten query, nothing else.`],
  ["human", `Original query: {query}
  
  Rewritten query:`]
]);

export const generateAnswerPrompt = ChatPromptTemplate.fromMessages([
  ["system", `You are a helpful assistant that generates accurate, informative answers based on retrieved information.
  When answering:
  1. Stick to the information provided in the retrieved documents
  2. If the documents don't contain the complete answer, acknowledge the limitations
  3. Format your response clearly with appropriate structure
  4. Be concise but comprehensive
  5. Cite sources using reference numbers [1], [2], etc. where appropriate
  6. Include a "Sources" section at the end of your answer if you reference any sources`],
  ["human", `User question: {query}
  
  Retrieved information:
  {documents}
  
  {sourcesText}
  
  Please provide a helpful answer based on this information, citing sources where appropriate:`]
]);
