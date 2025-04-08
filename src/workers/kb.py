from langgraph.graph import StateGraph, START, END
from langgraph.types import Command
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams
from langchain_text_splitters import RecursiveCharacterTextSplitter
import os

from src.state import State
from src.model import model, embeddings
from src.prompts import relevance_prompt, rewrite_query_prompt, generate_answer_prompt

# Vector store path
VECTOR_STORE_PATH = os.environ.get("VECTOR_STORE_PATH", "kb_data")

# Function to get thread-specific vector store path
def get_vector_store_path(thread_id=None):
    if not thread_id:
        return VECTOR_STORE_PATH
    return os.path.join(VECTOR_STORE_PATH)

# Initialize or load the vector store
async def get_vector_store(config: RunnableConfig | None = None):
    thread_id = config.get("configurable", {}).get("thread_id") if config else None
    store_path = get_vector_store_path(thread_id)
    
    # Ensure directory exists
    store_dir = os.path.dirname(store_path)
    if not os.path.exists(store_dir):
        os.makedirs(store_dir, recursive=True)
    
    # Create Qdrant client
    client = QdrantClient(path=store_path)
    
    # Use thread_id as collection_name if available, otherwise use a default
    collection_name = thread_id if thread_id else "default_kb_collection"
    
    # Check if collection exists
    collections = client.get_collections().collections
    collection_names = [collection.name for collection in collections]
    
    if collection_name not in collection_names:
        # Create a new collection with the given embedding size
        client.create_collection(
            collection_name=collection_name,
            vectors_config={
                "dense": VectorParams(
                    size=768,  # Adjust based on your embedding size
                    distance=Distance.COSINE
                )
            }
        )
    
    # Create and return vector store
    return QdrantVectorStore(
        client=client,
        collection_name=collection_name,
        embedding=embeddings
    )

# Create retriever from vector store
async def create_retriever(config=None):
    vector_store = await get_vector_store(config)
    return vector_store.as_retriever(
        search_kwargs={
            "k": 5,  # Number of documents to retrieve
            "filter": None,  # Optional filter
            "search_type": "similarity",  # Can be "similarity", "mmr", etc.
        }
    )

# Function to call the retrieval model
async def retrieve_information(state, config=None):
    messages = state.get("messages", [])
    last_message = messages[-1] if messages else None
    
    # Extract the query from either the original message or the rewritten query
    query = state.get("rewrittenQuery") or (
        last_message.content if last_message and hasattr(last_message, "content") else ""
    )
    
    # Create retriever with thread-specific config
    retriever = await create_retriever(config)
    
    # Retrieve documents
    docs = await retriever.get_relevant_documents(query or "")
    docs_content = "\n\n".join(doc.page_content for doc in docs)
    
    # Extract source information from metadata
    sources = []
    for doc in docs:
        # Get source from metadata or generate a placeholder
        source = (
            doc.metadata.get("source") or 
            doc.metadata.get("title") or 
            doc.metadata.get("filename") or 
            "Unknown source"
        )
        if source not in sources:
            sources.append(source)
    
    # Return documents as a tool message and store sources
    return {
        "messages": [
            ToolMessage(
                content=docs_content,
                tool_call_id="retrieve_information",
                name="retrieve_information"
            )
        ],
        "sources": sources  # Store sources in state
    }

# Function to grade document relevance
async def grade_documents(state, config=None):
    messages = state.get("messages", [])
    
    # Find the original query (first human message)
    original_query = next((msg.content for msg in messages if msg._getType() == "human"), None)
    
    # Find the retrieved documents (last tool message)
    retrieved_docs = next((msg.content for msg in reversed(messages) if msg._getType() == "tool"), None)
    
    if not original_query or not retrieved_docs:
        return {"relevance": "no"}
    
    # Get the relevance assessment
    relevance_response = await relevance_prompt.pipe(model).invoke({
        "query": original_query,
        "documents": retrieved_docs
    }, config)
    
    relevance = "yes" if "yes" in relevance_response.content.lower() else "no"
    
    return {"relevance": relevance}

# Function to rewrite the query
async def rewrite_query(state, config=None):
    messages = state.get("messages", [])
    
    # Find the original query
    original_query = next((msg.content for msg in messages if msg._getType() == "human"), None)
    
    if not original_query:
        return {}
    
    # Get the rewritten query
    rewrite_response = await rewrite_query_prompt.pipe(model).invoke({
        "query": original_query
    }, config)
    
    rewritten_query = rewrite_response.content
    
    return {
        "rewrittenQuery": rewritten_query,
        "messages": [
            AIMessage(f"I'll try to improve the search with a more specific query: \"{rewritten_query}\"")
        ]
    }

# Function to generate the final answer
async def generate_answer(state, config=None):
    messages = state.get("messages", [])
    sources = state.get("sources", [])
    
    # Find the original query
    original_query = next((msg.content for msg in messages if msg._getType() == "human"), None)
    
    # Find the retrieved documents
    retrieved_docs = next((msg.content for msg in reversed(messages) if msg._getType() == "tool"), None)
    
    if not original_query or not retrieved_docs:
        return Command(
            update={
                "messages": [AIMessage("I couldn't find relevant information to answer your question.")]
            },
            goto="supervisor",
            graph=Command.PARENT
        )
    
    # Format sources for inclusion in the prompt
    sources_text = (
        f"Sources:\n{chr(10).join(f'[{idx + 1}] {src}' for idx, src in enumerate(sources))}"
        if sources else "No specific sources available."
    )
    
    # Generate the answer with the sources context
    answer_response = await generate_answer_prompt.pipe(model).invoke({
        "query": original_query,
        "documents": retrieved_docs,
        "sourcesText": sources_text
    }, config)
    
    # Return the answer and sources to the parent graph
    return Command(
        update={
            "messages": [answer_response],
            "sources": sources  # Pass sources to parent graph for potential future use
        },
        goto="supervisor",
        graph=Command.PARENT
    )

# Function to determine the next node
def determine_next_node(state):
    if state.get("relevance") == "yes":
        return "generate"
    else:
        return "rewrite"

# Create the KB worker workflow
kb_workflow = (
    StateGraph(State)
    .add_node("retrieve", retrieve_information)
    .add_node("grade", grade_documents)
    .add_node("rewrite", rewrite_query)
    .add_node("generate", generate_answer)
    .add_edge(START, "retrieve")
    .add_edge("retrieve", "grade")
    .add_conditional_edges(
        "grade",
        determine_next_node,
        {
            "generate": "generate",
            "rewrite": "rewrite"
        }
    )
    .add_edge("rewrite", "retrieve")
    .add_edge("generate", END)
)

# Compile the workflow
kb_worker = kb_workflow.compile()

# Function to add documents to KB
async def add_documents_to_kb(documents, metadatas=None, config=None):
    thread_id = config.get("configurable", {}).get("thread_id") if config else None
    
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
    )
    
    docs = await text_splitter.create_documents(documents, metadatas)
    vector_store = await get_vector_store(config)
    await vector_store.add_documents(docs)

