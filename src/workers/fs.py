from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import create_react_agent, ToolNode
from langchain_core.messages import HumanMessage
from langgraph.types import Command

from src.model import model
from src.state import State
from src.tools import fs_toolkit
from src.prompts import file_write_prompt

# Get file tool node based on thread_id
def get_file_tool_node(config=None):
    thread_id = config.get("configurable", {}).get("thread_id", "default") if config else "default"
    # In Python, we'll use a simpler approach since we don't need the session manager
    return ToolNode(fs_toolkit)

# Get model with file tools bound
def get_model_with_tools(config=None):
    thread_id = config.get("configurable", {}).get("thread_id", "default") if config else "default"
    # Bind tools to model
    return model.bind_tools(fs_toolkit)

# Determine if we should continue based on tool calls
def should_continue(state):
    messages = state.get("messages", [])
    if not messages:
        return END
    
    last_message = messages[-1]
    # Check if the last message has tool calls
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return END

# Call the model
async def call_model(state, config=None):
    messages = state.get("messages", [])
    model_with_tools = get_model_with_tools(config)
    response = await model_with_tools.invoke(messages, config)
    return {"messages": [response]}

# Call file tools
async def call_file_tool_node(state, config=None):
    messages = state.get("messages", [])
    file_tool_node = get_file_tool_node(config)
    
    # Get the last message only for the tool node
    response = await file_tool_node.invoke({"messages": [messages[-1]]}, config)
    
    tool_messages = response.get("messages", [])
    if not tool_messages:
        # Return to agent if no tool messages
        return Command(
            update={
                "messages": []
            },
            goto="agent"
        )
    
    # Process each tool message
    for tool_message in tool_messages:
        # Special handling for file read operations
        if tool_message.name in ["file_read", "file_read_image"]:
            return Command(
                update={
                    "messages": [tool_message]
                },
                goto="supervisor",
                graph=Command.PARENT
            )
        # Special handling for file write with empty content
        elif tool_message.name == "file_write" and tool_message.content == "":
            return Command(
                update={
                    "messages": [tool_message]
                },
                goto="write_file_content"
            )
        # For other file operations, continue with the agent
        elif tool_message.name in [tool.name for tool in fs_toolkit]:
            return Command(
                update={
                    "messages": [tool_message]
                },
                goto="agent"
            )
        # Default case: go back to supervisor
        else:
            return Command(
                update={
                    "messages": [tool_message]
                },
                goto="supervisor",
                graph=Command.PARENT
            )
    
    # Default fallback if no tool messages were processed
    return Command(
        update={
            "messages": []
        },
        goto="supervisor",
        graph=Command.PARENT
    )

# Handle file content writing
async def write_file_content(state, config=None):
    messages = state.get("messages", [])
    
    # Filter for file write tools
    file_write_tools = [tool for tool in fs_toolkit if tool.name == "file_write"]
    
    # Create agent specifically for file writing
    write_file_agent = create_react_agent(
        llm=model,
        tools=file_write_tools,
        prompt=file_write_prompt
    )
    
    # Prepare input for the agent
    input_data = {
        "messages": messages,
        "instruction": messages[0] if messages else HumanMessage(content="")  # first message is the instruction
    }
    
    # Invoke the agent
    result = await write_file_agent.invoke(input_data, config)
    
    # Get the last message from the result
    last_message = result.get("messages", [])[-1] if result.get("messages") else None
    
    # Return to supervisor
    return Command(
        update={
            "messages": [last_message] if last_message else []
        },
        goto="supervisor",
        graph=Command.PARENT
    )

# Create the file system worker workflow
workflow = (
    StateGraph(State)
    # Define the nodes
    .add_node("agent", call_model)
    .add_node("tools", call_file_tool_node)
    .add_node("write_file_content", write_file_content)
    # Define the edges
    .add_edge(START, "agent")
    .add_conditional_edges("agent", should_continue, ["tools", END])
    .add_edge("tools", "agent")
)

# Compile the workflow
fs_worker = workflow.compile()
